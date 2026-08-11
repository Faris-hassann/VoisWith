import { describe, expect, it } from "vitest";
import { buildFormSnapshots } from "../../src/ai/form-snapshot-builder.js";
import type { ElementInventoryItem, InspectedForm } from "../../src/types/testing.js";

describe("buildFormSnapshots", () => {
  it("never carries value, locator, or form action across the LLM boundary", () => {
    const forms: InspectedForm[] = [
      {
        elementId: "element_1",
        method: "POST",
        action: "https://example.com/api/submit?secret=1",
        fields: [
          field("element_2", {
            name: "email",
            label: "Work Email",
            type: "email",
            required: true,
            value: "user@example.com",
          }),
        ],
        submitControls: [field("element_3", { kind: "submit", text: "Send" })],
      },
    ];

    const [snapshot] = buildFormSnapshots(forms, "https://example.com/contact");

    expect(snapshot).toBeDefined();
    expect(JSON.stringify(snapshot)).not.toContain("user@example.com");
    expect(JSON.stringify(snapshot)).not.toContain("secret=1");
    expect(JSON.stringify(snapshot)).not.toContain("locator");
    expect((snapshot as unknown as { action?: string }).action).toBeUndefined();
    expect((snapshot as unknown as { value?: string }).value).toBeUndefined();
    expect(snapshot?.routeFamily).toBe("/contact");
    expect(JSON.stringify(snapshot)).not.toContain("https://example.com");
  });

  it("excludes hidden fields entirely", () => {
    const forms: InspectedForm[] = [
      {
        elementId: "element_1",
        fields: [
          field("element_2", { name: "visible_field" }),
          field("element_3", { name: "csrf_token", hidden: true }),
        ],
        submitControls: [],
      },
    ];

    const [snapshot] = buildFormSnapshots(forms, "https://example.com/contact");

    expect(snapshot?.fields).toHaveLength(1);
    expect(snapshot?.fields[0]?.name).toBe("visible_field");
  });

  it("drops a form with only hidden fields rather than sending an empty shell", () => {
    const forms: InspectedForm[] = [
      { elementId: "element_1", fields: [field("element_2", { hidden: true })], submitControls: [] },
    ];

    const snapshots = buildFormSnapshots(forms, "https://example.com/contact");

    expect(snapshots).toHaveLength(0);
  });

  it("produces identical formIds for the same field signature on the same route family, and different ids otherwise", () => {
    const loginForm: InspectedForm[] = [
      {
        elementId: "element_1",
        fields: [field("element_2", { name: "email", type: "email" }), field("element_3", { name: "password", type: "password" })],
        submitControls: [],
      },
    ];
    const contactForm: InspectedForm[] = [
      {
        elementId: "element_1",
        fields: [field("element_2", { name: "message", type: "text" })],
        submitControls: [],
      },
    ];

    const [loginA] = buildFormSnapshots(loginForm, "https://example.com/login");
    const [loginB] = buildFormSnapshots(loginForm, "https://example.com/login");
    const [contact] = buildFormSnapshots(contactForm, "https://example.com/login");

    expect(loginA?.formId).toBe(loginB?.formId);
    expect(loginA?.formId).not.toBe(contact?.formId);
  });

  it("flattens validation constraints onto the field", () => {
    const forms: InspectedForm[] = [
      {
        elementId: "element_1",
        fields: [
          field("element_2", {
            name: "bio",
            validation: { maxLength: 280, minLength: 10, pattern: "^[a-z]+$" },
          }),
        ],
        submitControls: [],
      },
    ];

    const [snapshot] = buildFormSnapshots(forms, "https://example.com/profile");

    expect(snapshot?.fields[0]?.maxLength).toBe(280);
    expect(snapshot?.fields[0]?.minLength).toBe(10);
    expect(snapshot?.fields[0]?.pattern).toBe("^[a-z]+$");
  });
});

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
