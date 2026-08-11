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
        return undefined;
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
      const password = inputs.find((input) => {
        const text = [input.type, input.name, input.id, input.placeholder, input.getAttribute("autocomplete"), input.getAttribute("aria-label"), labelTextFor(input)].filter(Boolean).join(" ").toLowerCase();
        return /password|current-password/.test(text) && visibleEditable(input);
      });
      const passwordForm = password?.closest("form");
      const submit = [...document.querySelectorAll("button,input[type='submit'],[role='button']")]
        .filter((button) => !passwordForm || passwordForm.contains(button) || button.getAttribute("form") === passwordForm.id)
        .map((button, index) => {
        const style = getComputedStyle(button);
        const text = (button.textContent ?? button.getAttribute("value") ?? button.getAttribute("aria-label") ?? "").trim();
        const type = button.getAttribute("type")?.toLowerCase();
        const unusable = button.disabled || button.offsetParent === null || style.visibility === "hidden" || style.display === "none";
        const excluded = /show|hide|visibility|eye|google|facebook|github|sso|oauth/i.test(text) || type === "button";
        const exact = /^(sign in|log in|login|continue)$/i.test(text);
        const action = /login|log in|sign in|continue|submit/i.test(text);
        const nativeSubmit = button.tagName.toLowerCase() === "input" || type === "submit" || !type;
        return { button, index, unusable, excluded, score: (exact ? 30 : 0) + (action ? 10 : 0) + (nativeSubmit ? 5 : 0) };
      })
        .filter((candidate) => !candidate.unusable && !candidate.excluded && candidate.score > 0)
        .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.button;
      return {
        usernameSelector: username ? selectorFor(username) : undefined,
        passwordSelector: password ? selectorFor(password) : undefined,
        submitSelector: submit ? selectorFor(submit) : undefined,
        humanChallengeDetected,
      };
    })()`);
  }
}
