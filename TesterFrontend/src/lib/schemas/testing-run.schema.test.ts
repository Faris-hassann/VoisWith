import { describe, expect, it } from "vitest";
import { defaultFormValues, testingFormSchema } from "./testing-run.schema";

describe("testingFormSchema", () => {
  it("uses authorization confirmation by default", () => {
    const result = testingFormSchema.safeParse({ ...defaultFormValues, targetUrl: "https://example.com" });
    expect(result.success).toBe(true);
  });

  it("enables acknowledged form submission by default", () => {
    expect(defaultFormValues.execution.allowFormSubmission).toBe(true);
    expect(defaultFormValues.writeActionsAcknowledged).toBe(true);

    const result = testingFormSchema.safeParse({ ...defaultFormValues, targetUrl: "https://example.com" });
    expect(result.success).toBe(true);
  });

  it("validates recommended defaults when authorization is confirmed", () => {
    const result = testingFormSchema.safeParse({
      ...defaultFormValues,
      targetUrl: "https://example.com",
      authorizationConfirmed: true,
    });
    expect(result.success).toBe(true);
  });

  it("returns validation errors instead of throwing for invalid URLs", () => {
    expect(() =>
      testingFormSchema.safeParse({
        ...defaultFormValues,
        targetUrl: "not a url",
        authorizationConfirmed: true,
      }),
    ).not.toThrow();

    const result = testingFormSchema.safeParse({
      ...defaultFormValues,
      targetUrl: "javascript:alert(1)",
      authorizationConfirmed: true,
    });
    expect(result.success).toBe(false);
  });
});
