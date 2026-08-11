import { z } from "zod";
import { TEST_TYPES } from "../testing/test-types.js";

const patternArraySchema = z.array(z.string().min(1).max(300)).max(100).default([]);
const fieldHintsSchema = z
  .object({
    usernameSelector: z.string().min(1).max(500).optional(),
    passwordSelector: z.string().min(1).max(500).optional(),
    submitSelector: z.string().min(1).max(500).optional(),
  })
  .strict()
  .optional();

const credentialsSchema = z
  .object({
    enabled: z.boolean().optional(),
    loginUrl: z.string().url().optional(),
    username: z.string().min(1).max(500).optional(),
    password: z.string().min(1).max(2000).optional(),
    fieldHints: fieldHintsSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.enabled === false) return;
    if (!value.username) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["username"], message: "Username is required when credentials are enabled." });
    }
    if (!value.password) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["password"], message: "Password is required when credentials are enabled." });
    }
  })
  .transform((value) => {
    if (value.enabled === false) return undefined;
    return {
      ...value,
      username: value.username ?? "",
      password: value.password ?? "",
    };
  });

const baseTestingRunRequestSchema = z
  .object({
    targetUrl: z.string().url(),
    environment: z.enum(["production", "staging"]).default("production"),
    authorizationConfirmed: z.literal(true, {
      errorMap: () => ({ message: "authorizationConfirmed must be true" }),
    }),
    writeActionsAcknowledged: z.boolean().optional(),
    credentials: credentialsSchema.optional(),
    roles: z
      .array(
        z
          .object({
            name: z.enum(["Admin", "Agent", "Client"]),
            credentials: credentialsSchema,
            loginUrl: z.string().url().optional(),
            fieldHints: fieldHintsSchema,
          })
          .strict(),
      )
      .min(1)
      .max(3)
      .optional(),
    testMatrix: z
      .object({
        enabled: z.boolean().default(false),
        viewports: z
          .array(
            z
              .object({
                name: z.string().min(1).max(50),
                width: z.number().int().min(320).max(3840),
                height: z.number().int().min(240).max(2160),
              })
              .strict(),
          )
          .max(10)
          .default([]),
        locales: z
          .array(
            z
              .object({
                name: z.string().min(1).max(50),
                locale: z.string().min(2).max(20),
                direction: z.enum(["ltr", "rtl"]),
              })
              .strict(),
          )
          .max(5)
          .default([]),
      })
      .strict()
      .default({}),
    testTypes: z.array(z.enum(TEST_TYPES)).min(1).max(TEST_TYPES.length),
    selectedTestTypes: z.array(z.string()).optional(),
    allowedOrigins: z.array(z.string().url()).max(50).optional(),
    includeSubdomains: z.boolean().default(false),
    browserMode: z.enum(["headed", "headless"]).optional(),
    visualizationMode: z.enum(["local", "live", "off"]).default("local"),
    testData: z.record(z.unknown()).default({}),
    crawl: z
      .object({
        strategy: z.literal("DFS").default("DFS"),
        maxDepth: z.number().int().min(0).max(7).optional(),
        maxPages: z.number().int().min(1).max(500).optional(),
        sameOriginOnly: z.boolean().default(true),
        includePatterns: patternArraySchema,
        excludePatterns: patternArraySchema.default(["/logout", "/delete", "/remove", "/payment"]),
        ignoredQueryParameters: patternArraySchema.default([
          "utm_source",
          "utm_medium",
          "utm_campaign",
          "utm_term",
          "utm_content",
          "fbclid",
          "gclid",
        ]),
      })
      .strict()
      .default({}),
    browser: z
      .object({
        channel: z.literal("chrome").default("chrome"),
        headless: z.boolean().default(false),
        viewport: z
          .object({
            width: z.number().int().min(320).max(3840).default(1440),
            height: z.number().int().min(240).max(2160).default(900),
          })
          .strict()
          .default({}),
      })
      .strict()
      .default({}),
    execution: z
      .object({
        safeMode: z.boolean().default(true),
        allowFormSubmission: z.boolean().default(false),
        allowFileUploads: z.boolean().default(true),
        allowDestructiveActions: z.boolean().default(false),
        allowPayments: z.boolean().default(false),
        maximumActionsPerPage: z.number().int().min(1).max(200).default(15),
        maximumRunDurationSeconds: z.number().int().min(10).max(10800).default(300),
      })
      .strict()
      .default({}),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if (value.execution.allowFormSubmission && value.writeActionsAcknowledged !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["writeActionsAcknowledged"],
        message: "writeActionsAcknowledged must be true when allowFormSubmission is enabled.",
      });
    }
  })
  .transform((value) => {
    const targetOrigin = new URL(value.targetUrl).origin;
    const selectedTestTypes = normalizeSelectedTestTypes(value.selectedTestTypes);
    const testTypes = selectedTestTypes.length > 0 ? selectedTestTypes : value.testTypes;
    const browserMode = value.browserMode ?? (value.browser.headless ? "headless" : "headed");
    return {
      ...value,
      testTypes,
      allowedOrigins: value.allowedOrigins?.length ? value.allowedOrigins.map((origin) => new URL(origin).origin) : [targetOrigin],
      includeSubdomains: value.includeSubdomains,
      browserMode,
      visualizationMode: value.visualizationMode,
      testData: value.testData,
      writeActionsAcknowledged: value.writeActionsAcknowledged,
      browser: {
        ...value.browser,
        headless: browserMode === "headless",
      },
      crawl: {
        ...value.crawl,
        sameOriginOnly: value.crawl.sameOriginOnly && !value.allowedOrigins?.length,
      },
    };
  });

