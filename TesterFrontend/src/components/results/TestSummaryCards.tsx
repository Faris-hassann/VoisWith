import type { RunSummary } from "@/lib/api/types";
import { Card, CardContent } from "@/components/ui/card";

const fields: Array<{ key: keyof RunSummary; label: string }> = [
  { key: "pagesDiscovered", label: "Pages discovered" },
  { key: "pagesTested", label: "Pages tested" },
  { key: "pagesSkipped", label: "Pages skipped" },
  { key: "testsExecuted", label: "Tests executed" },
  { key: "passedTests", label: "Passed" },
  { key: "failedTests", label: "Failed" },
  { key: "skippedTests", label: "Skipped" },
  { key: "blockedByPolicy", label: "Blocked" },
  { key: "inconclusiveTests", label: "Inconclusive" },
  { key: "consoleErrors", label: "Console errors" },
  { key: "failedNetworkRequests", label: "Network failures" },
];

export function TestSummaryCards({ summary }: { summary: RunSummary }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
      {fields.map((field) => (
        <Card key={field.key}>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">{field.label}</div>
            <div className="mt-2 text-2xl font-semibold">{summary[field.key]}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
