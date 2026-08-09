import { describe, expect, it } from "vitest";
import { classifyForm } from "../../src/safety/form-classifier.js";
import type { ElementInventoryItem, InspectedForm } from "../../src/types/testing.js";

/** DESIGN-DECISIONS.md §4 — hard block never planned, soft block filled but never submitted. */
describe("privileged form classifier", () => {
  it("hard-blocks a DELETE method and a destructive action URL", () => {
    expect(classifyForm(formFor({ method: "DELETE" }))).toMatchObject({ block: "hard", matchedSignal: "method:DELETE" });
    expect(classifyForm(formFor({ action: "https://example.com/account/remove" }))).toMatchObject({
      block: "hard",
      matchedSignal: "action:remove",
    });
  });

  it("hard-blocks every §4 submit verb and records which one matched", () => {
    const verbs = [
      "delete", "remove", "revoke", "deactivate", "suspend", "reset",
      "purge", "transfer", "invite", "send", "pay", "upgrade", "downgrade",
    ];
    for (const verb of verbs) {
      const result = classifyForm(formFor({ submitText: `${verb} it` }));
      expect(result).toMatchObject({ decision: "blocked_privileged", block: "hard", matchedSignal: `submit_label:${verb}` });
    }
  });

  it("hard-blocks privileged field names and labels", () => {
    expect(classifyForm(formFor({ fields: [field("element_2", { name: "api_key" })] }))).toMatchObject({
      block: "hard",
      matchedSignal: "field:api_key",
    });
    expect(classifyForm(formFor({ fields: [field("element_2", { label: "Admin notes" })] }))).toMatchObject({
      block: "hard",
      matchedSignal: "field:admin",
    });
  });

  it("hard-blocks a password field away from the login, but allows it on the login page", () => {
    const passwordForm = formFor({
      fields: [field("element_2", { name: "email", type: "email" }), field("element_3", { name: "password", type: "password" })],
      submitText: "Continue",
    });

    expect(classifyForm(passwordForm, { pageTitle: "Profile" })).toMatchObject({
      block: "hard",
      matchedSignal: "password_field_off_login",
    });
    expect(classifyForm(passwordForm, { pageTitle: "Login" })).toEqual({ decision: "allowed" });
    expect(classifyForm(passwordForm, { pageUrl: "https://example.com/sign-in" })).toEqual({ decision: "allowed" });
  });

  it("soft-blocks an administrative page heading", () => {
    // Leftmost match wins, so "Team members" reports `team`, not `members`.
    const result = classifyForm(formFor({ fields: threeValidatedFields() }), { headings: ["Team members"] });
    expect(result).toMatchObject({ decision: "blocked_privileged", block: "soft", matchedSignal: "heading:team" });

    const settings = classifyForm(formFor({ fields: threeValidatedFields() }), { pageTitle: "Account Settings" });
    expect(settings).toMatchObject({ block: "soft", matchedSignal: "heading:settings" });
  });

  it("soft-blocks a 1-2 field form with no validation surface", () => {
    const result = classifyForm(formFor({ fields: [field("element_2", { name: "email", type: "text" })] }));
    expect(result).toMatchObject({ block: "soft", matchedSignal: "few_fields_no_validation" });
  });

  it("allows a small form once it has a validation surface", () => {
    const required = classifyForm(formFor({ fields: [field("element_2", { name: "email", required: true })] }));
    expect(required).toEqual({ decision: "allowed" });

    const typed = classifyForm(formFor({ fields: [field("element_2", { name: "email", type: "email" })] }));
    expect(typed).toEqual({ decision: "allowed" });
  });

  it("allows an ordinary multi-field contact form", () => {
    expect(classifyForm(formFor({ fields: threeValidatedFields(), submitText: "Submit message" }))).toEqual({
      decision: "allowed",
    });
  });

  it("fails closed on a form with nothing parseable", () => {
    expect(classifyForm(formFor({ fields: [] }))).toMatchObject({ block: "soft", matchedSignal: "no_visible_fields" });
  });

  it("ignores hidden fields and hidden submit controls", () => {
    // A hidden privileged field must not be what decides the verdict — the
    // snapshot never sends hidden fields to the model either.
    const result = classifyForm(
      formFor({ fields: [...threeValidatedFields(), field("element_9", { name: "api_key", hidden: true })] }),
    );
    expect(result).toEqual({ decision: "allowed" });
  });
});

function threeValidatedFields(): ElementInventoryItem[] {
  return [
    field("element_2", { name: "name", required: true }),
    field("element_3", { name: "email", type: "email" }),
    field("element_4", { name: "message" }),
  ];
}

function formFor(overrides: {
  method?: string;
  action?: string;
  submitText?: string;
  fields?: ElementInventoryItem[];
}): InspectedForm {
  return {
    elementId: "element_1",
    method: overrides.method,
    action: overrides.action,
    fields: overrides.fields ?? [field("element_2", { name: "email", type: "email" })],
    submitControls: [field("element_8", { kind: "submit", text: overrides.submitText ?? "Submit" })],
  };
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
