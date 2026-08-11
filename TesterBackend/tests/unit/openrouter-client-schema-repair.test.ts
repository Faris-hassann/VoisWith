import { afterEach, describe, expect, it, vi } from "vitest";

process.env.QWEN_API_KEY = "test-key";
process.env.QWEN_API_URL = "https://qwen.snouhy.com/chat";

const { OpenRouterClient } = await import("../../src/ai/openrouter-client.js");
const { AppError } = await import("../../src/errors/app-error.js");
const { LLM_FAILURE_REASONS } = await import("../../src/errors/error-codes.js");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Qwen schema validation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("classifies a shape failure as llm_schema_invalid and retries once", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { message: JSON.stringify({ testCases: [], unknownKey: "smuggled" }) }));
    vi.stubGlobal("fetch", fetchMock);

    const validate = (value: unknown) => {
      const record = value as { unknownKey?: unknown };
      return record.unknownKey === undefined ? { ok: true as const } : { ok: false as const, message: "unknown key: unknownKey" };
    };

    let error: InstanceType<typeof AppError> | undefined;
    try {
      await new OpenRouterClient().createStructuredPlan({ systemPrompt: "sys", context: {}, validate });
    } catch (thrown) {
      error = thrown instanceof AppError ? thrown : undefined;
    }

    expect(error?.llmFailureReason).toBe(LLM_FAILURE_REASONS.LLM_SCHEMA_INVALID);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const details = error?.details as { attempts: Array<{ model: string; reason: string }> } | undefined;
    expect(details?.attempts).toHaveLength(2);
    expect(details?.attempts.every((attempt) => attempt.reason === LLM_FAILURE_REASONS.LLM_SCHEMA_INVALID)).toBe(true);
  });

  it("recovers once the repair response satisfies the validator", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      return call === 1
        ? jsonResponse(200, { message: JSON.stringify({ testCases: [], unknownKey: "smuggled" }) })
        : jsonResponse(200, { message: JSON.stringify({ testCases: [] }) });
    });
    vi.stubGlobal("fetch", fetchMock);

    const validate = (value: unknown) => {
      const record = value as { unknownKey?: unknown };
      return record.unknownKey === undefined ? { ok: true as const } : { ok: false as const, message: "unknown key: unknownKey" };
    };

    const result = await new OpenRouterClient().createStructuredPlan({ systemPrompt: "sys", context: {}, validate });
    expect(result.value).toEqual({ testCases: [] });
    expect(result.recoveredAttempts).toEqual([
      { model: "qwen", reason: LLM_FAILURE_REASONS.LLM_SCHEMA_INVALID, message: expect.any(String) },
    ]);
  });
});
