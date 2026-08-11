import type { FormSnapshot } from "../types/llm-contract.js";

/** DESIGN-DECISIONS.md §5: 3 forms per batch, or ~4k estimated input tokens, whichever hits first. */
const MAX_FORMS_PER_BATCH = 3;
const MAX_ESTIMATED_TOKENS_PER_BATCH = 4000;

/** Rough chars-per-token estimate for batch sizing only — not a billing figure. */
function estimateTokens(snapshot: FormSnapshot): number {
  return Math.ceil(JSON.stringify(snapshot).length / 4);
}

/**
 * Splits forms into sequential batches. A single form that alone exceeds the
 * token estimate still ships alone rather than being dropped.
 */
export function batchFormSnapshots(snapshots: FormSnapshot[], maxContextChars = Number.POSITIVE_INFINITY): FormSnapshot[][] {
  const batches: FormSnapshot[][] = [];
  let current: FormSnapshot[] = [];
  let currentTokens = 0;

  for (const snapshot of snapshots) {
    const tokens = estimateTokens(snapshot);
    const candidate = [...current, snapshot];
    const serializedChars = JSON.stringify({ formCount: candidate.length, forms: candidate }).length;
    const wouldOverflow = current.length > 0 && (
      current.length >= MAX_FORMS_PER_BATCH ||
      currentTokens + tokens > MAX_ESTIMATED_TOKENS_PER_BATCH ||
      serializedChars > maxContextChars
    );
    if (wouldOverflow) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(snapshot);
    currentTokens += tokens;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}
