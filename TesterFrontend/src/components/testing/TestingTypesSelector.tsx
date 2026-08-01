"use client";

import type { UseFormReturn } from "react-hook-form";
import { TEST_TYPES, type TestingType } from "@/lib/api/types";
import { recommendedTypes, type TestingFormValues } from "@/lib/schemas/testing-run.schema";
import { Button } from "@/components/ui/button";

const labels: Record<TestingType, string> = {
  SMOKE: "Smoke testing",
  PAGE_DISCOVERY: "Page discovery",
  NAVIGATION: "Navigation testing",
  LINKS: "Link testing",
  FORMS: "Form testing",
  FORM_VALIDATION: "Form validation",
  POSITIVE: "Positive testing",
  NEGATIVE: "Negative testing",
  BOUNDARY: "Boundary testing",
  AUTHENTICATION: "Authentication",
  SESSION: "Session",
  AUTHORIZATION: "Authorization",
  END_TO_END: "End-to-end",
  BUSINESS_RULES: "Business rules",
  API_NETWORK: "API and network",
  ERROR_HANDLING: "Error handling",
  FILE_UPLOAD_SAFE: "Safe file upload",
  DATA_INTEGRITY_OBSERVABLE: "Observable data integrity",
  PERFORMANCE_BASIC: "Basic performance",
  RELIABILITY_BASIC: "Basic reliability",
  CHROMIUM_COMPATIBILITY: "Chromium compatibility",
  PASSIVE_SECURITY: "Passive security",
  REGRESSION_BASELINE: "Regression baseline",
  CONSOLE_ERRORS: "Console errors",
  ACCESSIBILITY_TECHNICAL: "Technical accessibility",
};

const groups: Array<{ title: string; items: TestingType[] }> = [
  { title: "Core functionality", items: ["SMOKE", "PAGE_DISCOVERY", "NAVIGATION", "LINKS", "END_TO_END", "BUSINESS_RULES"] },
  { title: "Forms and data", items: ["FORMS", "FORM_VALIDATION", "POSITIVE", "NEGATIVE", "BOUNDARY", "FILE_UPLOAD_SAFE", "DATA_INTEGRITY_OBSERVABLE"] },
  { title: "Access and sessions", items: ["AUTHENTICATION", "SESSION", "AUTHORIZATION"] },
  { title: "Technical monitoring", items: ["API_NETWORK", "CONSOLE_ERRORS", "ERROR_HANDLING", "PERFORMANCE_BASIC", "RELIABILITY_BASIC"] },
  { title: "Security and quality", items: ["PASSIVE_SECURITY", "ACCESSIBILITY_TECHNICAL", "REGRESSION_BASELINE", "CHROMIUM_COMPATIBILITY"] },
];

export function TestingTypesSelector({ form }: { form: UseFormReturn<TestingFormValues> }) {
  const selected = form.watch("testTypes");
  const authEnabled = form.watch("authenticationEnabled");
  const toggle = (type: TestingType) => {
    form.setValue(
      "testTypes",
      selected.includes(type) ? selected.filter((item) => item !== type) : [...selected, type],
      { shouldValidate: true, shouldDirty: true },
    );
  };
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => form.setValue("testTypes", [...recommendedTypes], { shouldValidate: true })}>
          Select recommended
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => form.setValue("testTypes", TEST_TYPES.filter((item) => !["AUTHORIZATION", "REGRESSION_BASELINE"].includes(item)), { shouldValidate: true })}>
          Select all safe tests
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => form.setValue("testTypes", [], { shouldValidate: true })}>
          Clear
        </Button>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {groups.map((group) => (
          <div key={group.title} className="rounded-lg border p-4">
            <h3 className="text-sm font-semibold">{group.title}</h3>
            <div className="mt-3 grid gap-2">
              {group.items.map((type) => {
                const warning =
                  type === "AUTHORIZATION"
                    ? "Requires multiple role credentials; backend will mark unavailable in v1."
                    : type === "REGRESSION_BASELINE"
                      ? "Requires a backend baseline; unavailable in v1."
                      : ["AUTHENTICATION", "SESSION"].includes(type) && !authEnabled
                        ? "Normally requires credentials."
                        : undefined;
                return (
                  <label key={type} className="flex cursor-pointer items-start gap-3 rounded-md border bg-background p-3 hover:bg-muted/40">
                    <input type="checkbox" className="mt-1" checked={selected.includes(type)} onChange={() => toggle(type)} />
                    <span>
                      <span className="block text-sm font-medium">{labels[type]}</span>
                      <span className="block font-mono text-xs text-muted-foreground">{type}</span>
                      {warning ? <span className="mt-1 block text-xs text-amber-600">{warning}</span> : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
