import type { Page } from "playwright";
import { ScopePolicy } from "./scope-policy.js";
import type { RunContext } from "../testing/run-context.js";
import type { PageReport } from "../types/report.js";
import { isDeadlineExceeded } from "../utilities/timeout.js";

interface CrawlItem {
  url: string;
  depth: number;
  parentUrl?: string;
  source: string;
}

export class PageCrawler {
  async crawl(input: {
    context: RunContext;
    page: Page;
    testPage: (url: string) => Promise<PageReport>;
  }): Promise<void> {
    const { context, page, testPage } = input;
    const policy = new ScopePolicy({
      targetOrigin: context.targetOrigin,
      sameOriginOnly: context.request.crawl.sameOriginOnly,
      includePatterns: context.request.crawl.includePatterns,
      excludePatterns: context.request.crawl.excludePatterns,
    });
    const seed = policy.evaluate(context.request.targetUrl);
    const stack: CrawlItem[] = seed.allowed && seed.canonicalUrl ? [{ url: seed.canonicalUrl, depth: 0, source: "seed" }] : [];

    while (stack.length > 0) {
      if (isDeadlineExceeded(context.deadlineMs)) break;
      if (context.visitedUrls.size >= context.request.crawl.maxPages) break;
      const item = stack.pop();
      if (!item || context.visitedUrls.has(item.url)) continue;
      const decision = policy.evaluate(item.url, item.parentUrl);
      if (!decision.allowed || !decision.canonicalUrl) {
        context.skippedUrls.set(item.url, decision.reason ?? "scope-policy");
        continue;
      }
      if (item.depth > context.request.crawl.maxDepth) {
        context.skippedUrls.set(item.url, "max-depth");
        continue;
      }

      try {
        const report = await testPage(decision.canonicalUrl);
        context.pageReports.push(report);
        context.visitedUrls.add(decision.canonicalUrl);
        const links = await page.locator("a[href]").evaluateAll((anchors) =>
          anchors.map((anchor) => (anchor as HTMLAnchorElement).href),
        );
        for (const link of links.reverse()) {
          const next = policy.evaluate(link, decision.canonicalUrl);
          if (
            next.allowed &&
            next.canonicalUrl &&
            !context.visitedUrls.has(next.canonicalUrl) &&
            !context.pendingUrls.has(next.canonicalUrl)
          ) {
            context.pendingUrls.add(next.canonicalUrl);
            stack.push({
              url: next.canonicalUrl,
              depth: item.depth + 1,
              parentUrl: decision.canonicalUrl,
              source: "link",
            });
          }
        }
      } catch (error) {
        context.failedUrls.set(item.url, error instanceof Error ? error.message : String(error));
      }
    }
  }
}
