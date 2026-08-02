import { describe, expect, it } from "vitest";
import { buildFormSnapshots, buildLinkSnapshots } from "../../src/inspection/page-inspector.js";
import type { ElementInventoryItem } from "../../src/types/testing.js";

describe("buildFormSnapshots", () => {
  it("keeps inputs inside different forms separate", () => {
    const elements = [
      element("form_a", "form"),
      element("email", "input", { formOwnerElementId: "form_a", name: "email" }),
      element("submit_a", "submit", { formOwnerElementId: "form_a", text: "Join" }),
      element("form_b", "form"),
      element("query", "search", { formOwnerElementId: "form_b", name: "q" }),
      element("submit_b", "submit", { formOwnerElementId: "form_b", text: "Search" }),
    ];

    const forms = buildFormSnapshots(elements);

    expect(forms).toHaveLength(2);
    expect(forms.find((form) => form.elementId === "form_a")?.fields.map((field) => field.id)).toEqual(["email"]);
    expect(forms.find((form) => form.elementId === "form_b")?.fields.map((field) => field.id)).toEqual(["query"]);
  });

  it("detects an implicit form for standalone inputs and submit buttons", () => {
    const forms = buildFormSnapshots([
      element("email", "input", { placeholder: "Email" }),
      element("submit", "submit", { text: "Subscribe" }),
    ]);

    expect(forms).toHaveLength(1);
    expect(forms[0]).toMatchObject({
      elementId: "implicit_form_1",
      implicit: true,
      apparentPurpose: "signup",
    });
    const implicitForm = forms[0];
    expect(implicitForm?.fields.map((field) => field.id)).toEqual(["email"]);
    expect(implicitForm?.submitControls.map((control) => control.id)).toEqual(["submit"]);
  });
});

describe("buildLinkSnapshots", () => {
  it("includes canonical URL, internal status, and source element IDs", () => {
    const links = buildLinkSnapshots(
      [
        {
          text: "Docs",
          href: "/docs?utm_source=newsletter#intro",
          sourceCss: "#docs",
        },
        {
          text: "External",
          href: "https://external.example/path",
          sourceCss: "#external",
        },
      ],
      [
        element("element_1", "link", { locator: { strategy: "css", value: "#docs" } }),
        element("element_2", "link", { locator: { strategy: "css", value: "#external" } }),
      ],
      "https://example.com",
      "https://example.com/start",
    );

    expect(links[0]).toMatchObject({
      text: "Docs",
      href: "/docs?utm_source=newsletter#intro",
      canonicalHref: "https://example.com/docs",
      internal: true,
      sourceElementId: "element_1",
    });
    expect(links[1]).toMatchObject({
      canonicalHref: "https://external.example/path",
      internal: false,
      sourceElementId: "element_2",
    });
  });
});

function element(
  id: string,
  kind: ElementInventoryItem["kind"],
  overrides: Partial<ElementInventoryItem> = {},
): ElementInventoryItem {
  return {
    id,
    kind,
    tagName: kind === "form" ? "form" : kind === "submit" ? "button" : "input",
    disabled: false,
    hidden: false,
    locator: { strategy: "css", value: `#${id}` },
    ...overrides,
  };
}
