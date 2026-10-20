import { NextRequest, NextResponse } from "next/server";
import { handleWebhook } from "@/server/payments/handleWebhook";
import { checkRateLimit, getClientIp } from "@/server/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const clientIp = getClientIp(request.headers);
  const rateLimit = await checkRateLimit({
    key: `webhook:ip:${clientIp}`,
    limit: 60,
    windowSeconds: 60,
  });

  if (!rateLimit.allowed) {
    const retryAfter = String(rateLimit.retryAfterSeconds ?? 60);
    return new NextResponse("Too Many Requests", {
      status: 429,
      headers: { "Retry-After": retryAfter },
    });
  }

  const signatureHeader = request.headers.get("verif-hash");
  const rawBody = await request.text();

  const result = await handleWebhook(rawBody, signatureHeader);

  return new NextResponse(result.message, { status: result.status });
}
