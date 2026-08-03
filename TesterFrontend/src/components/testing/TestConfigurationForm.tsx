"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, type FieldPath } from "react-hook-form";
import { toast } from "sonner";
import { ApiErrorAlert } from "@/components/shared/ApiErrorAlert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { startWebsiteTest } from "@/lib/api/testing.api";
import { defaultFormValues, testingFormSchema, type TestingFormValues } from "@/lib/schemas/testing-run.schema";
import { buildTestingPayload } from "@/lib/testing/payload";
import { TestingTypesSelector } from "./TestingTypesSelector";

export function TestConfigurationForm() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<unknown>();
  const form = useForm<TestingFormValues>({
    resolver: zodResolver(testingFormSchema),
    defaultValues: defaultFormValues,
    mode: "onBlur",
  });
  const authEnabled = form.watch("authenticationEnabled");
  const values = form.watch();

  const onSubmit = form.handleSubmit(async (formValues) => {
    setError(undefined);
    const payload = buildTestingPayload(formValues);
    form.setValue("credentials.password", "");
    setIsStarting(true);
    try {
      const run = await startWebsiteTest(payload);
      toast.success("Test run started");
      router.push(`/testing/running/${run.runId}`);
    } catch (caught) {
      setError(caught);
      toast.error("Test run could not be started");
    } finally {
      setIsStarting(false);
      form.setValue("credentials.password", "");
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {error ? <ApiErrorAlert error={error} /> : null}
      <Card>
        <CardHeader><CardTitle>1. Target</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <Field label="Target URL" error={form.formState.errors.targetUrl?.message}>
            <input className="w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="https://example.com" {...form.register("targetUrl")} />
          </Field>
          <Field label="Allowed origins">
            <textarea className="min-h-16 w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="Leave blank to use the target origin" {...form.register("allowedOriginsText")} />
          </Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...form.register("includeSubdomains")} /> Include subdomains of allowed origins</label>
          <p className="text-xs text-muted-foreground">HTTPS is preferred. Localhost and private-network targets may be rejected by backend SSRF protection.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>2. Authentication</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={authEnabled} onChange={(event) => form.setValue("authenticationEnabled", event.target.checked)} />
            <span className="text-sm font-medium">This website requires login.</span>
          </label>
          {authEnabled ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Login URL" error={form.formState.errors.credentials?.loginUrl?.message}>
                <input className="w-full rounded-md border bg-background px-3 py-2 text-sm" {...form.register("credentials.loginUrl")} />
              </Field>
              <Field label="Username or email" error={form.formState.errors.credentials?.username?.message}>
                <input className="w-full rounded-md border bg-background px-3 py-2 text-sm" autoComplete="off" {...form.register("credentials.username")} />
              </Field>
              <Field label="Password" error={form.formState.errors.credentials?.password?.message}>
                <div className="flex rounded-md border bg-background">
                  <input className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none" type={showPassword ? "text" : "password"} autoComplete="new-password" {...form.register("credentials.password")} />
                  <button type="button" className="px-3" onClick={() => setShowPassword((value) => !value)} aria-label="Toggle password visibility">
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>
              <Field label="Username field hint">
                <input className="w-full rounded-md border bg-background px-3 py-2 text-sm" {...form.register("credentials.usernameSelector")} />
              </Field>
              <Field label="Password field hint">
                <input className="w-full rounded-md border bg-background px-3 py-2 text-sm" {...form.register("credentials.passwordSelector")} />
              </Field>
              <Field label="Submit button hint">
                <input className="w-full rounded-md border bg-background px-3 py-2 text-sm" {...form.register("credentials.submitSelector")} />
              </Field>
              <p className="md:col-span-2 text-xs text-muted-foreground">CAPTCHA, MFA, OTP, passkeys, and security challenges require human interaction and cannot be bypassed.</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>3. Testing types</CardTitle></CardHeader>
        <CardContent><TestingTypesSelector form={form} /></CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>4. Crawl settings</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Strategy"><input disabled className="w-full rounded-md border bg-muted px-3 py-2 text-sm" value="DFS" readOnly /></Field>
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Emergency max depth" name="crawl.maxDepth" form={form} />
              <NumberField label="Emergency max pages" name="crawl.maxPages" form={form} />
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...form.register("crawl.sameOriginOnly")} /> Same-origin only</label>
            <Field label="Include patterns"><textarea className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm" {...form.register("crawl.includePatternsText")} /></Field>
            <Field label="Exclude patterns"><textarea className="min-h-28 w-full rounded-md border bg-background px-3 py-2 text-sm" {...form.register("crawl.excludePatternsText")} /></Field>
            <Field label="Ignored query parameters"><textarea className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm" {...form.register("crawl.ignoredQueryParametersText")} /></Field>
            <p className="text-xs text-muted-foreground">By default the crawler runs until DFS convergence. Emergency limits are only applied when set.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>5. Browser and safety</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Browser channel"><input disabled className="w-full rounded-md border bg-muted px-3 py-2 text-sm" value="chrome" readOnly /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...form.register("browser.headless")} /> Headless mode</label>
            <Field label="Visualization mode">
              <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" {...form.register("visualizationMode")}>
                <option value="live">Live browser viewer</option>
                <option value="local">Local headed Chrome</option>
                <option value="off">Off</option>
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Viewport width" name="browser.viewport.width" form={form} />
              <NumberField label="Viewport height" name="browser.viewport.height" form={form} />
            </div>
            <div className="grid gap-2 rounded-md border bg-muted/40 p-3 text-sm">
              <label><input type="checkbox" {...form.register("execution.safeMode")} /> Safe mode</label>
              <label><input type="checkbox" {...form.register("execution.allowFormSubmission")} /> Allow form submission</label>
              <label><input type="checkbox" {...form.register("execution.allowFileUploads")} /> Allow safe file uploads</label>
              <label><input type="checkbox" disabled /> Destructive actions disabled for prototype</label>
              <label><input type="checkbox" disabled /> Payments disabled for prototype</label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Actions per page" name="execution.maximumActionsPerPage" form={form} />
              <NumberField label="Run duration seconds" name="execution.maximumRunDurationSeconds" form={form} />
            </div>
            <p className="text-xs text-muted-foreground">Visible Chrome opens on the backend machine. Safety policy blocks real payments, deletes, password changes, permission changes, message sending, and bypass attempts.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>6. Review and run</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid gap-3 sm:grid-cols-3">
            <Review label="Target" value={values.targetUrl || "Not set"} />
            <Review label="Credentials" value={authEnabled ? "Credentials provided" : "No authentication"} />
            <Review label="Testing types" value={`${values.testTypes.length} selected`} />
            <Review label="Crawl" value={values.crawl.maxPages || values.crawl.maxDepth ? `Emergency caps configured` : "Exhaustive until convergence"} />
            <Review label="Browser" value={`Chrome ${values.browser.headless ? "headless" : "visible"}`} />
            <Review label="Safety" value={values.execution.safeMode ? "Safe mode enabled" : "Safe mode disabled"} />
          </div>
          <Button type="submit" disabled={form.formState.isSubmitting || isStarting}>
            <Play className="h-4 w-4" />
            {isStarting || form.formState.isSubmitting ? "Starting" : "Run Test"}
          </Button>
        </CardContent>
      </Card>
    </form>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </label>
  );
}

function NumberField({ label, name, form }: { label: string; name: FieldPath<TestingFormValues>; form: ReturnType<typeof useForm<TestingFormValues>> }) {
  return (
    <Field label={label}>
      <input
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        type="number"
        placeholder="No default limit"
        {...form.register(name, {
          setValueAs: (value) => value === "" || Number.isNaN(Number(value)) ? undefined : Number(value),
        })}
      />
    </Field>
  );
}

function Review({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-medium">{value}</div>
    </div>
  );
}
