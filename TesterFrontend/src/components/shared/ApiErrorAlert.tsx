import { ApiError } from "@/lib/api/errors";

export function ApiErrorAlert({ error }: { error: unknown }) {
  const apiError = error instanceof ApiError ? error : undefined;
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
      <div className="font-semibold">{apiError?.input.message ?? "Something went wrong."}</div>
      {apiError?.input.status ? <div className="mt-1">HTTP {apiError.input.status}</div> : null}
      {apiError?.input.correlationId ? <div className="mt-1 font-mono text-xs">Request ID: {apiError.input.correlationId}</div> : null}
      {apiError?.input.safeData ? (
        <details className="mt-3">
          <summary className="cursor-pointer">Safe technical details</summary>
          <pre className="mt-2 max-h-60 overflow-auto rounded bg-white/70 p-3 text-xs dark:bg-black/30">
            {JSON.stringify(apiError.input.safeData, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
