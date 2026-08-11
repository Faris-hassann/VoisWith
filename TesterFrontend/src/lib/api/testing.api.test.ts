import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../environment/env";
import { buildTestingRunWebSocketUrl, listTestingRuns, startWebsiteTest } from "./testing.api";
import type { TestingRunRequest } from "./types";

describe("testing async API helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds a backend WebSocket URL for a run", () => {
    const url = new URL(buildTestingRunWebSocketUrl("run 1", 42));
    const base = new URL(env.apiBaseUrl);
    expect(url.protocol).toBe(base.protocol === "https:" ? "wss:" : "ws:");
    expect(url.host).toBe(base.host);
    expect(url.pathname).toBe(`${env.testRunsEndpoint}/run%201/stream`);
    expect(url.searchParams.get("lastSequence")).toBe("42");
  });

  it("starts an async backend run using the runs endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          runId: "run_123",
          status: "running",
          startedAt: "2026-01-01T00:00:00.000Z",
          streamUrl: "/api/v1/testing/runs/run_123/stream",
        }),
        { status: 202, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await startWebsiteTest(requestFor());

    expect(response.runId).toBe("run_123");
    const fetchCalls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>;
    expect(fetchCalls[0]?.[0].toString()).toContain(env.testRunsEndpoint);
  });

  it("lists retained run summaries", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ runs: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));
    await expect(listTestingRuns()).resolves.toEqual({ runs: [] });
  });
});

function requestFor(): TestingRunRequest {
  return {
    targetUrl: "https://example.com",
    authorizationConfirmed: true,
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
