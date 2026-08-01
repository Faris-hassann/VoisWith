import { z } from "zod";
import { TEST_TYPES } from "../testing/test-types.js";

const patternArraySchema = z.array(z.string().min(1).max(300)).max(100).default([]);

export const testingRunRequestSchema = z
  .object({
    targetUrl: z.string().url(),
    authorizationConfirmed: z.literal(true, {
      errorMap: () => ({ message: "authorizationConfirmed must be true" }),
    }),
    credentials: z
      .object({
        loginUrl: z.string().url().optional(),
        username: z.string().min(1).max(500),
        password: z.string().min(1).max(2000),
        fieldHints: z
          .object({
            usernameSelector: z.string().min(1).max(500).optional(),
            passwordSelector: z.string().min(1).max(500).optional(),
            submitSelector: z.string().min(1).max(500).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
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
