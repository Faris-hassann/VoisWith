import type { Request, Response } from "express";
import { testingRunRequestSchema } from "../schemas/testing-request.schema.js";
import { RunOrchestrator } from "../services/run-orchestrator.js";

const orchestrator = new RunOrchestrator();

export async function runTestingController(req: Request, res: Response): Promise<void> {
  const request = testingRunRequestSchema.parse(req.body);
  const report = await orchestrator.run(request);
  res.status(200).json(report);
}
