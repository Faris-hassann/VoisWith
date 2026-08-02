import type { Page } from "playwright";
import { canonicalizeUrl } from "../crawler/url-canonicalizer.js";
import type { ConsoleObservation, NetworkObservation } from "../types/report.js";
import type { ElementInventoryItem, FormSnapshot, PageSnapshot } from "../types/testing.js";
import { ElementInventoryBuilder } from "./element-inventory.js";

const FIELD_KINDS = new Set<ElementInventoryItem["kind"]>(["input", "textarea", "select", "checkbox", "radio", "file", "search"]);

interface RawLinkSnapshot {
  text: string;
  href: string;
  sourceCss: string;
}

interface PageDomData {
  text: string;
  headings: string[];
  links: RawLinkSnapshot[];
  tables: string[];
  images: Array<{ src: string; alt?: string }>;
  scripts: Array<{ src: string; type?: string }>;
  visibleValidationErrors: string[];
  uiObservations: PageSnapshot["uiObservations"];
}

export class PageInspector {
  private readonly inventoryBuilder = new ElementInventoryBuilder();

  async inspect(input: {
    page: Page;
    targetOrigin: string;
    consoleErrors: ConsoleObservation[];
    failedRequests: NetworkObservation[];
    observedApiCalls: NetworkObservation[];
  }): Promise<PageSnapshot> {
    const { page } = input;
    const url = page.url();
    const canonicalUrl = canonicalizeUrl(url).url ?? url;
    const elements = await this.inventoryBuilder.build(page);
    const title = await page.title().catch(() => "");
    const pageData = await page.evaluate<PageDomData>(`(() => {
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

      const text = document.body?.innerText?.replace(/\\s+/g, " ").trim().slice(0, 8000) ?? "";
      const headings = [...document.querySelectorAll("h1,h2,h3")]
        .map((heading) => heading.textContent?.trim())
        .filter(Boolean)
        .slice(0, 30);
      const links = [...document.querySelectorAll("a[href]")].slice(0, 300).map((link) => ({
        text: (link.textContent ?? "").trim().slice(0, 200),
        href: link.href,
        sourceCss: selectorFor(link),
      }));
      const tables = [...document.querySelectorAll("table")]
        .slice(0, 20)
        .map((table) => table.textContent?.replace(/\\s+/g, " ").trim().slice(0, 1000) ?? "");
      const images = [...document.querySelectorAll("img[src]")]
        .slice(0, 200)
        .map((image) => ({
          src: image.src,
          alt: image.getAttribute("alt") ?? undefined,
        }));
      const scripts = [...document.querySelectorAll("script[src]")]
        .slice(0, 200)
        .map((script) => ({
          src: script.src,
          type: script.getAttribute("type") ?? undefined,
        }));
      const visibleValidationErrors = [
        ...document.querySelectorAll("[aria-invalid='true'],.error,.invalid,.validation-error,[role='alert']"),
      ]
        .map((item) => item.textContent?.trim())
        .filter(Boolean)
        .slice(0, 30);
      const horizontalOverflow = Math.max(
        0,
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
        document.body ? document.body.scrollWidth - document.body.clientWidth : 0,
      );
      const unlabeledInteractive = [...document.querySelectorAll("button,a[href],input,textarea,select")]
        .filter((element) => {
          const label =
            element.getAttribute("aria-label") ||
            element.getAttribute("title") ||
            element.getAttribute("placeholder") ||
            element.innerText?.trim() ||
            element.getAttribute("name");
          return !label;
        })
        .length;
      const loadingIndicators = [...document.querySelectorAll("[aria-busy='true'],[role='progressbar'],.loading,.spinner,.skeleton")]
        .filter((element) => element.offsetParent !== null && getComputedStyle(element).visibility !== "hidden")
        .length;
      const documentDirection = document.documentElement.dir || getComputedStyle(document.documentElement).direction || "ltr";
      const uiObservations = [
        {
          name: "horizontal-overflow",
          status: horizontalOverflow > 8 ? "FAILED" : "PASSED",
          description: horizontalOverflow + "px horizontal overflow detected.",
          count: horizontalOverflow,
        },
        {
          name: "unlabeled-interactive-elements",
          status: unlabeledInteractive > 0 ? "INCONCLUSIVE" : "PASSED",
          description: unlabeledInteractive + " interactive element(s) lack an obvious accessible name.",
          count: unlabeledInteractive,
        },
        {
          name: "visible-loading-indicators",
          status: loadingIndicators > 0 ? "INCONCLUSIVE" : "PASSED",
          description: loadingIndicators + " loading indicator(s) remained visible after DOMContentLoaded.",
          count: loadingIndicators,
        },
        {
          name: "document-direction",
          status: documentDirection === "rtl" || documentDirection === "ltr" ? "PASSED" : "INCONCLUSIVE",
          description: "Document direction is " + documentDirection + ".",
        },
      ];
      return { text, headings, links, tables, images, scripts, visibleValidationErrors, uiObservations };
    })()`);

    const forms = buildFormSnapshots(elements);

    return {
      url,
      canonicalUrl,
      title,
      headings: pageData.headings,
      visibleText: pageData.text,
      links: buildLinkSnapshots(pageData.links, elements, input.targetOrigin, url),
      images: buildAssetSnapshots(pageData.images, input.targetOrigin, url),
      scripts: buildAssetSnapshots(pageData.scripts, input.targetOrigin, url),
      elements,
      forms,
      tables: pageData.tables,
      dialogs: elements.filter((element) => element.kind === "dialog"),
      currentQueryParameters: Object.fromEntries(new URL(url).searchParams.entries()),
      consoleErrors: input.consoleErrors,
      failedRequests: input.failedRequests,
      observedApiCalls: input.observedApiCalls,
      performance: [],
      visibleValidationErrors: pageData.visibleValidationErrors,
      uiObservations: [...pageData.uiObservations],
    };
  }
}

