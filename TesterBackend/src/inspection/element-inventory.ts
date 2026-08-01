import type { Page } from "playwright";
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
  testId?: string;
  css: string;
}

export class ElementInventoryBuilder {
  async build(page: Page): Promise<ElementInventoryItem[]> {
    const raw = await page.evaluate(() => {
      const selectorFor = (element: Element): string => {
        if (element.id) return `#${CSS.escape(element.id)}`;
        const testId = element.getAttribute("data-testid") ?? element.getAttribute("data-test");
        if (testId) return `[data-testid="${CSS.escape(testId)}"],[data-test="${CSS.escape(testId)}"]`;
        const name = element.getAttribute("name");
        if (name) return `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
        const parts: string[] = [];
        let current: Element | null = element;
        while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 4) {
          const tag = current.tagName.toLowerCase();
          const parent: Element | null = current.parentElement;
          if (!parent) {
            parts.unshift(tag);
            break;
          }
          const siblings = [...parent.children].filter((child) => child.tagName === current?.tagName);
          const index = siblings.indexOf(current) + 1;
          parts.unshift(`${tag}:nth-of-type(${index})`);
          current = parent;
        }
        return parts.join(" > ");
      };

      const labelFor = (element: Element): string | undefined => {
        const id = element.getAttribute("id");
        if (id) {
          const explicit = document.querySelector(`label[for="${CSS.escape(id)}"]`);
          if (explicit?.textContent?.trim()) return explicit.textContent.trim();
        }
        const implicit = element.closest("label");
        return implicit?.textContent?.trim() || undefined;
      };

      const kindFor = (element: Element): RawElement["kind"] => {
        const tag = element.tagName.toLowerCase();
        const type = element.getAttribute("type")?.toLowerCase();
        const role = element.getAttribute("role")?.toLowerCase();
        const text = element.textContent?.toLowerCase() ?? "";
        if (tag === "a") return "link";
        if (tag === "button") return /submit|save|continue|send/i.test(text) ? "submit" : "button";
        if (tag === "textarea") return "textarea";
        if (tag === "select") return "select";
        if (tag === "form") return "form";
        if (role === "dialog") return "dialog";
        if (role === "tab") return "tab";
        if (role === "menu" || role === "menuitem") return "menu";
        if (tag === "input") {
          if (type === "checkbox") return "checkbox";
          if (type === "radio") return "radio";
          if (type === "file") return "file";
          if (type === "search") return "search";
          return "input";
        }
        return "other";
      };

      return [
        ...document.querySelectorAll(
          "a,button,input,textarea,select,form,[role='button'],[role='dialog'],[role='tab'],[role='menu'],[role='menuitem']",
        ),
      ].slice(0, 500).map((element): RawElement => {
        const htmlElement = element as HTMLElement;
        const input = element as HTMLInputElement;
        const tagName = element.tagName.toLowerCase();
        const validation: Record<string, string | number | boolean> = {};
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
            htmlElement.innerText?.trim().slice(0, 200) ??
            undefined,
          text: htmlElement.innerText?.trim().slice(0, 300) || undefined,
          label: labelFor(element),
          placeholder: element.getAttribute("placeholder") ?? undefined,
          name: element.getAttribute("name") ?? undefined,
          type: element.getAttribute("type") ?? undefined,
          value: ["password", "hidden"].includes(input.type) ? undefined : input.value?.slice(0, 200),
          disabled: Boolean((element as HTMLInputElement).disabled || element.getAttribute("aria-disabled") === "true"),
          hidden:
            htmlElement.offsetParent === null ||
            htmlElement.hidden ||
            getComputedStyle(htmlElement).visibility === "hidden",
          required: Boolean((element as HTMLInputElement).required),
          validation,
          formAction: (element as HTMLButtonElement).formAction || element.getAttribute("action") || undefined,
          formMethod: (element as HTMLButtonElement).formMethod || element.getAttribute("method") || undefined,
          testId: element.getAttribute("data-testid") ?? element.getAttribute("data-test") ?? undefined,
          css: selectorFor(element),
        };
      });
    });

    return raw.map((item, index) => ({
      id: `element_${index + 1}`,
      ...item,
      locator: this.locatorFor(item),
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
