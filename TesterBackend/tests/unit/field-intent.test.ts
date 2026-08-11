import { describe, expect, it } from "vitest";
import { inferFieldIntent } from "../../src/testing/field-intent.js";
import type { FormFieldSnapshot } from "../../src/types/llm-contract.js";

describe("deterministic field intent", () => {
  it("prefers declared types and recognizes bounded metadata tokens", () => {
    expect(inferFieldIntent(field({ type: "email", label: "Unrelated" }))).toBe("email");
    expect(inferFieldIntent(field({ type: "text", name: "mobile_phone" }))).toBe("phone");
    expect(inferFieldIntent(field({ type: "text", placeholder: "Postal code" }))).toBe("postal");
    expect(inferFieldIntent(field({ type: "text", label: "Planet" }))).toBe("unknown");
  });
});

function field(overrides: Partial<FormFieldSnapshot>): FormFieldSnapshot {
  return { elementId: "element_1", kind: "input", required: false, disabled: false, ...overrides };
}
