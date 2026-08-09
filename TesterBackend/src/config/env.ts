import "dotenv/config";
import { z } from "zod";

const booleanFromEnv = z
  .union([z.literal("true"), z.literal("false"), z.boolean()])
  .transform((value) => value === true || value === "true");

const numberFromEnv = z
  .union([z.string().min(1), z.number()])
  .transform((value) => Number(value))
  .pipe(z.number().finite());

/**
 * OpenRouter free-tier slug shape, e.g. "vendor/model-name:free". Rejects the
 * placeholder "openrouter/free" (not a real model) and "openrouter/auto"
 * (paid routing, never an allowed substitute). See DESIGN-DECISIONS.md §5.
 */
export const OPENROUTER_FREE_MODEL_PATTERN = /^[\w.-]+\/[\w.:-]+:free$/;

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: numberFromEnv.default("3000"),
  LOG_LEVEL: z.string().default("info"),
  FRONTEND_ORIGINS: z.string().default("http://localhost:3000,http://localhost:3001,http://localhost:5173"),
  AUTO_OPEN_SWAGGER: booleanFromEnv.default("true"),
  OPENROUTER_API_KEY: z.string().default(""),
  OPENROUTER_MODELS: z.string().default(""),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  OPENROUTER_TEMPERATURE: numberFromEnv.default("0.1").pipe(z.number().min(0).max(2)),
  OPENROUTER_MAX_OUTPUT_TOKENS: numberFromEnv.default("6000").pipe(z.number().int().min(1)),
  OPENROUTER_TIMEOUT_MS: numberFromEnv.default("30000"),
  AI_RESPONSE_TIMEOUT_MS: numberFromEnv.optional(),
  OPENROUTER_MAX_RETRIES: numberFromEnv.default("2"),
  /** Delay before every AI call after the first in a run, to stay under the shared free-tier rate ceiling. */
  AI_CALL_PACING_MS: numberFromEnv.default("1500"),
  OPENROUTER_SITE_URL: z.string().default(""),
  OPENROUTER_APP_NAME: z.string().default("TesterBackend"),
  BROWSER_CHANNEL: z.literal("chrome").default("chrome"),
  BROWSER_HEADLESS: booleanFromEnv.default("false"),
  PLAYWRIGHT_CHANNEL: z.literal("chrome").optional(),
  PLAYWRIGHT_HEADLESS: booleanFromEnv.optional(),
  BROWSER_LAUNCH_TIMEOUT_MS: numberFromEnv.default("30000"),
  PAGE_NAVIGATION_TIMEOUT_MS: numberFromEnv.default("30000"),
  NAVIGATION_TIMEOUT_MS: numberFromEnv.optional(),
  ACTION_TIMEOUT_MS: numberFromEnv.default("10000"),
  MAX_CONCURRENT_RUNS: numberFromEnv.default("1"),
  MAX_PAGES_PER_RUN: numberFromEnv.default("50"),
  MAX_DEPTH_PER_RUN: numberFromEnv.default("8"),
  MAX_ACTIONS_PER_PAGE: numberFromEnv.default("15"),
  MAX_RUN_DURATION_SECONDS: numberFromEnv.default("1800"),
  MAX_AI_CALLS_PER_RUN: numberFromEnv.default("25"),
  MAX_AI_TEST_CASES_PER_RUN: numberFromEnv.default("400"),
  MAX_OPENROUTER_CALLS_PER_RUN: numberFromEnv.optional(),
  MAX_OPENROUTER_TOKENS_PER_RUN: numberFromEnv.default("250000"),
  ALLOW_PRIVATE_NETWORK_TARGETS: booleanFromEnv.default("false"),
  REQUIRE_HTTPS: booleanFromEnv.default("true"),
  ARTIFACT_ROOT: z.string().default("artifacts"),
  PROMPT_FILE_PATH: z.string().default("src/prompts/form-test-planner.system.md"),
  LIVE_VIEW_ENABLED: booleanFromEnv.default("true"),
  LIVE_VIEW_FRAME_INTERVAL_MS: numberFromEnv.default("1500"),
  SCREENSHOT_DIRECTORY: z.string().default("artifacts/screenshots"),
  TRACE_DIRECTORY: z.string().default("artifacts/traces"),
  TEST_RUN_ALLOWED_ORIGINS: z.string().default(""),
});

/**
 * Model IDs are validated only once OPENROUTER_API_KEY is set — a blank key
 * means AI is not in use at all, and there is nothing to validate. Once a key
 * is present, exactly three non-empty, correctly-shaped free-model slugs are
 * required; anything else fails configuration loudly rather than silently
 * falling back. See DESIGN-DECISIONS.md §5.
 */
const refinedEnvSchema = envSchema.superRefine((value, ctx) => {
  if (!value.OPENROUTER_API_KEY) return;

  const models = value.OPENROUTER_MODELS.split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  if (models.length !== 3) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OPENROUTER_MODELS"],
      message: `OPENROUTER_MODELS must list exactly 3 pinned free model IDs when OPENROUTER_API_KEY is set (found ${models.length}). Run "npm run openrouter:models" to list currently available free models.`,
    });
    return;
  }

  const invalid = models.filter((model) => !OPENROUTER_FREE_MODEL_PATTERN.test(model));
  if (invalid.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OPENROUTER_MODELS"],
      message: `OPENROUTER_MODELS contains invalid slug(s): ${invalid.join(", ")}. Expected the OpenRouter "vendor/model-name:free" format, e.g. "meta-llama/llama-3.3-70b-instruct:free". Never "openrouter/auto".`,
    });
  }
});

const parsed = parseEnv();

function parseEnv() {
  try {
    return refinedEnvSchema.parse(process.env);
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
  openRouter: {
    apiKey: parsed.OPENROUTER_API_KEY,
    /** Exactly 3 pinned free-model slugs, tried in order. Empty when AI is not configured. */
    models: parsed.OPENROUTER_API_KEY
      ? parsed.OPENROUTER_MODELS.split(",").map((model) => model.trim()).filter(Boolean)
      : [],
    baseUrl: parsed.OPENROUTER_BASE_URL.replace(/\/$/, ""),
    temperature: parsed.OPENROUTER_TEMPERATURE,
    maxOutputTokens: parsed.OPENROUTER_MAX_OUTPUT_TOKENS,
    timeoutMs: parsed.AI_RESPONSE_TIMEOUT_MS ?? parsed.OPENROUTER_TIMEOUT_MS,
    maxRetries: parsed.OPENROUTER_MAX_RETRIES,
    siteUrl: parsed.OPENROUTER_SITE_URL,
    appName: parsed.OPENROUTER_APP_NAME,
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
    maxOpenRouterCallsPerRun: parsed.MAX_AI_CALLS_PER_RUN ?? parsed.MAX_OPENROUTER_CALLS_PER_RUN ?? 25,
    maxAiTestCasesPerRun: parsed.MAX_AI_TEST_CASES_PER_RUN,
    maxOpenRouterTokensPerRun: parsed.MAX_OPENROUTER_TOKENS_PER_RUN,
  },
  security: {
    allowPrivateNetworkTargets: parsed.ALLOW_PRIVATE_NETWORK_TARGETS,
    requireHttps: parsed.REQUIRE_HTTPS,
  },
  artifacts: {
    root: parsed.ARTIFACT_ROOT,
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

export function assertOpenRouterConfigured(): void {
  if (!config.openRouter.apiKey || config.openRouter.models.length !== 3) {
    throw new Error("OPENROUTER_API_KEY and exactly 3 OPENROUTER_MODELS entries must be set to run AI planning.");
  }
}
