import { describe, expect, it } from "vitest";
import { AppError } from "../../src/errors/app-error.js";
import { ERROR_CODES } from "../../src/errors/error-codes.js";
import { serializeError } from "../../src/errors/serialize-error.js";

describe("serializeError", () => {
  it("preserves useful fields from Error", () => {
    const error = new Error("Boom");
    const serialized = serializeError(error);

    expect(serialized).toMatchObject({ name: "Error", message: "Boom" });
    expect(serialized.stack).toContain("Boom");
  });

  it("preserves code and details from AppError", () => {
    const error = new AppError({
      code: ERROR_CODES.BROWSER_LAUNCH_FAILURE,
      message: "Chrome failed",
      details: { command: "chrome", token: "secret" },
    });

    expect(serializeError(error)).toMatchObject({
      name: "AppError",
      message: "Chrome failed",
      code: ERROR_CODES.BROWSER_LAUNCH_FAILURE,
      details: { command: "chrome", token: "[REDACTED]" },
    });
  });

  it("makes empty thrown objects readable", () => {
    expect(serializeError({})).toMatchObject({
      name: "ThrownObject",
      message: "Thrown empty object",
    });
  });
});
