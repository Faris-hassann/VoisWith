import { Router } from "express";
import { getTestingRunController, runTestingController, startTestingRunController } from "../controllers/testing.controller.js";
import { asyncHandler } from "../utilities/async-handler.js";

export const testingRouter = Router();

testingRouter.post("/runs", asyncHandler(startTestingRunController));
testingRouter.get("/runs/:runId", asyncHandler(getTestingRunController));
testingRouter.post("/run", asyncHandler(runTestingController));
