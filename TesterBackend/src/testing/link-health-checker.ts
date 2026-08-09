import type { Page } from "playwright";
import { config } from "../config/env.js";
import { assertSafeTargetUrl } from "../security/ssrf-protection.js";
import type { IssueSeverity, TestCaseResult, TestStatus } from "../types/report.js";
import type { LinkSnapshot, TestingRunRequest } from "../types/testing.js";
import type { TestingType } from "./test-types.js";
import { severityForServerError } from "../reporting/severity.js";

const MAX_LINKS_PER_PAGE = 300;

interface LinkHealthInput {
  page: Page;
  links: LinkSnapshot[];
  targetOrigin: string;
  request: TestingRunRequest;
}

export async function buildLinkHealthTests(input: LinkHealthInput): Promise<TestCaseResult[]> {
  if (!input.request.testTypes.includes("LINKS")) return [];

  const uniqueLinks = dedupeLinks(input.links).slice(0, MAX_LINKS_PER_PAGE);
  if (uniqueLinks.length === 0) {
    return [
      linkResult({
        id: "link-health-none",
        name: "Observed link health",
        status: "SKIPPED",
        expected: "Links are checked when present on the page.",
        actual: "No links were detected on this page.",
      }),
    ];
  }

  const results: TestCaseResult[] = [];
  for (const [index, link] of uniqueLinks.entries()) {
    results.push(await checkLink(input, link, index));
  }
  return results;
}

async function checkLink(input: LinkHealthInput, link: LinkSnapshot, index: number): Promise<TestCaseResult> {
  const targetUrl = link.canonicalHref ?? link.href;
  const linkLabel = link.text ? `Link "${link.text.slice(0, 80)}"` : "Untitled link";

  if (!/^https?:\/\//i.test(targetUrl)) {
    return linkResult({
      id: `link-health-${index + 1}`,
      name: linkLabel,
      status: "SKIPPED",
      expected: "HTTP(S) links are reachable.",
      actual: `Skipped non-HTTP link: ${targetUrl}`,
      href: targetUrl,
    });
  }

  const url = new URL(targetUrl);
  if (input.request.crawl.sameOriginOnly && url.origin !== input.targetOrigin) {
    return linkResult({
      id: `link-health-${index + 1}`,
      name: linkLabel,
      status: "SKIPPED",
      expected: "In-scope links are reachable.",
      actual: `Skipped external link while same-origin testing is enabled: ${targetUrl}`,
      href: targetUrl,
    });
  }

  try {
    await assertSafeTargetUrl(targetUrl, config.security);
    const response = await input.page.context().request.get(targetUrl, {
      failOnStatusCode: false,
      maxRedirects: 5,
      timeout: 10_000,
    });
    const statusCode = response.status();
    const status: TestStatus = statusCode >= 200 && statusCode < 400 ? "PASSED" : "FAILED";
    return linkResult({
      id: `link-health-${index + 1}`,
      name: linkLabel,
      status,
      expected: "Link returns a successful or redirect HTTP status.",
      actual: `${targetUrl} returned HTTP ${statusCode}.`,
      href: targetUrl,
      // §8 rates a 5xx HIGH; a 4xx stays at the default MEDIUM for a broken link.
      severity: statusCode >= 500 ? severityForServerError() : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return linkResult({
      id: `link-health-${index + 1}`,
      name: linkLabel,
      status: "FAILED",
      expected: "Link can be requested safely and returns a successful status.",
      actual: `${targetUrl} failed link check: ${message}`,
      href: targetUrl,
    });
  }
}

function dedupeLinks(links: LinkSnapshot[]): LinkSnapshot[] {
  const seen = new Set<string>();
  const unique: LinkSnapshot[] = [];
  for (const link of links) {
    const key = link.canonicalHref ?? link.href;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(link);
  }
  return unique;
}

function linkResult(input: {
  id: string;
  name: string;
  status: TestStatus;
  expected: string;
  actual: string;
  href?: string;
  /** Overrides the status-derived rating with an explicit §8 table value. */
  severity?: IssueSeverity;
}): TestCaseResult {
  return {
    id: input.id,
    name: input.name,
    type: "LINKS" satisfies TestingType,
    status: input.status,
    priority: "MEDIUM",
    steps: [
      {
        action: {
          action: "ASSERT_RESPONSE_STATUS",
          description: "Deterministic link health check",
          value: input.href,
        },
        status: input.status,
        expectedResult: input.expected,
        actualResult: input.actual,
      },
    ],
    assertions: [],
    expectedResult: input.expected,
    actualResult: input.actual,
    error: ["FAILED", "ERROR"].includes(input.status) ? input.actual : undefined,
    evidence: [],
    reproductionSteps: ["Navigate to page", `Check link destination${input.href ? `: ${input.href}` : ""}`],
    severity: input.severity ?? (input.status === "FAILED" ? "MEDIUM" : input.status === "SKIPPED" ? "INFORMATIONAL" : undefined),
    confidence: input.status === "PASSED" ? 0.9 : 0.75,
  };
}