export function buildAssetSnapshots(
  assets: Array<{ src: string; alt?: string; type?: string }>,
  targetOrigin: string,
  baseUrl: string,
): PageSnapshot["images"] {
  return assets.map((asset) => {
    const canonical = canonicalizeUrl(asset.src, baseUrl);
    return {
      ...asset,
      canonicalSrc: canonical.url,
      internal: canonical.url ? safeOrigin(canonical.url) === targetOrigin : false,
    };
  });
}

export function buildLinkSnapshots(
  links: RawLinkSnapshot[],
  elements: ElementInventoryItem[],
  targetOrigin: string,
  baseUrl: string,
): PageSnapshot["links"] {
  const linkIdByCss = new Map(
    elements
      .filter((element) => element.kind === "link" && element.locator.strategy === "css")
      .map((element) => [element.locator.value, element.id]),
  );

  return links.map((link) => {
    const canonical = canonicalizeUrl(link.href, baseUrl);
    const canonicalHref = canonical.url;
    return {
      text: link.text,
      href: link.href,
      canonicalHref,
      internal: canonicalHref ? safeOrigin(canonicalHref) === targetOrigin : false,
      sourceElementId: linkIdByCss.get(link.sourceCss),
    };
  });
}

export function buildFormSnapshots(elements: ElementInventoryItem[]): FormSnapshot[] {
  const forms: FormSnapshot[] = elements
    .filter((element) => element.kind === "form")
    .map((form) => ({
      elementId: form.id,
      method: form.formMethod,
      action: form.formAction,
      fields: elements.filter((element) => FIELD_KINDS.has(element.kind) && element.formOwnerElementId === form.id),
      submitControls: elements.filter((element) => element.kind === "submit" && element.formOwnerElementId === form.id),
    }));

  const standaloneFields = elements.filter((element) => FIELD_KINDS.has(element.kind) && !element.formOwnerElementId);
  const standaloneSubmits = elements.filter((element) => element.kind === "submit" && !element.formOwnerElementId);
  if (standaloneFields.length > 0 || standaloneSubmits.length > 0) {
    forms.push({
      elementId: "implicit_form_1",
      implicit: true,
      fields: standaloneFields,
      submitControls: standaloneSubmits,
      apparentPurpose: inferImplicitFormPurpose(standaloneFields, standaloneSubmits),
    });
  }

  return forms;
}

function inferImplicitFormPurpose(
  fields: ElementInventoryItem[],
  submitControls: ElementInventoryItem[],
): string | undefined {
  const labels = [...fields, ...submitControls]
    .map((element) => element.accessibleName ?? element.label ?? element.placeholder ?? element.text)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!labels) return undefined;
  if (labels.includes("search")) return "search";
  if (labels.includes("email") || labels.includes("subscribe")) return "signup";
  if (labels.includes("login") || labels.includes("password")) return "login";
  return "standalone controls";
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}
