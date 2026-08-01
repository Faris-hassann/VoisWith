import { redactSecrets } from "../security/redact";

export class ApiError extends Error {
  constructor(
    public readonly input: {
      status?: number;
      code?: string;
      message: string;
      validationDetails?: unknown;
      runId?: string;
      correlationId?: string;
      safeData?: unknown;
    },
  ) {
    super(input.message);
    this.name = "ApiError";
  }
}

export async function createApiError(response: Response): Promise<ApiError> {
  const correlationId = response.headers.get("x-request-id") ?? undefined;
  const contentType = response.headers.get("content-type") ?? "";
  let data: unknown;
  if (contentType.includes("application/json")) {
    data = await response.json().catch(() => undefined);
  } else {
    data = await response.text().catch(() => undefined);
  }
  const errorObject = isRecord(data) && isRecord(data.error) ? data.error : undefined;
  return new ApiError({
    status: response.status,
    code: isRecord(errorObject) && typeof errorObject.code === "string" ? errorObject.code : undefined,
    message:
      isRecord(errorObject) && typeof errorObject.message === "string"
        ? errorObject.message
        : `Backend request failed with HTTP ${response.status}.`,
    validationDetails: isRecord(errorObject) ? errorObject.details : undefined,
    correlationId:
      isRecord(errorObject) && typeof errorObject.requestId === "string" ? errorObject.requestId : correlationId,
    safeData: redactSecrets(data),
  });
}

export function mapNetworkError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const message =
    error instanceof DOMException && error.name === "AbortError"
      ? "The request was cancelled or timed out."
      : "The browser could not access the backend. Verify that the Express CORS configuration allows the frontend origin.";
  return new ApiError({ message, safeData: redactSecrets(error) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
