import { NextResponse } from "next/server";
import { env } from "@/lib/environment/env";
import { redactSecrets } from "@/lib/security/redact";

export async function GET() {
  try {
    const response = await fetch(`${env.apiBaseUrl}${env.testRunsEndpoint}`, { method: "GET", cache: "no-store" });
    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
    });
  } catch (error) {
    return NextResponse.json({ error: { code: "PROXY_REQUEST_FAILED", message: "The Next.js proxy could not list backend runs.", details: redactSecrets(error) } }, { status: 502 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const response = await fetch(`${env.apiBaseUrl}${env.testRunsEndpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
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
          message: "The Next.js proxy could not start the backend run.",
          details: redactSecrets(error),
        },
      },
      { status: 502 },
    );
  }
}
