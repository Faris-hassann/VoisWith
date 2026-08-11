import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AboutPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">About</h1>
        <p className="mt-1 text-sm text-muted-foreground">A local prototype for authorized functional website testing.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Safety and limitations</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Use this only for systems you own or are explicitly authorized to test.</p>
          <p>The frontend never calls OpenRouter directly and never runs Playwright. AI planning and browser automation stay inside the Express backend.</p>
          <p>No exploitative penetration testing, real payments, destructive actions, password changes, permission changes, or security bypassing are performed by default.</p>
          <p>Progress percentages, history, polling, and export endpoints are not invented because the backend does not expose them yet.</p>
        </CardContent>
      </Card>
    </div>
  );
}
