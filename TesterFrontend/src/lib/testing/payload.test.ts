import { describe, expect, it } from "vitest";
import { defaultFormValues } from "../schemas/testing-run.schema";
import { buildTestingPayload } from "./payload";

describe("buildTestingPayload", () => {
  it("sends the default form-submission consent pair", () => {
    const payload = buildTestingPayload({
      ...defaultFormValues,
      targetUrl: "https://example.com",
    });

    expect(payload.execution.allowFormSubmission).toBe(true);
    expect(payload.writeActionsAcknowledged).toBe(true);
  });

  it("omits credentials when auth is disabled", () => {
    const payload = buildTestingPayload({
      ...defaultFormValues,
      targetUrl: "https://example.com",
      authorizationConfirmed: true,
      authenticationEnabled: false,
    });
    expect(payload.credentials).toBeUndefined();
  });

  it("includes credentials only when auth is enabled and complete", () => {
    const payload = buildTestingPayload({
      ...defaultFormValues,
      targetUrl: "https://example.com",
      authorizationConfirmed: true,
      authenticationEnabled: true,
      credentials: { username: "user", password: "secret", loginUrl: "https://example.com/login" },
    });
    expect(payload.credentials).toMatchObject({ username: "user", password: "secret" });
  });
});
