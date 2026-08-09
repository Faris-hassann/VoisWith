import type { ErrorCode, LlmFailureReason } from "./error-codes.js";

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;
  public readonly fatal: boolean;
  /** Set on AI pipeline failures so callers can classify without string-matching `message`. */
  public readonly llmFailureReason?: LlmFailureReason;

  constructor(input: {
    code: ErrorCode;
    message: string;
    statusCode?: number;
    details?: unknown;
    fatal?: boolean;
    llmFailureReason?: LlmFailureReason;
  }) {
    super(input.message);
    this.name = "AppError";
    this.code = input.code;
    this.statusCode = input.statusCode ?? 500;
    this.details = input.details;
    this.fatal = input.fatal ?? false;
    this.llmFailureReason = input.llmFailureReason;
  }
}
