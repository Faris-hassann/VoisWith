"use client";

import { Download, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { TestingRunResponse } from "@/lib/api/types";
import { redactSecrets } from "@/lib/security/redact";

export function RawReportViewer({ report }: { report: TestingRunResponse }) {
  const json = JSON.stringify(redactSecrets(report), null, 2);
  const download = () => {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `web-test-report-${report.runId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(json).then(() => toast.success("Copied report JSON"))}>
          <Copy className="h-4 w-4" /> Copy
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={download}>
          <Download className="h-4 w-4" /> Download JSON
        </Button>
      </div>
      <pre className="max-h-[620px] overflow-auto rounded-lg border bg-slate-950 p-4 text-xs text-slate-100">{json}</pre>
    </div>
  );
}
