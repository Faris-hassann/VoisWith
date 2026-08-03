import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { config } from "../config/env.js";
import type { LocaleDirection, TestingRunRequest } from "../types/testing.js";
import { AppError } from "../errors/app-error.js";
import { ERROR_CODES } from "../errors/error-codes.js";
import { serializeError } from "../errors/serialize-error.js";
import { installVisibleCursor } from "./browser-visual-agent.js";

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export class BrowserManager {
  async launch(
    request: TestingRunRequest,
    downloadsPath: string,
    options?: {
      viewport?: TestingRunRequest["browser"]["viewport"];
      locale?: string;
      direction?: LocaleDirection;
    },
  ): Promise<BrowserSession> {
    try {
      const browser = await chromium.launch({
        channel: request.browser.channel,
        headless: request.browser.headless,
        timeout: config.browser.launchTimeoutMs,
        downloadsPath,
      });
      const context = await browser.newContext({
        viewport: options?.viewport ?? request.browser.viewport,
        locale: options?.locale,
        acceptDownloads: true,
      });
      context.setDefaultNavigationTimeout(config.browser.pageNavigationTimeoutMs);
      context.setDefaultTimeout(config.browser.actionTimeoutMs);
      const page = await context.newPage();
      await installVisibleCursor(page);
      if (options?.direction === "rtl") {
        await page.addInitScript(() => {
          document.documentElement.setAttribute("dir", "rtl");
        });
      }
      return { browser, context, page };
    } catch (error) {
      const serialized = serializeError(error);
      throw new AppError({
        code: ERROR_CODES.BROWSER_LAUNCH_FAILURE,
        message: `Failed to launch visible Chrome browser: ${serialized.message}`,
        details: serialized,
        fatal: true,
      });
    }
  }

  async close(session?: Partial<BrowserSession>): Promise<void> {
    await Promise.allSettled([
      session?.context?.close(),
      session?.browser?.close(),
    ]);
  }
}
