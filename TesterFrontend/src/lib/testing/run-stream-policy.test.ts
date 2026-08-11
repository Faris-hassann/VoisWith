import { describe, expect, it } from "vitest";
import { HEARTBEAT_INTERVAL_MS, MISSED_HEARTBEATS_BEFORE_CLOSE, reconnectDelayMs, RUN_POLL_INTERVAL_MS, shouldReconnect } from "./run-stream-policy";

describe("run stream recovery policy", () => {
  it("uses the settled capped exponential reconnect schedule", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 99].map(reconnectDelayMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });

  it("never reconnects normal or terminal closes", () => {
    expect(shouldReconnect(1000, false)).toBe(false);
    expect(shouldReconnect(1006, true)).toBe(false);
    expect(shouldReconnect(1006, false)).toBe(true);
  });

  it("pins heartbeat and polling intervals", () => {
    expect(HEARTBEAT_INTERVAL_MS * MISSED_HEARTBEATS_BEFORE_CLOSE).toBe(60_000);
    expect(RUN_POLL_INTERVAL_MS).toBe(10_000);
  });
});
