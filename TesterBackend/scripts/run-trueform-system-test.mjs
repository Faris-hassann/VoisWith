import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";

const backendUrl = process.env.TESTER_BACKEND_URL ?? "http://localhost:3000/api/v1/testing/runs";
const healthUrl = process.env.TESTER_BACKEND_HEALTH_URL ?? new URL("/health", backendUrl).toString();
const targetUrl = process.env.TRUEFORM_TARGET_URL ?? "https://trueform.cultivbureau.com";
const loginUrl = process.env.TRUEFORM_LOGIN_URL ?? "https://trueform.cultivbureau.com/login";
const email = process.env.TRUEFORM_EMAIL ?? "admin@Cultiv.com";
const password = process.env.TRUEFORM_PASSWORD;
const environment = process.env.TRUEFORM_ENVIRONMENT ?? "production";
const matrixEnabled = process.env.TRUEFORM_TEST_MATRIX === "true";
const maxDepth = optionalNumber(process.env.TRUEFORM_MAX_DEPTH);
const maxPages = optionalNumber(process.env.TRUEFORM_MAX_PAGES);
const maxActionsPerPage = Number(process.env.TRUEFORM_MAX_ACTIONS_PER_PAGE ?? 15);
const maxDurationSeconds = Number(process.env.TRUEFORM_MAX_DURATION_SECONDS ?? 1800);

if (!password) {
  throw new Error("Set TRUEFORM_PASSWORD before running this script. Example: $env:TRUEFORM_PASSWORD='...'; npm run trueform:system-test");
}

const payload = {
  targetUrl,
  authorizationConfirmed: true,
  environment,
  roles: [
    {
      name: "Admin",
      credentials: {
        loginUrl,
        username: email,
        password,
        fieldHints: {
          usernameSelector: "input[type='email']",
          passwordSelector: "input[type='password']",
          submitSelector: "button[type='submit']",
        },
      },
    },
  ],
  testTypes: [
    "SMOKE",
    "PAGE_DISCOVERY",
    "NAVIGATION",
    "LINKS",
    "FORMS",
    "FORM_VALIDATION",
    "POSITIVE",
    "NEGATIVE",
    "BOUNDARY",
    "AUTHENTICATION",
    "SESSION",
    "AUTHORIZATION",
    "END_TO_END",
    "BUSINESS_RULES",
    "API_NETWORK",
    "ERROR_HANDLING",
    "FILE_UPLOAD_SAFE",
    "DATA_INTEGRITY_OBSERVABLE",
    "PERFORMANCE_BASIC",
    "RELIABILITY_BASIC",
    "CHROMIUM_COMPATIBILITY",
    "PASSIVE_SECURITY",
    "CONSOLE_ERRORS",
    "ACCESSIBILITY_TECHNICAL",
  ],
  crawl: {
    strategy: "DFS",
    ...(maxDepth !== undefined ? { maxDepth } : {}),
    ...(maxPages !== undefined ? { maxPages } : {}),
    sameOriginOnly: true,
    includePatterns: [],
    excludePatterns: [
      "/logout",
      "/delete",
      "/remove",
      "/payment",
      "/checkout",
      "/billing",
      "/settings/danger",
    ],
  },
  browser: {
    channel: "chrome",
    headless: false,
    viewport: {
      width: 1440,
      height: 900,
    },
  },
  execution: {
    safeMode: true,
    allowFormSubmission: environment === "staging",
    allowFileUploads: environment === "staging",
    allowDestructiveActions: false,
    allowPayments: false,
    maximumActionsPerPage: maxActionsPerPage,
    maximumRunDurationSeconds: maxDurationSeconds,
  },
  testMatrix: {
    enabled: matrixEnabled,
    viewports: [
      { name: "desktop", width: 1440, height: 900 },
      { name: "tablet", width: 834, height: 1112 },
      { name: "mobile", width: 390, height: 844 },
    ],
    locales: [
      { name: "english-ltr", locale: "en-US", direction: "ltr" },
      { name: "arabic-rtl", locale: "ar", direction: "rtl" },
    ],
  },
};

printRunConfiguration();
if (maxPages !== undefined) warnIfBackendLimitIsLower("MAX_PAGES_PER_RUN", maxPages);
if (maxDepth !== undefined) warnIfBackendLimitIsLower("MAX_DEPTH_PER_RUN", maxDepth);
warnIfBackendLimitIsLower("MAX_RUN_DURATION_SECONDS", maxDurationSeconds);
if (maxPages !== undefined) warnIfBackendLimitIsLower("MAX_AI_CALLS_PER_RUN", maxPages);

await assertBackendReady();

const response = await fetch(backendUrl, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});

const text = await response.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = { raw: text };
}

if (!response.ok) {
  console.error(`TrueForm system test request failed: HTTP ${response.status}`);
  console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}

const runId = body.runId;
if (!runId) {
  throw new Error(`Backend did not return a runId: ${JSON.stringify(body)}`);
}

const finalSnapshot = await pollRun(runId);
const outputDir = path.resolve("artifacts", "manual-runs");
await fs.mkdir(outputDir, { recursive: true });
const outputPath = path.join(outputDir, `trueform-system-test-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
await fs.writeFile(outputPath, `${JSON.stringify(finalSnapshot, null, 2)}\n`, "utf8");

console.log(`TrueForm system test completed with status: ${finalSnapshot.status ?? "unknown"}`);
console.log(`Run ID: ${runId}`);
console.log(`Report saved to ${outputPath}`);
if (finalSnapshot.status === "failed") process.exit(1);

function printRunConfiguration() {
  console.log("TrueForm system test configuration:");
  console.log(`- targetUrl: ${targetUrl}`);
  console.log(`- loginUrl: ${loginUrl}`);
  console.log(`- environment: ${environment}`);
  console.log(`- crawl.maxPages: ${maxPages ?? "until convergence"}`);
  console.log(`- crawl.maxDepth: ${maxDepth ?? "until convergence"}`);
  console.log(`- maximumActionsPerPage: ${maxActionsPerPage}`);
  console.log(`- maximumRunDurationSeconds: ${maxDurationSeconds}`);
  console.log(`- testMatrix.enabled: ${matrixEnabled}`);
}

async function assertBackendReady() {
  try {
    const response = await fetch(healthUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    throw new Error(`Backend is not reachable at ${healthUrl}. Start it with npm run dev before running this script. Cause: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function pollRun(runId) {
  const statusUrl = `${backendUrl.replace(/\/$/, "")}/${encodeURIComponent(runId)}`;
  const deadline = Date.now() + maxDurationSeconds * 1000 + 60_000;
  let latest;
  while (Date.now() < deadline) {
    const response = await fetch(statusUrl);
    const text = await response.text();
    latest = JSON.parse(text);
    if (["completed", "failed", "stopped"].includes(latest.status)) return latest;
    console.log(`Run ${runId} status: ${latest.status}; events: ${latest.events?.length ?? 0}`);
    await delay(5000);
  }
  throw new Error(`Timed out waiting for run ${runId}. Last snapshot: ${JSON.stringify(latest)}`);
}

function optionalNumber(value) {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function warnIfBackendLimitIsLower(name, requestedValue) {
  const configuredValue = Number(process.env[name]);
  if (Number.isFinite(configuredValue) && configuredValue < requestedValue) {
    console.warn(
      `Warning: backend ${name}=${configuredValue} is lower than requested ${requestedValue}; the backend will clamp this run.`,
    );
  }
}
