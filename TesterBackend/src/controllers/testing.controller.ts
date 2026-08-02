import type { Request, Response } from "express";
import { testingRunRequestSchema } from "../schemas/testing-request.schema.js";
import { RunOrchestrator } from "../services/run-orchestrator.js";
import { RunRegistry } from "../runs/run-registry.js";

const orchestrator = new RunOrchestrator();
export const runRegistry = new RunRegistry(orchestrator);

export async function runTestingController(req: Request, res: Response): Promise<void> {
  const request = testingRunRequestSchema.parse(req.body);
  const report = await orchestrator.run(request);
  res.status(200).json(report);
}

export async function startTestingRunController(req: Request, res: Response): Promise<void> {
  const request = testingRunRequestSchema.parse(req.body);
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
  const snapshot = runRegistry.get(runId);
  if (!snapshot) {
    res.status(404).json({ error: { code: "RUN_NOT_FOUND", message: "Run not found." } });
    return;
  }
  res.status(200).json(snapshot);
}
