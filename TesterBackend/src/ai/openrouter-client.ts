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

const NON_JSON_CONTENT_TYPE = "OpenRouter response was not JSON.";
const AUTH_REJECTED = "OpenRouter credential is configured but was rejected by the provider.";

export interface StructuredPlanResult {
  value: unknown;
  provider: "openrouter";
  model: string;
  recoveredAttempts: LlmAttempt[];
}

const TEST_PLAN_JSON_SCHEMA = {
  name: "form_test_plan",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      testCases: {
        type: "array",
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            caseId: { type: "string", maxLength: 100 },
            formId: { type: "string", maxLength: 100 },
            testType: {
              type: "string",
              enum: ["FORMS", "FORM_VALIDATION", "POSITIVE", "NEGATIVE", "BOUNDARY", "ERROR_HANDLING"],
            },
            intent: { type: "string", maxLength: 1000 },
            inputs: {
              type: "array",
              maxItems: 100,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  elementId: { type: "string", pattern: "^element_[1-9][0-9]*$" },
                  value: { type: "string", maxLength: 500 },
                },
                required: ["elementId", "value"],
              },
            },
            submit: { type: "boolean" },
            expectedOutcome: {
              type: "object",
              additionalProperties: false,
              properties: {
                kind: {
                  type: "string",
                  enum: ["VALIDATION_ERROR", "FIELD_ERROR", "SUBMIT_ACCEPTED", "NO_NAVIGATION", "ERROR_MESSAGE_SHOWN"],
                },
                elementId: { type: ["string", "null"], pattern: "^element_[1-9][0-9]*$" },
              },
              required: ["kind", "elementId"],
            },
          },
          required: ["caseId", "formId", "testType", "intent", "inputs", "submit", "expectedOutcome"],
        },
      },
    },
    required: ["testCases"],
  },
} as const;

export class OpenRouterClient {
  async createStructuredPlan(input: {
    systemPrompt: string;
    context: unknown;
    validate?: (value: unknown) => { ok: true } | { ok: false; message: string };
  }): Promise<StructuredPlanResult> {
    if (!config.ai.apiKey) {
      throw new AppError({
        code: ERROR_CODES.AI_REQUEST_FAILURE,
        message: "OPENROUTER_API_KEY must be configured.",
        statusCode: 500,
        fatal: true,
      });
    }

    const attempts: LlmAttempt[] = [];
    let first = await this.attempt(input.systemPrompt, input.context, undefined, input.validate);
    if (first.ok) return this.success(first.value, attempts);
    attempts.push(this.record(first));

    if (first.retryable) {
      first = await this.attempt(input.systemPrompt, input.context, undefined, input.validate);
      if (first.ok) return this.success(first.value, attempts);
      attempts.push(this.record(first));
    }

    const repairable =
      first.reason === LLM_FAILURE_REASONS.LLM_INVALID_JSON || first.reason === LLM_FAILURE_REASONS.LLM_SCHEMA_INVALID;
    if (repairable) {
      const repaired = await this.attempt(input.systemPrompt, input.context, first.message, input.validate);
      if (repaired.ok) return this.success(repaired.value, attempts);
      attempts.push(this.record(repaired));
    }

    const last = attempts[attempts.length - 1]!;
    throw new AppError({
      code: ERROR_CODES.AI_REQUEST_FAILURE,
      message: `OpenRouter request failed: ${last.message}`,
      statusCode: 502,
      details: redactSecrets({ attempts, reason: last.reason, provider: "openrouter", model: config.ai.model }),
      llmFailureReason: last.reason,
    });
  }

  private success(value: unknown, recoveredAttempts: LlmAttempt[]): StructuredPlanResult {
    return { value, provider: "openrouter", model: config.ai.model, recoveredAttempts };
  }

  private record(result: AttemptResult): LlmAttempt {
    return { model: config.ai.model, reason: result.reason!, message: result.message ?? "unknown error" };
  }

