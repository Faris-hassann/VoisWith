import crypto from "node:crypto";
import { formSnapshotSchema } from "../schemas/llm-contract.schema.js";
import type { InspectedForm, ElementInventoryItem } from "../types/testing.js";
import type { FormFieldKind, FormFieldSnapshot, FormSnapshot } from "../types/llm-contract.js";
import { routeFamily } from "../utilities/route-family.js";

const FIELD_KIND_MAP: Record<string, FormFieldKind> = {
  input: "input",
  textarea: "textarea",
  select: "select",
  checkbox: "checkbox",
  radio: "radio",
  file: "file",
  search: "search",
};

/**
 * Builds the only representation of a form the LLM ever sees. No `value`, no
 * locator, no full/action URL — route family and visible field metadata only.
 * See DESIGN-DECISIONS.md §3.
 */
/**
 * Pairs each sanitized snapshot with the inspector form it came from.
 *
 * The executor needs the original `InspectedForm` to find submit controls and
 * locator descriptors — none of which may cross the LLM boundary — so the
 * association is returned here rather than recomputed from a `formId` later.
 */
export interface BuiltFormSnapshot {
  snapshot: FormSnapshot;
  form: InspectedForm;
}

export function buildFormSnapshotsWithForms(
  forms: InspectedForm[],
  pageUrl: string,
  ignoredQueryParameters: string[] = [],
): BuiltFormSnapshot[] {
  // formId is keyed on the route family, so it must be computed with the same
  // ignore list the crawler uses — otherwise the same form on ?utm_source=a and
  // ?utm_source=b would produce two different formIds and be tested twice.
  const family = routeFamily(pageUrl, ignoredQueryParameters);
  const built: BuiltFormSnapshot[] = [];

  for (const form of forms) {
    const visibleFields = form.fields.filter((field) => !field.hidden);
    if (visibleFields.length === 0) continue;

    const fields = visibleFields.map(fieldSnapshot);
    const submitLabel = form.submitControls.find((control) => !control.hidden)?.text?.trim();
    const fieldSig = fieldSignature(visibleFields);

    const snapshot: FormSnapshot = {
      formId: sha1(`${family}::${fieldSig}`),
      elementId: form.elementId,
      method: form.method,
      routeFamily: family,
      apparentPurpose: form.apparentPurpose,
      fields,
      submitLabel,
    };

    // Fail closed: a snapshot our own serializer cannot produce cleanly is
    // dropped rather than sent to the model half-formed.
    const parsed = formSnapshotSchema.safeParse(snapshot);
    if (parsed.success) built.push({ snapshot: parsed.data, form });
  }

  return built;
}

/** Snapshots only, for callers that never need to act on the page. */
export function buildFormSnapshots(
  forms: InspectedForm[],
  pageUrl: string,
  ignoredQueryParameters: string[] = [],
): FormSnapshot[] {
  return buildFormSnapshotsWithForms(forms, pageUrl, ignoredQueryParameters).map((built) => built.snapshot);
}

function fieldSnapshot(field: ElementInventoryItem): FormFieldSnapshot {
  const validation = field.validation ?? {};
  const snapshot: FormFieldSnapshot = {
    elementId: field.id,
    kind: FIELD_KIND_MAP[field.kind] ?? "other",
    type: field.type,
    label: field.label,
    placeholder: field.placeholder,
    name: field.name,
    required: Boolean(field.required),
    disabled: field.disabled,
    minLength: numberValue(validation.minLength),
    maxLength: numberValue(validation.maxLength),
    min: stringValue(validation.min),
    max: stringValue(validation.max),
    pattern: stringValue(validation.pattern),
  };
  return snapshot;
}

/**
 * DESIGN-DECISIONS.md §7, verbatim:
 *   fieldSignature = sha1(sorted(field.name || field.label || elementRole + ":" + type).join("|"))
 *
 * Note the precedence: `":" + type` belongs to the *fallback* arm only. A field
 * with a name contributes its name alone. `elementId` is excluded because it
 * regenerates per page, and values are excluded entirely — that is what lets
 * the same form be recognized across pages.
 */
function fieldSignature(fields: ElementInventoryItem[]): string {
  const parts = fields
    .map((field) => field.name || field.label || `${field.role ?? field.kind}:${field.type ?? field.kind}`)
    .sort();
  return sha1(parts.join("|"));
}

function sha1(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex");
}

function numberValue(value: string | number | boolean | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function stringValue(value: string | number | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}