export const testingRunRequestSchema = z.preprocess(normalizeNewRequestShape, baseTestingRunRequestSchema);

export type TestingRunRequestInput = z.input<typeof testingRunRequestSchema>;

function normalizeNewRequestShape(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const input = raw as Record<string, unknown>;
  const selectedTestTypes = Array.isArray(input.selectedTestTypes) ? normalizeSelectedTestTypes(input.selectedTestTypes) : undefined;
  const credentials = normalizeCredentials(input.credentials);
  return {
    ...input,
    testTypes: input.testTypes ?? selectedTestTypes ?? ["SMOKE"],
    credentials,
    browser: {
      channel: "chrome",
      headless: input.browserMode === "headless",
      viewport: { width: 1440, height: 900 },
      ...(isRecord(input.browser) ? input.browser : {}),
    },
    execution: {
      safeMode: true,
      allowFormSubmission: false,
      allowFileUploads: false,
      allowDestructiveActions: Boolean(input.allowDestructiveActions),
      allowPayments: false,
      maximumActionsPerPage: 15,
      maximumRunDurationSeconds: 10800,
      ...(isRecord(input.execution) ? input.execution : {}),
    },
  };
}

function normalizeCredentials(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (value.enabled === false) return undefined;
  return value;
}

function normalizeSelectedTestTypes(values: unknown[] | undefined) {
  if (!values) return [];
  const aliases: Record<string, (typeof TEST_TYPES)[number]> = {
    smoke: "SMOKE",
    navigation: "NAVIGATION",
    links: "LINKS",
    forms: "FORMS",
    validation: "FORM_VALIDATION",
    functional: "POSITIVE",
    authentication: "AUTHENTICATION",
    authorization: "AUTHORIZATION",
    accessibility: "ACCESSIBILITY_TECHNICAL",
    responsive: "CHROMIUM_COMPATIBILITY",
    "error-handling": "ERROR_HANDLING",
    ui: "SMOKE",
    session: "SESSION",
    "end-to-end": "END_TO_END",
    regression: "REGRESSION_BASELINE",
  };
  return values
    .map((value) => String(value).trim())
    .map((value) => aliases[value.toLowerCase()] ?? value.toUpperCase().replace(/[\s-]+/g, "_"))
    .filter((value): value is (typeof TEST_TYPES)[number] => (TEST_TYPES as readonly string[]).includes(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
