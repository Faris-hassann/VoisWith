import { NextResponse } from "next/server";
import { env } from "@/lib/environment/env";
import { redactSecrets } from "@/lib/security/redact";

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await params;
    const response = await fetch(`${env.apiBaseUrl}${env.testRunsEndpoint}/${encodeURIComponent(runId)}/report.json`, {
      method: "GET",
      cache: "no-store",
    });
    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json",
        "content-disposition": response.headers.get("content-disposition") ?? `attachment; filename="testing-report-${runId}.json"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "PROXY_REQUEST_FAILED",
          message: "The Next.js proxy could not download the backend report.",
          details: redactSecrets(error),
        },
      },
      { status: 502 },
    );
  }
}
