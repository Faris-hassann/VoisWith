import { env } from "@/lib/environment/env";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Frontend API and prototype preferences.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>API connection</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <Row label="API base URL" value={env.apiBaseUrl} />
          <Row label="Docs URL" value={env.apiDocsUrl} />
          <Row label="Test endpoint" value={env.testRunEndpoint} />
          <Row label="API mode" value={env.apiMode} />
          <Row label="Mock mode" value={env.mockMode ? "Enabled" : "Disabled"} />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex flex-wrap justify-between gap-3 border-b pb-2 last:border-b-0"><span className="text-muted-foreground">{label}</span><span className="font-mono">{value}</span></div>;
}
