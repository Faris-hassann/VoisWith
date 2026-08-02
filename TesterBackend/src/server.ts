import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { config } from "./config/env.js";
import { logger } from "./config/logger.js";
import { createApp } from "./app.js";

const app = createApp();
const server = createServer(app);

server.requestTimeout = 30_000;
server.headersTimeout = 35_000;

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    logger.error(
      { port: config.port, code: error.code },
      `port ${config.port} is already in use; stop the other backend or set PORT=${config.port + 2}`,
    );
    process.exit(1);
  }
  logger.error({ err: error }, "Server failed");
  process.exit(1);
});

server.listen(config.port, () => {
  const swaggerUrl = `http://localhost:${config.port}/docs`;
  logger.info({ port: config.port, swaggerUrl }, "TesterBackend listening");
  if (config.autoOpenSwagger) {
    openUrl(swaggerUrl);
  }
});

function openUrl(url: string): void {
  const command =
    process.platform === "win32"
      ? "cmd"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  const args =
    process.platform === "win32"
      ? ["/c", "start", "", url]
      : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

function shutdown(signal: string): void {
  logger.info({ signal }, "Shutting down");
  server.close((error) => {
    if (error) {
      logger.error({ err: error }, "Shutdown failed");
      process.exit(1);
    }
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
