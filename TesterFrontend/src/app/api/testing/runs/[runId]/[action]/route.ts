import { NextResponse } from "next/server";
import { env } from "@/lib/environment/env";
import { redactSecrets } from "@/lib/security/redact";

const CONTROL_ACTIONS = new Set(["pause", "resume", "stop"]);

export async function POST(_request: Request, { params }: { params: Promise<{ runId: string; action: string }> }) {
  try {
    const { runId, action } = await params;
    if (!CONTROL_ACTIONS.has(action)) {
      return NextResponse.json({ error: { code: "UNKNOWN_RUN_ACTION", message: "Unknown run action." } }, { status: 404 });
    }
    const response = await fetch(`${env.apiBaseUrl}${env.testRunsEndpoint}/${encodeURIComponent(runId)}/${action}`, {
      method: "POST",
      cache: "no-store",
    });
    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json",
        "x-request-id": response.headers.get("x-request-id") ?? "",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "PROXY_REQUEST_FAILED",
          message: "The Next.js proxy could not control the backend run.",
          details: redactSecrets(error),
        },
      },
      { status: 502 },
    );
  }
}
