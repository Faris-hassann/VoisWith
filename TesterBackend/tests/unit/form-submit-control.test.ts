import { describe, expect, it } from "vitest";
import { selectSubmitControl } from "../../src/testing/form-test-executor.js";
import type { ElementInventoryItem } from "../../src/types/testing.js";

describe("selectSubmitControl", () => {
  it("selects the save/send/submit control that best matches the generated case intent", () => {
    const controls = [control("continue", "Continue"), control("save", "Save draft"), control("send", "Send message")];

    expect(selectSubmitControl(controls, "Send a valid contact message")?.id).toBe("send");
    expect(selectSubmitControl(controls, "Save a valid profile draft")?.id).toBe("save");
  });

  it("never selects hidden or disabled commit controls", () => {
    const controls = [
      control("hidden_send", "Send", { hidden: true }),
      control("disabled_save", "Save", { disabled: true }),
      control("submit", "Submit"),
    ];

    expect(selectSubmitControl(controls, "Send the form")?.id).toBe("submit");
  });

  it("falls back deterministically to the first usable native submit control", () => {
    const controls = [control("primary", "Finish"), control("secondary", "Other")];
    expect(selectSubmitControl(controls, "Valid boundary case")?.id).toBe("primary");
  });
});

function control(
  id: string,
  text: string,
  overrides: Partial<ElementInventoryItem> = {},
): ElementInventoryItem {
  return {
    id,
    kind: "submit",
    tagName: "button",
    type: "submit",
    text,
    accessibleName: text,
    disabled: false,
    hidden: false,
    locator: { strategy: "role", role: "button", value: text, exact: true },
    ...overrides,
  };
}
