import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { config } from "../config/env.js";
import { logger } from "../config/logger.js";
import type { RunRegistry } from "../runs/run-registry.js";

export function attachTestingRunWebSocketServer(server: Server, registry: RunRegistry): void {
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

  wss.on("connection", (ws: WebSocket, _request: IncomingMessage, runId: string) => {
    const snapshot = registry.get(runId);
    if (!snapshot) {
      send(ws, { type: "run.not_found", runId, message: "Run not found." });
      ws.close(1008, "Run not found");
      return;
    }

    send(ws, { type: "run.snapshot", snapshot });
    const unsubscribe = registry.subscribe(runId, (event) => send(ws, { type: "run.event", event }));
    const heartbeat = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.ping();
    }, 30_000);

    ws.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    ws.on("error", (error) => {
      logger.warn({ err: error, runId }, "Testing run WebSocket failed");
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
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
