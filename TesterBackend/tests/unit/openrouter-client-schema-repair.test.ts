import { afterEach, describe, expect, it, vi } from "vitest";

process.env.OPENROUTER_API_KEY = "test-key";
process.env.OPENROUTER_MODELS = "vendor-a/model-a:free,vendor-b/model-b:free,vendor-c/model-c:free";

const { OpenRouterClient } = await import("../../src/ai/openrouter-client.js");
const { AppError } = await import("../../src/errors/app-error.js");
const { LLM_FAILURE_REASONS } = await import("../../src/errors/error-codes.js");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function contentResponse(content: string): Response {
  return jsonResponse(200, { choices: [{ message: { content }, finish_reason: "stop" }] });
}

describe("OpenRouterClient schema validation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("classifies a shape failure as llm_schema_invalid and retries the same model with a repair prompt before advancing", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      contentResponse(JSON.stringify({ testCases: [], unknownKey: "smuggled" })),
    );
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
    // 2 attempts (normal + repair) per model x 3 models, since every response keeps failing validation.
    expect(fetchMock).toHaveBeenCalledTimes(6);

    const details = error?.details as { attempts: Array<{ model: string; reason: string }> } | undefined;
    expect(details?.attempts).toHaveLength(6);
    expect(details?.attempts.every((attempt) => attempt.reason === LLM_FAILURE_REASONS.LLM_SCHEMA_INVALID)).toBe(true);

    const repairInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    const repairBody = JSON.parse(String(repairInit?.body)) as { messages: Array<{ content: string }> };
    expect(repairBody.messages[0]?.content).toContain("Your previous response could not be parsed");
  });

  it("recovers via the repair prompt once the response satisfies the validator", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      return call === 1
        ? contentResponse(JSON.stringify({ testCases: [], unknownKey: "smuggled" }))
        : contentResponse(JSON.stringify({ testCases: [] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const validate = (value: unknown) => {
      const record = value as { unknownKey?: unknown };
      return record.unknownKey === undefined ? { ok: true as const } : { ok: false as const, message: "unknown key: unknownKey" };
    };

    const result = await new OpenRouterClient().createStructuredPlan({ systemPrompt: "sys", context: {}, validate });

    expect(result).toEqual({ testCases: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
