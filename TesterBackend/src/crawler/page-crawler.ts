import { ScopePolicy } from "./scope-policy.js";
import type { RunContext } from "../testing/run-context.js";
import type { PageReport } from "../types/report.js";
import type { LinkSnapshot } from "../types/testing.js";
import { isDeadlineExceeded } from "../utilities/timeout.js";
import { routeFamily } from "../utilities/route-family.js";
import { errorMessage } from "../errors/serialize-error.js";

interface CrawlItem {
  url: string;
  normalizedUrl: string;
  depth: number;
  parentUrl?: string;
  discoveredByElementId?: string;
  navigationPath: string[];
  authenticationState: "anonymous" | "authenticated";
  role?: string;
  source: string;
}

export interface CrawledPageResult {
  report: PageReport;
  links: LinkSnapshot[];
  stateFingerprint?: string;
}

/** DESIGN-DECISIONS.md §9. */
const MAX_INSTANCES_PER_ROUTE_FAMILY = 3;

export class PageCrawler {
  async crawl(input: {
    context: RunContext;
    testPage: (url: string) => Promise<CrawledPageResult>;
  }): Promise<void> {
    const { context, testPage } = input;
    const discoveredUrls = context.discoveredUrls ??= new Set();
    const visitedStates = context.visitedStates ??= new Set();
    const pendingCrawlItems = context.pendingCrawlItems ??= new Set();
    const processedInteractions = context.processedInteractions ??= new Set();
    const routeFamilies = context.routeFamilies ??= new Map();
    // Depth-pruned URLs use `continue`, not `break`, so a depth limit can never
    // itself trip the loop's exit condition. Tracked separately so a crawl that
    // exhausts its stack only because deeper items were pruned reports
    // depth_budget rather than the more optimistic converged.
    let depthLimited = false;
    const policy = new ScopePolicy({
      targetOrigin: context.targetOrigin,
      sameOriginOnly: context.request.crawl.sameOriginOnly,
      includePatterns: context.request.crawl.includePatterns,
      excludePatterns: context.request.crawl.excludePatterns,
      allowedOrigins: context.request.allowedOrigins,
      includeSubdomains: context.request.includeSubdomains ?? false,
      ignoredQueryParameters: context.request.crawl.ignoredQueryParameters,
    });
    const seed = policy.evaluate(context.request.targetUrl);
    const stack: CrawlItem[] = seed.allowed && seed.canonicalUrl
      ? [{
          url: seed.canonicalUrl,
          normalizedUrl: seed.canonicalUrl,
          depth: 0,
          source: "seed",
          navigationPath: [seed.canonicalUrl],
          authenticationState: context.request.credentials ? "authenticated" : "anonymous",
          role: context.roleName,
        }]
      : [];
    if (seed.canonicalUrl) {
      discoveredUrls.add(seed.canonicalUrl);
      context.pendingUrls.add(seed.canonicalUrl);
      pendingCrawlItems.add(seed.canonicalUrl);
    }
    context.diagnostics.crawl.events.push({
      name: "Crawler initialized",
      status: seed.allowed ? "PASSED" : "FAILED",
      timestamp: new Date().toISOString(),
      url: seed.canonicalUrl ?? context.request.targetUrl,
      message: seed.allowed ? "Seed URL accepted for DFS crawl." : (seed.reason ?? "Seed URL rejected."),
    });

    while (stack.length > 0) {
      if (context.control?.isStopped()) {
        context.diagnostics.crawl.events.push({
          name: "Crawler stopped",
          status: "SKIPPED",
          timestamp: new Date().toISOString(),
          message: "Run was stopped by request.",
        });
        context.stoppedReason = "user_stopped";
        break;
      }
      await context.control?.waitWhilePaused();
      if (isDeadlineExceeded(context.deadlineMs)) {
        context.diagnostics.crawl.events.push({
          name: "Crawler stopped",
          status: "SKIPPED",
          timestamp: new Date().toISOString(),
          message: "Run deadline exceeded.",
        });
        context.stoppedReason = "time_budget";
        break;
      }
      if (context.request.crawl.maxPages !== undefined && context.visitedUrls.size >= context.request.crawl.maxPages) {
        context.diagnostics.crawl.events.push({
          name: "Crawler stopped",
          status: "SKIPPED",
          timestamp: new Date().toISOString(),
          message: `Maximum page limit reached: ${context.request.crawl.maxPages}.`,
        });
        context.stoppedReason = "page_budget";
        break;
      }
      const item = stack.pop();
      if (!item) continue;
      context.pendingUrls.delete(item.url);
      pendingCrawlItems.delete(item.normalizedUrl);
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
      if (context.request.crawl.maxDepth !== undefined && item.depth > context.request.crawl.maxDepth) {
        depthLimited = true;
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
      const family = routeFamily(decision.canonicalUrl, context.request.crawl.ignoredQueryParameters ?? []);
      // DESIGN-DECISIONS.md §9 caps instances per route family, so a listing of
      // 400 products costs 3 page visits rather than 400. Checked before
      // testPage so the budget saves the work, not just the bookkeeping.
      const familyVisits = routeFamilies.get(family) ?? 0;
      if (familyVisits >= MAX_INSTANCES_PER_ROUTE_FAMILY) {
        context.skippedUrls.set(decision.canonicalUrl, `route-family-limit:${family}`);
        context.diagnostics.crawl.events.push({
          name: "Route family limit reached",
          status: "SKIPPED",
          timestamp: new Date().toISOString(),
          url: decision.canonicalUrl,
          message: `Already visited ${familyVisits} instance(s) of route family ${family}.`,
        });
        continue;
      }

      try {
        const result = await testPage(decision.canonicalUrl);
        const report = result.report;
        // §9: crawl state is keyed on route family + DOM structure hash, not the
        // raw URL — two URLs in the same family rendering the same structure are
        // the same state regardless of their ids.
        const stateKey = `${family}#${result.stateFingerprint ?? "default"}`;
        if (visitedStates.has(stateKey)) {
          context.skippedUrls.set(decision.canonicalUrl, "duplicate-state");
          context.diagnostics.crawl.events.push({
            name: "State skipped",
            status: "SKIPPED",
            timestamp: new Date().toISOString(),
            url: decision.canonicalUrl,
            message: "Duplicate route family and DOM structure hash.",
          });
          continue;
        }
        context.pageReports.push(report);
        context.visitedUrls.add(decision.canonicalUrl);
        visitedStates.add(stateKey);
        routeFamilies.set(family, familyVisits + 1);
        const links = result.links;
        context.diagnostics.crawl.discoveredCandidates += links.length;
        let acceptedLinks = 0;
        let skippedLinks = 0;
        for (const link of links.reverse()) {
          const candidateUrl = link.canonicalHref ?? link.href;
          const interactionKey = `${decision.canonicalUrl}:${link.sourceElementId ?? link.text}:${candidateUrl}`;
          if (processedInteractions.has(interactionKey)) {
            skippedLinks += 1;
            continue;
          }
          processedInteractions.add(interactionKey);
          const next = policy.evaluate(candidateUrl, decision.canonicalUrl);
          // A link that is already visited or already queued is not "skipped" —
          // it is accounted for elsewhere and will be (or has been) tested.
          // Only a scope-policy rejection is a real skip; conflating the two
          // made skippedUrls useless as a coverage signal, since fully-tested
          // pages showed up in it purely for being linked twice.
          const alreadyAccountedFor =
            !!next.canonicalUrl &&
            (context.visitedUrls.has(next.canonicalUrl) ||
              context.pendingUrls.has(next.canonicalUrl) ||
              pendingCrawlItems.has(next.canonicalUrl));
          if (next.allowed && next.canonicalUrl && !alreadyAccountedFor) {
            acceptedLinks += 1;
            discoveredUrls.add(next.canonicalUrl);
            context.pendingUrls.add(next.canonicalUrl);
            pendingCrawlItems.add(next.canonicalUrl);
            stack.push({
              url: next.canonicalUrl,
              normalizedUrl: next.canonicalUrl,
              depth: item.depth + 1,
              parentUrl: decision.canonicalUrl,
              discoveredByElementId: link.sourceElementId,
              navigationPath: [...item.navigationPath, next.canonicalUrl],
              authenticationState: item.authenticationState,
              role: item.role,
              source: link.sourceElementId ?? (link.text || "link"),
            });
          } else {
            skippedLinks += 1;
            if (!alreadyAccountedFor) {
              context.skippedUrls.set(candidateUrl, next.reason ?? "out-of-scope");
            }
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
    if (stack.length === 0) {
      // The loop's own invariant guarantees this only happens on natural
      // exhaustion: every budget/stop exit above breaks while stack.length > 0.
      context.stoppedReason = depthLimited ? "depth_budget" : "converged";
      context.diagnostics.crawl.events.push({
        name: depthLimited ? "Crawler converged (depth-limited)" : "Crawler converged",
        status: "PASSED",
        timestamp: new Date().toISOString(),
        message: depthLimited
          ? "DFS stack empty, but URLs beyond the configured max depth were pruned."
          : "DFS stack empty; no pending URL crawl items remain.",
      });
    } else {
      // A budget or stop request ended the crawl with work still queued. Those
      // pages were never visited and never will be — recording them is what
      // makes a truncated crawl distinguishable from a complete one.
      const reason = `not-reached:${context.stoppedReason ?? "unknown"}`;
      const unreached = new Set(stack.map((queued) => queued.url));
      for (const url of unreached) {
        context.skippedUrls.set(url, reason);
      }
      context.diagnostics.crawl.unreachedUrls = [...unreached];
      context.diagnostics.crawl.events.push({
        name: "Crawler left URLs unreached",
        status: "SKIPPED",
        timestamp: new Date().toISOString(),
        message: `${unreached.size} queued URL(s) were never visited because the crawl stopped (${context.stoppedReason ?? "unknown"}).`,
      });
    }
  }
}

