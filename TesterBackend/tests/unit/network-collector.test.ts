import { describe, expect, it } from "vitest";
import { networkDuplicateKey } from "../../src/collectors/network-collector.js";

describe("NetworkCollector", () => {
  it("groups duplicate observed API calls with stable duplicate keys", () => {
    const first = networkDuplicateKey("POST", "https://example.com/api/tickets?timestamp=1");
    const second = networkDuplicateKey("POST", "https://example.com/api/tickets?timestamp=2");

    expect(first).toBe(second);
  });
});
