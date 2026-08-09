import { config } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import { ERROR_CODES, LLM_FAILURE_REASONS, type LlmAttempt, type LlmFailureReason } from "../errors/error-codes.js";
import { redactSecrets } from "../security/secret-redaction.js";
import { delay, withTimeout } from "../utilities/timeout.js";

interface Attempt {
  ok: boolean;
  value?: unknown;
  reason?: LlmFailureReason;
  message?: string;
  /** Present only on a 429, parsed from the Retry-After response header. */
  retryAfterMs?: number;
}

/** Cap on how long a single Retry-After wait is honored for, regardless of what the header says. */
const MAX_RETRY_AFTER_MS = 5000;

/**
 * OpenRouter chat-completions client.
 *
 * Retry ladder per DESIGN-DECISIONS.md §5: for each of the three pinned free
 * models, try once with the normal prompt; if that fails on a parse/shape
 * problem, retry the *same* model once with a repair prompt carrying the
 * parse error; then move to the next model. A transport or availability
 * failure skips straight to the next model rather than repairing, since
 * repairing a prompt cannot fix a 404 or a rate limit. A 429 additionally
 * honors the server's own Retry-After hint (capped) before advancing.
 *
 * Every attempt across every model is recorded, not just the last one — a run
 * that exhausts all 3 models failed 3+ times, and knowing only the final
 * reason makes "why did AI planning fail" unanswerable from the report alone.
 *
 * The deterministic fallback this ladder bottoms out to lives in the AI
 * planner, not here — this client's job ends at reporting typed reasons.
 */
export class OpenRouterClient {
  async createStructuredPlan(input: {
    systemPrompt: string;
    context: unknown;
    /** Optional shape check beyond JSON parsing; a failure here joins the same repair/next-model ladder as a parse failure. */
    validate?: (value: unknown) => { ok: true } | { ok: false; message: string };
  }): Promise<unknown> {
    if (!config.openRouter.apiKey || config.openRouter.models.length !== 3) {
      throw new AppError({
        code: ERROR_CODES.AI_REQUEST_FAILURE,
        message: "OPENROUTER_API_KEY and exactly 3 OPENROUTER_MODELS must be configured.",
        statusCode: 500,
        fatal: true,
      });
    }

    const attempts: LlmAttempt[] = [];

    for (const model of config.openRouter.models) {
      const first = await this.attempt(model, input.systemPrompt, input.context, input.validate);
      if (first.ok) return first.value;
      attempts.push({ model, reason: first.reason!, message: first.message ?? "unknown error" });

      if (first.reason === LLM_FAILURE_REASONS.LLM_RATE_LIMITED && first.retryAfterMs) {
        await delay(Math.min(first.retryAfterMs, MAX_RETRY_AFTER_MS));
      }

      const repairable =
        first.reason === LLM_FAILURE_REASONS.LLM_INVALID_JSON || first.reason === LLM_FAILURE_REASONS.LLM_SCHEMA_INVALID;
      if (repairable) {
        const repairPrompt = `${input.systemPrompt}\n\nYour previous response could not be parsed as valid JSON matching the required schema. Parse error: ${first.message}\nReturn ONLY valid JSON that matches the schema exactly.`;
        const repaired = await this.attempt(model, repairPrompt, input.context, input.validate);
        if (repaired.ok) return repaired.value;
        attempts.push({ model, reason: repaired.reason!, message: repaired.message ?? "unknown error" });
      }
    }

    const last = attempts[attempts.length - 1]!;
    throw new AppError({
      code: ERROR_CODES.AI_REQUEST_FAILURE,
      message: `OpenRouter request failed on all ${config.openRouter.models.length} configured models: ${last.message}`,
      statusCode: 502,
      details: redactSecrets({ attempts, reason: last.reason, model: last.model }),
      llmFailureReason: last.reason,
    });
  }

  private async attempt(
    model: string,
    systemPrompt: string,
    context: unknown,
    validate?: (value: unknown) => { ok: true } | { ok: false; message: string },
  ): Promise<Attempt> {
    const body = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(context) },
      ],
      response_format: { type: "json_object" },
      temperature: config.openRouter.temperature,
      max_tokens: config.openRouter.maxOutputTokens,
    };

    let response: Response;
    try {
      response = await withTimeout(
        fetch(`${config.openRouter.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.openRouter.apiKey}`,
            ...(config.openRouter.siteUrl ? { "HTTP-Referer": config.openRouter.siteUrl } : {}),
            ...(config.openRouter.appName ? { "X-Title": config.openRouter.appName } : {}),
          },
          body: JSON.stringify(body),
        }),
        config.openRouter.timeoutMs,
        "OpenRouter request timed out.",
      );
    } catch (error) {
      return {
        ok: false,
        reason: LLM_FAILURE_REASONS.LLM_TRANSPORT_ERROR,
        message: error instanceof Error ? error.message : String(error),
      };
    }

    if (response.status === 429) {
      return {
        ok: false,
        reason: LLM_FAILURE_REASONS.LLM_RATE_LIMITED,
        message: `OpenRouter responded 429 for model ${model}.`,
        retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
      };
    }
    if (response.status === 404 || response.status === 400) {
      return {
        ok: false,
        reason: LLM_FAILURE_REASONS.LLM_UNAVAILABLE,
        message: `OpenRouter responded ${response.status} for model ${model}. The model may be delisted or misconfigured.`,
      };
    }
    if (!response.ok) {
      return { ok: false, reason: LLM_FAILURE_REASONS.LLM_TRANSPORT_ERROR, message: `OpenRouter responded ${response.status} for model ${model}.` };
    }

    let data: { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> };
    try {
      data = (await response.json()) as typeof data;
    } catch (error) {
      return {
        ok: false,
        reason: LLM_FAILURE_REASONS.LLM_INVALID_JSON,
        message: `OpenRouter response body was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const choice = data.choices?.[0];
    if (choice?.finish_reason === "length") {
      return { ok: false, reason: LLM_FAILURE_REASONS.LLM_TRUNCATED, message: `Model ${model} truncated its response (finish_reason: length).` };
    }

    const content = choice?.message?.content;
    if (!content) {
      return { ok: false, reason: LLM_FAILURE_REASONS.LLM_INVALID_JSON, message: "OpenRouter response did not include content." };
    }

    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch (error) {
      return {
        ok: false,
        reason: LLM_FAILURE_REASONS.LLM_INVALID_JSON,
        message: `Model ${model} content was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    if (validate) {
      const result = validate(value);
      if (!result.ok) {
        return { ok: false, reason: LLM_FAILURE_REASONS.LLM_SCHEMA_INVALID, message: `Model ${model} response failed schema validation: ${result.message}` };
      }
    }

    return { ok: true, value };
  }
}

/** OpenRouter sends Retry-After as an integer number of seconds; HTTP-date form is not handled. */
function parseRetryAfterMs(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;
  const seconds = Number(headerValue);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return seconds * 1000;
}
