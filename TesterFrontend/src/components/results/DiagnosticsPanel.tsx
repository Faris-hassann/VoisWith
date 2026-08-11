import { EmptyState } from "@/components/shared/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import type { TestingRunResponse } from "@/lib/api/types";

export function DiagnosticsPanel({ report }: { report: TestingRunResponse }) {
  const diagnostics = report.diagnostics;
  const onlyOnePage = report.summary.pagesDiscovered === 1;
  const onlyOneTest = report.summary.testsExecuted === 1;
  const firstFailedTest = report.pages.flatMap((page) => page.tests).find((test) => test.status === "FAILED" || test.status === "ERROR");

  const providerConfigured = diagnostics?.ai.providerConfigured;

  if (!diagnostics) {
    return (
      <EmptyState
        title="Diagnostics unavailable"
        description="This report was generated before backend diagnostics were added. Run a new test after restarting the backend."
      />
    );
  }

  const latestAiFailure = diagnostics.ai.failures.at(-1);

  return (
    <div className="space-y-4">
      {(onlyOnePage || onlyOneTest || diagnostics.ai.disabled || providerConfigured === false || diagnostics.ai.failures.length > 0) ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {onlyOnePage ? <p>Only the starting page was accepted for crawl.</p> : null}
          {onlyOneTest && firstFailedTest ? <p className="mt-1">Only one test was recorded: {firstFailedTest.name}. Error: {firstFailedTest.error ?? firstFailedTest.actualResult ?? "No error detail returned."}</p> : null}
          {diagnostics.ai.disabled ? <p className="mt-1">AI planning was disabled because the backend AI call budget was 0.</p> : null}
          {providerConfigured === false ? <p className="mt-1">OpenRouter is not configured, so AI test generation is being skipped and deterministic planning is used instead.</p> : null}
          {diagnostics.ai.failures.length > 0 ? <p className="mt-1">{describeAiFailure(latestAiFailure?.reason, latestAiFailure?.message)}</p> : null}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Run</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Target" value={diagnostics.targetUrl} />
            <Row label="Final URL" value={diagnostics.finalUrl ?? "Not captured"} />
            <Row label="Browser" value={diagnostics.browser.launched ? "Launched" : diagnostics.browser.error ?? "Not launched"} />
            <Row label="Login" value={`${diagnostics.login.status}: ${diagnostics.login.message}`} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Crawl</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Accepted URLs" value={`${diagnostics.crawl.acceptedUrls.length}`} />
            <Row label="Skipped URLs" value={`${diagnostics.crawl.skippedUrls.length}`} />
            <Row label="External URLs" value={`${diagnostics.crawl.externalUrls?.length ?? 0}`} />
            <Row label="Failed URLs" value={`${diagnostics.crawl.failedUrls.length}`} />
            <Row label="Candidates" value={`${diagnostics.crawl.discoveredCandidates}`} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>AI planning</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Budget" value={`${diagnostics.ai.maxCalls ?? "Unknown"}`} />
            <Row label="Enabled" value={diagnostics.ai.disabled ? "No" : "Yes"} />
            <Row label="Provider" value={diagnostics.ai.provider ?? "legacy"} />
            <Row label="OpenRouter key" value={providerConfigured === false ? "Missing" : latestAiFailure?.reason === "llm_unavailable" && latestAiFailure.message?.includes("credential is configured but was rejected") ? "Rejected" : "Configured"} />
            <Row label="Calls" value={`${diagnostics.ai.calls}`} />
            <Row label="Successes" value={`${diagnostics.ai.successes}`} />
            <Row label="Failures" value={`${diagnostics.ai.failures.length}`} />
            <Row label="Validation failures" value={`${diagnostics.ai.validationFailures.length}`} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Page diagnostics</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2">Status</th>
                <th>URL</th>
                <th>Links</th>
                <th>Forms</th>
                <th>Controls</th>
                <th>Baseline</th>
                <th>AI planned</th>
                <th>Artifact</th>
              </tr>
            </thead>
            <tbody>
              {diagnostics.pages.map((page) => (
                <tr key={page.url} className="border-t">
                  <td className="py-2"><StatusBadge value={page.status} /></td>
                  <td className="font-mono text-xs">{page.url}</td>
                  <td>{page.internalLinks}/{page.links}</td>
                  <td>{page.forms}</td>
                  <td>{page.buttons + page.inputs}</td>
                  <td>{page.baselineTests}</td>
                  <td>{page.aiPlannedTests}</td>
                  <td className="font-mono text-xs">{page.reportArtifactPath ?? "Not written"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Skipped, external, and failed crawl decisions</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {[...diagnostics.crawl.skippedUrls.slice(0, 25), ...(diagnostics.crawl.externalUrls ?? []).slice(0, 25).map((item) => ({ url: item.url, reason: "external-link-observed" })), ...diagnostics.crawl.failedUrls.slice(0, 25)].length === 0 ? (
            <p className="text-muted-foreground">No skipped, external, or failed crawl decisions were recorded.</p>
          ) : (
            [...diagnostics.crawl.skippedUrls.slice(0, 25), ...(diagnostics.crawl.externalUrls ?? []).slice(0, 25).map((item) => ({ url: item.url, reason: item.sourceUrl ? `external-link-observed from ${item.sourceUrl}` : "external-link-observed" })), ...diagnostics.crawl.failedUrls.slice(0, 25)].map((item) => (
              <div key={`${item.url}-${item.reason}`} className="rounded border p-2">
                <div className="font-mono text-xs">{item.url}</div>
                <div className="mt-1 text-muted-foreground">{item.reason}</div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function describeAiFailure(reason?: string, message?: string): string {
  if (reason === "llm_unavailable" && message?.includes("credential is configured but was rejected")) {
    return "OpenRouter rejected the current credential. Replace OPENROUTER_API_KEY and restart the backend before expecting AI-generated cases.";
  }
  if (reason === "llm_rate_limited") {
    return "OpenRouter rate-limited at least one planning batch. Deterministic planning covered the affected forms.";
  }
  if (reason === "llm_transport_error") {
    if (message?.includes("message_too_long") || message?.includes("message limit")) {
      return "OpenRouter rejected an oversized planning request. Deterministic planning covered the affected forms.";
    }
    if (/timed out/i.test(message ?? "")) {
      return "An OpenRouter model did not return within the configured five-minute window. Deterministic planning covered the affected forms.";
    }
    return "OpenRouter timed out or could not be reached for at least one planning batch. Deterministic planning covered the affected forms.";
  }
  if (reason === "llm_invalid_json") {
    return "OpenRouter returned invalid JSON for at least one planning batch. Deterministic planning covered the affected forms.";
  }
  if (reason === "llm_schema_invalid") {
    return "OpenRouter returned a schema-invalid planning payload for at least one batch. Deterministic planning covered the affected forms.";
  }
  return "AI planning failed on at least one page. Check the OpenRouter credential, model, response shape, timeout, or provider availability in backend logs.";
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b pb-1 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
