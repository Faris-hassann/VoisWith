import { describe, expect, it } from "vitest";
import { AppError } from "../../src/errors/app-error.js";
import { ERROR_CODES } from "../../src/errors/error-codes.js";
import { serializeError } from "../../src/errors/serialize-error.js";
import {
  orderedSelectors,
  passwordCandidates,
  submitCandidates,
  usernameCandidates,
} from "../../src/authentication/authentication-handler.js";

describe("AuthenticationHandler selector helpers", () => {
  it("prioritizes hints, splits comma selectors, and keeps fallback candidates", () => {
    const candidates = usernameCandidates(
      {
        username: "admin@example.com",
        password: "secret",
        fieldHints: {
          usernameSelector: "input[type='email'], input[name='email']",
        },
      },
      { usernameSelector: "#detected-email" },
    );

    expect(candidates.slice(0, 3)).toEqual(["input[type='email']", "input[name='email']", "#detected-email"]);
    expect(candidates).toContain("input[autocomplete='email']");
  });

  it("includes robust password and submit fallbacks", () => {
    expect(passwordCandidates({ username: "u", password: "p" }, {})).toContain("input[type='password']");
    expect(submitCandidates({ username: "u", password: "p" }, {})).toContain("button:has-text('Sign in')");
  });

  it("deduplicates ordered selectors", () => {
    expect(orderedSelectors(["input, input", "button"])).toEqual(["input", "button"]);
  });

  it("serializes login diagnostics without leaking credentials", () => {
    const error = new AppError({
      code: ERROR_CODES.LOGIN_FAILURE,
      message: "Login failed",
      details: {
        diagnostics: {
          usernameLocator: "input[type='email']",
          passwordLocator: "input[type='password']",
          attempts: ["Filled username locator and verification passed."],
        },
        password: "Admin@1234",
      },
    });

    const serialized = serializeError(error);
    expect(JSON.stringify(serialized)).toContain("input[type='email']");
    expect(JSON.stringify(serialized)).not.toContain("Admin@1234");
  });
});
