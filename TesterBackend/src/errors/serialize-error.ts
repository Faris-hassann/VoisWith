import { redactSecrets } from "../security/secret-redaction.js";

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  details?: unknown;
}

export function serializeError(error: unknown): SerializedError {
  const fallback = "Unknown error";

  if (error instanceof Error) {
    const withCode = error as Error & { code?: unknown; details?: unknown };
    return redactSecrets({
      name: error.name || "Error",
      message: error.message || fallback,
      stack: error.stack,
      code: typeof withCode.code === "string" ? withCode.code : undefined,
      details: withCode.details,
    });
  }

  if (isRecord(error)) {
    const name = stringValue(error.name) ?? "ThrownObject";
    const message = stringValue(error.message) ?? stringifyRecord(error) ?? fallback;
    return redactSecrets({
      name,
      message,
      stack: stringValue(error.stack),
      code: stringValue(error.code),
      details: safeDetails(error),
    });
  }

  return redactSecrets({
    name: typeof error,
    message: stringValue(error) ?? fallback,
  });
}

export function errorMessage(error: unknown): string {
  return serializeError(error).message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return undefined;
}

function stringifyRecord(value: Record<string, unknown>): string | undefined {
  const entries = Object.entries(value);
  if (entries.length === 0) return "Thrown empty object";
  try {
    return JSON.stringify(value);
  } catch {
    return "Thrown object could not be serialized";
  }
}

function safeDetails(value: Record<string, unknown>): unknown {
  const { name: _name, message: _message, stack: _stack, code: _code, ...details } = value;
  return Object.keys(details).length > 0 ? details : undefined;
}
