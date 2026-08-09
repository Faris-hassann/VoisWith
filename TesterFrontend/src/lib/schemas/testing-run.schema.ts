import { z } from "zod";
import { TEST_TYPES } from "../api/types";

const httpUrl = z
  .string()
  .trim()
  .url()
  .refine(isHttpUrl, "Use an HTTP or HTTPS URL.");

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export const testingFormSchema = z
  .object({
    targetUrl: httpUrl,
    allowedOriginsText: z.string(),
    includeSubdomains: z.boolean(),
    visualizationMode: z.enum(["local", "live", "off"]),
    authorizationConfirmed: z.literal(true, {
      errorMap: () => ({ message: "You must confirm authorization before running a test." }),
    }),
    writeActionsAcknowledged: z.boolean().default(false),
    authenticationEnabled: z.boolean().default(false),
    credentials: z
      .object({
        loginUrl: z.string().trim().optional(),
        username: z.string().trim().optional(),
        password: z.string().optional(),
        usernameSelector: z.string().trim().optional(),
        passwordSelector: z.string().trim().optional(),
        submitSelector: z.string().trim().optional(),
      })
      .default({}),
    testTypes: z.array(z.enum(TEST_TYPES)).min(1, "Select at least one testing type."),
    crawl: z.object({
      strategy: z.literal("DFS"),
      maxDepth: z.number().int().min(0).max(10000).optional(),
      maxPages: z.number().int().min(1).max(1000000).optional(),
      sameOriginOnly: z.boolean(),
      includePatternsText: z.string(),
      excludePatternsText: z.string(),
      ignoredQueryParametersText: z.string(),
    }),
    browser: z.object({
      channel: z.literal("chrome"),
      headless: z.boolean(),
      viewport: z.object({
        width: z.number().int().min(320).max(3840),
        height: z.number().int().min(240).max(2160),
      }),
    }),
    execution: z.object({
      safeMode: z.boolean(),
      allowFormSubmission: z.boolean(),
      allowFileUploads: z.boolean(),
      allowDestructiveActions: z.boolean(),
      allowPayments: z.boolean(),
      maximumActionsPerPage: z.number().int().min(1).max(200),
      maximumRunDurationSeconds: z.number().int().min(10).max(7200),
    }),
    destructiveAcknowledged: z.boolean().default(false),
    paymentAcknowledged: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.authenticationEnabled) {
      if (!value.credentials.username) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["credentials", "username"], message: "Username is required." });
      }
      if (!value.credentials.password) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["credentials", "password"], message: "Password is required." });
      }
      if (value.credentials.loginUrl) {
        const parsed = httpUrl.safeParse(value.credentials.loginUrl);
        if (!parsed.success) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["credentials", "loginUrl"], message: "Login URL must be HTTP or HTTPS." });
        }
      }
    }
    if (value.execution.allowDestructiveActions && !value.destructiveAcknowledged) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["execution", "allowDestructiveActions"], message: "Destructive actions require acknowledgement." });
    }
    if (value.execution.allowPayments && !value.paymentAcknowledged) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["execution", "allowPayments"], message: "Payments require acknowledgement." });
    }
    if (value.execution.allowFormSubmission && !value.writeActionsAcknowledged) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["writeActionsAcknowledged"],
        message: "You must acknowledge write actions before enabling form submission.",
      });
    }
  });

export type TestingFormValues = z.infer<typeof testingFormSchema>;

export const recommendedTypes = [
  "SMOKE",
  "PAGE_DISCOVERY",
  "NAVIGATION",
  "LINKS",
  "FORMS",
  "FORM_VALIDATION",
  "POSITIVE",
  "NEGATIVE",
  "API_NETWORK",
  "CONSOLE_ERRORS",
  "ERROR_HANDLING",
  "PERFORMANCE_BASIC",
  "PASSIVE_SECURITY",
] as const;

export const defaultFormValues: TestingFormValues = {
  targetUrl: "",
  allowedOriginsText: "",
  includeSubdomains: false,
  visualizationMode: "live",
  authorizationConfirmed: true,
  writeActionsAcknowledged: false,
  authenticationEnabled: false,
  credentials: {},
  testTypes: [...recommendedTypes],
  crawl: {
    strategy: "DFS",
    maxDepth: undefined,
    maxPages: undefined,
    sameOriginOnly: true,
    includePatternsText: "",
    excludePatternsText: "/logout\n/delete\n/remove\n/payment\n/checkout\n/unsubscribe",
    ignoredQueryParametersText: "utm_source\nutm_medium\nutm_campaign\nutm_term\nutm_content\nfbclid\ngclid",
  },
  browser: {
    channel: "chrome",
    headless: false,
    viewport: { width: 1440, height: 900 },
  },
  execution: {
    safeMode: true,
    allowFormSubmission: false,
    allowFileUploads: false,
    allowDestructiveActions: false,
    allowPayments: false,
    maximumActionsPerPage: 15,
    maximumRunDurationSeconds: 300,
  },
  destructiveAcknowledged: false,
  paymentAcknowledged: false,
};
