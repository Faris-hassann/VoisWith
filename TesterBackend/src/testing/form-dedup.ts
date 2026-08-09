import type { FormSnapshot } from "../types/llm-contract.js";

export interface FormDedupDecision {
  formId: string;
  elementId: string;
  /** Always `duplicate_of:<firstPageUrl>` per DESIGN-DECISIONS.md §7. */
  decision: string;
  firstPageUrl: string;
}

export interface FormDedupResult {
  /** Forms to plan and test on this page — first occurrences only. */
  unique: FormSnapshot[];
  /** Repeat occurrences, skipped with the page that already covered them. */
  duplicates: FormDedupDecision[];
}

/**
 * DESIGN-DECISIONS.md §7: one form, tested once, on the first page it appears.
 *
 * `formId` already encodes `routeFamily + "::" + fieldSignature` and excludes
 * `elementId` and all values, so the same form recurring in a footer across
 * pages resolves to the same id and is skipped after its first sighting — even
 * though the route-family rule still permits visiting 3 instances of a route.
 *
 * `processedForms` is run-scoped state, deliberately owned by the caller rather
 * than this module, so dedup spans the whole crawl rather than a single page.
 */
export function dedupeFormSnapshots(
  snapshots: FormSnapshot[],
  processedForms: Map<string, string>,
  pageUrl: string,
): FormDedupResult {
  const unique: FormSnapshot[] = [];
  const duplicates: FormDedupDecision[] = [];

  for (const snapshot of snapshots) {
    const firstPageUrl = processedForms.get(snapshot.formId);
    if (firstPageUrl === undefined) {
      processedForms.set(snapshot.formId, pageUrl);
      unique.push(snapshot);
      continue;
    }
    duplicates.push({
      formId: snapshot.formId,
      elementId: snapshot.elementId,
      decision: `duplicate_of:${firstPageUrl}`,
      firstPageUrl,
    });
  }

  return { unique, duplicates };
}
