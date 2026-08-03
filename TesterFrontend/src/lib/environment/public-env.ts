export const publicEnv = {
  apiBaseUrl: publicValue("NEXT_PUBLIC_API_BASE_URL", "http://localhost:3000").replace(/\/$/, ""),
  testRunEndpoint: publicValue("NEXT_PUBLIC_TEST_RUN_ENDPOINT", "/api/v1/testing/run"),
  testRunsEndpoint: publicValue("NEXT_PUBLIC_TEST_RUNS_ENDPOINT", "/api/v1/testing/runs"),
  mockMode: publicValue("NEXT_PUBLIC_ENABLE_MOCK_MODE", "false") === "true",
  apiMode: publicValue("NEXT_PUBLIC_API_MODE", "direct") === "proxy" ? "proxy" : "direct",
};

function publicValue(key: string, fallback: string): string {
  const value = process.env[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}
