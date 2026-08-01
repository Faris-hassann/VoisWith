import type { Page } from "playwright";
import type { TestAction } from "../types/ai.js";
import type { ElementInventoryItem } from "../types/testing.js";
import type { AssertionResult } from "../types/report.js";
import { locatorFromDescriptor } from "../actions/playwright-action-executor.js";

export class AssertionEngine {
  async assert(page: Page, action: TestAction, element?: ElementInventoryItem): Promise<AssertionResult> {
    try {
      if (action.action === "ASSERT_URL") {
        const matched = action.expectedUrl ? page.url().includes(action.expectedUrl) : true;
        return result(action, matched, action.expectedUrl, page.url());
      }
      if (!element) {
        return result(action, false, "Known element", "Element unavailable", "Missing element.");
      }
      const locator = locatorFromDescriptor(page, element.locator);
      switch (action.action) {
        case "ASSERT_VISIBLE":
          return result(action, await locator.isVisible(), "Element visible", "Visibility checked");
        case "ASSERT_HIDDEN":
          return result(action, !(await locator.isVisible()), "Element hidden", "Visibility checked");
        case "ASSERT_TEXT": {
          const text = (await locator.textContent()) ?? "";
          return result(action, text.includes(action.expectedText ?? ""), action.expectedText, text);
        }
        case "ASSERT_ENABLED":
          return result(action, await locator.isEnabled(), "Element enabled", "Enabled checked");
        case "ASSERT_DISABLED":
          return result(action, await locator.isDisabled(), "Element disabled", "Disabled checked");
        case "ASSERT_VALUE": {
          const value = await locator.inputValue();
          return result(action, value === (action.value ?? ""), action.value, value);
        }
        default:
          return result(action, true, "No assertion required", "Action is not an assertion");
      }
    } catch (error) {
      return result(action, false, "Assertion completes", undefined, error instanceof Error ? error.message : String(error));
    }
  }
}

function result(
  action: TestAction,
  passed: boolean,
  expectedResult?: string,
  actualResult?: string,
  error?: string,
): AssertionResult {
  return {
    action,
    status: passed ? "PASSED" : "FAILED",
    expectedResult,
    actualResult,
    error,
  };
}
