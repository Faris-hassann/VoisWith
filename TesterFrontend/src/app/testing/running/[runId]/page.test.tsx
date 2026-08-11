import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RunningPage from "./page";

const mocks = vi.hoisted(() => ({
  getTestingRunStatus: vi.fn(),
  saveReport: vi.fn(),
}));

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;
  readyState = MockWebSocket.OPEN;
  private listeners = new Map<string, Array<(event: MessageEvent | CloseEvent | Event) => void>>();

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
    queueMicrotask(() => this.emit("open", new Event("open")));
  }

  addEventListener(type: string, listener: (event: MessageEvent | CloseEvent | Event) => void) {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  send() {}

  close(code = 1000, reason = "closed") {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close", new CloseEvent("close", { code, reason }));
  }

  emitMessage(payload: unknown) {
    this.emit("message", new MessageEvent("message", { data: JSON.stringify(payload) }));
  }

  private emit(type: string, event: MessageEvent | CloseEvent | Event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

vi.mock("@/lib/api/testing.api", () => ({
  buildTestingRunReportUrl: (runId: string) => `/api/v1/testing/runs/${runId}/report.json`,
  buildTestingRunWebSocketUrl: (runId: string) => `ws://example.test/runs/${runId}`,
  controlTestingRun: vi.fn(),
  getTestingRunStatus: mocks.getTestingRunStatus,
}));

vi.mock("@/providers/report-store-provider", () => ({
  useReportStore: () => ({ saveReport: mocks.saveReport }),
}));

vi.mock("sweetalert2", () => ({
  default: {
    fire: vi.fn(() => Promise.resolve({ isConfirmed: false })),
  },
}));

describe("RunningPage", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    mocks.getTestingRunStatus.mockResolvedValue({
      runId: "run-1",
      status: "running",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      events: [],
    });
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("keeps cursor and unknown events in the generic raw feed", async () => {
    await act(async () => {
      render(<RunningPage params={Promise.resolve({ runId: "run-1" })} />);
    });

    await screen.findByText("Live Test Run");
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0]!;

    socket.emitMessage({
      type: "run.event",
      event: {
        runId: "run-1",
        sequence: 1,
        type: "live-view:cursor",
        status: "info",
        timestamp: new Date().toISOString(),
        message: "Live cursor move.",
        liveCursor: { x: 120, y: 90, action: "move" },
      },
    });
    socket.emitMessage({
      type: "run.event",
      event: {
        runId: "run-1",
        sequence: 2,
        type: "custom.unknown",
        status: "info",
        timestamp: new Date().toISOString(),
        message: "Unknown event still renders.",
      },
    });

    expect(await screen.findByText("live-view:cursor")).toBeInTheDocument();
    expect((await screen.findAllByText("custom.unknown")).length).toBeGreaterThan(0);
  });
});
