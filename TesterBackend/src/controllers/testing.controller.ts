import type { Request, Response } from "express";
import { testingRunRequestSchema } from "../schemas/testing-request.schema.js";
import { RunOrchestrator } from "../services/run-orchestrator.js";
import { RunRegistry } from "../runs/run-registry.js";
import type { TestingRunRequest } from "../types/testing.js";
import { config } from "../config/env.js";
import { RunHistoryStore } from "../runs/run-history-store.js";

export const runHistoryStore = new RunHistoryStore(config.artifacts.root, config.artifacts.retentionDays);
const orchestrator = new RunOrchestrator(runHistoryStore);
export const runRegistry = new RunRegistry(orchestrator, runHistoryStore);

export async function runTestingController(req: Request, res: Response): Promise<void> {
  const request = testingRunRequestSchema.parse(req.body) as TestingRunRequest;
  const report = await orchestrator.run(request);
  res.status(200).json(report);
}

export async function startTestingRunController(req: Request, res: Response): Promise<void> {
  const request = testingRunRequestSchema.parse(req.body) as TestingRunRequest;
  const snapshot = runRegistry.start(request);
  res.status(202).json({
    runId: snapshot.runId,
    status: snapshot.status,
    startedAt: snapshot.startedAt,
    streamUrl: `/api/v1/testing/runs/${encodeURIComponent(snapshot.runId)}/stream`,
  });
}

export async function getTestingRunController(req: Request, res: Response): Promise<void> {
  const param = req.params.runId;
  const runId = Array.isArray(param) ? param[0] : param;
  if (!runId) {
    res.status(400).json({ error: { code: "RUN_ID_REQUIRED", message: "Run ID is required." } });
    return;
  }
  const snapshot = runRegistry.get(runId) ?? await runHistoryStore.getSnapshot(runId);
  if (!snapshot) {
    res.status(404).json({ error: { code: "RUN_NOT_FOUND", message: "Run not found." } });
    return;
  }
  res.status(200).json(snapshot);
}

export async function listTestingRunsController(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ runs: await runHistoryStore.list() });
}

export async function pauseTestingRunController(req: Request, res: Response): Promise<void> {
  const snapshot = mutateRun(req, res, "pause");
  if (snapshot) res.status(200).json(snapshot);
}

export async function resumeTestingRunController(req: Request, res: Response): Promise<void> {
  const snapshot = mutateRun(req, res, "resume");
  if (snapshot) res.status(200).json(snapshot);
}

export async function stopTestingRunController(req: Request, res: Response): Promise<void> {
  const snapshot = mutateRun(req, res, "stop");
  if (snapshot) res.status(200).json(snapshot);
}

export async function downloadTestingRunReportController(req: Request, res: Response): Promise<void> {
  const snapshot = await getSnapshot(req, res);
  if (!snapshot) return;
  if (!snapshot.report) {
    res.status(404).json({ error: { code: "REPORT_NOT_READY", message: "Report is not ready." } });
    return;
  }
  res.setHeader("content-type", "application/json");
  res.setHeader("content-disposition", `attachment; filename="testing-report-${snapshot.runId}.json"`);
  res.status(200).send(JSON.stringify(snapshot.report, null, 2));
}

function mutateRun(req: Request, res: Response, action: "pause" | "resume" | "stop") {
  const runId = runIdFromRequest(req, res);
  if (!runId) return undefined;
  const snapshot =
    action === "pause" ? runRegistry.pause(runId) : action === "resume" ? runRegistry.resume(runId) : runRegistry.stop(runId);
  if (!snapshot) {
    res.status(404).json({ error: { code: "RUN_NOT_FOUND", message: "Run not found." } });
    return undefined;
  }
  return snapshot;
}

async function getSnapshot(req: Request, res: Response) {
  const runId = runIdFromRequest(req, res);
  if (!runId) return undefined;
  const snapshot = runRegistry.get(runId) ?? await runHistoryStore.getSnapshot(runId);
  if (!snapshot) {
    res.status(404).json({ error: { code: "RUN_NOT_FOUND", message: "Run not found." } });
    return undefined;
  }
  return snapshot;
}

function runIdFromRequest(req: Request, res: Response): string | undefined {
  const param = req.params.runId;
  const runId = Array.isArray(param) ? param[0] : param;
  if (!runId) {
    res.status(400).json({ error: { code: "RUN_ID_REQUIRED", message: "Run ID is required." } });
    return undefined;
  }
  return runId;
}
