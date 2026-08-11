import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config/env.js";
import { logger } from "../config/logger.js";
import { redactSecrets } from "../security/secret-redaction.js";
import { getTestTypeAvailability } from "../testing/test-types.js";
import type { TestingType } from "../testing/test-types.js";
import type {
  FindingsStatus,
  Issue,
  LegacyStatus,
  PageReport,
  RunHistoryItem,
  RunStatus,
  RunSummary,
  StoppedReason,
  TestingRunResponse,
} from "../types/report.js";
import type { TestingRunRequest } from "../types/testing.js";
import type { AsyncRunSnapshot } from "./run-events.js";
import { buildIssuesFromPages } from "../reporting/issue-builder.js";

const MANIFEST_VERSION = 1 as const;
const FINAL_REPORT_PATH = "reports/report.json";

export interface RunManifest {
  version: typeof MANIFEST_VERSION;
  runId: string;
  request: unknown;
  targetOrigin: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  terminalStatus: RunStatus | null;
  findingsStatus?: FindingsStatus;
  legacyStatus?: LegacyStatus;
  stoppedReason?: StoppedReason;
  counts: Partial<RunSummary>;
  issueCount: number;
  pageReports: string[];
  reportPath?: string;
  latestSequence: number;
  recoveryDiagnostics?: { recoveredAt: string; reason: string };
}

export class RunHistoryStore {
  private readonly root: string;
  private readonly latestSequences = new Map<string, number>();

  constructor(root = config.artifacts.root, private readonly retentionDays = config.artifacts.retentionDays) {
    this.root = path.resolve(root);
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    await this.recoverIncompleteRuns();
    await this.sweep();
  }

  async initializeRun(runId: string, request: TestingRunRequest, targetOrigin: string, startedAt: string): Promise<void> {
    const runRoot = this.runRoot(runId);
    await fs.mkdir(path.join(runRoot, "reports"), { recursive: true });
    const manifest: RunManifest = {
      version: MANIFEST_VERSION,
      runId,
      request: persistedRequest(request),
      targetOrigin,
      startedAt,
      updatedAt: startedAt,
      terminalStatus: null,
      counts: {},
      issueCount: 0,
      pageReports: [],
      latestSequence: this.latestSequences.get(runId) ?? 0,
    };
    await this.writeManifest(manifest);
  }

  noteSequence(runId: string, sequence: number): void {
    this.latestSequences.set(runId, sequence);
  }

  async persistSequence(runId: string): Promise<void> {
    const manifest = await this.readManifest(runId);
    if (!manifest) return;
    manifest.latestSequence = this.latestSequences.get(runId) ?? manifest.latestSequence;
    manifest.updatedAt = new Date().toISOString();
    await this.writeManifest(manifest);
  }

  async checkpointPage(runId: string, reportPath: string, pages: PageReport[]): Promise<void> {
    const manifest = await this.readManifest(runId);
    if (!manifest || manifest.terminalStatus) return;
    const relativeReportPath = this.relativeRunPath(runId, reportPath);
    if (!manifest.pageReports.includes(relativeReportPath)) manifest.pageReports.push(relativeReportPath);
    const partial = summarizePages(pages);
    manifest.counts = partial.summary;
    manifest.issueCount = partial.issues.length;
    manifest.updatedAt = new Date().toISOString();
    manifest.latestSequence = this.latestSequences.get(runId) ?? manifest.latestSequence;
    await this.writeManifest(manifest);
  }

  async finalize(report: TestingRunResponse): Promise<void> {
    const manifest = await this.readManifest(report.runId);
    if (!manifest) return;
    const reportPath = path.join(this.runRoot(report.runId), FINAL_REPORT_PATH);
    await atomicWriteJson(reportPath, redactSecrets(report));
    manifest.completedAt = report.completedAt;
    manifest.updatedAt = report.completedAt;
    manifest.terminalStatus = report.runStatus;
    manifest.findingsStatus = report.findingsStatus;
    manifest.legacyStatus = report.status;
    manifest.stoppedReason = report.stoppedReason;
    manifest.counts = report.summary;
    manifest.issueCount = report.issues.length;
    manifest.reportPath = FINAL_REPORT_PATH;
    manifest.latestSequence = this.latestSequences.get(report.runId) ?? manifest.latestSequence;
    await this.writeManifest(manifest);
    for (let pass = 0; pass < 2; pass += 1) {
      const artifactsBytes = await directorySize(this.runRoot(report.runId));
      report.summary.artifactsBytes = artifactsBytes;
      manifest.counts = report.summary;
      await atomicWriteJson(reportPath, redactSecrets(report));
      await this.writeManifest(manifest);
    }
  }

  async list(): Promise<RunHistoryItem[]> {
    const manifests = await this.readAllManifests();
    return manifests
      .filter((manifest) => manifest.terminalStatus && manifest.completedAt && manifest.findingsStatus && manifest.legacyStatus)
      .map((manifest) => historyItem(manifest))
      .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
  }

