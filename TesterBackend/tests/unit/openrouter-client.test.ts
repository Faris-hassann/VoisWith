import { afterEach, describe, expect, it, vi } from "vitest";

process.env.OPENROUTER_API_KEY = "test-key";
process.env.OPENROUTER_API_URL = "https://openrouter.test/api/v1/chat/completions";
process.env.OPENROUTER_MODEL = "openai/gpt-4o-mini";
process.env.OPENROUTER_TIMEOUT_MS = "60000";

const { OpenRouterClient } = await import("../../src/ai/openrouter-client.js");
const { AppError } = await import("../../src/errors/app-error.js");
const { LLM_FAILURE_REASONS } = await import("../../src/errors/error-codes.js");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("OpenRouterClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("classifies a 429 as llm_rate_limited without multi-model retries", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(429, { error: "rate_limited" }));
    vi.stubGlobal("fetch", fetchMock);

    const error = await capture(() => new OpenRouterClient().createStructuredPlan({ systemPrompt: "sys", context: {} }));
    expect(error?.llmFailureReason).toBe(LLM_FAILURE_REASONS.LLM_RATE_LIMITED);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies 401 as llm_unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(401, { error: "unauthorized" })));
    const error = await capture(() => new OpenRouterClient().createStructuredPlan({ systemPrompt: "sys", context: {} }));
    expect(error?.llmFailureReason).toBe(LLM_FAILURE_REASONS.LLM_UNAVAILABLE);
    expect(error?.message).toContain("credential is configured but was rejected");
  });

  it("classifies a network throw as llm_transport_error", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);
    const error = await capture(() => new OpenRouterClient().createStructuredPlan({ systemPrompt: "sys", context: {} }));
    expect(error?.llmFailureReason).toBe(LLM_FAILURE_REASONS.LLM_TRANSPORT_ERROR);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("recovers from one transient network failure", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse(200, completion('{"testCases":[]}')));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenRouterClient().createStructuredPlan({ systemPrompt: "sys", context: {} });
    expect(result.value).toEqual({ testCases: [] });
    expect(result.recoveredAttempts).toHaveLength(1);
  });

  it("repairs invalid JSON once", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, completion("not json")));
    vi.stubGlobal("fetch", fetchMock);

    const error = await capture(() => new OpenRouterClient().createStructuredPlan({ systemPrompt: "sys", context: {} }));
    expect(error?.llmFailureReason).toBe(LLM_FAILURE_REASONS.LLM_INVALID_JSON);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const repairCall = fetchMock.mock.calls[1] as [unknown, RequestInit?] | undefined;
    const repairInit = repairCall?.[1];
    const repairBody = JSON.parse(String(repairInit?.body)) as { messages: Array<{ content: string }> };
    expect(repairBody.messages[1]?.content).toContain("previous output failed validation");
  });

  it("returns parsed content on success", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, completion('{"testCases":[]}')));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenRouterClient().createStructuredPlan({ systemPrompt: "sys", context: {} });
    expect(result.value).toEqual({ testCases: [] });
    expect(result.provider).toBe("openrouter");
    expect(result.model).toBe("openai/gpt-4o-mini");
    expect(result.recoveredAttempts).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = ((fetchMock.mock.calls as unknown) as Array<[unknown, RequestInit | undefined]>)[0]?.[1];
    expect(init).toBeDefined();
    if (!init) throw new Error("Missing fetch init");
    expect(init.headers).toMatchObject({
      authorization: "Bearer test-key",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      models: ["openai/gpt-4o-mini"],
      messages: [{ role: "system", content: "sys" }, { role: "user", content: "INPUT_JSON\n{}" }],
      response_format: { type: "json_schema" },
      provider: { require_parameters: true },
      stream: false,
    });
  });

  it("extracts JSON from a Markdown-fenced provider response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, completion("Result:\n```json\n{\"testCases\":[]}\n```"))));

    const result = await new OpenRouterClient().createStructuredPlan({ systemPrompt: "sys", context: {} });
    expect(result.value).toEqual({ testCases: [] });
  });

  it("includes a safe provider error code in non-success diagnostics", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(400, { error: "message_too_long" })));

    const error = await capture(() => new OpenRouterClient().createStructuredPlan({ systemPrompt: "sys", context: {} }));
    expect(error?.message).toContain("OpenRouter responded 400: message_too_long");
  });

  it("sends large prompts without the old Qwen 2,000-character limit", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, completion('{"testCases":[]}')));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenRouterClient().createStructuredPlan({ systemPrompt: "x".repeat(2001), context: {} });
    expect(result.value).toEqual({ testCases: [] });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("classifies a non-JSON content type as llm_unavailable without repair", async () => {
    const fetchMock = vi.fn(async () => new Response("<html>bad gateway</html>", { status: 200, headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetchMock);

    const error = await capture(() => new OpenRouterClient().createStructuredPlan({ systemPrompt: "sys", context: {} }));
    expect(error?.llmFailureReason).toBe(LLM_FAILURE_REASONS.LLM_UNAVAILABLE);
    expect(error?.message).toContain("response was not JSON");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("records the failed first attempt when repair succeeds", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      return call === 1
        ? jsonResponse(200, completion("not json"))
        : jsonResponse(200, completion('{"testCases":[]}'));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenRouterClient().createStructuredPlan({ systemPrompt: "sys", context: {} });
    expect(result.recoveredAttempts).toEqual([
      { model: "openai/gpt-4o-mini", reason: LLM_FAILURE_REASONS.LLM_INVALID_JSON, message: expect.any(String) },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves both attempts when repair also fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, completion("not json"))));

    const error = await capture(() => new OpenRouterClient().createStructuredPlan({ systemPrompt: "sys", context: {} }));
    const details = error?.details as { attempts: Array<{ model: string; reason: string }> } | undefined;
    expect(details?.attempts).toHaveLength(2);
    expect(details?.attempts.every((attempt) => attempt.model === "openai/gpt-4o-mini")).toBe(true);
  });
});

function completion(content: string): unknown {
  return { choices: [{ message: { role: "assistant", content } }] };
}

async function capture(fn: () => Promise<unknown>): Promise<InstanceType<typeof AppError> | undefined> {
  try {
    await fn();
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error : undefined;
  }
}
