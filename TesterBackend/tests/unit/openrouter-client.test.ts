import { afterEach, describe, expect, it, vi } from "vitest";

// Config is read once at module load, so the three pinned models and a key
// must be in place before env.ts (and therefore openrouter-client.ts) import.
process.env.OPENROUTER_API_KEY = "test-key";
process.env.OPENROUTER_MODELS = "vendor-a/model-a:free,vendor-b/model-b:free,vendor-c/model-c:free";

const { OpenRouterClient } = await import("../../src/ai/openrouter-client.js");
const { AppError } = await import("../../src/errors/app-error.js");
const { LLM_FAILURE_REASONS } = await import("../../src/errors/error-codes.js");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function contentResponse(content: string, finishReason = "stop"): Response {
  return jsonResponse(200, { choices: [{ message: { content }, finish_reason: finishReason }] });
}

describe("OpenRouterClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("classifies a 429 as llm_rate_limited and advances to the next model", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(429, {}));
    vi.stubGlobal("fetch", fetchMock);

    const error = await capture(() => new OpenRouterClient().createStructuredPlan({ systemPrompt: "sys", context: {} }));
    expect(error?.llmFailureReason).toBe(LLM_FAILURE_REASONS.LLM_RATE_LIMITED);
    // One attempt per model, no repair retry for a rate limit.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("classifies a 404 as llm_unavailable (delisted or misconfigured model)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(404, {})));
    const error = await capture(() => new OpenRouterClient().createStructuredPlan({ systemPrompt: "sys", context: {} }));
    expect(error?.llmFailureReason).toBe(LLM_FAILURE_REASONS.LLM_UNAVAILABLE);
  });

  it("classifies a network throw as llm_transport_error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const error = await capture(() => new OpenRouterClient().createStructuredPlan({ systemPrompt: "sys", context: {} }));
    expect(error?.llmFailureReason).toBe(LLM_FAILURE_REASONS.LLM_TRANSPORT_ERROR);
  });

  it("classifies unparseable content as llm_invalid_json and retries the same model with a repair prompt", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => contentResponse("not json"));
    vi.stubGlobal("fetch", fetchMock);

    const error = await capture(() => new OpenRouterClient().createStructuredPlan({ systemPrompt: "sys", context: {} }));
    expect(error?.llmFailureReason).toBe(LLM_FAILURE_REASONS.LLM_INVALID_JSON);
    // 2 attempts (normal + repair) per model x 3 models.
    expect(fetchMock).toHaveBeenCalledTimes(6);
    const repairInit = fetchMock.mock.calls[1]?.[1];
    const repairBody = JSON.parse(String(repairInit?.body));
    expect(repairBody.messages[0].content).toContain("Your previous response could not be parsed");
  });

  it("classifies a truncated response as llm_truncated", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => contentResponse('{"testCases":[]}', "length")));
    const error = await capture(() => new OpenRouterClient().createStructuredPlan({ systemPrompt: "sys", context: {} }));
    expect(error?.llmFailureReason).toBe(LLM_FAILURE_REASONS.LLM_TRUNCATED);
  });

  it("returns parsed content on success without exhausting the model chain", async () => {
    const fetchMock = vi.fn(async () => contentResponse('{"testCases":[]}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenRouterClient().createStructuredPlan({ systemPrompt: "sys", context: {} });
    expect(result.value).toEqual({ testCases: [] });
    expect(result.model).toBe("vendor-a/model-a:free");
    // Nothing failed on the way, so there is nothing to report as recovered.
    expect(result.recoveredAttempts).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("recovers via the repair prompt without advancing models", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      return call === 1 ? contentResponse("not json") : contentResponse('{"testCases":[]}');
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenRouterClient().createStructuredPlan({ systemPrompt: "sys", context: {} });
    expect(result.value).toEqual({ testCases: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The failed first attempt survives as a recovered attempt rather than
    // vanishing just because a later try succeeded.
    expect(result.recoveredAttempts).toEqual([
      { model: "vendor-a/model-a:free", reason: LLM_FAILURE_REASONS.LLM_INVALID_JSON, message: expect.any(String) },
    ]);
  });

  it("preserves every model's own failure reason on full exhaustion, not just the last", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      // Model 1: truncated. Model 2: 404 unavailable. Model 3: 429 rate limited.
      if (call === 1) return contentResponse('{"partial', "length");
      if (call === 2) return jsonResponse(404, {});
      return jsonResponse(429, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    const error = await capture(() => new OpenRouterClient().createStructuredPlan({ systemPrompt: "sys", context: {} }));
    expect(error?.llmFailureReason).toBe(LLM_FAILURE_REASONS.LLM_RATE_LIMITED);

    const details = error?.details as { attempts: Array<{ model: string; reason: string }> } | undefined;
    expect(details?.attempts).toEqual([
      { model: "vendor-a/model-a:free", reason: LLM_FAILURE_REASONS.LLM_TRUNCATED, message: expect.any(String) },
      { model: "vendor-b/model-b:free", reason: LLM_FAILURE_REASONS.LLM_UNAVAILABLE, message: expect.any(String) },
      { model: "vendor-c/model-c:free", reason: LLM_FAILURE_REASONS.LLM_RATE_LIMITED, message: expect.any(String) },
    ]);
  });

  it("records both attempts (normal + repair) against the same model in the attempt history", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => contentResponse("not json")));
    const error = await capture(() => new OpenRouterClient().createStructuredPlan({ systemPrompt: "sys", context: {} }));

    const details = error?.details as { attempts: Array<{ model: string }> } | undefined;
    expect(details?.attempts).toHaveLength(6);
    expect(details?.attempts.filter((attempt) => attempt.model === "vendor-a/model-a:free")).toHaveLength(2);
  });

  it("honors a Retry-After header on 429 before advancing to the next model, capped at 5s", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(null, { status: 429, headers: { "retry-after": "1" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const promise = capture(() => new OpenRouterClient().createStructuredPlan({ systemPrompt: "sys", context: {} }));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await promise;
    expect(fetchMock).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
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
