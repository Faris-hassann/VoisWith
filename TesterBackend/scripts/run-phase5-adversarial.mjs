import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";

const backendPort = 33201;
const targetUrl = "http://127.0.0.1:43117";
const artifactRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tester-phase5-adversarial-"));
let backend;
let fixture;

try {
  fixture = await ensureFixture();
  backend = await startBackend();

  const recovery = await verifyProcessKillRecovery();
  const replay = await verifyDisconnectReplay();
  const parity = await verifyDiskParity();

  console.log(JSON.stringify({ artifactRoot, recovery, replay, parity }, null, 2));
} finally {
  await stopProcess(backend);
  await stopProcess(fixture);
  await fs.rm(artifactRoot, { recursive: true, force: true });
}

async function verifyProcessKillRecovery() {
  const started = await startRun();
  const manifestPath = path.join(artifactRoot, started.runId, "manifest.json");
  await waitFor(async () => {
    const manifest = await readJson(manifestPath);
    return Array.isArray(manifest?.pageReports) && manifest.pageReports.length >= 1 ? manifest : undefined;
  }, "manifest checkpoint");

  await stopProcess(backend);
  backend = await startBackend();

  const snapshot = await fetchJson(`/api/v1/testing/runs/${started.runId}`);
  if (snapshot.status !== "failed") throw new Error(`Expected recovered snapshot status=failed, got ${snapshot.status}`);
  if (snapshot.report?.runStatus !== "ERRORED") throw new Error(`Expected recovered report runStatus ERRORED, got ${snapshot.report?.runStatus}`);
  if (snapshot.report?.status !== "ERROR") throw new Error(`Expected recovered legacy status ERROR, got ${snapshot.report?.status}`);
  if (snapshot.report?.stoppedReason !== "error") throw new Error(`Expected recovered stoppedReason error, got ${snapshot.report?.stoppedReason}`);

  return {
    runId: started.runId,
    status: snapshot.status,
    runStatus: snapshot.report.runStatus,
    stoppedReason: snapshot.report.stoppedReason,
  };
}

async function verifyDisconnectReplay() {
  const started = await startRun();
  const seenBeforeDisconnect = [];
  const seenAfterReconnect = [];
  let lastSequence = 0;

  await connectAndCollect(started.runId, async ({ event, close }) => {
    if (!event) return false;
    seenBeforeDisconnect.push(event);
    lastSequence = Math.max(lastSequence, event.sequence);
    if (event.type === "page.snapshot_collected") {
      close();
      return true;
    }
    return false;
  });

  const reconnectResult = await connectAndCollect(started.runId, async ({ event, closeInfo }) => {
    if (event) {
      if (seenAfterReconnect.some((existing) => existing.sequence === event.sequence)) {
        throw new Error(`Duplicate replay event sequence ${event.sequence}`);
      }
      seenAfterReconnect.push(event);
    }
    if (closeInfo) {
      if (closeInfo.code !== 1000 || closeInfo.reason !== "run_complete") {
        throw new Error(`Expected terminal close 1000/run_complete, got ${closeInfo.code}/${closeInfo.reason}`);
      }
      return true;
    }
    return false;
  }, lastSequence);

  const completedIndex = seenAfterReconnect.findIndex((event) => event.type === "run.completed");
  const reportReadyIndex = seenAfterReconnect.findIndex((event) => event.type === "run.report_ready");
  if (completedIndex < 0 || reportReadyIndex < 0 || completedIndex > reportReadyIndex) {
    throw new Error("Expected replay to include run.completed before run.report_ready.");
  }
  for (let index = 1; index < seenAfterReconnect.length; index += 1) {
    if (seenAfterReconnect[index].sequence <= seenAfterReconnect[index - 1].sequence) {
      throw new Error("Replay events were not strictly increasing by sequence.");
    }
  }

  return {
    runId: started.runId,
    lastSequenceBeforeDisconnect: lastSequence,
    replayedEvents: seenAfterReconnect.length,
    terminalClose: reconnectResult.closeInfo,
  };
}

async function verifyDiskParity() {
  const started = await startRun();
  const terminalEvent = await waitForTerminalEvent(started.runId);
  const liveFields = encodeFields(terminalEvent.report);

  await stopProcess(backend);
  backend = await startBackend();

  const diskReport = await fetchJson(`/api/v1/testing/runs/${started.runId}/report.json`);
  const diskFields = encodeFields(diskReport);
  if (liveFields !== diskFields) {
    throw new Error(`Disk parity mismatch.\nlive=${liveFields}\ndisk=${diskFields}`);
  }

  return {
    runId: started.runId,
    parity: "byte-identical",
    fields: JSON.parse(liveFields),
  };
}

