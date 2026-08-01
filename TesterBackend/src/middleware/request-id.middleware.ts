import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

declare module "express-serve-static-core" {
  interface Request {
    requestId: string;
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.requestId = req.header("x-request-id") ?? crypto.randomUUID();
  res.setHeader("x-request-id", req.requestId);
  next();
}
