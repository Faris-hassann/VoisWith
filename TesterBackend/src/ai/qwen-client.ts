import { config } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import { ERROR_CODES, LLM_FAILURE_REASONS, type LlmAttempt, type LlmFailureReason } from "../errors/error-codes.js";
import { redactSecrets } from "../security/secret-redaction.js";
import { withTimeout } from "../utilities/timeout.js";

interface AttemptResult {
  ok: boolean;
  value?: unknown;
  reason?: LlmFailureReason;
  message?: string;
}

export interface StructuredPlanResult {
  value: unknown;
  provider: "qwen";
  model: "qwen";
  recoveredAttempts: LlmAttempt[];
}

export class QwenClient {
  async createStructuredPlan(input: {
    systemPrompt: string;
    context: unknown;
    validate?: (value: unknown) => { ok: true } | { ok: false; message: string };
  }): Promise<StructuredPlanResult> {
    if (!config.ai.apiKey) {
      throw new AppError({
        code: ERROR_CODES.AI_REQUEST_FAILURE,
        message: "QWEN_API_KEY must be configured.",
        statusCode: 500,
        fatal: true,
      });
    }

    const attempts: LlmAttempt[] = [];
    const first = await this.attempt(this.composeMessage(input.systemPrompt, input.context), input.validate);
    if (first.ok) {
      return { value: first.value, provider: "qwen", model: "qwen", recoveredAttempts: [] };
    }
    attempts.push({ model: "qwen", reason: first.reason!, message: first.message ?? "unknown error" });

    const repairable =
      first.reason === LLM_FAILURE_REASONS.LLM_INVALID_JSON || first.reason === LLM_FAILURE_REASONS.LLM_SCHEMA_INVALID;
    if (repairable) {
      const repaired = await this.attempt(this.composeRepairMessage(input.systemPrompt, input.context, first.message ?? "unknown error"), input.validate);
      if (repaired.ok) {
        return { value: repaired.value, provider: "qwen", model: "qwen", recoveredAttempts: attempts };
      }
      attempts.push({ model: "qwen", reason: repaired.reason!, message: repaired.message ?? "unknown error" });
    }

    const last = attempts[attempts.length - 1]!;
    throw new AppError({
      code: ERROR_CODES.AI_REQUEST_FAILURE,
      message: `Qwen request failed: ${last.message}`,
      statusCode: 502,
      details: redactSecrets({ attempts, reason: last.reason, provider: "qwen" }),
      llmFailureReason: last.reason,
    });
  }

  private composeMessage(systemPrompt: string, context: unknown): string {
    return `${systemPrompt}\n\nRUNTIME INPUT JSON\n${JSON.stringify(context, null, 2)}`;
  }

  private composeRepairMessage(systemPrompt: string, context: unknown, failure: string): string {
    return `${this.composeMessage(systemPrompt, context)}\n\nYour previous response was invalid.\nFailure: ${failure}\nReturn only valid JSON matching the required schema exactly.`;
  }

  private async attempt(
    message: string,
    validate?: (value: unknown) => { ok: true } | { ok: false; message: string },
  ): Promise<AttemptResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Qwen request timed out.")), config.ai.timeoutMs);

    let response: Response;
    try {
      response = await fetch(config.ai.apiUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.ai.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      return {
        ok: false,
        reason: LLM_FAILURE_REASONS.LLM_TRANSPORT_ERROR,
        message: error instanceof Error ? error.message : String(error),
      };
    }
    clearTimeout(timer);

    if (response.status === 401 || response.status === 403 || response.status === 400 || response.status === 404) {
      return {
        ok: false,
        reason: LLM_FAILURE_REASONS.LLM_UNAVAILABLE,
        message: response.status === 401 || response.status === 403
          ? `Qwen rejected the configured credential (${response.status}).`
          : `Qwen responded ${response.status}.`,
      };
    }
    if (response.status === 429) {
      return {
        ok: false,
        reason: LLM_FAILURE_REASONS.LLM_RATE_LIMITED,
        message: "Qwen responded 429.",
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        reason: LLM_FAILURE_REASONS.LLM_TRANSPORT_ERROR,
        message: `Qwen responded ${response.status}.`,
      };
    }

    let rawBody = "";
    try {
      rawBody = await withTimeout(response.text(), config.ai.timeoutMs, "Qwen response body timed out.");
    } catch (error) {
      return {
        ok: false,
        reason: LLM_FAILURE_REASONS.LLM_TRANSPORT_ERROR,
        message: error instanceof Error ? error.message : String(error),
      };
    }

    let envelope: unknown;
    try {
      envelope = JSON.parse(rawBody);
    } catch (error) {
      return {
        ok: false,
        reason: LLM_FAILURE_REASONS.LLM_INVALID_JSON,
        message: `Qwen response body was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const extracted = extractStructuredValue(envelope);
    if (!extracted.ok) {
      return { ok: false, reason: LLM_FAILURE_REASONS.LLM_INVALID_JSON, message: extracted.message };
    }

    if (validate) {
      const result = validate(extracted.value);
      if (!result.ok) {
        return {
          ok: false,
          reason: LLM_FAILURE_REASONS.LLM_SCHEMA_INVALID,
          message: `Qwen response failed schema validation: ${result.message}`,
        };
      }
    }

    return { ok: true, value: extracted.value };
  }
}

function extractStructuredValue(input: unknown): { ok: true; value: unknown } | { ok: false; message: string } {
  const seen = new Set<unknown>();
  const candidates: unknown[] = [];

  const visit = (value: unknown) => {
    if (value === null || value === undefined || seen.has(value)) return;
    seen.add(value);

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          candidates.push(JSON.parse(trimmed));
        } catch {
          candidates.push(trimmed);
        }
      }
      return;
    }

    if (!Array.isArray(value) && typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    const record = value as Record<string, unknown>;
    if (Array.isArray(record.testCases)) {
      candidates.push(record);
    }
    for (const nestedValue of Object.values(record)) {
      visit(nestedValue);
    }
  };

  visit(input);

  const structured = candidates.filter((candidate) => {
    return Boolean(candidate && typeof candidate === "object" && Array.isArray((candidate as { testCases?: unknown }).testCases));
  });
  if (structured.length === 1) {
    return { ok: true, value: structured[0] };
  }
  if (structured.length > 1) {
    return { ok: false, message: "Qwen response contained multiple competing structured payloads." };
  }
  return { ok: false, message: "Qwen response did not include a parseable { testCases: [...] } payload." };
}
