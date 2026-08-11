import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunHistoryStore } from "../../src/runs/run-history-store.js";
import type { PageReport, TestingRunResponse } from "../../src/types/report.js";
import type { TestingRunRequest } from "../../src/types/testing.js";

describe("RunHistoryStore", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it("atomically checkpoints redacted manifests and exposes finalized history", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "run-history-"));
    const store = new RunHistoryStore(root, 14);
    const request = requestFor();
    request.credentials = { username: "admin", password: "super-secret" };
    await store.initializeRun("run_1", request, "https://example.com", "2026-08-01T00:00:00.000Z");

    const reportPath = path.join(root, "run_1", "reports", "page-000001.json");
    await fs.writeFile(reportPath, JSON.stringify(pageFor()), "utf8");
    store.noteSequence("run_1", 17);
    await store.checkpointPage("run_1", reportPath, [pageFor()]);
    await store.checkpointPage("run_1", reportPath, [pageFor()]);

    const manifestText = await fs.readFile(path.join(root, "run_1", "manifest.json"), "utf8");
    expect(manifestText).not.toContain("super-secret");
    expect(manifestText).not.toContain("admin");
    expect(JSON.parse(manifestText).pageReports).toEqual(["reports/page-000001.json"]);
    expect(JSON.parse(manifestText).latestSequence).toBe(17);
    expect((await fs.readdir(path.join(root, "run_1"))).some((name) => name.endsWith(".tmp"))).toBe(false);

    const report = reportFor("run_1");
    await store.finalize(report);
    const history = await store.list();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ runId: "run_1", issueCount: 0, runStatus: "COMPLETED" });
    expect((await store.getSnapshot("run_1"))?.report?.runId).toBe("run_1");
  });

  it("recovers an unterminated manifest from completed page reports", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "run-recovery-"));
    const first = new RunHistoryStore(root, 14);
    await first.initializeRun("run_crashed", requestFor(), "https://example.com", "2026-08-01T00:00:00.000Z");
    const reportPath = path.join(root, "run_crashed", "reports", "page-000001.json");
    await fs.writeFile(reportPath, JSON.stringify(pageFor("FAILED")), "utf8");
    await first.checkpointPage("run_crashed", reportPath, [pageFor("FAILED")]);

    const restarted = new RunHistoryStore(root, 14);
    await restarted.initialize();

    const snapshot = await restarted.getSnapshot("run_crashed");
    expect(snapshot?.status).toBe("failed");
    expect(snapshot?.report).toMatchObject({ runStatus: "ERRORED", findingsStatus: "ISSUES_FOUND", status: "ERROR", stoppedReason: "error" });
    expect(snapshot?.report?.pages).toHaveLength(1);
  });

  it("sweeps only expired run directories and rejects escaped artifact paths", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "run-retention-"));
    const store = new RunHistoryStore(root, 14);
    await store.initializeRun("run_safe", requestFor(), "https://example.com", "2026-08-01T00:00:00.000Z");
    await expect(store.checkpointPage("run_safe", path.join(root, "outside.json"), [pageFor()])).rejects.toThrow("escaped");
    await store.initializeRun("run_old", requestFor(), "https://example.com", "2020-01-01T00:00:00.000Z");
    await store.finalize({ ...reportFor("run_old"), completedAt: "2020-01-02T00:00:00.000Z" });
    await store.sweep(Date.parse("2026-08-11T00:00:00.000Z"));
    await expect(fs.stat(path.join(root, "run_old"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

function requestFor(): TestingRunRequest {
  return {
    targetUrl: "https://example.com",
    authorizationConfirmed: true,
    environment: "staging",
    testTypes: ["SMOKE"],
    crawl: { strategy: "DFS", sameOriginOnly: true, includePatterns: [], excludePatterns: [] },
    browser: { channel: "chrome", headless: true, viewport: { width: 1280, height: 720 } },
    execution: {
      safeMode: true,
      allowFormSubmission: false,
      allowFileUploads: false,
      allowDestructiveActions: false,
      allowPayments: false,
      maximumActionsPerPage: 10,
      maximumRunDurationSeconds: 300,
    },
  };
}

function pageFor(status: PageReport["status"] = "PASSED"): PageReport {
  return {
    url: "https://example.com/",
    canonicalUrl: "https://example.com/",
    status,
    tests: status === "FAILED" ? [{
      id: "seeded",
      name: "Seeded defect",
      type: "SMOKE",
      status: "FAILED",
      steps: [],
      assertions: [],
      reproductionSteps: [],
      evidence: [],
      severity: "HIGH",
    }] : [],
    consoleErrors: [],
    failedNetworkRequests: [],
    performanceObservations: [],
    evidence: [],
  };
}

function reportFor(runId: string): TestingRunResponse {
  return {
    runId,
    runStatus: "COMPLETED",
    findingsStatus: "PASSED",
    status: "PASSED",
    startedAt: "2026-08-01T00:00:00.000Z",
    completedAt: "2026-08-01T00:01:00.000Z",
    targetOrigin: "https://example.com",
    selectedTestingTypes: ["SMOKE"],
    stoppedReason: "converged",
    summary: {
      pagesDiscovered: 1, pagesTested: 1, pagesSkipped: 0, pagesNotReached: 0,
      testsExecuted: 0, passedTests: 0, failedTests: 0, skippedTests: 0,
      blockedByPolicy: 0, inconclusiveTests: 0, consoleErrors: 0,
      failedNetworkRequests: 0, artifactsBytes: 12,
    },
    pages: [pageFor()], issues: [], coverageLimitations: [], artifacts: [],
  };
}
