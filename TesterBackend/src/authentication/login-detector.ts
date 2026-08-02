import type { Page } from "playwright";

export interface LoginDetection {
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  humanChallengeDetected: boolean;
}

export class LoginDetector {
  async detect(page: Page): Promise<LoginDetection> {
    return page.evaluate(`(() => {
      const challengeText = document.body?.innerText?.toLowerCase() ?? "";
      const humanChallengeDetected = /captcha|multi-factor|mfa|one-time|otp|passkey|security challenge/.test(challengeText);
      const selectorFor = (element) => {
        if (element.id) return "#" + CSS.escape(element.id);
        const name = element.getAttribute("name");
        if (name) return element.tagName.toLowerCase() + "[name=\\"" + CSS.escape(name) + "\\"]";
        const testId = element.getAttribute("data-testid") ?? element.getAttribute("data-test");
        if (testId) return "[data-testid=\\"" + CSS.escape(testId) + "\\"],[data-test=\\"" + CSS.escape(testId) + "\\"]";
        return element.tagName.toLowerCase();
      };
      const labelTextFor = (input) => {
        const id = input.getAttribute("id");
        if (!id) return "";
        return document.querySelector("label[for='" + CSS.escape(id) + "']")?.textContent ?? "";
      };
      const inputScore = (input) => {
        const text = [
          input.type,
          input.name,
          input.id,
          input.placeholder,
          input.getAttribute("aria-label"),
          labelTextFor(input),
        ].filter(Boolean).join(" ").toLowerCase();
        if (/email/.test(text)) return 5;
        if (/username|user|login|account/.test(text)) return 4;
        if (input.type === "email") return 3;
        return 0;
      };
      const visibleEditable = (input) => {
        const style = getComputedStyle(input);
        return !input.disabled && !input.readOnly && input.offsetParent !== null && style.visibility !== "hidden" && style.display !== "none";
      };
      const inputs = [...document.querySelectorAll("input")];
      const username = inputs
        .filter((input) => input.type !== "password" && input.type !== "hidden" && visibleEditable(input))
        .sort((a, b) => inputScore(b) - inputScore(a))[0];
      const password = inputs.find((input) => input.type === "password" && visibleEditable(input));
      const submit = [...document.querySelectorAll("button,input[type='submit'],[role='button']")].find((button) => {
        const style = getComputedStyle(button);
        if (button.disabled || button.offsetParent === null || style.visibility === "hidden" || style.display === "none") return false;
        return /login|log in|sign in|continue|submit/i.test(button.textContent ?? button.getAttribute("value") ?? "");
      });
      return {
        usernameSelector: username ? selectorFor(username) : undefined,
        passwordSelector: password ? selectorFor(password) : undefined,
        submitSelector: submit ? selectorFor(submit) : undefined,
        humanChallengeDetected,
      };
    })()`);
  }
}
