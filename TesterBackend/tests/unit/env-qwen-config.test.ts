import { afterEach, describe, expect, it, vi } from "vitest";

describe("Qwen environment configuration", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  it("does not inherit OPENROUTER variables into Qwen configuration", async () => {
    process.env = {
      ...originalEnv,
      QWEN_API_KEY: "",
      OPENROUTER_API_KEY: "legacy-key",
      OPENROUTER_BASE_URL: "https://openrouter.example.test",
      OPENROUTER_TIMEOUT_MS: "99999",
    };

    const { config } = await import("../../src/config/env.js");
    expect(config.ai.apiKey).toBe("");
    expect(config.ai.apiUrl).toBe("https://qwen.snouhy.com/chat");
    expect(config.ai.timeoutMs).toBe(60000);
  });
});
