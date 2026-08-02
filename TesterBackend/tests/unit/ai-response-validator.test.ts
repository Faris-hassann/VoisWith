import { describe, expect, it } from "vitest";
import { AiResponseValidator } from "../../src/ai/ai-response-validator.js";

const elements = [
  {
    id: "element_1",
    kind: "button",
    tagName: "button",
    disabled: false,
    hidden: false,
    locator: { strategy: "css", value: "button" },
  },
] as const;

describe("AiResponseValidator", () => {
  it("normalizes common model output into a valid executable plan", () => {
    const validator = new AiResponseValidator();
    const plan = validator.validate(
      {
        plan: {
          summary: "Dashboard",
          purpose: "Admin dashboard",
          risks: ["Broken nav"],
          tests: [
            {
              name: "click visible nav",
              type: "links",
              priority: "high",
              steps: [
                { action: "click", element_id: "element_1", extra: "ignored" },
                { action: "click" },
              ],
              assertions: [],
            },
          ],
          additionalLinks: ["/relative", "https://example.com/next"],
        },
      },
      [...elements],
    );

    expect(plan.pageSummary).toBe("Dashboard");
    expect(plan.testCases[0]?.type).toBe("LINKS");
    expect(plan.testCases[0]?.steps).toEqual([{ action: "CLICK", elementId: "element_1" }]);
    expect(plan.additionalLinksToPrioritize).toEqual(["https://example.com/next"]);
  });

  it("rejects unknown element ids", () => {
    const validator = new AiResponseValidator();
    expect(() =>
      validator.validate(
        {
          pageSummary: "Home",
          identifiedPurpose: "Landing",
          risks: [],
          testCases: [
            {
              id: "t1",
              name: "Click",
              type: "SMOKE",
              priority: "HIGH",
              preconditions: [],
              steps: [{ action: "CLICK", elementId: "element_99" }],
              assertions: [],
              cleanupActions: [],
              destructive: false,
              reasoningSummary: "Safe click.",
            },
          ],
          additionalLinksToPrioritize: [],
          pageTestingComplete: true,
        },
        [...elements],
      ),
    ).toThrow();
  });
});
