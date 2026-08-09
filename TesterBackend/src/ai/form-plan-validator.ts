import { buildFormTestPlanSchema } from "../schemas/llm-contract.schema.js";
import { LLM_FAILURE_REASONS, type LlmFailureReason } from "../errors/error-codes.js";
import type { FormSnapshot, FormTestPlan } from "../types/llm-contract.js";

export type FormPlanValidationResult =
  | { ok: true; plan: FormTestPlan }
  | { ok: false; reason: LlmFailureReason; details: unknown };

/**
 * Validates a raw LLM response against the batch it was produced from.
 *
 * Deliberately does not normalize, coerce, or repair: the strict contract is the
 * whole point, and a response that misses it is rejected as `llm_schema_invalid`
 * so the caller can retry, fall through to the next model, or degrade to
 * deterministic checks.
 */
export function validateFormTestPlan(raw: unknown, snapshots: FormSnapshot[]): FormPlanValidationResult {
  const parsed = buildFormTestPlanSchema(snapshots).safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: LLM_FAILURE_REASONS.LLM_SCHEMA_INVALID,
      details: parsed.error.flatten(),
    };
  }
  return { ok: true, plan: parsed.data };
}