  async getReport(runId: string): Promise<TestingRunResponse | undefined> {
    const manifest = await this.readManifest(runId);
    if (!manifest?.reportPath) return undefined;
    try {
      const value = JSON.parse(await fs.readFile(this.resolveRunPath(runId, manifest.reportPath), "utf8"));
      return value as TestingRunResponse;
    } catch (error) {
      logger.warn({ err: redactSecrets(error), runId }, "Failed to read persisted run report");
      return undefined;
    }
  }

  async getSnapshot(runId: string): Promise<AsyncRunSnapshot | undefined> {
    const manifest = await this.readManifest(runId);
    if (!manifest?.terminalStatus) return undefined;
    const report = await this.getReport(runId);
    if (!report) return undefined;
    return {
      runId,
      status: manifest.terminalStatus === "STOPPED" ? "stopped" : manifest.terminalStatus === "ERRORED" ? "failed" : "completed",
      startedAt: manifest.startedAt,
      updatedAt: manifest.updatedAt,
      completedAt: manifest.completedAt,
      events: [],
      report,
      error: manifest.recoveryDiagnostics,
    };
  }

  async has(runId: string): Promise<boolean> {
    return Boolean(await this.readManifest(runId));
  }

  async recoverIncompleteRuns(): Promise<void> {
    for (const manifest of await this.readAllManifests()) {
      if (manifest.terminalStatus !== null) continue;
      try {
        const pages: PageReport[] = [];
        for (const reportPath of manifest.pageReports) {
          const value = JSON.parse(await fs.readFile(this.resolveRunPath(manifest.runId, reportPath), "utf8"));
          pages.push(value as PageReport);
        }
        const completedAt = new Date().toISOString();
        const report = recoveredReport(manifest, pages, completedAt);
        manifest.recoveryDiagnostics = { recoveredAt: completedAt, reason: "unterminated_manifest" };
        await atomicWriteJson(path.join(this.runRoot(manifest.runId), FINAL_REPORT_PATH), report);
        manifest.completedAt = completedAt;
        manifest.updatedAt = completedAt;
        manifest.terminalStatus = "ERRORED";
        manifest.findingsStatus = report.findingsStatus;
        manifest.legacyStatus = "ERROR";
        manifest.stoppedReason = "error";
        manifest.counts = report.summary;
        manifest.issueCount = report.issues.length;
        manifest.reportPath = FINAL_REPORT_PATH;
        await this.writeManifest(manifest);
      } catch (error) {
        logger.warn({ err: redactSecrets(error), runId: manifest.runId }, "Failed to recover unterminated run manifest");
      }
    }
  }

  async sweep(now = Date.now()): Promise<void> {
    const cutoff = now - this.retentionDays * 24 * 60 * 60 * 1000;
    for (const manifest of await this.readAllManifests()) {
      const timestamp = Date.parse(manifest.completedAt ?? manifest.updatedAt);
      if (!Number.isFinite(timestamp) || timestamp >= cutoff) continue;
      const runRoot = this.runRoot(manifest.runId);
      if (path.dirname(runRoot) !== this.root) continue;
      await fs.rm(runRoot, { recursive: true, force: true });
      this.latestSequences.delete(manifest.runId);
    }
  }

  private async readAllManifests(): Promise<RunManifest[]> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(this.root, { withFileTypes: true });
    } catch {
      return [];
    }
    const manifests: RunManifest[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifest = await this.readManifest(entry.name);
      if (manifest) manifests.push(manifest);
    }
    return manifests;
  }

  private async readManifest(runId: string): Promise<RunManifest | undefined> {
    try {
      const value = JSON.parse(await fs.readFile(path.join(this.runRoot(runId), "manifest.json"), "utf8"));
      if (!isManifest(value) || value.runId !== runId) throw new Error("Invalid run manifest shape.");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.warn({ err: redactSecrets(error), runId }, "Skipping invalid run manifest");
      }
      return undefined;
    }
  }

  private async writeManifest(manifest: RunManifest): Promise<void> {
    await atomicWriteJson(path.join(this.runRoot(manifest.runId), "manifest.json"), manifest);
  }

  private runRoot(runId: string): string {
    if (!runId || path.basename(runId) !== runId || /[\\/]/.test(runId)) throw new Error("Invalid run ID.");
    const resolved = path.resolve(this.root, runId);
    if (path.dirname(resolved) !== this.root) throw new Error("Run path escaped artifact root.");
    return resolved;
  }

  private relativeRunPath(runId: string, filePath: string): string {
    const resolved = path.resolve(filePath);
    const runRoot = this.runRoot(runId);
    if (resolved !== runRoot && !resolved.startsWith(`${runRoot}${path.sep}`)) throw new Error("Artifact path escaped run directory.");
    return path.relative(runRoot, resolved).replace(/\\/g, "/");
  }

  private resolveRunPath(runId: string, relativePath: string): string {
    const runRoot = this.runRoot(runId);
    const resolved = path.resolve(runRoot, relativePath);
    if (!resolved.startsWith(`${runRoot}${path.sep}`)) throw new Error("Manifest path escaped run directory.");
    return resolved;
  }
}

