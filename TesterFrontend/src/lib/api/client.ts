import { env } from "../environment/env";
import { createApiError, mapNetworkError } from "./errors";

export interface ApiClientOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function apiRequest<T>(
  endpoint: string,
  init: RequestInit = {},
  options: ApiClientOptions = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 330000);
  const signal = mergeSignals(controller.signal, options.signal);
  const url = endpoint.startsWith("http") ? endpoint : `${env.apiBaseUrl}${endpoint}`;

  try {
    const response = await fetch(url, {
      ...init,
      signal,
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) throw await createApiError(response);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return undefined as T;
    return (await response.json()) as T;
  } catch (error) {
    throw mapNetworkError(error);
  } finally {
    clearTimeout(timeout);
  }
}

function mergeSignals(a: AbortSignal, b?: AbortSignal): AbortSignal {
  if (!b) return a;
  const controller = new AbortController();
  const abort = () => controller.abort();
  a.addEventListener("abort", abort, { once: true });
  b.addEventListener("abort", abort, { once: true });
  return controller.signal;
}
