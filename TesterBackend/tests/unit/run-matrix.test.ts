import { describe, expect, it } from "vitest";
import { buildMatrixTargets, buildRoleTargets } from "../../src/testing/run-matrix.js";
import type { TestingRunRequest } from "../../src/types/testing.js";

describe("run matrix helpers", () => {
  it("expands role, viewport, and locale combinations", () => {
    const targets = buildMatrixTargets({
      ...request(),
      roles: [
        { name: "Admin", credentials: { username: "admin", password: "pw" } },
        { name: "Client", credentials: { username: "client", password: "pw" } },
      ],
      testMatrix: {
        enabled: true,
        viewports: [
          { name: "desktop", width: 1440, height: 900 },
          { name: "mobile", width: 390, height: 844 },
        ],
        locales: [
          { name: "english-ltr", locale: "en-US", direction: "ltr" },
          { name: "arabic-rtl", locale: "ar", direction: "rtl" },
        ],
      },
    });

    expect(targets).toHaveLength(8);
    expect(targets.some((target) => target.role.name === "Client" && target.locale.direction === "rtl")).toBe(true);
  });

  it("keeps backward-compatible single credential runs as Default role", () => {
    const roles = buildRoleTargets({
      ...request(),
      credentials: { username: "one", password: "pw" },
    });

    expect(roles).toEqual([{ name: "Default", credentials: { username: "one", password: "pw" } }]);
  });
});

function request(): TestingRunRequest {
  return {
    targetUrl: "https://example.com",
    authorizationConfirmed: true,
    environment: "staging",
    testTypes: ["SMOKE"],
    crawl: { strategy: "DFS", maxDepth: 1, maxPages: 1, sameOriginOnly: true, includePatterns: [], excludePatterns: [] },
    browser: { channel: "chrome", headless: false, viewport: { width: 1440, height: 900 } },
    execution: {
      safeMode: true,
      allowFormSubmission: true,
      allowFileUploads: true,
      allowDestructiveActions: false,
      allowPayments: false,
      maximumActionsPerPage: 10,
      maximumRunDurationSeconds: 60,
    },
  };
}
