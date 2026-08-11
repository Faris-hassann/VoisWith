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
  retryable?: boolean;
}

const NON_JSON_CONTENT_TYPE = "Qwen response was not JSON.";
const AUTH_REJECTED = "Qwen credential is configured but was rejected by the provider.";
/** The hosted /chat endpoint rejects message strings longer than 2,000 characters. */
export const QWEN_MAX_MESSAGE_CHARS = 2000;
/** Leave room for the short correction instruction used by the repair attempt. */
export const QWEN_PRIMARY_MESSAGE_CHARS = 1940;

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
    const primaryMessage = this.composeMessage(input.systemPrompt, input.context);
    let first = await this.attempt(primaryMessage, input.validate);
    if (first.ok) {
      return { value: first.value, provider: "qwen", model: "qwen", recoveredAttempts: [] };
    }
    attempts.push({ model: "qwen", reason: first.reason!, message: first.message ?? "unknown error" });

    if (first.retryable) {
      first = await this.attempt(primaryMessage, input.validate);
      if (first.ok) {
        return { value: first.value, provider: "qwen", model: "qwen", recoveredAttempts: attempts };
      }
      attempts.push({ model: "qwen", reason: first.reason!, message: first.message ?? "unknown error" });
    }

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
    return `${systemPrompt}\nINPUT_JSON\n${JSON.stringify(context)}`;
  }

  private composeRepairMessage(systemPrompt: string, context: unknown, failure: string): string {
    const failureKind = failure.includes("schema validation") ? "schema" : "JSON";
    return `${this.composeMessage(systemPrompt, context)}\nPrevious output had invalid ${failureKind}. Return corrected JSON only.`;
  }

  private async attempt(
    message: string,
    validate?: (value: unknown) => { ok: true } | { ok: false; message: string },
  ): Promise<AttemptResult> {
    if (message.length > QWEN_MAX_MESSAGE_CHARS) {
      return {
        ok: false,
        reason: LLM_FAILURE_REASONS.LLM_TRANSPORT_ERROR,
        message: `Qwen request exceeds the provider's ${QWEN_MAX_MESSAGE_CHARS}-character message limit (${message.length} characters).`,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Qwen request timed out.")), config.ai.timeoutMs);

    try {
      return await withTimeout((async () => {
        const response = await fetch(config.ai.apiUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.ai.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ message }),
          signal: controller.signal,
        });
        const rawBody = await response.text();
        if (response.status === 401 || response.status === 403) {
          return {
            ok: false,
            reason: LLM_FAILURE_REASONS.LLM_UNAVAILABLE,
            message: `${AUTH_REJECTED} HTTP ${response.status}.`,
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
          const providerError = extractProviderError(rawBody);
          return {
            ok: false,
            reason: LLM_FAILURE_REASONS.LLM_TRANSPORT_ERROR,
            message: `Qwen responded ${response.status}${providerError ? `: ${providerError}` : ""}.`,
            retryable: response.status >= 500,
          };
        }

        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        if (!contentType.includes("application/json")) {
          return {
            ok: false,
            reason: LLM_FAILURE_REASONS.LLM_UNAVAILABLE,
            message: `${NON_JSON_CONTENT_TYPE} Content-Type: ${contentType || "missing"}.`,
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
      })(), config.ai.timeoutMs, "Qwen request timed out.");
    } catch (error) {
      clearTimeout(timer);
      return {
        ok: false,
        reason: LLM_FAILURE_REASONS.LLM_TRANSPORT_ERROR,
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function extractProviderError(rawBody: string): string | undefined {
  try {
    const parsed = JSON.parse(rawBody) as { error?: unknown; message?: unknown };
    const value = typeof parsed.error === "string" ? parsed.error : typeof parsed.message === "string" ? parsed.message : undefined;
    return value?.slice(0, 200).replace(/[\r\n]+/g, " ");
  } catch {
    return undefined;
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
      const jsonText = extractJsonText(trimmed);
      if (jsonText) {
        try {
          candidates.push(JSON.parse(jsonText));
        } catch {
          candidates.push(jsonText);
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

function extractJsonText(value: string): string | undefined {
  if (value.startsWith("{") || value.startsWith("[")) return value;
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced?.startsWith("{") || fenced?.startsWith("[")) return fenced;
  const objectStart = value.indexOf("{");
  const objectEnd = value.lastIndexOf("}");
  return objectStart >= 0 && objectEnd > objectStart ? value.slice(objectStart, objectEnd + 1) : undefined;
}
