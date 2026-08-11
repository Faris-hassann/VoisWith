import { afterEach, describe, expect, it, vi } from "vitest";

process.env.QWEN_API_KEY = "test-key";
process.env.QWEN_API_URL = "https://qwen.snouhy.com/chat";
process.env.QWEN_TIMEOUT_MS = "60000";

const { QwenClient } = await import("../../src/ai/qwen-client.js");
const { AppError } = await import("../../src/errors/app-error.js");
const { LLM_FAILURE_REASONS } = await import("../../src/errors/error-codes.js");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("QwenClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("classifies a 429 as llm_rate_limited without multi-model retries", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(429, { error: "rate_limited" }));
    vi.stubGlobal("fetch", fetchMock);

    const error = await capture(() => new QwenClient().createStructuredPlan({ systemPrompt: "sys", context: {} }));
    expect(error?.llmFailureReason).toBe(LLM_FAILURE_REASONS.LLM_RATE_LIMITED);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies 401 as llm_unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(401, { error: "unauthorized" })));
    const error = await capture(() => new QwenClient().createStructuredPlan({ systemPrompt: "sys", context: {} }));
    expect(error?.llmFailureReason).toBe(LLM_FAILURE_REASONS.LLM_UNAVAILABLE);
  });

  it("classifies a network throw as llm_transport_error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    const error = await capture(() => new QwenClient().createStructuredPlan({ systemPrompt: "sys", context: {} }));
    expect(error?.llmFailureReason).toBe(LLM_FAILURE_REASONS.LLM_TRANSPORT_ERROR);
  });

  it("repairs invalid JSON once", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { message: "not json" }));
    vi.stubGlobal("fetch", fetchMock);

    const error = await capture(() => new QwenClient().createStructuredPlan({ systemPrompt: "sys", context: {} }));
    expect(error?.llmFailureReason).toBe(LLM_FAILURE_REASONS.LLM_INVALID_JSON);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const repairCall = fetchMock.mock.calls[1] as [unknown, RequestInit?] | undefined;
    const repairInit = repairCall?.[1];
    const repairBody = JSON.parse(String(repairInit?.body)) as { message: string };
    expect(repairBody.message).toContain("Your previous response was invalid");
  });

  it("returns parsed content on success", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { message: '{"testCases":[]}' }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new QwenClient().createStructuredPlan({ systemPrompt: "sys", context: {} });
    expect(result.value).toEqual({ testCases: [] });
    expect(result.provider).toBe("qwen");
    expect(result.model).toBe("qwen");
    expect(result.recoveredAttempts).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("records the failed first attempt when repair succeeds", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      return call === 1
        ? jsonResponse(200, { message: "not json" })
        : jsonResponse(200, { message: '{"testCases":[]}' });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new QwenClient().createStructuredPlan({ systemPrompt: "sys", context: {} });
    expect(result.recoveredAttempts).toEqual([
      { model: "qwen", reason: LLM_FAILURE_REASONS.LLM_INVALID_JSON, message: expect.any(String) },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves both attempts when repair also fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { message: "not json" })));

    const error = await capture(() => new QwenClient().createStructuredPlan({ systemPrompt: "sys", context: {} }));
    const details = error?.details as { attempts: Array<{ model: string; reason: string }> } | undefined;
    expect(details?.attempts).toHaveLength(2);
    expect(details?.attempts.every((attempt) => attempt.model === "qwen")).toBe(true);
  });
});

async function capture(fn: () => Promise<unknown>): Promise<InstanceType<typeof AppError> | undefined> {
  try {
    await fn();
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error : undefined;
  }
}
