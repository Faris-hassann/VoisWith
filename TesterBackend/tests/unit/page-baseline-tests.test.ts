import { describe, expect, it } from "vitest";
import { buildPageBaselineTests } from "../../src/testing/page-baseline-tests.js";
import type { PageSnapshot } from "../../src/types/testing.js";

describe("buildPageBaselineTests", () => {
  it("generates multiple deterministic tests for links and forms", () => {
    const snapshot: PageSnapshot = {
      url: "https://example.com",
      canonicalUrl: "https://example.com",
      title: "Example",
      headings: ["Example"],
      visibleText: "Example page",
      links: [
        { text: "About", href: "https://example.com/about", canonicalHref: "https://example.com/about", internal: true },
      ],
      images: [],
      scripts: [],
      elements: [
        {
          id: "element_1",
          kind: "input",
          tagName: "input",
          disabled: false,
          hidden: false,
          required: true,
          locator: { strategy: "css", value: "input" },
        },
        {
          id: "element_2",
          kind: "submit",
          tagName: "button",
          disabled: false,
          hidden: false,
          text: "Submit",
          locator: { strategy: "css", value: "button" },
        },
      ],
      forms: [
        {
          elementId: "form_1",
          fields: [
            {
              id: "element_1",
              kind: "input",
              tagName: "input",
              disabled: false,
              hidden: false,
              required: true,
              locator: { strategy: "css", value: "input" },
            },
          ],
          submitControls: [
            {
              id: "element_2",
              kind: "submit",
              tagName: "button",
              disabled: false,
              hidden: false,
              text: "Submit",
              locator: { strategy: "css", value: "button" },
            },
          ],
        },
      ],
      tables: [],
      dialogs: [],
      currentQueryParameters: {},
      consoleErrors: [],
      failedRequests: [],
      observedApiCalls: [],
      performance: [{ name: "navigation-duration", valueMs: 100, description: "Navigation" }],
      visibleValidationErrors: [],
      uiObservations: [],
    };

    const tests = buildPageBaselineTests({
      snapshot,
      selectedTypes: ["SMOKE", "PAGE_DISCOVERY", "LINKS", "FORMS", "FORM_VALIDATION", "PERFORMANCE_BASIC"],
      credentialsProvided: false,
    });

    expect(tests.length).toBeGreaterThan(4);
    expect(tests.some((test) => test.type === "FORMS" && test.status === "PASSED")).toBe(true);
    expect(tests.some((test) => test.type === "FORM_VALIDATION" && test.status === "PASSED")).toBe(true);
  });
});
