import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { config } from "../config/env.js";
import { logger } from "../config/logger.js";
import type { RunRegistry } from "../runs/run-registry.js";
import type { RunHistoryStore } from "../runs/run-history-store.js";

export function attachTestingRunWebSocketServer(server: Server, registry: RunRegistry, history: RunHistoryStore): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const runId = parseRunId(request);
    if (!runId) return;

    const origin = request.headers.origin;
    if (origin && !isAllowedOrigin(origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request, runId);
    });
  });

  wss.on("connection", async (ws: WebSocket, request: IncomingMessage, runId: string) => {
    const lastSequence = parseLastSequence(request);
    const liveSnapshot = registry.get(runId);
    const snapshot = liveSnapshot ?? await history.getSnapshot(runId);
    if (!snapshot) {
      send(ws, { type: "run.not_found", runId, message: "Run not found." });
      ws.close(1008, "Run not found");
      return;
    }

    send(ws, {
      type: "run.snapshot",
      snapshot: {
        ...snapshot,
        events: lastSequence === undefined ? snapshot.events : snapshot.events.filter((event) => event.sequence > lastSequence),
      },
    });
    let closeTimer: NodeJS.Timeout | undefined;
    const closeTerminal = () => {
      if (closeTimer) return;
      closeTimer = setTimeout(() => ws.close(1000, "run_complete"), 2_000);
    };
    const unsubscribe = liveSnapshot
      ? registry.subscribe(runId, (event) => {
          send(ws, { type: "run.event", event });
          if (event.type === "run.report_ready") closeTerminal();
        })
      : () => undefined;
    if (!liveSnapshot || registry.isTerminal(runId)) closeTerminal();

    let missedHeartbeats = 0;
    const heartbeat = setInterval(() => {
      if (ws.readyState !== ws.OPEN) return;
      missedHeartbeats += 1;
      if (missedHeartbeats >= 2) {
        ws.close(4000, "heartbeat_timeout");
        return;
      }
      ws.ping();
      send(ws, { type: "stream.ping", timestamp: new Date().toISOString() });
    }, 30_000);

    ws.on("message", (data) => {
      try {
        const payload = JSON.parse(data.toString()) as { type?: string };
        if (payload.type === "stream.pong") missedHeartbeats = 0;
      } catch {
        // Unknown client messages are ignored; run events are server-owned.
      }
    });

    ws.on("close", () => {
      clearInterval(heartbeat);
      if (closeTimer) clearTimeout(closeTimer);
      unsubscribe();
    });
    ws.on("error", (error) => {
      logger.warn({ err: error, runId }, "Testing run WebSocket failed");
      clearInterval(heartbeat);
      if (closeTimer) clearTimeout(closeTimer);
      unsubscribe();
    });
  });
}

function parseLastSequence(request: IncomingMessage): number | undefined {
  const value = new URL(request.url ?? "/", "http://localhost").searchParams.get("lastSequence");
  if (value === null) return undefined;
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : undefined;
}

function parseRunId(request: IncomingMessage): string | undefined {
  const url = new URL(request.url ?? "/", "http://localhost");
  const match = url.pathname.match(/^\/api\/v1\/testing\/runs\/([^/]+)\/stream$/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function isAllowedOrigin(origin: string): boolean {
  const defaults = new Set(["http://localhost:3000", "http://localhost:3001", "http://localhost:5173"]);
  return config.frontendOrigins.includes(origin) || defaults.has(origin);
}

function send(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}
