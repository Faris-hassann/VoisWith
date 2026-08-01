import { Router } from "express";
import { runTestingController } from "../controllers/testing.controller.js";
import { asyncHandler } from "../utilities/async-handler.js";

export const testingRouter = Router();

testingRouter.post("/run", asyncHandler(runTestingController));
