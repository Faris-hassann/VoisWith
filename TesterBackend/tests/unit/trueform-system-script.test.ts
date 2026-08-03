import { execFile } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
let server: http.Server | undefined;

describe("run-trueform-system-test script", () => {
  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
      server = undefined;
    }
  });

  it("uses full-crawl desktop-first defaults in the request payload", async () => {
    let payload: unknown;
    let statusPolls = 0;
    server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      if (req.method === "GET" && req.url === "/api/v1/testing/runs/script-test") {
        statusPolls += 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ runId: "script-test", status: "completed", events: [], report: { status: "PASSED" }, polls: statusPolls }));
        return;
      }
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        res.writeHead(202, { "content-type": "application/json" });
        res.end(JSON.stringify({ runId: "script-test", status: "running" }));
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP test server address.");

    const env = { ...process.env };
    for (const key of [
      "TRUEFORM_MAX_PAGES",
      "TRUEFORM_MAX_DEPTH",
      "TRUEFORM_MAX_DURATION_SECONDS",
      "TRUEFORM_MAX_ACTIONS_PER_PAGE",
      "TRUEFORM_TEST_MATRIX",
    ]) {
      delete env[key];
    }
    env.TRUEFORM_PASSWORD = "test-password";
    env.TESTER_BACKEND_URL = `http://127.0.0.1:${address.port}/api/v1/testing/runs`;
    env.TESTER_BACKEND_HEALTH_URL = `http://127.0.0.1:${address.port}/health`;

    const scriptPath = path.resolve("scripts", "run-trueform-system-test.mjs");
    const result = await execFileAsync("node", [scriptPath], {
      cwd: process.cwd(),
      env,
      timeout: 30_000,
    });

    expect(result.stdout).toContain("crawl.maxPages: until convergence");
    expect(payload).toMatchObject({
      crawl: {},
      execution: {
        maximumRunDurationSeconds: 1800,
      },
      testMatrix: {
        enabled: false,
      },
    });
  });
});
