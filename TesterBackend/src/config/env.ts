import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

// Resolve the backend environment independently of the shell's working
// directory. Explicit process environment variables still take precedence.
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
loadDotenv({ path: path.join(backendRoot, ".env"), override: false });

const booleanFromEnv = z
  .union([z.literal("true"), z.literal("false"), z.boolean()])
  .transform((value) => value === true || value === "true");

const numberFromEnv = z
  .union([z.string().min(1), z.number()])
  .transform((value) => Number(value))
  .pipe(z.number().finite());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: numberFromEnv.default("3000"),
  LOG_LEVEL: z.string().default("info"),
  FRONTEND_ORIGINS: z.string().default("http://localhost:3000,http://localhost:3001,http://localhost:5173"),
  AUTO_OPEN_SWAGGER: booleanFromEnv.default("true"),
  QWEN_API_KEY: z.string().default(""),
  QWEN_API_URL: z.string().url().default("https://qwen.snouhy.com/chat"),
  QWEN_TIMEOUT_MS: numberFromEnv.default("60000"),
  AI_CALL_PACING_MS: numberFromEnv.default("1500"),
  BROWSER_CHANNEL: z.literal("chrome").default("chrome"),
  BROWSER_HEADLESS: booleanFromEnv.default("false"),
  PLAYWRIGHT_CHANNEL: z.literal("chrome").optional(),
  PLAYWRIGHT_HEADLESS: booleanFromEnv.optional(),
  BROWSER_LAUNCH_TIMEOUT_MS: numberFromEnv.default("30000"),
  PAGE_NAVIGATION_TIMEOUT_MS: numberFromEnv.default("30000"),
  NAVIGATION_TIMEOUT_MS: numberFromEnv.optional(),
  ACTION_TIMEOUT_MS: numberFromEnv.default("10000"),
  MAX_CONCURRENT_RUNS: numberFromEnv.default("1"),
  MAX_PAGES_PER_RUN: numberFromEnv.default("500").pipe(z.number().int().min(1).max(500)),
  MAX_DEPTH_PER_RUN: numberFromEnv.default("7").pipe(z.number().int().min(0).max(7)),
  MAX_ACTIONS_PER_PAGE: numberFromEnv.default("15"),
  MAX_RUN_DURATION_SECONDS: numberFromEnv.default("10800").pipe(z.number().int().min(10).max(10800)),
  MAX_AI_CALLS_PER_RUN: numberFromEnv.default("25"),
  MAX_AI_TEST_CASES_PER_RUN: numberFromEnv.default("400"),
  ALLOW_PRIVATE_NETWORK_TARGETS: booleanFromEnv.default("false"),
  REQUIRE_HTTPS: booleanFromEnv.default("true"),
  ARTIFACT_ROOT: z.string().default("artifacts"),
  ARTIFACT_RETENTION_DAYS: numberFromEnv.default("14").pipe(z.number().int().min(1)),
  PROMPT_FILE_PATH: z.string().default("src/prompts/form-test-planner.system.md"),
  LIVE_VIEW_ENABLED: booleanFromEnv.default("true"),
  LIVE_VIEW_FRAME_INTERVAL_MS: numberFromEnv.default("1500"),
  SCREENSHOT_DIRECTORY: z.string().default("artifacts/screenshots"),
  TRACE_DIRECTORY: z.string().default("artifacts/traces"),
  TEST_RUN_ALLOWED_ORIGINS: z.string().default(""),
});

const parsed = parseEnv();

function parseEnv() {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
      throw new Error(`Invalid environment configuration:\n${messages}`);
    }
    throw error;
  }
}

export const config = {
  nodeEnv: parsed.NODE_ENV,
  port: parsed.PORT,
  logLevel: parsed.LOG_LEVEL,
  frontendOrigins: parsed.FRONTEND_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  autoOpenSwagger: parsed.AUTO_OPEN_SWAGGER,
  ai: {
    provider: "qwen" as const,
    apiKey: parsed.QWEN_API_KEY,
    apiUrl: parsed.QWEN_API_URL.replace(/\/$/, ""),
    timeoutMs: parsed.QWEN_TIMEOUT_MS,
    pacingMs: parsed.AI_CALL_PACING_MS,
  },
  browser: {
    channel: parsed.PLAYWRIGHT_CHANNEL ?? parsed.BROWSER_CHANNEL,
    headless: parsed.PLAYWRIGHT_HEADLESS ?? parsed.BROWSER_HEADLESS,
    launchTimeoutMs: parsed.BROWSER_LAUNCH_TIMEOUT_MS,
    pageNavigationTimeoutMs: parsed.NAVIGATION_TIMEOUT_MS ?? parsed.PAGE_NAVIGATION_TIMEOUT_MS,
    actionTimeoutMs: parsed.ACTION_TIMEOUT_MS,
  },
  limits: {
    maxConcurrentRuns: parsed.MAX_CONCURRENT_RUNS,
    maxPagesPerRun: parsed.MAX_PAGES_PER_RUN,
    maxDepthPerRun: parsed.MAX_DEPTH_PER_RUN,
    maxActionsPerPage: parsed.MAX_ACTIONS_PER_PAGE,
    maxRunDurationSeconds: parsed.MAX_RUN_DURATION_SECONDS,
    maxAiCallsPerRun: parsed.MAX_AI_CALLS_PER_RUN,
    maxAiTestCasesPerRun: parsed.MAX_AI_TEST_CASES_PER_RUN,
  },
  security: {
    allowPrivateNetworkTargets: parsed.ALLOW_PRIVATE_NETWORK_TARGETS,
    requireHttps: parsed.REQUIRE_HTTPS,
  },
  artifacts: {
    root: parsed.ARTIFACT_ROOT,
    retentionDays: parsed.ARTIFACT_RETENTION_DAYS,
    screenshotDirectory: parsed.SCREENSHOT_DIRECTORY,
    traceDirectory: parsed.TRACE_DIRECTORY,
  },
  liveView: {
    enabled: parsed.LIVE_VIEW_ENABLED,
    frameIntervalMs: parsed.LIVE_VIEW_FRAME_INTERVAL_MS,
  },
  defaults: {
    allowedOrigins: parsed.TEST_RUN_ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
  },
  prompts: {
    filePath: parsed.PROMPT_FILE_PATH,
  },
};

export function assertAiConfigured(): void {
  if (!config.ai.apiKey) {
    throw new Error("QWEN_API_KEY must be set to run AI planning.");
  }
}