async function waitForTerminalEvent(runId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${backendPort}/api/v1/testing/runs/${encodeURIComponent(runId)}/stream`);
    ws.on("message", (raw) => {
      const payload = JSON.parse(raw.toString());
      if (payload.type === "stream.ping") {
        ws.send(JSON.stringify({ type: "stream.pong", timestamp: payload.timestamp }));
        return;
      }
      if (payload.type === "run.event" && payload.event?.type === "run.completed" && payload.event?.report) {
        resolve(payload.event);
      }
    });
    ws.on("close", (code, reason) => {
      if (code !== 1000) reject(new Error(`Terminal wait socket closed early ${code}/${reason.toString()}`));
    });
    ws.on("error", reject);
  });
}

async function connectAndCollect(runId, until, lastSequence) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const suffix = lastSequence === undefined ? "" : `?lastSequence=${lastSequence}`;
    const ws = new WebSocket(`ws://127.0.0.1:${backendPort}/api/v1/testing/runs/${encodeURIComponent(runId)}/stream${suffix}`);

    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    ws.on("message", async (raw) => {
      try {
        const payload = JSON.parse(raw.toString());
        if (payload.type === "stream.ping") {
          ws.send(JSON.stringify({ type: "stream.pong", timestamp: payload.timestamp }));
          return;
        }
        if (payload.type === "run.snapshot") {
          for (const event of payload.snapshot.events ?? []) {
            const done = await until({ event, close: () => ws.close(4001, "test_disconnect") });
            if (done) return finish({ closeInfo: undefined });
          }
          return;
        }
        if (payload.type === "run.event") {
          const done = await until({ event: payload.event, close: () => ws.close(4001, "test_disconnect") });
          if (done) return finish({ closeInfo: undefined });
        }
      } catch (error) {
        reject(error);
      }
    });

    ws.on("close", async (code, reason) => {
      const done = await until({ closeInfo: { code, reason: reason.toString() } });
      if (done) finish({ closeInfo: { code, reason: reason.toString() } });
    });
    ws.on("error", reject);
  });
}

async function startRun() {
  const response = await fetch(`http://127.0.0.1:${backendPort}/api/v1/testing/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody()),
  });
  if (!response.ok) {
    throw new Error(`Failed to start run: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function startBackend() {
  const child = spawn(process.execPath, ["dist/src/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(backendPort),
      ARTIFACT_ROOT: artifactRoot,
      ALLOW_PRIVATE_NETWORK_TARGETS: "true",
      REQUIRE_HTTPS: "false",
      BROWSER_HEADLESS: "true",
      MAX_AI_CALLS_PER_RUN: "0",
      LIVE_VIEW_ENABLED: "true",
      NODE_ENV: "development",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", () => undefined);
  child.stderr.on("data", () => undefined);
  await waitForHttp(`http://127.0.0.1:${backendPort}/health`);
  return child;
}

async function ensureFixture() {
  if (await isHealthy(targetUrl)) return undefined;
  const child = spawn(process.execPath, ["tests/fixtures/test-site/server.mjs"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", () => undefined);
  child.stderr.on("data", () => undefined);
  await waitForHttp(targetUrl);
  return child;
}

async function waitForHttp(url) {
  await waitFor(() => isHealthy(url).then((ready) => ready ? true : undefined), `service ${url}`);
}

async function isHealthy(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitFor(probe, label) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function stopProcess(child) {
  if (!child || child.killed) return;
  child.kill("SIGKILL");
  await new Promise((resolve) => child.once("exit", resolve));
}

async function fetchJson(pathname) {
  const response = await fetch(`http://127.0.0.1:${backendPort}${pathname}`);
  if (!response.ok) throw new Error(`Request failed ${pathname}: ${response.status} ${await response.text()}`);
  return response.json();
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function encodeFields(report) {
  return JSON.stringify({
    artifactsBytes: report.summary.artifactsBytes,
    stoppedReason: report.stoppedReason,
    coverageLimitations: report.coverageLimitations,
  });
}

function requestBody() {
  return {
    targetUrl,
    authorizationConfirmed: true,
    writeActionsAcknowledged: true,
    environment: "staging",
    visualizationMode: "off",
    browserMode: "headless",
    testTypes: [
      "SMOKE", "PAGE_DISCOVERY", "NAVIGATION", "LINKS", "FORMS", "FORM_VALIDATION",
      "AUTHENTICATION", "API_NETWORK", "ERROR_HANDLING", "PERFORMANCE_BASIC",
      "CONSOLE_ERRORS", "ACCESSIBILITY_TECHNICAL",
    ],
    crawl: { strategy: "DFS", maxDepth: 7, maxPages: 500, sameOriginOnly: true, includePatterns: [], excludePatterns: [], ignoredQueryParameters: [] },
    browser: { channel: "chrome", headless: true, viewport: { width: 1280, height: 720 } },
    execution: {
      safeMode: true,
      allowFormSubmission: true,
      allowFileUploads: false,
      allowDestructiveActions: false,
      allowPayments: false,
      maximumActionsPerPage: 50,
      maximumRunDurationSeconds: 600,
    },
  };
}
