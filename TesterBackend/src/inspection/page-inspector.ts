import type { Page } from "playwright";
import { canonicalizeUrl } from "../crawler/url-canonicalizer.js";
import type { ConsoleObservation, NetworkObservation } from "../types/report.js";
import type { FormSnapshot, PageSnapshot } from "../types/testing.js";
import { ElementInventoryBuilder } from "./element-inventory.js";

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
    const pageData = await page.evaluate(() => {
      const text = document.body?.innerText?.replace(/\s+/g, " ").trim().slice(0, 8000) ?? "";
      const headings = [...document.querySelectorAll("h1,h2,h3")]
        .map((heading) => heading.textContent?.trim())
        .filter(Boolean)
        .slice(0, 30) as string[];
      const links = [...document.querySelectorAll("a[href]")].slice(0, 300).map((link) => ({
        text: (link.textContent ?? "").trim().slice(0, 200),
        href: (link as HTMLAnchorElement).href,
      }));
      const tables = [...document.querySelectorAll("table")]
        .slice(0, 20)
        .map((table) => table.textContent?.replace(/\s+/g, " ").trim().slice(0, 1000) ?? "");
      const visibleValidationErrors = [
        ...document.querySelectorAll("[aria-invalid='true'],.error,.invalid,.validation-error,[role='alert']"),
      ]
        .map((item) => item.textContent?.trim())
        .filter(Boolean)
        .slice(0, 30) as string[];
      return { text, headings, links, tables, visibleValidationErrors };
    });

    const forms: FormSnapshot[] = elements
      .filter((element) => element.kind === "form")
      .map((form) => ({
        elementId: form.id,
        method: form.formMethod,
        action: form.formAction,
        fields: elements.filter((element) =>
          ["input", "textarea", "select", "checkbox", "radio", "file"].includes(element.kind),
        ),
        submitControls: elements.filter((element) => element.kind === "submit"),
      }));

    return {
      url,
      canonicalUrl,
      title,
      headings: pageData.headings,
      visibleText: pageData.text,
      links: pageData.links.map((link) => {
        const canonical = canonicalizeUrl(link.href, url);
        return {
          text: link.text,
          href: link.href,
          canonicalHref: canonical.url,
          internal: safeOrigin(link.href) === input.targetOrigin,
        };
      }),
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
    };
  }
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}
