export const RUN_POLL_INTERVAL_MS = 10_000;
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const MISSED_HEARTBEATS_BEFORE_CLOSE = 2;

const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;

export function reconnectDelayMs(attempt: number): number {
  return RECONNECT_DELAYS_MS[Math.min(Math.max(0, attempt), RECONNECT_DELAYS_MS.length - 1)]!;
}

export function shouldReconnect(closeCode: number, terminal: boolean): boolean {
  return !terminal && closeCode !== 1000;
}
