import "dotenv/config";
import { z } from "zod";

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
  OPENROUTER_API_KEY: z.string().default(""),
  OPENROUTER_MODEL: z.string().default(""),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  OPENROUTER_TEMPERATURE: numberFromEnv.default("0.1").pipe(z.number().min(0).max(2)),
  OPENROUTER_MAX_OUTPUT_TOKENS: numberFromEnv.default("3000").pipe(z.number().int().min(1)),
  OPENROUTER_TIMEOUT_MS: numberFromEnv.default("30000"),
  OPENROUTER_MAX_RETRIES: numberFromEnv.default("2"),
  OPENROUTER_SITE_URL: z.string().default(""),
  OPENROUTER_APP_NAME: z.string().default("TesterBackend"),
  BROWSER_CHANNEL: z.literal("chrome").default("chrome"),
  BROWSER_HEADLESS: booleanFromEnv.default("false"),
  BROWSER_LAUNCH_TIMEOUT_MS: numberFromEnv.default("30000"),
  PAGE_NAVIGATION_TIMEOUT_MS: numberFromEnv.default("30000"),
  ACTION_TIMEOUT_MS: numberFromEnv.default("10000"),
  MAX_CONCURRENT_RUNS: numberFromEnv.default("1"),
  MAX_PAGES_PER_RUN: numberFromEnv.default("50"),
  MAX_DEPTH_PER_RUN: numberFromEnv.default("8"),
  MAX_ACTIONS_PER_PAGE: numberFromEnv.default("15"),
  MAX_RUN_DURATION_SECONDS: numberFromEnv.default("1800"),
  MAX_AI_CALLS_PER_RUN: numberFromEnv.default("50"),
  MAX_OPENROUTER_CALLS_PER_RUN: numberFromEnv.default("50"),
  MAX_OPENROUTER_TOKENS_PER_RUN: numberFromEnv.default("250000"),
  ALLOW_PRIVATE_NETWORK_TARGETS: booleanFromEnv.default("false"),
  REQUIRE_HTTPS: booleanFromEnv.default("true"),
  ARTIFACT_ROOT: z.string().default("artifacts"),
  PROMPT_FILE_PATH: z.string().default("src/prompts/web-test-planner.system.md"),
});

const parsed = envSchema.parse(process.env);

export const config = {
  nodeEnv: parsed.NODE_ENV,
  port: parsed.PORT,
  logLevel: parsed.LOG_LEVEL,
  frontendOrigins: parsed.FRONTEND_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  autoOpenSwagger: parsed.AUTO_OPEN_SWAGGER,
  openRouter: {
    apiKey: parsed.OPENROUTER_API_KEY,
    model: parsed.OPENROUTER_MODEL,
    baseUrl: parsed.OPENROUTER_BASE_URL.replace(/\/$/, ""),
    temperature: parsed.OPENROUTER_TEMPERATURE,
    maxOutputTokens: parsed.OPENROUTER_MAX_OUTPUT_TOKENS,
    timeoutMs: parsed.OPENROUTER_TIMEOUT_MS,
    maxRetries: parsed.OPENROUTER_MAX_RETRIES,
    siteUrl: parsed.OPENROUTER_SITE_URL,
    appName: parsed.OPENROUTER_APP_NAME,
  },
  browser: {
    channel: parsed.BROWSER_CHANNEL,
    headless: parsed.BROWSER_HEADLESS,
    launchTimeoutMs: parsed.BROWSER_LAUNCH_TIMEOUT_MS,
    pageNavigationTimeoutMs: parsed.PAGE_NAVIGATION_TIMEOUT_MS,
    actionTimeoutMs: parsed.ACTION_TIMEOUT_MS,
  },
  limits: {
    maxConcurrentRuns: parsed.MAX_CONCURRENT_RUNS,
    maxPagesPerRun: parsed.MAX_PAGES_PER_RUN,
    maxDepthPerRun: parsed.MAX_DEPTH_PER_RUN,
    maxActionsPerPage: parsed.MAX_ACTIONS_PER_PAGE,
    maxRunDurationSeconds: parsed.MAX_RUN_DURATION_SECONDS,
    maxOpenRouterCallsPerRun: parsed.MAX_AI_CALLS_PER_RUN ?? parsed.MAX_OPENROUTER_CALLS_PER_RUN,
    maxOpenRouterTokensPerRun: parsed.MAX_OPENROUTER_TOKENS_PER_RUN,
  },
  security: {
    allowPrivateNetworkTargets: parsed.ALLOW_PRIVATE_NETWORK_TARGETS,
    requireHttps: parsed.REQUIRE_HTTPS,
  },
  artifacts: {
    root: parsed.ARTIFACT_ROOT,
  },
  prompts: {
    filePath: parsed.PROMPT_FILE_PATH,
  },
};

export function assertOpenRouterConfigured(): void {
  if (!config.openRouter.apiKey || !config.openRouter.model) {
    throw new Error("OPENROUTER_API_KEY and OPENROUTER_MODEL must be set to run tests.");
  }
}
