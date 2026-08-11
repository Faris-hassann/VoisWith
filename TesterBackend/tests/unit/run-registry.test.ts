import { describe, expect, it } from "vitest";
import { RunRegistry } from "../../src/runs/run-registry.js";
import type { RunEventSink } from "../../src/runs/run-events.js";
import type { TestingRunResponse } from "../../src/types/report.js";
import type { TestingRunRequest } from "../../src/types/testing.js";

describe("RunRegistry", () => {
  it("buffers progress events and final report for async runs", async () => {
    const registry = new RunRegistry({
      run: async (_request: TestingRunRequest, options?: { runId?: string; onEvent?: RunEventSink }) => {
        options?.onEvent?.({
          runId: options.runId ?? "missing",
          type: "page.snapshot_collected",
          status: "passed",
          message: "Collected snapshot.",
          counts: { links: 3 },
        });
        return reportFor(options?.runId ?? "missing");
      },
    } as never);

    const started = registry.start(requestFor());
    expect(started.status).toBe("running");
    await eventually(() => registry.get(started.runId)?.status === "completed");

    const snapshot = registry.get(started.runId);
    expect(snapshot?.report?.runId).toBe(started.runId);
    expect(snapshot?.events.map((event) => event.type)).toContain("page.snapshot_collected");
    expect(snapshot?.events.slice(-2).map((event) => event.type)).toEqual(["run.completed", "run.report_ready"]);
  });

  it("notifies subscribers with sequenced live events", async () => {
    const registry = new RunRegistry({
      run: async (_request: TestingRunRequest, options?: { runId?: string; onEvent?: RunEventSink }) => {
        await Promise.resolve();
        options?.onEvent?.({
          runId: options.runId ?? "missing",
          type: "ai.planning_started",
          status: "started",
          message: "Planning.",
        });
        return reportFor(options?.runId ?? "missing");
      },
    } as never);
    const started = registry.start(requestFor());
    const seen: string[] = [];
    registry.subscribe(started.runId, (event) => seen.push(`${event.sequence}:${event.type}`));

    await eventually(() => registry.get(started.runId)?.status === "completed");

    expect(seen.some((event) => event.endsWith(":ai.planning_started"))).toBe(true);
    expect(seen.some((event) => event.endsWith(":run.completed"))).toBe(true);
  });

  it("retains a lightweight 2000-event replay window after a sequence", async () => {
    let resolveRun!: (report: TestingRunResponse) => void;
    const registry = new RunRegistry({
      run: async (_request: TestingRunRequest, options?: { runId?: string }) =>
        new Promise<TestingRunResponse>((resolve) => { resolveRun = () => resolve(reportFor(options?.runId ?? "missing")); }),
    } as never);
    const started = registry.start(requestFor());
    for (let index = 0; index < 2_100; index += 1) {
      registry.append(started.runId, { runId: started.runId, type: `event.${index}`, status: "info", message: "buffered" });
    }
    registry.append(started.runId, {
      runId: started.runId,
      type: "live-view:frame",
      status: "info",
      message: "frame",
      liveFrame: { mimeType: "image/jpeg", data: "abc" },
    });
    registry.append(started.runId, {
      runId: started.runId,
      type: "live-view:cursor",
      status: "info",
      message: "cursor",
      liveCursor: { x: 100, y: 120, action: "move" },
    });

    expect(registry.get(started.runId)?.events.filter((event) => !event.liveFrame && !event.liveCursor)).toHaveLength(2_000);
    expect(registry.get(started.runId)?.events.some((event) => event.liveCursor?.action === "move")).toBe(true);
    expect(registry.eventsAfter(started.runId, 2_095)?.every((event) => event.sequence > 2_095)).toBe(true);
    expect(registry.snapshotEvents(started.runId, 5_000)?.some((event) => event.liveCursor?.action === "move")).toBe(true);
    resolveRun(reportFor(started.runId));
    await eventually(() => registry.isTerminal(started.runId));
  });
});

function requestFor(): TestingRunRequest {
  return {
    targetUrl: "https://example.com",
    authorizationConfirmed: true,
    environment: "production",
    testTypes: ["SMOKE"],
    crawl: { strategy: "DFS", maxDepth: 1, maxPages: 1, sameOriginOnly: true, includePatterns: [], excludePatterns: [] },
    browser: { channel: "chrome", headless: false, viewport: { width: 1440, height: 900 } },
    execution: {
      safeMode: true,
      allowFormSubmission: false,
      allowFileUploads: false,
      allowDestructiveActions: false,
      allowPayments: false,
      maximumActionsPerPage: 1,
      maximumRunDurationSeconds: 30,
    },
  };
}

function reportFor(runId: string): TestingRunResponse {
  return {
    runId,
    runStatus: "COMPLETED",
    findingsStatus: "PASSED",
    status: "PASSED",
    stoppedReason: "converged",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    targetOrigin: "https://example.com",
    selectedTestingTypes: ["SMOKE"],
    summary: {
      pagesDiscovered: 1,
      pagesTested: 1,
      pagesSkipped: 0,
      pagesNotReached: 0,
      testsExecuted: 1,
      passedTests: 1,
      failedTests: 0,
      skippedTests: 0,
      blockedByPolicy: 0,
      inconclusiveTests: 0,
      consoleErrors: 0,
      failedNetworkRequests: 0,
      artifactsBytes: 0,
    },
    pages: [],
    issues: [],
    coverageLimitations: [],
    artifacts: [],
  };
}

async function eventually(predicate: () => boolean | undefined): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Condition was not met.");
}
