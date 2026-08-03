import { publicEnv } from "../environment/public-env";

export const endpoints = {
  health: "/health",
  testingRun: publicEnv.testRunEndpoint,
  testingRuns: publicEnv.testRunsEndpoint,
  proxyTestingRun: "/api/testing/run",
  proxyTestingRuns: "/api/testing/runs",
};