function isManifest(value: unknown): value is RunManifest {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<RunManifest>;
  return item.version === MANIFEST_VERSION && typeof item.runId === "string" && typeof item.startedAt === "string" &&
    typeof item.updatedAt === "string" && Array.isArray(item.pageReports) && typeof item.latestSequence === "number" &&
    (item.terminalStatus === null || ["COMPLETED", "STOPPED", "ERRORED"].includes(item.terminalStatus ?? ""));
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

async function directorySize(root: string): Promise<number> {
  let total = 0;
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) total += await directorySize(entryPath);
    else if (entry.isFile() && !entry.name.endsWith(".tmp")) total += (await fs.stat(entryPath)).size;
  }
  return total;
}

function summarizePages(pages: PageReport[]): { summary: RunSummary; issues: Issue[] } {
  const tests = pages.flatMap((page) => page.tests);
  const failed = tests.filter((test) => test.status === "FAILED" || test.status === "ERROR");
  const issues = buildIssuesFromPages(pages);
  const summary: RunSummary = {
    pagesDiscovered: pages.length,
    pagesTested: pages.filter((page) => page.status !== "SKIPPED").length,
    pagesSkipped: pages.filter((page) => page.status === "SKIPPED").length,
    pagesNotReached: 0,
    testsExecuted: tests.length,
    passedTests: tests.filter((test) => test.status === "PASSED").length,
    failedTests: failed.length,
    skippedTests: tests.filter((test) => test.status === "SKIPPED").length,
    blockedByPolicy: tests.filter((test) => test.status === "BLOCKED_BY_POLICY").length,
    inconclusiveTests: tests.filter((test) => test.status === "INCONCLUSIVE").length,
    consoleErrors: pages.reduce((sum, page) => sum + page.consoleErrors.length, 0),
    failedNetworkRequests: pages.reduce((sum, page) => sum + page.failedNetworkRequests.length, 0),
    artifactsBytes: pages.flatMap((page) => page.evidence).reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0),
  };
  return { summary, issues };
}

function recoveredReport(manifest: RunManifest, pages: PageReport[], completedAt: string): TestingRunResponse {
  const { summary, issues } = summarizePages(pages);
  const selectedTestingTypes = selectedTypes(manifest.request);
  return {
    runId: manifest.runId,
    runStatus: "ERRORED",
    findingsStatus: issues.length > 0 ? "ISSUES_FOUND" : "INCONCLUSIVE",
    status: "ERROR",
    startedAt: manifest.startedAt,
    completedAt,
    targetOrigin: manifest.targetOrigin,
    selectedTestingTypes,
    stoppedReason: "error",
    summary,
    pages,
    issues,
    coverageLimitations: selectedTestingTypes.map((testType) => ({
      testType,
      availability: getTestTypeAvailability(testType),
      executed: false,
      reason: "Run exited unexpectedly; only completed per-page reports were recovered.",
    })),
    artifacts: pages.flatMap((page) => page.evidence),
  };
}

function selectedTypes(request: unknown): TestingType[] {
  if (!request || typeof request !== "object" || !("testTypes" in request)) return [];
  const values = (request as { testTypes?: unknown }).testTypes;
  return Array.isArray(values) ? values.filter((value): value is TestingType => typeof value === "string") : [];
}

function persistedRequest(request: TestingRunRequest): unknown {
  const sanitized = redactSecrets(request) as unknown as Record<string, unknown>;
  delete sanitized.credentials;
  if (Array.isArray(sanitized.roles)) {
    sanitized.roles = sanitized.roles.map((role) => {
      if (!role || typeof role !== "object") return role;
      const safeRole = { ...(role as Record<string, unknown>) };
      delete safeRole.credentials;
      return safeRole;
    });
  }
  return sanitized;
}

function historyItem(manifest: RunManifest): RunHistoryItem {
  const summary = manifest.counts as RunSummary;
  return {
    runId: manifest.runId,
    targetOrigin: manifest.targetOrigin,
    runStatus: manifest.terminalStatus!,
    findingsStatus: manifest.findingsStatus!,
    status: manifest.legacyStatus!,
    stoppedReason: manifest.stoppedReason,
    startedAt: manifest.startedAt,
    completedAt: manifest.completedAt!,
    summary,
    issueCount: manifest.issueCount,
    artifactsBytes: summary.artifactsBytes ?? 0,
  };
}
