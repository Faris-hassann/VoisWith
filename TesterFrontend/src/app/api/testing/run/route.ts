import { NextResponse } from "next/server";
import { env } from "@/lib/environment/env";
import { redactSecrets } from "@/lib/security/redact";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 360000);
    const response = await fetch(`${env.apiBaseUrl}${env.testRunEndpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);
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
          message: "The Next.js proxy could not reach the backend.",
          details: redactSecrets(error),
        },
      },
      { status: 502 },
    );
  }
}
