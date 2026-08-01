import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { config } from "../config/env.js";
import type { TestingRunRequest } from "../types/testing.js";
import { AppError } from "../errors/app-error.js";
import { ERROR_CODES } from "../errors/error-codes.js";

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export class BrowserManager {
  async launch(request: TestingRunRequest, downloadsPath: string): Promise<BrowserSession> {
    try {
      const browser = await chromium.launch({
        channel: request.browser.channel,
        headless: request.browser.headless,
        timeout: config.browser.launchTimeoutMs,
        downloadsPath,
      });
      const context = await browser.newContext({
        viewport: request.browser.viewport,
        acceptDownloads: true,
      });
      context.setDefaultNavigationTimeout(config.browser.pageNavigationTimeoutMs);
      context.setDefaultTimeout(config.browser.actionTimeoutMs);
      const page = await context.newPage();
      return { browser, context, page };
    } catch (error) {
      throw new AppError({
        code: ERROR_CODES.BROWSER_LAUNCH_FAILURE,
        message: "Failed to launch isolated Chrome browser.",
        details: error instanceof Error ? error.message : String(error),
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
