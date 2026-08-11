import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { URL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const liveAi = process.argv.includes("--live-ai");
const targetUrl = "http://127.0.0.1:43117";
const artifactRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tester-acceptance-"));
let fixture;

process.env.ARTIFACT_ROOT = artifactRoot;
process.env.ALLOW_PRIVATE_NETWORK_TARGETS = "true";
process.env.REQUIRE_HTTPS = "false";
process.env.BROWSER_HEADLESS = "true";
process.env.MAX_AI_CALLS_PER_RUN = liveAi ? (process.env.MAX_AI_CALLS_PER_RUN || "25") : "0";
if (liveAi) process.env.AI_RESPONSE_TIMEOUT_MS = process.env.ACCEPTANCE_AI_TIMEOUT_MS || "90000";

try {
  if (!(await isFixtureReady())) {
    fixture = spawn(process.execPath, ["tests/fixtures/test-site/server.mjs"], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    await waitForFixture();
  }

  const [{ config }, { preflightOpenRouterModels }, { RunHistoryStore }, { RunOrchestrator }] = await Promise.all([
    import("../dist/src/config/env.js"),
    import("../dist/src/config/openrouter-preflight.js"),
    import("../dist/src/runs/run-history-store.js"),
    import("../dist/src/services/run-orchestrator.js"),
  ]);
  if (liveAi) await preflightOpenRouterModels();

  const history = new RunHistoryStore(config.artifacts.root, 14);
  await history.initialize();
  const events = [];
  const report = await new RunOrchestrator(history).run(request(), { onEvent: (event) => events.push(event) });
  assertAcceptance(report, events, liveAi);
  console.log(JSON.stringify({
    mode: liveAi ? "live-ai" : "deterministic",
    models: liveAi ? config.openRouter.models : [],
    runId: report.runId,
    runStatus: report.runStatus,
    findingsStatus: report.findingsStatus,
    stoppedReason: report.stoppedReason,
    issues: report.issues.map((issue) => ({ title: issue.title, pageUrl: issue.pageUrl, severity: issue.severity })),
    ai: report.diagnostics?.ai,
  }, null, 2));
} finally {
  if (fixture) fixture.kill();
  await fs.rm(artifactRoot, { recursive: true, force: true });
}

function request() {
  return {
    targetUrl,
    authorizationConfirmed: true,
    writeActionsAcknowledged: true,
    environment: "staging",
    testTypes: [
      "SMOKE", "PAGE_DISCOVERY", "NAVIGATION", "LINKS", "FORMS", "FORM_VALIDATION",
      "AUTHENTICATION", "API_NETWORK", "ERROR_HANDLING", "PERFORMANCE_BASIC",
      "CONSOLE_ERRORS", "ACCESSIBILITY_TECHNICAL",
    ],
    crawl: { strategy: "DFS", maxDepth: 7, maxPages: 500, sameOriginOnly: true, includePatterns: [], excludePatterns: [], ignoredQueryParameters: [] },
    browser: { channel: "chrome", headless: true, viewport: { width: 1280, height: 720 } },
    execution: {
      safeMode: true,
      allowFormSubmission: true,
      allowFileUploads: false,
      allowDestructiveActions: false,
      allowPayments: false,
      maximumActionsPerPage: 50,
      maximumRunDurationSeconds: liveAi ? 1800 : 600,
    },
  };
}

function assertAcceptance(report, events, isLive) {
  const failures = [];
  if (report.runStatus !== "COMPLETED") failures.push(`runStatus=${report.runStatus}`);
  if (report.findingsStatus !== "ISSUES_FOUND") failures.push(`findingsStatus=${report.findingsStatus}`);
  if (report.stoppedReason !== "converged") failures.push(`stoppedReason=${report.stoppedReason}`);
  if (report.summary.inconclusiveTests !== 0) failures.push(`inconclusive=${report.summary.inconclusiveTests}`);
  for (const route of ["/signup", "/contact", "/feedback"]) {
    if (!report.issues.some((issue) => new URL(issue.pageUrl ?? targetUrl).pathname === route)) failures.push(`missing seeded finding ${route}`);
  }
  for (const route of ["/signup", "/contact"]) {
    const finding = report.issues.find((issue) => new URL(issue.pageUrl ?? targetUrl).pathname === route);
    if (finding?.severity !== "HIGH") failures.push(`${route} severity=${finding?.severity ?? "missing"}`);
  }
  const feedback = report.issues.find((issue) => new URL(issue.pageUrl ?? targetUrl).pathname === "/feedback");
  if (feedback?.severity !== "MEDIUM") failures.push(`/feedback severity=${feedback?.severity ?? "missing"}`);
  const login = report.pages.find((page) => new URL(page.url).pathname === "/login");
  if (!login || login.tests.some((test) => test.status === "FAILED" || test.status === "ERROR" || test.status === "INCONCLUSIVE")) {
    failures.push("clean /login control did not pass conclusively");
  }
  if (!events.some((event) => event.type === "form:duplicate_skipped")) failures.push("cross-page duplicate event missing");
  if (!isLive && report.diagnostics?.ai.disabled !== true) failures.push("deterministic run did not disable AI");
  if (isLive && (report.diagnostics?.ai.successes ?? 0) < 1) failures.push("no schema-valid live AI batch completed");
  if (failures.length) throw new Error(`Acceptance failed:\n- ${failures.join("\n- ")}`);
}

async function isFixtureReady() {
  try {
    return (await fetch(targetUrl)).ok;
  } catch {
    return false;
  }
}

async function waitForFixture() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await isFixtureReady()) return;
    await delay(100);
  }
  throw new Error("Acceptance fixture did not start.");
}
