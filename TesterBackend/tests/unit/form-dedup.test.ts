import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { dedupeFormSnapshots } from "../../src/testing/form-dedup.js";
import { buildFormSnapshots } from "../../src/ai/form-snapshot-builder.js";
import type { FormSnapshot } from "../../src/types/llm-contract.js";
import type { ElementInventoryItem, InspectedForm } from "../../src/types/testing.js";

/**
 * DESIGN-DECISIONS.md §7 — exact formulas, not approximations:
 *   fieldSignature = sha1(sorted(name || label || role + ":" + type).join("|"))
 *   formId         = sha1(routeFamily + "::" + fieldSignature)
 * `fieldSignature` excludes elementId (regenerates per page) and all values.
 */
describe("§7 formId derivation", () => {
  it("matches the published formula exactly for a known form", () => {
    const forms = [
      inspectedForm([
        field("element_2", { name: "email", type: "email" }),
        field("element_3", { name: "message", type: "text" }),
      ]),
    ];

    const [snapshot] = buildFormSnapshots(forms, "https://example.com/contact");

    // §7 is `field.name || field.label || elementRole + ":" + type` — the
    // `":" + type` suffix binds to the fallback arm only, so a named field
    // contributes its bare name.
    const fieldSignature = sha1(["email", "message"].sort().join("|"));
    const expected = sha1(`https://example.com/contact::${fieldSignature}`);
    expect(snapshot?.formId).toBe(expected);
  });

  it("falls back to role:type only for a field with neither name nor label", () => {
    const [snapshot] = buildFormSnapshots(
      [inspectedForm([field("element_2", { role: "textbox", type: "search" })])],
      "https://example.com/contact",
    );

    const fieldSignature = sha1("textbox:search");
    expect(snapshot?.formId).toBe(sha1(`https://example.com/contact::${fieldSignature}`));
  });

  it("treats a renamed field as a different form, since the name is the signature", () => {
    const before = buildFormSnapshots([inspectedForm([field("element_2", { name: "email" })])], "https://example.com/contact");
    const after = buildFormSnapshots([inspectedForm([field("element_2", { name: "email_address" })])], "https://example.com/contact");
    expect(before[0]?.formId).not.toBe(after[0]?.formId);
  });

  it("is independent of field order in the DOM", () => {
    const ordered = buildFormSnapshots(
      [inspectedForm([field("element_2", { name: "email" }), field("element_3", { name: "message" })])],
      "https://example.com/contact",
    );
    const reversed = buildFormSnapshots(
      [inspectedForm([field("element_2", { name: "message" }), field("element_3", { name: "email" })])],
      "https://example.com/contact",
    );
    expect(ordered[0]?.formId).toBe(reversed[0]?.formId);
  });

  it("excludes elementId and prefilled values", () => {
    const base = buildFormSnapshots(
      [inspectedForm([field("element_2", { name: "email", value: "someone@example.com" })])],
      "https://example.com/contact",
    );
    // Same form, different positional ids and a different prefilled value.
    const shifted = buildFormSnapshots(
      [inspectedForm([field("element_77", { name: "email", value: "other@example.com" })], "element_70")],
      "https://example.com/contact",
    );
    expect(base[0]?.formId).toBe(shifted[0]?.formId);
  });

  it("keys on route family, so the same form on a different route is a different id", () => {
    const contact = buildFormSnapshots([inspectedForm([field("element_2", { name: "email" })])], "https://example.com/contact");
    const support = buildFormSnapshots([inspectedForm([field("element_2", { name: "email" })])], "https://example.com/support");
    expect(contact[0]?.formId).not.toBe(support[0]?.formId);
  });

  it("collapses ids within a route family, so /orders/1 and /orders/2 share a formId", () => {
    const first = buildFormSnapshots([inspectedForm([field("element_2", { name: "note" })])], "https://example.com/orders/1");
    const second = buildFormSnapshots([inspectedForm([field("element_2", { name: "note" })])], "https://example.com/orders/2");
    expect(first[0]?.formId).toBe(second[0]?.formId);
  });

  it("does not collide when the field set differs on the same route", () => {
    const login = buildFormSnapshots(
      [inspectedForm([field("element_2", { name: "email" }), field("element_3", { name: "password" })])],
      "https://example.com/account",
    );
    const search = buildFormSnapshots([inspectedForm([field("element_2", { name: "query" })])], "https://example.com/account");
    expect(login[0]?.formId).not.toBe(search[0]?.formId);
  });
});

describe("§7 dedup — one form, tested once, on the first page it appears", () => {
  it("keeps the first sighting and skips the repeat with duplicate_of:<firstPageUrl>", () => {
    const processedForms = new Map<string, string>();
    const footer = snapshot("form_footer");

    const first = dedupeFormSnapshots([footer], processedForms, "https://example.com/");
    expect(first.unique).toHaveLength(1);
    expect(first.duplicates).toHaveLength(0);

    const second = dedupeFormSnapshots([footer], processedForms, "https://example.com/pricing");
    expect(second.unique).toHaveLength(0);
    expect(second.duplicates).toEqual([
      {
        formId: "form_footer",
        elementId: "element_1",
        decision: "duplicate_of:https://example.com/",
        firstPageUrl: "https://example.com/",
      },
    ]);
  });

  it("attributes a duplicate to the first page even after several repeats", () => {
    const processedForms = new Map<string, string>();
    const footer = snapshot("form_footer");
    dedupeFormSnapshots([footer], processedForms, "https://example.com/");
    dedupeFormSnapshots([footer], processedForms, "https://example.com/pricing");
    const third = dedupeFormSnapshots([footer], processedForms, "https://example.com/about");

    expect(third.duplicates[0]?.decision).toBe("duplicate_of:https://example.com/");
  });

  it("passes distinct forms on the same page through untouched", () => {
    const processedForms = new Map<string, string>();
    const result = dedupeFormSnapshots([snapshot("form_a"), snapshot("form_b")], processedForms, "https://example.com/contact");
    expect(result.unique.map((form) => form.formId)).toEqual(["form_a", "form_b"]);
    expect(result.duplicates).toHaveLength(0);
  });

  it("dedupes within a single page when the same form appears twice", () => {
    const processedForms = new Map<string, string>();
    const result = dedupeFormSnapshots([snapshot("form_a"), snapshot("form_a")], processedForms, "https://example.com/contact");
    expect(result.unique).toHaveLength(1);
    expect(result.duplicates).toHaveLength(1);
  });
});

function sha1(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex");
}

function snapshot(formId: string): FormSnapshot {
  return {
    formId,
    elementId: "element_1",
    fields: [{ elementId: "element_2", kind: "input", required: false, disabled: false }],
  };
}

function inspectedForm(fields: ElementInventoryItem[], elementId = "element_1"): InspectedForm {
  return { elementId, fields, submitControls: [] };
}

function field(id: string, overrides: Partial<ElementInventoryItem> = {}): ElementInventoryItem {
  return {
    id,
    kind: "input",
    tagName: "input",
    disabled: false,
    hidden: false,
    locator: { strategy: "css", value: `#${id}` },
    ...overrides,
  };
}
