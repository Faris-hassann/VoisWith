import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../errors/app-error.js";
import { ERROR_CODES } from "../errors/error-codes.js";
import { logger } from "../config/logger.js";
import { redactSecrets } from "../security/secret-redaction.js";

export function errorMiddleware(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const redacted = redactSecrets(error);

  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: ERROR_CODES.INVALID_REQUEST,
        message: "Request validation failed.",
        details: error.flatten(),
        requestId: req.requestId,
      },
    });
    return;
  }

  if (error instanceof AppError) {
    logger.warn({ err: redacted, requestId: req.requestId }, "Application error");
    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        details: redactSecrets(error.details),
        requestId: req.requestId,
      },
    });
    return;
  }

  logger.error({ err: redacted, requestId: req.requestId }, "Unhandled error");
  res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Unexpected server error.",
      requestId: req.requestId,
    },
  });
}
