import { env } from "../environment/env";

export const endpoints = {
  health: "/health",
  testingRun: env.testRunEndpoint,
  proxyTestingRun: "/api/testing/run",
};
