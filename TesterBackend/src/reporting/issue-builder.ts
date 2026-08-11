import type { ConsoleObservation, Issue, NetworkObservation, PageReport, TestCaseResult } from "../types/report.js";
import type { TestingType } from "../testing/test-types.js";

interface GroupedObservation {
  fingerprint: string;
  severity: Issue["severity"];
  title: string;
  description: string;
  evidence: Issue["evidence"];
  confidence: number;
  pageUrl?: string;
  role?: string;
  viewport?: string;
  locale?: string;
  testName?: string;
  relatedTestTypes: TestingType[];
}

export function buildIssuesFromPages(pages: PageReport[]): Issue[] {
  const grouped = new Map<string, GroupedObservation[]>();
  const passthrough: GroupedObservation[] = [];

  for (const page of pages) {
    const correlated = collectCorrelatedPageObservations(page);
    const consumedTypes = new Set<TestingType>();
    for (const observation of correlated) {
      grouped.set(observation.fingerprint, [...(grouped.get(observation.fingerprint) ?? []), observation]);
      for (const type of observation.relatedTestTypes) consumedTypes.add(type);
    }

    for (const test of page.tests) {
      if (!isFailedTest(test)) continue;
      if (consumedTypes.has(test.type)) continue;
      passthrough.push(buildTestFailureObservation(page, test));
    }
  }

  const groupedIssues = [...grouped.entries()].map(([fingerprint, occurrences], index) =>
    toGroupedIssue(`issue_${index + 1}`, fingerprint, occurrences)
  );
  const passthroughIssues = passthrough.map((observation, index) =>
    toGroupedIssue(`issue_${groupedIssues.length + index + 1}`, observation.fingerprint, [observation])
  );
  return [...groupedIssues, ...passthroughIssues];
}

function collectCorrelatedPageObservations(page: PageReport): GroupedObservation[] {
  const observations: GroupedObservation[] = [];
  const remainingConsole = [...page.consoleErrors];

  for (const network of page.failedNetworkRequests) {
    const normalizedUrl = normalizeUrl(network.url);
    const correlatedConsole = remainingConsole.find((item) => normalizeConsoleUrl(item) === normalizedUrl && isFailedResourceConsole(item));
    if (correlatedConsole) {
      remainingConsole.splice(remainingConsole.indexOf(correlatedConsole), 1);
    }
    observations.push({
      fingerprint: buildObservationFingerprint(network, correlatedConsole),
      severity: "MEDIUM",
      title: correlatedConsole ? "Failed resource request observed in network and console" : "Failed resource request observed",
      description: describeObservation(network, correlatedConsole),
      evidence: [],
      confidence: correlatedConsole ? 0.95 : 0.85,
      pageUrl: page.url,
      role: page.role,
      viewport: page.viewport,
      locale: page.locale,
      testName: correlatedConsole ? "Observed API and network behavior + Console error check" : "Observed API and network behavior",
      relatedTestTypes: correlatedConsole ? ["API_NETWORK", "CONSOLE_ERRORS"] : ["API_NETWORK"],
    });
  }

  for (const consoleItem of remainingConsole) {
    observations.push({
      fingerprint: `console|${normalizeConsoleSignature(consoleItem)}`,
      severity: "MEDIUM",
      title: "Browser console error observed",
      description: consoleItem.text,
      evidence: [],
      confidence: 0.8,
      pageUrl: page.url,
      role: page.role,
      viewport: page.viewport,
      locale: page.locale,
      testName: "Console error check",
      relatedTestTypes: ["CONSOLE_ERRORS"],
    });
  }

  return observations;
}

function buildObservationFingerprint(network: NetworkObservation, consoleItem?: ConsoleObservation): string {
  const normalizedUrl = normalizeUrl(network.url);
  const method = network.method.toUpperCase();
  const status = network.status ? `status:${network.status}` : `failure:${network.failureReason ?? "unknown"}`;
  const observationClass = consoleItem ? "network+console" : "network";
  return `${observationClass}|${method}|${status}|${normalizedUrl}`;
}

function describeObservation(network: NetworkObservation, consoleItem?: ConsoleObservation): string {
  const status = network.status ? `HTTP ${network.status}` : network.failureReason ?? "request failure";
  const base = `${network.method.toUpperCase()} ${network.url} returned ${status}.`;
  return consoleItem ? `${base} Console reported: ${consoleItem.text}` : base;
}

function normalizeUrl(input: string): string {
  try {
    const value = new URL(input);
    const params = [...value.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
    );
    value.search = "";
    for (const [key, val] of params) value.searchParams.append(key, val);
    value.hash = "";
    return value.toString();
  } catch {
    return input.trim();
  }
}

function normalizeConsoleUrl(item: ConsoleObservation): string | undefined {
  const match = item.text.match(/https?:\/\/\S+/i);
  return match ? normalizeUrl(match[0].replace(/[),.;]+$/, "")) : undefined;
}

function normalizeConsoleSignature(item: ConsoleObservation): string {
  return `${item.type.toLowerCase()}|${item.text.trim().toLowerCase()}`;
}

function isFailedResourceConsole(item: ConsoleObservation): boolean {
  return /failed to load resource/i.test(item.text);
}

function buildTestFailureObservation(page: PageReport, test: TestCaseResult): GroupedObservation {
  const pageScope = [page.url, page.role, page.viewport, page.locale].filter(Boolean).join("|");
  return {
    fingerprint: `test|${test.type}|${test.name}|${test.error ?? test.actualResult ?? "failed"}|${pageScope}`,
    severity: test.severity ?? "MEDIUM",
    title: test.name,
    description: test.error ?? test.actualResult ?? "Test failed.",
    evidence: test.evidence,
    confidence: test.confidence ?? 0.7,
    pageUrl: page.url,
    role: page.role,
    viewport: page.viewport,
    locale: page.locale,
    testName: test.name,
    relatedTestTypes: [test.type],
  };
}

function isFailedTest(test: TestCaseResult): boolean {
  return test.status === "FAILED" || test.status === "ERROR";
}

function toGroupedIssue(id: string, fingerprint: string, occurrences: GroupedObservation[]): Issue {
  const first = occurrences[0]!;
  const pages = [...new Set(occurrences.map((item) => item.pageUrl).filter((value): value is string => Boolean(value)))];
  const relatedTestTypes = [...new Set(occurrences.flatMap((item) => item.relatedTestTypes))];
  return {
    id,
    fingerprint,
    occurrenceCount: occurrences.length,
    failedTestCount: occurrences.reduce((sum, item) => sum + item.relatedTestTypes.length, 0),
    affectedPages: pages,
    relatedTestTypes,
    severity: first.severity,
    title: first.title,
    description: first.description,
    pageUrl: first.pageUrl,
    role: first.role,
    viewport: first.viewport,
    locale: first.locale,
    testName: first.testName,
    evidence: first.evidence,
    confidence: first.confidence,
  };
}
