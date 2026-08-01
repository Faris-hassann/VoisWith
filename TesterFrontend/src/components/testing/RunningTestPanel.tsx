"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TestingFormValues } from "@/lib/schemas/testing-run.schema";

export function RunningTestPanel({ values, elapsedSeconds, onCancel }: { values: TestingFormValues; elapsedSeconds: number; onCancel: () => void }) {
  return (
    <div className="rounded-lg border bg-card p-6 shadow-lg" aria-live="polite">
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <div>
          <h2 className="font-semibold">Test is running</h2>
          <p className="text-sm text-muted-foreground">Chrome may have opened on the backend machine.</p>
        </div>
      </div>
      <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Info label="Target" value={values.targetUrl || "Configured target"} />
        <Info label="Elapsed" value={`${elapsedSeconds}s`} />
        <Info label="Safety mode" value={values.execution.safeMode ? "Enabled" : "Disabled"} />
        <Info label="Request state" value="Waiting for completed backend report" />
        <Info label="Pages limit" value={`${values.crawl.maxPages}`} />
        <Info label="Actions/page" value={`${values.execution.maximumActionsPerPage}`} />
      </div>
      <div className="mt-5 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        {["Connecting to backend", "Starting isolated browser", "Discovering pages", "Planning tests", "Executing tests", "Building report"].map((phase) => (
          <div key={phase} className="rounded border bg-background px-3 py-2">{phase}</div>
        ))}
      </div>
      <div className="mt-5">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel frontend request</Button>
        <p className="mt-2 text-xs text-muted-foreground">Cancelling this browser request may not stop backend execution unless a cancellation endpoint is later added.</p>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-medium">{value}</div>
    </div>
  );
}
