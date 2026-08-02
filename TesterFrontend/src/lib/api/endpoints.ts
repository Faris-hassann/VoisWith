import { env } from "../environment/env";

export const endpoints = {
  health: "/health",
  testingRun: env.testRunEndpoint,
  testingRuns: env.testRunsEndpoint,
  proxyTestingRun: "/api/testing/run",
  proxyTestingRuns: "/api/testing/runs",
};
