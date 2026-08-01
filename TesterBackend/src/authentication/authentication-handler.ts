import type { Page } from "playwright";
import { AppError } from "../errors/app-error.js";
import { ERROR_CODES } from "../errors/error-codes.js";
import type { Credentials } from "../types/testing.js";
import { LoginDetector } from "./login-detector.js";

export class AuthenticationHandler {
  private readonly detector = new LoginDetector();

  async authenticate(page: Page, credentials?: Credentials): Promise<string | undefined> {
    if (!credentials) return undefined;

    if (credentials.loginUrl) {
      await page.goto(credentials.loginUrl, { waitUntil: "domcontentloaded" });
    }

    const beforeUrl = page.url();
    const detection = await this.detector.detect(page);
    if (detection.humanChallengeDetected) {
      throw new AppError({
        code: ERROR_CODES.HUMAN_AUTHENTICATION_REQUIRED,
        message: "Human authentication challenge detected.",
        statusCode: 409,
      });
    }

    const usernameSelector = credentials.fieldHints?.usernameSelector ?? detection.usernameSelector;
    const passwordSelector = credentials.fieldHints?.passwordSelector ?? detection.passwordSelector;
    const submitSelector = credentials.fieldHints?.submitSelector ?? detection.submitSelector;
    if (!usernameSelector || !passwordSelector || !submitSelector) {
      throw new AppError({
        code: ERROR_CODES.LOGIN_FAILURE,
        message: "Could not detect login fields.",
        statusCode: 422,
      });
    }

    await page.locator(usernameSelector).first().fill(credentials.username);
    await page.locator(passwordSelector).first().fill(credentials.password);
    await Promise.allSettled([
      page.waitForLoadState("domcontentloaded", { timeout: 10000 }),
      page.locator(submitSelector).first().click(),
    ]);
    await page.waitForTimeout(1000);

    const successSignals = await page.evaluate(() => {
      const text = document.body?.innerText?.toLowerCase() ?? "";
      const hasPassword = Boolean(document.querySelector("input[type='password']"));
      return {
        loginFormGone: !hasPassword,
        hasAccountSignal: /dashboard|account|profile|logout|log out|sign out/.test(text),
        hasAuthError: /invalid|incorrect|failed|try again/.test(text),
      };
    });

    const cookies = await page.context().cookies();
    const urlChanged = page.url() !== beforeUrl;
    const success =
      !successSignals.hasAuthError &&
      [urlChanged, successSignals.loginFormGone, successSignals.hasAccountSignal, cookies.length > 0].filter(Boolean)
        .length >= 2;

    if (!success) {
      throw new AppError({
        code: ERROR_CODES.LOGIN_FAILURE,
        message: "Login did not produce enough success signals.",
        statusCode: 422,
      });
    }

    return "Login completed using supplied credentials.";
  }
}
