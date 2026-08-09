import { EmptyState } from "@/components/shared/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import type { TestingRunResponse } from "@/lib/api/types";

export function DiagnosticsPanel({ report }: { report: TestingRunResponse }) {
  const diagnostics = report.diagnostics;
  const onlyOnePage = report.summary.pagesDiscovered === 1;
  const onlyOneTest = report.summary.testsExecuted === 1;
  const firstFailedTest = report.pages.flatMap((page) => page.tests).find((test) => test.status === "FAILED" || test.status === "ERROR");

  if (!diagnostics) {
    return (
      <EmptyState
        title="Diagnostics unavailable"
        description="This report was generated before backend diagnostics were added. Run a new test after restarting the backend."
      />
    );
  }

  return (
    <div className="space-y-4">
      {(onlyOnePage || onlyOneTest || diagnostics.ai.disabled || diagnostics.ai.openRouterConfigured === false || diagnostics.ai.modelConfigured === false || diagnostics.ai.failures.length > 0) ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {onlyOnePage ? <p>Only the starting page was accepted for crawl.</p> : null}
          {onlyOneTest && firstFailedTest ? <p className="mt-1">Only one test was recorded: {firstFailedTest.name}. Error: {firstFailedTest.error ?? firstFailedTest.actualResult ?? "No error detail returned."}</p> : null}
          {diagnostics.ai.disabled ? <p className="mt-1">AI planning was disabled because the backend AI call budget was 0.</p> : null}
          {diagnostics.ai.openRouterConfigured === false || diagnostics.ai.modelConfigured === false ? <p className="mt-1">OpenRouter is not fully configured, so AI test generation cannot run yet.</p> : null}
          {diagnostics.ai.failures.length > 0 ? <p className="mt-1">AI planning failed on at least one page. Check OpenRouter key/model, structured JSON support, and backend logs.</p> : null}
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
            <Row label="Failed URLs" value={`${diagnostics.crawl.failedUrls.length}`} />
            <Row label="Candidates" value={`${diagnostics.crawl.discoveredCandidates}`} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>AI planning</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Budget" value={`${diagnostics.ai.maxCalls ?? "Unknown"}`} />
            <Row label="Enabled" value={diagnostics.ai.disabled ? "No" : "Yes"} />
            <Row label="OpenRouter key" value={diagnostics.ai.openRouterConfigured === false ? "Missing" : "Configured"} />
            <Row label="Models" value={diagnostics.ai.modelConfigured === false ? "Missing" : diagnostics.ai.models?.join(", ") ?? "Configured"} />
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
        <CardHeader><CardTitle>Skipped and failed crawl decisions</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {[...diagnostics.crawl.skippedUrls.slice(0, 25), ...diagnostics.crawl.failedUrls.slice(0, 25)].length === 0 ? (
            <p className="text-muted-foreground">No skipped or failed crawl decisions were recorded.</p>
          ) : (
            [...diagnostics.crawl.skippedUrls.slice(0, 25), ...diagnostics.crawl.failedUrls.slice(0, 25)].map((item) => (
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b pb-1 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
