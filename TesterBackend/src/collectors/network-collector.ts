import type { Page, Request } from "playwright";
import type { NetworkObservation } from "../types/report.js";
import { redactString } from "../security/secret-redaction.js";

export class NetworkCollector {
  private readonly observations: NetworkObservation[] = [];
  private readonly requestStartedAt = new Map<Request, number>();

  constructor(private readonly targetOrigin: string) {}

  attach(page: Page): void {
    page.on("request", (request) => {
      this.requestStartedAt.set(request, Date.now());
    });
    page.on("requestfailed", (request) => {
      this.observations.push(this.toObservation(request, undefined, request.failure()?.errorText));
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        this.observations.push(this.toObservation(response.request(), response.status()));
      }
    });
  }

  all(): NetworkObservation[] {
    return [...this.observations];
  }

  failed(): NetworkObservation[] {
    return this.observations.filter((item) => item.failureReason || (item.status ?? 0) >= 400);
  }

  apiCalls(): NetworkObservation[] {
    return this.observations.filter((item) => item.appearsApiRequest);
  }

  private toObservation(request: Request, status?: number, failureReason?: string): NetworkObservation {
    const started = this.requestStartedAt.get(request);
    const url = redactString(request.url());
    return {
      url,
      method: request.method(),
      resourceType: request.resourceType(),
      status,
      durationMs: started ? Date.now() - started : undefined,
      failureReason: failureReason ? redactString(failureReason) : undefined,
      sameOrigin: safeOrigin(url) === this.targetOrigin,
      appearsApiRequest: /\/api\/|\/graphql|\/rest\/|application\/json/i.test(url),
    };
  }
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}
