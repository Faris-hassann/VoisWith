import { NextResponse } from "next/server";
import { env } from "@/lib/environment/env";
import { redactSecrets } from "@/lib/security/redact";

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await params;
    const response = await fetch(`${env.apiBaseUrl}${env.testRunsEndpoint}/${encodeURIComponent(runId)}`, {
      method: "GET",
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
          message: "The Next.js proxy could not read the backend run.",
          details: redactSecrets(error),
        },
      },
      { status: 502 },
    );
  }
}
