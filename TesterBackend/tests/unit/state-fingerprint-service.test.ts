import { describe, expect, it } from "vitest";
import { StateFingerprintService } from "../../src/crawler/state-fingerprint-service.js";

describe("StateFingerprintService", () => {
  it("keeps fingerprints stable when unstable field names and timestamps change", () => {
    const service = new StateFingerprintService();
    const first = service.fingerprint({
      normalizedUrl: "https://example.com/dashboard",
      title: "Dashboard",
      headings: ["Welcome 123456"],
      landmarks: ["header", "main"],
      role: "Admin",
      forms: [],
      dialogs: [],
      elements: [
        {
          id: "element_1",
          kind: "input",
          tagName: "input",
          name: "csrf_token_123",
          label: "Search",
          disabled: false,
          hidden: false,
          locator: { strategy: "css", value: "input" },
        },
      ],
    });
    const second = service.fingerprint({
      normalizedUrl: "https://example.com/dashboard",
      title: "Dashboard",
      headings: ["Welcome 999999"],
      landmarks: ["header", "main"],
      role: "Admin",
      forms: [],
      dialogs: [],
      elements: [
        {
          id: "element_22",
          kind: "input",
          tagName: "input",
          name: "csrf_token_456",
          label: "Search",
          disabled: false,
          hidden: false,
          locator: { strategy: "css", value: "input:nth-of-type(2)" },
        },
      ],
    });

    expect(second).toBe(first);
  });
});
