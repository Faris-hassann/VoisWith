import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact";

describe("redactSecrets", () => {
  it("redacts nested passwords", () => {
    expect(redactSecrets({ credentials: { password: "secret" } })).toEqual({
      credentials: { password: "[REDACTED]" },
    });
  });
});
