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
