import type { Page } from "playwright";
import type { TestAction } from "../types/ai.js";
import type { ElementInventoryItem, LocatorDescriptor } from "../types/testing.js";
import type { TestStepResult } from "../types/report.js";
import { FormDataGenerator } from "../testing/form-data-generator.js";
import { moveCursorToLocator } from "../browser/browser-visual-agent.js";

export function locatorFromDescriptor(page: Page, descriptor: LocatorDescriptor) {
  switch (descriptor.strategy) {
    case "role":
      return page.getByRole(descriptor.role as never, { name: descriptor.value, exact: descriptor.exact });
    case "label":
      return page.getByLabel(descriptor.value, { exact: descriptor.exact });
    case "placeholder":
      return page.getByPlaceholder(descriptor.value, { exact: descriptor.exact });
    case "testId":
      return page.getByTestId(descriptor.value);
    case "name":
      return page.locator(`[name="${cssEscape(descriptor.value)}"]`).first();
    case "css":
      return page.locator(descriptor.value).first();
  }
}

export class PlaywrightActionExecutor {
  private readonly data: FormDataGenerator;

  constructor(runId: string) {
    this.data = new FormDataGenerator(runId);
  }

  async execute(page: Page, action: TestAction, element?: ElementInventoryItem): Promise<TestStepResult> {
    try {
      if (action.action === "STOP") return success(action, "Stopped by plan.");
      if (action.action === "NAVIGATE" && action.url) {
        await page.goto(action.url, { waitUntil: "domcontentloaded" });
        return success(action, `Navigated to ${action.url}`);
      }
      if (action.action === "RELOAD") {
        await page.reload({ waitUntil: "domcontentloaded" });
        return success(action, "Reloaded page.");
      }
      if (action.action === "GO_BACK") {
        await page.goBack({ waitUntil: "domcontentloaded" });
        return success(action, "Went back.");
      }
      if (action.action === "WAIT_FOR") {
        await page.waitForTimeout(action.timeoutMs ?? 1000);
        return success(action, "Wait completed.");
      }
      if (action.action === "ASSERT_URL") {
        const currentUrl = page.url();
        const expected = action.expectedUrl ?? action.value;
        if (!expected || currentUrl.includes(expected)) {
          return success(action, `Current URL is ${currentUrl}`);
        }
        return failure(action, `Expected URL to include ${expected}, current URL is ${currentUrl}`);
      }
      if (!element) return failure(action, "Element no longer available.");

      const locator = locatorFromDescriptor(page, element.locator);
      await locator.scrollIntoViewIfNeeded().catch(() => undefined);
      await moveCursorToLocator(page, locator);
      switch (action.action) {
        case "CLICK":
        case "SUBMIT":
          await locator.click();
          break;
        case "FILL":
          await locator.fill(action.value ?? this.data.value(action.valueStrategy));
          break;
        case "CLEAR":
          await locator.fill("");
          break;
        case "SELECT":
          await locator.selectOption(action.value ?? this.data.value(action.valueStrategy));
          break;
        case "CHECK":
          await locator.check();
          break;
        case "UNCHECK":
          await locator.uncheck();
          break;
        case "PRESS_KEY":
          await locator.press(action.key ?? "Enter");
          break;
        case "UPLOAD_SAFE_FIXTURE":
          return failure(action, "Safe upload fixture generation is planned but not enabled in this step.");
        case "ASSERT_VISIBLE":
        case "ASSERT_HIDDEN":
        case "ASSERT_TEXT":
        case "ASSERT_ENABLED":
        case "ASSERT_DISABLED":
        case "ASSERT_VALUE":
        case "ASSERT_RESPONSE_STATUS":
        case "EXTRACT_VALUE":
          return success(action, "Assertion delegated to assertion engine.");
      }
      return success(action, "Action executed.");
    } catch (error) {
      return failure(action, error instanceof Error ? error.message : String(error));
    }
  }
}

function success(action: TestAction, actualResult: string): TestStepResult {
  return { action, status: "PASSED", actualResult };
}

function failure(action: TestAction, error: string): TestStepResult {
  return { action, status: "FAILED", error, actualResult: error };
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
