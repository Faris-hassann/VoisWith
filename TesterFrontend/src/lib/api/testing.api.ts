import { env } from "../environment/env";
import { mockCompletedReport } from "../testing/mock-reports";
import { endpoints } from "./endpoints";
import { apiRequest } from "./client";
import type { TestingRunRequest, TestingRunResponse } from "./types";

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

export async function checkBackendHealth(): Promise<boolean> {
  try {
    if (env.mockMode) return true;
    await apiRequest<{ status: string }>(endpoints.health, { method: "GET" }, { timeoutMs: 5000 });
    return true;
  } catch {
    return false;
  }
}
