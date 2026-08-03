import { Router } from "express";
import {
  downloadTestingRunReportController,
  getTestingRunController,
  pauseTestingRunController,
  resumeTestingRunController,
  runTestingController,
  startTestingRunController,
  stopTestingRunController,
} from "../controllers/testing.controller.js";
import { asyncHandler } from "../utilities/async-handler.js";

export const testingRouter = Router();

testingRouter.post("/runs", asyncHandler(startTestingRunController));
testingRouter.get("/runs/:runId", asyncHandler(getTestingRunController));
testingRouter.post("/runs/:runId/pause", asyncHandler(pauseTestingRunController));
testingRouter.post("/runs/:runId/resume", asyncHandler(resumeTestingRunController));
testingRouter.post("/runs/:runId/stop", asyncHandler(stopTestingRunController));
testingRouter.get("/runs/:runId/report.json", asyncHandler(downloadTestingRunReportController));
testingRouter.post("/run", asyncHandler(runTestingController));
