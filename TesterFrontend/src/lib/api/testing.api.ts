import { env } from "../environment/env";
import { mockCompletedReport } from "../testing/mock-reports";
import { endpoints } from "./endpoints";
import { apiRequest } from "./client";
import type { AsyncRunSnapshot, AsyncRunStartResponse, TestingRunRequest, TestingRunResponse } from "./types";

export async function runWebsiteTest(
  payload: TestingRunRequest,
  options: { signal?: AbortSignal } = {},
): Promise<TestingRunResponse> {
  if (env.mockMode) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    return mockCompletedReport(payload);
  }

  const endpoint = env.apiMode === "proxy" ? endpoints.proxyTestingRun : endpoints.testingRun;
  const timeoutMs = (payload.execution.maximumRunDurationSeconds + 60) * 1000;
  return apiRequest<TestingRunResponse>(
    endpoint,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    { signal: options.signal, timeoutMs },
  );
}

export async function startWebsiteTest(payload: TestingRunRequest): Promise<AsyncRunStartResponse> {
  if (env.mockMode) {
    return {
      runId: crypto.randomUUID(),
      status: "running",
      startedAt: new Date().toISOString(),
      streamUrl: "/mock-stream",
    };
  }

  const endpoint = env.apiMode === "proxy" ? endpoints.proxyTestingRuns : endpoints.testingRuns;
  return apiRequest<AsyncRunStartResponse>(
    endpoint,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    { timeoutMs: 15000 },
  );
}

export async function getTestingRunStatus(runId: string): Promise<AsyncRunSnapshot> {
  const endpointBase = env.apiMode === "proxy" ? endpoints.proxyTestingRuns : endpoints.testingRuns;
  return apiRequest<AsyncRunSnapshot>(`${endpointBase}/${encodeURIComponent(runId)}`, { method: "GET" }, { timeoutMs: 10000 });
}

export function buildTestingRunWebSocketUrl(runId: string): string {
  const base = new URL(env.apiBaseUrl);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = `${env.testRunsEndpoint}/${encodeURIComponent(runId)}/stream`;
  base.search = "";
  base.hash = "";
  return base.toString();
}

export async function checkBackendHealth(): Promise<boolean> {
  try {
    if (env.mockMode) return true;
    await apiRequest<{ status: string }>(endpoints.health, { method: "GET" }, { timeoutMs: 5000 });
    return true;
  } catch {
    return false;
  }
}
