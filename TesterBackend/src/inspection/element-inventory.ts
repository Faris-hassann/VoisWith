import type { Page } from "playwright";
import { CURSOR_HOST_ATTRIBUTE } from "../browser/browser-visual-agent.js";
import type { ElementInventoryItem, LocatorDescriptor } from "../types/testing.js";

interface RawElement {
  tagName: string;
  kind: ElementInventoryItem["kind"];
  role?: string;
  accessibleName?: string;
  text?: string;
  label?: string;
  placeholder?: string;
  name?: string;
  type?: string;
  value?: string;
  disabled: boolean;
  hidden: boolean;
  required?: boolean;
  validation?: Record<string, string | number | boolean>;
  formAction?: string;
  formMethod?: string;
  formOwnerElementId?: string;
  testId?: string;
  css: string;
}

export class ElementInventoryBuilder {
  async build(page: Page): Promise<ElementInventoryItem[]> {
    const raw = await page.evaluate<RawElement[]>(`(() => {
      const selectorFor = (element) => {
        if (element.id) return "#" + CSS.escape(element.id);
        const testId = element.getAttribute("data-testid") ?? element.getAttribute("data-test");
        if (testId) return "[data-testid=\\"" + CSS.escape(testId) + "\\"],[data-test=\\"" + CSS.escape(testId) + "\\"]";
        const name = element.getAttribute("name");
        if (name) return element.tagName.toLowerCase() + "[name=\\"" + CSS.escape(name) + "\\"]";
        const parts = [];
        let current = element;
        while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 4) {
          const tag = current.tagName.toLowerCase();
          const parent = current.parentElement;
          if (!parent) {
            parts.unshift(tag);
            break;
          }
          const siblings = [...parent.children].filter((child) => child.tagName === current.tagName);
          const index = siblings.indexOf(current) + 1;
          parts.unshift(tag + ":nth-of-type(" + index + ")");
          current = parent;
        }
        return parts.join(" > ");
      };

      const labelFor = (element) => {
        const id = element.getAttribute("id");
        if (id) {
          const explicit = document.querySelector("label[for='" + CSS.escape(id) + "']");
          if (explicit?.textContent?.trim()) return explicit.textContent.trim();
        }
        const implicit = element.closest("label");
        return implicit?.textContent?.trim() || undefined;
      };

      const kindFor = (element) => {
        const tag = element.tagName.toLowerCase();
        const type = element.getAttribute("type")?.toLowerCase();
        const role = element.getAttribute("role")?.toLowerCase();
        const text = element.textContent?.toLowerCase() ?? "";
        if (tag === "a") return "link";
        if (tag === "button") {
          // The type attribute is authoritative, and HTML's default for a
          // button inside a form is submit. Text is only a fallback: real
          // submit buttons say "Sign in" or "Subscribe" far more often than
          // they say "Submit", and treating those as plain buttons left forms
          // with no submit control for the executor to activate.
          if (type === "submit") return "submit";
          if (!type && element.form) return "submit";
          return /submit|save|continue|send/i.test(text) ? "submit" : "button";
        }
        if (tag === "textarea") return "textarea";
        if (tag === "select") return "select";
        if (tag === "form") return "form";
        if (role === "dialog") return "dialog";
        if (role === "tab") return "tab";
        if (role === "menu" || role === "menuitem") return "menu";
        if (tag === "input") {
          if (type === "submit" || type === "image") return "submit";
          if (type === "checkbox") return "checkbox";
          if (type === "radio") return "radio";
          if (type === "file") return "file";
          if (type === "search") return "search";
          return "input";
        }
        return "other";
      };

      const candidates = [
        ...document.querySelectorAll(
          "a,button,input,textarea,select,form,[role='button'],[role='dialog'],[role='tab'],[role='menu'],[role='menuitem']",
        ),
      ].filter((element) => {
        const host = element.getRootNode() instanceof ShadowRoot ? element.getRootNode().host : null;
        return !element.closest("[${CURSOR_HOST_ATTRIBUTE}]") && !host?.hasAttribute("${CURSOR_HOST_ATTRIBUTE}");
      }).slice(0, 500);
      const keyFor = (element) => {
        if (!element) return undefined;
        const index = candidates.indexOf(element);
        return index >= 0 ? "element_" + (index + 1) : undefined;
      };

      return candidates.map((element) => {
        const input = element;
        const tagName = element.tagName.toLowerCase();
        const validation = {};
        if (input.minLength > -1) validation.minLength = input.minLength;
        if (input.maxLength > -1) validation.maxLength = input.maxLength;
        if (input.min) validation.min = input.min;
        if (input.max) validation.max = input.max;
        if (input.pattern) validation.pattern = input.pattern;

        return {
          tagName,
          kind: kindFor(element),
          role: element.getAttribute("role") ?? undefined,
          accessibleName:
            element.getAttribute("aria-label") ??
            element.getAttribute("title") ??
            labelFor(element) ??
            element.innerText?.trim().slice(0, 200) ??
            undefined,
          text: element.innerText?.trim().slice(0, 300) || undefined,
          label: labelFor(element),
          placeholder: element.getAttribute("placeholder") ?? undefined,
          name: element.getAttribute("name") ?? undefined,
          type: element.getAttribute("type") ?? undefined,
          value: ["password", "hidden"].includes(input.type) ? undefined : input.value?.slice(0, 200),
          disabled: Boolean(input.disabled || element.getAttribute("aria-disabled") === "true"),
          hidden:
            element.offsetParent === null ||
            element.hidden ||
            getComputedStyle(element).visibility === "hidden",
          required: Boolean(input.required),
          validation,
          formAction: element.formAction || element.getAttribute("action") || undefined,
          formMethod: element.formMethod || element.getAttribute("method") || undefined,
          formOwnerElementId:
            tagName === "form"
              ? undefined
              : keyFor(element.form),
          testId: element.getAttribute("data-testid") ?? element.getAttribute("data-test") ?? undefined,
          css: selectorFor(element),
        };
      });
    })()`);

    return raw.map((item, index) => ({
      id: `element_${index + 1}`,
      ...item,
      locator: this.locatorFor(item),
      cssSelector: item.css,
    }));
  }

  private locatorFor(item: RawElement): LocatorDescriptor {
    if (item.role && item.accessibleName) {
      return { strategy: "role", role: item.role, value: item.accessibleName, exact: true };
    }
    if (item.label) return { strategy: "label", value: item.label, exact: true };
    if (item.placeholder) return { strategy: "placeholder", value: item.placeholder, exact: true };
    if (item.testId) return { strategy: "testId", value: item.testId };
    if (item.name) return { strategy: "name", value: item.name };
    return { strategy: "css", value: item.css };
  }
}
