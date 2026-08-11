import type { ElementInventoryItem, InspectedForm } from "../types/testing.js";

/**
 * The privileged-form classifier (DESIGN-DECISIONS.md §4).
 *
 * Runs on scraped inspector output **before** the AI planner, so a hard-blocked
 * form is never sent to the LLM at all. No URL denylist, no target-specific
 * tuning, and it **fails closed**: anything it cannot parse confidently is
 * soft-blocked rather than waved through.
 *
 * Nothing model-authored reaches this decision — the input is inspector data
 * only, and the signal that matched is recorded so a block is auditable rather
 * than mysterious.
 */

/** §4 hard block: a field whose name or label suggests privilege or secrets. */
const PRIVILEGED_FIELD = /role|permission|scope|grant|admin|owner|tenant|billing|plan|api[_-]?key|secret/i;

/** §4 hard block: a submit control that performs a destructive, financial, or outbound action. */
const PRIVILEGED_SUBMIT = /delete|remove|revoke|deactivate|suspend|reset|purge|transfer|invite|send|pay|upgrade|downgrade/i;

/** §4 hard block: a form action that targets a destructive endpoint. */
const DESTRUCTIVE_ACTION = /delete|remove|revoke/i;

/** §4 soft block: a page that administers the account rather than accepting ordinary input. */
const PRIVILEGED_HEADING = /settings|configuration|users|team|members|permissions/i;

/** Used only to decide whether a `type=password` field is expected here. */
const LOGIN_PAGE = /log[\s_-]?in|sign[\s_-]?in|login|signin|authenticate/i;

export type FormBlockKind = "hard" | "soft";

export type FormClassification =
  | { decision: "allowed" }
  | {
      decision: "blocked_privileged";
      /** `hard` is never planned and never submitted; `soft` may be planned and filled, never submitted. */
      block: FormBlockKind;
      /** e.g. `submit_label:invite` — §4 requires the matching signal be logged, not just the verdict. */
      matchedSignal: string;
    };

export interface FormClassificationContext {
  /** Page title and headings, used for the §4 heading rule and login detection. */
  pageTitle?: string;
  headings?: string[];
  /** Route family or URL of the page the form was found on. */
  pageUrl?: string;
}

export function classifyForm(form: InspectedForm, context: FormClassificationContext = {}): FormClassification {
  const visibleFields = form.fields.filter((field) => !field.hidden);
  const allFields = form.fields;
  const submitLabels = form.submitControls
    .filter((control) => !control.hidden)
    .map((control) => `${control.text ?? ""} ${control.accessibleName ?? ""}`.trim())
    .filter(Boolean);

  // --- Hard blocks -------------------------------------------------------

  if (form.method && form.method.toUpperCase() === "DELETE") {
    return blocked("hard", "method:DELETE");
  }

  if (form.action && DESTRUCTIVE_ACTION.test(form.action)) {
    return blocked("hard", `action:${DESTRUCTIVE_ACTION.exec(form.action)![0].toLowerCase()}`);
  }

  for (const label of submitLabels) {
    const match = PRIVILEGED_SUBMIT.exec(label);
    if (match) return blocked("hard", `submit_label:${match[0].toLowerCase()}`);
  }

  // Hidden inputs remain safety signals even though they never cross the LLM boundary.
  for (const field of allFields) {
    const descriptor = `${field.name ?? ""} ${field.label ?? ""} ${field.accessibleName ?? ""}`;
    const match = PRIVILEGED_FIELD.exec(descriptor);
    if (match) return blocked("hard", `field:${match[0].toLowerCase()}`);
  }

  const hasPassword = allFields.some((field) => field.type?.toLowerCase() === "password");
  if (hasPassword && !isLoginPage(form, context)) {
    // A password box somewhere other than the login is a credential change or
    // an account creation — §4 blocks both outright.
    return blocked("hard", "password_field_off_login");
  }

  // --- Soft blocks -------------------------------------------------------

  const heading = [context.pageTitle, ...(context.headings ?? [])].filter(Boolean).join(" ");
  const headingMatch = PRIVILEGED_HEADING.exec(heading);
  if (headingMatch) {
    return blocked("soft", `heading:${headingMatch[0].toLowerCase()}`);
  }

  // Unparseable: no visible fields at all means there is nothing to reason
  // about, and §4 says unknown fails closed.
  if (visibleFields.length === 0) {
    return blocked("soft", "no_visible_fields");
  }

  if (visibleFields.length <= 2 && !hasValidationSurface(visibleFields)) {
    // Too small and too unconstrained to tell a newsletter box from a
    // one-click account action, so it is filled but never submitted.
    return blocked("soft", "few_fields_no_validation");
  }

  return { decision: "allowed" };
}

/** True when any visible field declares a constraint we could actually assert against. */
function hasValidationSurface(fields: ElementInventoryItem[]): boolean {
  return fields.some((field) => {
    if (field.required) return true;
    const validation = field.validation ?? {};
    if (Object.keys(validation).length > 0) return true;
    const type = field.type?.toLowerCase();
    return type === "email" || type === "url" || type === "number" || type === "tel" || type === "date";
  });
}

/**
 * Whether a `type=password` field belongs here.
 *
 * The full LoginDetector needs a live Page and runs during authentication;
 * this classifier deliberately works from scraped data only, so login-ness is
 * inferred from the page's own title, headings, route, and the form's shape.
 */
function isLoginPage(form: InspectedForm, context: FormClassificationContext): boolean {
  const pageText = [context.pageTitle, ...(context.headings ?? []), context.pageUrl, form.apparentPurpose]
    .filter(Boolean)
    .join(" ");
  if (LOGIN_PAGE.test(pageText)) return true;

  const submitText = form.submitControls.map((control) => control.text ?? control.accessibleName ?? "").join(" ");
  return LOGIN_PAGE.test(submitText);
}

function blocked(block: FormBlockKind, matchedSignal: string): FormClassification {
  return { decision: "blocked_privileged", block, matchedSignal };
}
