import { NextRequest, NextResponse } from "next/server";
import { handleWebhook } from "@/server/payments/handleWebhook";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const signatureHeader = request.headers.get("verif-hash");
  const rawBody = await request.text();

  const result = await handleWebhook(rawBody, signatureHeader);

  return new NextResponse(result.message, { status: result.status });
}
