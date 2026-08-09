export const ERROR_CODES = {
  INVALID_REQUEST: "INVALID_REQUEST",
  AUTHORIZATION_CONFIRMATION_MISSING: "AUTHORIZATION_CONFIRMATION_MISSING",
  UNSAFE_TARGET: "UNSAFE_TARGET",
  DNS_RESOLUTION_FAILURE: "DNS_RESOLUTION_FAILURE",
  BROWSER_LAUNCH_FAILURE: "BROWSER_LAUNCH_FAILURE",
  NAVIGATION_FAILURE: "NAVIGATION_FAILURE",
  LOGIN_FAILURE: "LOGIN_FAILURE",
  HUMAN_AUTHENTICATION_REQUIRED: "HUMAN_AUTHENTICATION_REQUIRED",
  CRAWL_LIMIT_REACHED: "CRAWL_LIMIT_REACHED",
  RUN_TIMEOUT: "RUN_TIMEOUT",
  AI_REQUEST_FAILURE: "AI_REQUEST_FAILURE",
  INVALID_AI_RESPONSE: "INVALID_AI_RESPONSE",
  AI_PLANNING_LIMIT_REACHED: "AI_PLANNING_LIMIT_REACHED",
  ACTION_BLOCKED_BY_POLICY: "ACTION_BLOCKED_BY_POLICY",
  ELEMENT_NO_LONGER_AVAILABLE: "ELEMENT_NO_LONGER_AVAILABLE",
  ASSERTION_FAILURE: "ASSERTION_FAILURE",
  PAGE_CRASH: "PAGE_CRASH",
  REPORT_GENERATION_FAILURE: "REPORT_GENERATION_FAILURE",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Typed LLM failure reasons recorded on the run rather than thrown to the caller.
 * An exhausted or failing model degrades the run to deterministic checks; it
 * never fails the run. See DESIGN-DECISIONS.md §5 for the full taxonomy.
 */
export const LLM_FAILURE_REASONS = {
  /** Network failure, timeout, or non-JSON transport error reaching OpenRouter. */
  LLM_TRANSPORT_ERROR: "llm_transport_error",
  /** OpenRouter responded 429 (shared free-tier ceiling hit). */
  LLM_RATE_LIMITED: "llm_rate_limited",
  /** The response body was not parseable JSON. */
  LLM_INVALID_JSON: "llm_invalid_json",
  /**
   * The parsed response did not satisfy the strict contract: an unknown key
   * (including any selector-bearing key), an elementId or formId absent from
   * the input snapshots, a value over the length cap, an oversized option
   * array, or an outcome outside the five-value enum.
   */
  LLM_SCHEMA_INVALID: "llm_schema_invalid",
  /** The response was cut off before completion (finish_reason: "length"). */
  LLM_TRUNCATED: "llm_truncated",
  /** The model or endpoint is unavailable (404/400) — e.g. a delisted or misconfigured slug. */
  LLM_UNAVAILABLE: "llm_unavailable",
} as const;

export type LlmFailureReason = (typeof LLM_FAILURE_REASONS)[keyof typeof LLM_FAILURE_REASONS];

/**
 * One model attempt within a single OpenRouterClient.createStructuredPlan call.
 * Kept in full (not just the last attempt) so a report can answer "why did AI
 * planning fail" without re-running — every pinned model's own reason survives.
 */
export interface LlmAttempt {
  model: string;
  reason: LlmFailureReason;
  message: string;
}
