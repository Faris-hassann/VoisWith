import type { Page } from "playwright";

export interface LoginDetection {
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  humanChallengeDetected: boolean;
}

export class LoginDetector {
  async detect(page: Page): Promise<LoginDetection> {
    return page.evaluate(() => {
      const challengeText = document.body?.innerText?.toLowerCase() ?? "";
      const humanChallengeDetected = /captcha|multi-factor|mfa|one-time|otp|passkey|security challenge/.test(
        challengeText,
      );
      const inputScore = (input: HTMLInputElement): number => {
        const text = [
          input.type,
          input.name,
          input.id,
          input.placeholder,
          input.getAttribute("aria-label"),
          document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return /username|email|user|login|account/.test(text) ? 2 : 0;
      };
      const selectorFor = (element: Element): string => {
        if (element.id) return `#${CSS.escape(element.id)}`;
        const name = element.getAttribute("name");
        if (name) return `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
        return element.tagName.toLowerCase();
      };
      const inputs = [...document.querySelectorAll("input")] as HTMLInputElement[];
      const username = inputs
        .filter((input) => input.type !== "password" && !input.disabled)
        .sort((a, b) => inputScore(b) - inputScore(a))[0];
      const password = inputs.find((input) => input.type === "password" && !input.disabled);
      const submit = [...document.querySelectorAll("button,input[type='submit'],[role='button']")].find((button) =>
        /login|log in|sign in|continue|submit/i.test(button.textContent ?? button.getAttribute("value") ?? ""),
      );
      return {
        usernameSelector: username ? selectorFor(username) : undefined,
        passwordSelector: password ? selectorFor(password) : undefined,
        submitSelector: submit ? selectorFor(submit) : undefined,
        humanChallengeDetected,
      };
    });
  }
}
