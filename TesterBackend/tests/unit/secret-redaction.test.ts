import { describe, expect, it } from "vitest";
import { redactSecrets } from "../../src/security/secret-redaction.js";

describe("redactSecrets", () => {
  it("redacts nested secret-like fields", () => {
    const redacted = redactSecrets({
      credentials: { username: "user", password: "secret" },
      headers: { authorization: "Bearer token" },
    });

    expect(redacted).toEqual({
      credentials: { username: "user", password: "[REDACTED]" },
      headers: { authorization: "[REDACTED]" },
    });
  });
});
