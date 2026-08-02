import { ScopePolicy } from "./scope-policy.js";
import type { RunContext } from "../testing/run-context.js";
import type { PageReport } from "../types/report.js";
import type { LinkSnapshot } from "../types/testing.js";
import { isDeadlineExceeded } from "../utilities/timeout.js";
import { errorMessage } from "../errors/serialize-error.js";

interface CrawlItem {
  url: string;
  depth: number;
  parentUrl?: string;
  source: string;
}

export interface CrawledPageResult {
  report: PageReport;
  links: LinkSnapshot[];
}

export class PageCrawler {
  async crawl(input: {
    context: RunContext;
    testPage: (url: string) => Promise<CrawledPageResult>;
  }): Promise<void> {
    const { context, testPage } = input;
    const policy = new ScopePolicy({
      targetOrigin: context.targetOrigin,
      sameOriginOnly: context.request.crawl.sameOriginOnly,
      includePatterns: context.request.crawl.includePatterns,
      excludePatterns: context.request.crawl.excludePatterns,
    });
    const seed = policy.evaluate(context.request.targetUrl);
    const stack: CrawlItem[] = seed.allowed && seed.canonicalUrl ? [{ url: seed.canonicalUrl, depth: 0, source: "seed" }] : [];
    context.diagnostics.crawl.events.push({
      name: "Crawler initialized",
      status: seed.allowed ? "PASSED" : "FAILED",
      timestamp: new Date().toISOString(),
      url: seed.canonicalUrl ?? context.request.targetUrl,
      message: seed.allowed ? "Seed URL accepted for DFS crawl." : (seed.reason ?? "Seed URL rejected."),
    });

    while (stack.length > 0) {
      if (isDeadlineExceeded(context.deadlineMs)) {
        context.diagnostics.crawl.events.push({
          name: "Crawler stopped",
          status: "SKIPPED",
          timestamp: new Date().toISOString(),
          message: "Run deadline exceeded.",
        });
        break;
      }
      if (context.visitedUrls.size >= context.request.crawl.maxPages) {
        context.diagnostics.crawl.events.push({
          name: "Crawler stopped",
          status: "SKIPPED",
          timestamp: new Date().toISOString(),
          message: `Maximum page limit reached: ${context.request.crawl.maxPages}.`,
        });
        break;
      }
      const item = stack.pop();
      if (!item) continue;
      context.pendingUrls.delete(item.url);
      if (context.visitedUrls.has(item.url)) continue;
      context.diagnostics.crawl.events.push({
        name: "Crawler popped URL",
        status: "INFO",
        timestamp: new Date().toISOString(),
        url: item.url,
        message: `Depth ${item.depth}, source ${item.source}.`,
      });
      const decision = policy.evaluate(item.url, item.parentUrl);
      if (decision.canonicalUrl) {
        context.pendingUrls.delete(decision.canonicalUrl);
      }
      if (!decision.allowed || !decision.canonicalUrl) {
        context.skippedUrls.set(item.url, decision.reason ?? "scope-policy");
        context.diagnostics.crawl.events.push({
          name: "URL skipped",
          status: "SKIPPED",
          timestamp: new Date().toISOString(),
          url: item.url,
          message: decision.reason ?? "scope-policy",
        });
        continue;
      }
      if (item.depth > context.request.crawl.maxDepth) {
        context.skippedUrls.set(item.url, "max-depth");
        context.diagnostics.crawl.events.push({
          name: "URL skipped",
          status: "SKIPPED",
          timestamp: new Date().toISOString(),
          url: item.url,
          message: "max-depth",
        });
        continue;
      }

      try {
        const result = await testPage(decision.canonicalUrl);
        const report = result.report;
        context.pageReports.push(report);
        context.visitedUrls.add(decision.canonicalUrl);
        const links = result.links;
        context.diagnostics.crawl.discoveredCandidates += links.length;
        let acceptedLinks = 0;
        let skippedLinks = 0;
        for (const link of links.reverse()) {
          const candidateUrl = link.canonicalHref ?? link.href;
          const next = policy.evaluate(candidateUrl, decision.canonicalUrl);
          if (
            next.allowed &&
            next.canonicalUrl &&
            !context.visitedUrls.has(next.canonicalUrl) &&
            !context.pendingUrls.has(next.canonicalUrl)
          ) {
            acceptedLinks += 1;
            context.pendingUrls.add(next.canonicalUrl);
            stack.push({
              url: next.canonicalUrl,
              depth: item.depth + 1,
              parentUrl: decision.canonicalUrl,
              source: link.sourceElementId ?? (link.text || "link"),
            });
          } else {
            skippedLinks += 1;
            context.skippedUrls.set(candidateUrl, next.reason ?? "duplicate-or-visited");
          }
        }
        context.diagnostics.crawl.events.push({
          name: "Links discovered",
          status: "INFO",
          timestamp: new Date().toISOString(),
          url: decision.canonicalUrl,
          message: `${links.length} candidates, ${acceptedLinks} accepted, ${skippedLinks} skipped.`,
        });
      } catch (error) {
        const message = errorMessage(error);
        context.failedUrls.set(item.url, message);
        context.pageReports.push({
          url: item.url,
          canonicalUrl: decision.canonicalUrl,
          role: context.roleName,
          viewport: context.viewportName,
          locale: context.localeName,
          direction: context.direction,
          status: "ERROR",
          tests: [
            {
              id: "page-navigation-or-test-failure",
              name: "Page navigation or page-level test failure",
              type: "SMOKE",
              status: "ERROR",
              steps: [],
              assertions: [],
              expectedResult: "Page navigates and receives per-page testing.",
              actualResult: message,
              error: message,
              evidence: [],
              reproductionSteps: [`Navigate to ${item.url}`],
              severity: "MEDIUM",
              confidence: 0.9,
            },
          ],
          consoleErrors: [],
          failedNetworkRequests: [],
          performanceObservations: [],
          evidence: [],
          skippedReason: message,
        });
      }
    }
  }
}
