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
    loginUrl: z.string().url().optional(),
    username: z.string().min(1).max(500),
    password: z.string().min(1).max(2000),
    fieldHints: fieldHintsSchema,
  })
  .strict();

export const testingRunRequestSchema = z
  .object({
    targetUrl: z.string().url(),
    environment: z.enum(["production", "staging"]).default("production"),
    authorizationConfirmed: z.literal(true, {
      errorMap: () => ({ message: "authorizationConfirmed must be true" }),
    }),
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
    crawl: z
      .object({
        strategy: z.literal("DFS").default("DFS"),
        maxDepth: z.number().int().min(0).max(20).default(5),
        maxPages: z.number().int().min(1).max(1000).default(5),
        sameOriginOnly: z.boolean().default(true),
        includePatterns: patternArraySchema,
        excludePatterns: patternArraySchema.default(["/logout", "/delete", "/remove", "/payment"]),
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
        allowFormSubmission: z.boolean().default(true),
        allowFileUploads: z.boolean().default(true),
        allowDestructiveActions: z.boolean().default(false),
        allowPayments: z.boolean().default(false),
        maximumActionsPerPage: z.number().int().min(1).max(200).default(15),
        maximumRunDurationSeconds: z.number().int().min(10).max(7200).default(300),
      })
      .strict()
      .default({}),
  })
  .strict();

export type TestingRunRequestInput = z.input<typeof testingRunRequestSchema>;
