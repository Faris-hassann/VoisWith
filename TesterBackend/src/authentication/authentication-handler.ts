import type { Locator, Page } from "playwright";
import { AppError } from "../errors/app-error.js";
import { ERROR_CODES } from "../errors/error-codes.js";
import { errorMessage, serializeError } from "../errors/serialize-error.js";
import type { Credentials } from "../types/testing.js";
import { LoginDetector } from "./login-detector.js";

export interface LoginAttemptDiagnostics {
  usernameLocator?: string;
  passwordLocator?: string;
  submitLocator?: string;
  attempts: string[];
  finalUrl?: string;
  successSignals?: {
    loginFormGone: boolean;
    hasAccountSignal: boolean;
    hasAuthError: boolean;
    cookiesPresent: boolean;
    urlChanged: boolean;
  };
}

export interface AuthenticationResult {
  message: string;
  diagnostics: LoginAttemptDiagnostics;
}

interface LoginTarget {
  locator: Locator;
  description: string;
}

export class AuthenticationHandler {
  private readonly detector = new LoginDetector();

  async authenticate(page: Page, credentials?: Credentials): Promise<AuthenticationResult | undefined> {
    if (!credentials) return undefined;

    const diagnostics: LoginAttemptDiagnostics = { attempts: [] };

    try {
      if (credentials.loginUrl) {
        diagnostics.attempts.push(`Navigate to login URL: ${credentials.loginUrl}`);
        await page.goto(credentials.loginUrl, { waitUntil: "domcontentloaded" });
      }

      const beforeUrl = page.url();
      const detection = await this.detector.detect(page);
      if (detection.humanChallengeDetected) {
        throw new AppError({
          code: ERROR_CODES.HUMAN_AUTHENTICATION_REQUIRED,
          message: "Human authentication challenge detected.",
          statusCode: 409,
          details: diagnostics,
        });
      }

      const username = await firstUsableLocator(page, usernameCandidates(credentials, detection), {
        editable: true,
        diagnostics,
        label: "username",
      });
      let password = await firstUsableLocator(page, passwordCandidates(credentials, detection), {
        editable: true,
        diagnostics,
        label: "password",
      });
      let submit = await firstUsableLocator(page, submitCandidates(credentials, detection), {
        editable: false,
        diagnostics,
        label: "submit",
      });

      if (!username) {
        throw loginError("Could not detect visible editable login fields.", diagnostics);
      }

      diagnostics.usernameLocator = username.description;
      await fillAndVerify(username, credentials.username, "username", diagnostics);

      if (!password) {
        diagnostics.attempts.push("Password field was not visible before username submission; trying two-step login.");
        if (submit) {
          await submit.locator.click();
          diagnostics.attempts.push(`Clicked username-step submit locator: ${submit.description}`);
        } else {
          await username.locator.press("Enter");
          diagnostics.attempts.push("Pressed Enter on username field because no username-step submit control was usable.");
        }
        await Promise.allSettled([
          page.waitForLoadState("domcontentloaded", { timeout: 10000 }),
          page.waitForLoadState("networkidle", { timeout: 10000 }),
        ]);
        await page.waitForTimeout(1000);
        const afterUsernameDetection = await this.detector.detect(page);
        password = await firstUsableLocator(page, passwordCandidates(credentials, afterUsernameDetection), {
          editable: true,
          diagnostics,
          label: "password",
        });
        submit = await firstUsableLocator(page, submitCandidates(credentials, afterUsernameDetection), {
          editable: false,
          diagnostics,
          label: "submit",
        });
      }

      if (!password) {
        throw loginError("Could not detect visible editable password field.", diagnostics);
      }

      diagnostics.passwordLocator = password.description;
      diagnostics.submitLocator = submit?.description ?? "password-field Enter key fallback";
      await fillAndVerify(password, credentials.password, "password", diagnostics);

      if (submit) {
        await submit.locator.click();
        diagnostics.attempts.push(`Clicked submit locator: ${submit.description}`);
      } else {
        await password.locator.press("Enter");
        diagnostics.attempts.push("Pressed Enter on password field because no submit control was usable.");
      }

      await Promise.allSettled([
        page.waitForLoadState("domcontentloaded", { timeout: 10000 }),
        page.waitForLoadState("networkidle", { timeout: 10000 }),
        page.waitForURL((url) => url.toString() !== beforeUrl, { timeout: 10000 }),
      ]);
      await page.waitForTimeout(1000);

      const successSignals = await page.evaluate(() => {
        const text = document.body?.innerText?.toLowerCase() ?? "";
        const hasPassword = Boolean(document.querySelector("input[type='password']"));
        return {
          loginFormGone: !hasPassword,
          hasAccountSignal: /dashboard|account|profile|logout|log out|sign out|admin|client|agent/.test(text),
          hasAuthError: /invalid|incorrect|failed|try again|wrong|error/.test(text),
        };
      });

      const cookies = await page.context().cookies();
      diagnostics.finalUrl = page.url();
      diagnostics.successSignals = {
        ...successSignals,
        cookiesPresent: cookies.length > 0,
        urlChanged: page.url() !== beforeUrl,
      };

      const success =
        !successSignals.hasAuthError &&
        [
          diagnostics.successSignals.urlChanged,
          successSignals.loginFormGone,
          successSignals.hasAccountSignal,
          diagnostics.successSignals.cookiesPresent,
        ].filter(Boolean).length >= 2;

      if (!success) {
        throw loginError("Login did not produce enough success signals.", diagnostics);
      }

      return {
        message: "Login completed using supplied credentials.",
        diagnostics,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      diagnostics.attempts.push(`Login failed: ${errorMessage(error)}`);
      throw new AppError({
        code: ERROR_CODES.LOGIN_FAILURE,
        message: `Login failed: ${errorMessage(error)}`,
        statusCode: 422,
        details: {
          diagnostics,
          error: serializeError(error),
        },
      });
    }
  }
}

export function usernameCandidates(credentials: Credentials, detection: { usernameSelector?: string }): string[] {
  return orderedSelectors([
    credentials.fieldHints?.usernameSelector,
    detection.usernameSelector,
    "input[type='email']",
    "input[name='email']",
    "input[name='username']",
    "input[id*='email' i]",
    "input[id*='user' i]",
    "input[placeholder*='email' i]",
    "input[placeholder*='user' i]",
    "input[autocomplete='username']",
    "input[autocomplete='email']",
    "input[type='text']",
    "input:not([type])",
  ]);
}

export function passwordCandidates(credentials: Credentials, detection: { passwordSelector?: string }): string[] {
  return orderedSelectors([
    credentials.fieldHints?.passwordSelector,
    detection.passwordSelector,
    "input[type='password']",
    "input[name='password']",
    "input[id*='password' i]",
    "input[placeholder*='password' i]",
    "input[autocomplete='current-password']",
  ]);
}

export function submitCandidates(credentials: Credentials, detection: { submitSelector?: string }): string[] {
  return orderedSelectors([
    credentials.fieldHints?.submitSelector,
    detection.submitSelector,
    "button[type='submit']",
    "input[type='submit']",
    "button:has-text('Login')",
    "button:has-text('Log in')",
    "button:has-text('Sign in')",
    "button:has-text('Continue')",
    "[role='button']:has-text('Login')",
    "[role='button']:has-text('Sign in')",
    "form button",
  ]);
}

export function orderedSelectors(values: Array<string | undefined>): string[] {
  const selectors = values
    .filter((value): value is string => Boolean(value?.trim()))
    .flatMap((value) => value.split(",").map((item) => item.trim()).filter(Boolean));
  return [...new Set(selectors)];
}

async function firstUsableLocator(
  page: Page,
  selectors: string[],
  input: {
    editable: boolean;
    diagnostics: LoginAttemptDiagnostics;
    label: string;
  },
): Promise<LoginTarget | undefined> {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector);
      const count = Math.min(await locator.count(), 5);
      input.diagnostics.attempts.push(`Checked ${input.label} selector "${selector}" (${count} match(es)).`);
      for (let index = 0; index < count; index += 1) {
        const candidate = locator.nth(index);
        if (!(await candidate.isVisible().catch(() => false))) continue;
        if (!(await candidate.isEnabled().catch(() => false))) continue;
        if (input.editable && !(await candidate.isEditable().catch(() => false))) continue;
        return { locator: candidate, description: `${selector}${count > 1 ? ` [${index}]` : ""}` };
      }
    } catch (error) {
      input.diagnostics.attempts.push(`Selector "${selector}" failed: ${errorMessage(error)}`);
    }
  }
  return undefined;
}

async function fillAndVerify(
  target: LoginTarget,
  value: string,
  label: "username" | "password",
  diagnostics: LoginAttemptDiagnostics,
): Promise<void> {
  await target.locator.click();
  await target.locator.fill("");
  await target.locator.pressSequentially(value, { delay: 20 });
  await target.locator.page().waitForTimeout(300);
  const actual = await target.locator.inputValue().catch(() => "");
  const verified = label === "password" ? actual.length > 0 : actual === value;
  diagnostics.attempts.push(`Filled ${label} locator "${target.description}" and verification ${verified ? "passed" : "failed"}.`);
  if (!verified) {
    throw loginError(`Could not verify ${label} field after fill.`, diagnostics);
  }
}

function loginError(message: string, diagnostics: LoginAttemptDiagnostics): AppError {
  return new AppError({
    code: ERROR_CODES.LOGIN_FAILURE,
    message,
    statusCode: 422,
    details: { diagnostics },
  });
}
