import crypto from "node:crypto";
import type { ElementInventoryItem, FormSnapshot } from "../types/testing.js";

export interface StateFingerprintInput {
  normalizedUrl: string;
  title: string;
  headings: string[];
  landmarks: string[];
  forms: FormSnapshot[];
  elements: ElementInventoryItem[];
  dialogs: ElementInventoryItem[];
  role?: string;
}

const UNSTABLE_VALUE_PATTERN = /(?:csrf|token|nonce|session|timestamp|time|date|uuid|guid|random|hash|signature)/i;

export class StateFingerprintService {
  fingerprint(input: StateFingerprintInput): string {
    const stable = {
      url: input.normalizedUrl,
      title: normalizeText(input.title),
      headings: input.headings.map(normalizeText).filter(Boolean).slice(0, 30),
      landmarks: input.landmarks.map(normalizeText).filter(Boolean).slice(0, 30),
      role: input.role ?? "anonymous",
      dialogs: input.dialogs.map((dialog) => stableElement(dialog)).slice(0, 20),
      forms: input.forms.map((form) => ({
        implicit: Boolean(form.implicit),
        method: form.method?.toLowerCase(),
        action: stripUnstableUrl(form.action),
        purpose: normalizeText(form.apparentPurpose),
        fields: form.fields.map((field) => stableElement(field)),
        submitControls: form.submitControls.map((control) => stableElement(control)),
      })),
      interactive: input.elements
        .filter((element) => !element.hidden && element.kind !== "other")
        .map((element) => stableElement(element))
        .slice(0, 300),
    };
    return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 24);
  }
}

function stableElement(element: ElementInventoryItem) {
  return {
    kind: element.kind,
    tagName: element.tagName,
    role: element.role,
    name: stableValue(element.name),
    label: normalizeText(element.label),
    placeholder: normalizeText(element.placeholder),
    accessibleName: normalizeText(element.accessibleName),
    text: normalizeText(element.text),
    type: element.type,
    required: Boolean(element.required),
    disabled: Boolean(element.disabled),
  };
}

function stableValue(value?: string): string | undefined {
  if (!value || UNSTABLE_VALUE_PATTERN.test(value)) return undefined;
  return normalizeText(value);
}

function normalizeText(value?: string): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\b\d{4,}\b/g, "#").replace(/\s+/g, " ").trim().slice(0, 200);
  return normalized || undefined;
}

function stripUnstableUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (UNSTABLE_VALUE_PATTERN.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return stableValue(value);
  }
}