  private async attempt(
    systemPrompt: string,
    context: unknown,
    repairFailure?: string,
    validate?: (value: unknown) => { ok: true } | { ok: false; message: string },
  ): Promise<AttemptResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("OpenRouter request timed out.")), config.ai.timeoutMs);
    const userContent = repairFailure
      ? `INPUT_JSON\n${JSON.stringify(context)}\nThe previous output failed validation: ${repairFailure.slice(0, 500)}. Return a corrected plan.`
      : `INPUT_JSON\n${JSON.stringify(context)}`;

    try {
      return await withTimeout((async () => {
        const headers: Record<string, string> = {
          authorization: `Bearer ${config.ai.apiKey}`,
          "content-type": "application/json",
        };
        if (config.ai.httpReferer) headers["HTTP-Referer"] = config.ai.httpReferer;
        if (config.ai.appTitle) headers["X-OpenRouter-Title"] = config.ai.appTitle;

        const response = await fetch(config.ai.apiUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({
            models: config.ai.models,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userContent },
            ],
            response_format: { type: "json_schema", json_schema: TEST_PLAN_JSON_SCHEMA },
            provider: { require_parameters: true },
            stream: false,
          }),
          signal: controller.signal,
        });
        const rawBody = await response.text();
        if (response.status === 401 || response.status === 403) {
          return { ok: false, reason: LLM_FAILURE_REASONS.LLM_UNAVAILABLE, message: `${AUTH_REJECTED} HTTP ${response.status}.` };
        }
        if (response.status === 429) {
          return { ok: false, reason: LLM_FAILURE_REASONS.LLM_RATE_LIMITED, message: "OpenRouter responded 429." };
        }
        if (!response.ok) {
          const providerError = extractProviderError(rawBody);
          return {
            ok: false,
            reason: LLM_FAILURE_REASONS.LLM_TRANSPORT_ERROR,
            message: `OpenRouter responded ${response.status}${providerError ? `: ${providerError}` : ""}.`,
            retryable: [408, 502, 503, 504].includes(response.status),
          };
        }

        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        if (!contentType.includes("application/json")) {
          return { ok: false, reason: LLM_FAILURE_REASONS.LLM_UNAVAILABLE, message: `${NON_JSON_CONTENT_TYPE} Content-Type: ${contentType || "missing"}.` };
        }

        let envelope: unknown;
        try {
          envelope = JSON.parse(rawBody);
        } catch (error) {
          return { ok: false, reason: LLM_FAILURE_REASONS.LLM_INVALID_JSON, message: `OpenRouter response body was not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
        }

        const extracted = extractStructuredValue(envelope);
        if (!extracted.ok) return { ok: false, reason: LLM_FAILURE_REASONS.LLM_INVALID_JSON, message: extracted.message };
        if (validate) {
          const result = validate(extracted.value);
          if (!result.ok) {
            return { ok: false, reason: LLM_FAILURE_REASONS.LLM_SCHEMA_INVALID, message: `OpenRouter response failed schema validation: ${result.message}` };
          }
        }
        return { ok: true, value: extracted.value };
      })(), config.ai.timeoutMs, "OpenRouter request timed out.");
    } catch (error) {
      return { ok: false, reason: LLM_FAILURE_REASONS.LLM_TRANSPORT_ERROR, message: error instanceof Error ? error.message : String(error), retryable: true };
    } finally {
      clearTimeout(timer);
    }
  }
}

function extractProviderError(rawBody: string): string | undefined {
  try {
    const parsed = JSON.parse(rawBody) as { error?: unknown; message?: unknown };
    const nestedMessage = parsed.error && typeof parsed.error === "object" && "message" in parsed.error
      ? (parsed.error as { message?: unknown }).message
      : undefined;
    const value = typeof nestedMessage === "string"
      ? nestedMessage
      : typeof parsed.error === "string"
        ? parsed.error
        : typeof parsed.message === "string"
          ? parsed.message
          : undefined;
    return value?.slice(0, 300).replace(/[\r\n]+/g, " ");
  } catch {
    return undefined;
  }
}

function extractStructuredValue(input: unknown): { ok: true; value: unknown } | { ok: false; message: string } {
  const candidates: unknown[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown): void => {
    if (value === null || value === undefined || seen.has(value)) return;
    seen.add(value);
    if (typeof value === "string") {
      const jsonText = extractJsonText(value.trim());
      if (jsonText) {
        try { candidates.push(JSON.parse(jsonText)); } catch { /* handled below */ }
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.testCases)) candidates.push(record);
    Object.values(record).forEach(visit);
  };
  visit(input);
  const structured = candidates.filter((candidate) => candidate && typeof candidate === "object" && Array.isArray((candidate as { testCases?: unknown }).testCases));
  if (structured.length === 1) return { ok: true, value: normalizePlan(structured[0]) };
  if (structured.length > 1) return { ok: false, message: "OpenRouter response contained multiple competing structured payloads." };
  return { ok: false, message: "OpenRouter response did not include a parseable { testCases: [...] } payload." };
}

function normalizePlan(value: unknown): unknown {
  if (!value || typeof value !== "object" || !Array.isArray((value as { testCases?: unknown }).testCases)) return value;
  const plan = value as { testCases: Array<Record<string, unknown>> };
  for (const testCase of plan.testCases) {
    const expected = testCase.expectedOutcome;
    if (expected && typeof expected === "object" && (expected as { elementId?: unknown }).elementId === null) {
      delete (expected as { elementId?: unknown }).elementId;
    }
  }
  return plan;
}

function extractJsonText(value: string): string | undefined {
  if (value.startsWith("{") || value.startsWith("[")) return value;
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced?.startsWith("{") || fenced?.startsWith("[")) return fenced;
  const objectStart = value.indexOf("{");
  const objectEnd = value.lastIndexOf("}");
  return objectStart >= 0 && objectEnd > objectStart ? value.slice(objectStart, objectEnd + 1) : undefined;
}
