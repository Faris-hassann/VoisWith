import { z } from "zod";

const envSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_API_DOCS_URL: z.string().url().default("http://localhost:3000/docs/"),
  NEXT_PUBLIC_TEST_RUN_ENDPOINT: z.string().startsWith("/").default("/api/v1/testing/run"),
  NEXT_PUBLIC_APP_NAME: z.string().default("WebTest AI"),
  NEXT_PUBLIC_ENABLE_MOCK_MODE: z.enum(["true", "false"]).default("false"),
  NEXT_PUBLIC_API_MODE: z.enum(["direct", "proxy"]).default("direct"),
});

const parsed = envSchema.parse({
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  NEXT_PUBLIC_API_DOCS_URL: process.env.NEXT_PUBLIC_API_DOCS_URL,
  NEXT_PUBLIC_TEST_RUN_ENDPOINT: process.env.NEXT_PUBLIC_TEST_RUN_ENDPOINT,
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  NEXT_PUBLIC_ENABLE_MOCK_MODE: process.env.NEXT_PUBLIC_ENABLE_MOCK_MODE,
  NEXT_PUBLIC_API_MODE: process.env.NEXT_PUBLIC_API_MODE,
});

export const env = {
  apiBaseUrl: parsed.NEXT_PUBLIC_API_BASE_URL.replace(/\/$/, ""),
  apiDocsUrl: parsed.NEXT_PUBLIC_API_DOCS_URL,
  testRunEndpoint: parsed.NEXT_PUBLIC_TEST_RUN_ENDPOINT,
  appName: parsed.NEXT_PUBLIC_APP_NAME,
  mockMode: parsed.NEXT_PUBLIC_ENABLE_MOCK_MODE === "true",
  apiMode: parsed.NEXT_PUBLIC_API_MODE,
};
