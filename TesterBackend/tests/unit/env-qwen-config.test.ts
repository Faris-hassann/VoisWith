import { afterEach, describe, expect, it, vi } from "vitest";

describe("OpenRouter environment configuration", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  it("loads the OpenRouter endpoint, model, and timeout", async () => {
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: "test-key",
      OPENROUTER_API_URL: "https://openrouter.example.test/api/v1/chat/completions",
      OPENROUTER_MODEL: "google/gemini-2.5-flash",
      OPENROUTER_TIMEOUT_MS: "99999",
    };

    const { config } = await import("../../src/config/env.js");
    expect(config.ai.provider).toBe("openrouter");
    expect(config.ai.apiKey).toBe("test-key");
    expect(config.ai.apiUrl).toBe("https://openrouter.example.test/api/v1/chat/completions");
    expect(config.ai.model).toBe("google/gemini-2.5-flash");
    expect(config.ai.models).toEqual(["google/gemini-2.5-flash"]);
    expect(config.ai.timeoutMs).toBe(99999);
  });
});
