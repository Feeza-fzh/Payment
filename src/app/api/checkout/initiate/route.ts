import { NextRequest, NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { initiateCheckout } from "@/server/payments/initiateCheckout";

export const dynamic = "force-dynamic";

const InitiateSchema = z.object({
  planTier: z.enum(["MONTHLY", "YEARLY"]),
});

export async function POST(request: NextRequest): Promise<NextResponse | never> {
  const appBaseUrl = process.env.APP_BASE_URL || "http://localhost:3000";

  // Rule P-24, T33: Check Origin header
  const origin = request.headers.get("origin");
  if (origin && origin !== appBaseUrl) {
    try {
      const originHost = new URL(origin).host;
      const appHost = new URL(appBaseUrl).host;
      if (originHost !== appHost) {
        return NextResponse.json(
          { error: "Forbidden: Origin mismatch" },
          { status: 403 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: "Forbidden: Invalid Origin header" },
        { status: 403 }
      );
    }
  }

  // Parse body depending on content-type
  let planTierRaw: unknown;
  const contentType = request.headers.get("content-type") || "";
  const isForm =
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data");

  if (isForm) {
    const formData = await request.formData();
    planTierRaw = formData.get("planTier");
  } else {
    try {
      const body = (await request.json()) as { planTier?: unknown };
      planTierRaw = body?.planTier;
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON payload" },
        { status: 400 }
      );
    }
  }

  const parsed = InitiateSchema.safeParse({ planTier: planTierRaw });
  if (!parsed.success) {
    if (isForm) {
      redirect("/plans?error=invalid_plan");
    }
    return NextResponse.json(
      { error: "Invalid plan tier. Must be MONTHLY or YEARLY." },
      { status: 400 }
    );
  }

  // Seed user email per Rule L-8 / PRD §7.3
  const seedEmail = process.env.SEED_USER_EMAIL || "ada@example.com";

  const result = await initiateCheckout({
    planTier: parsed.data.planTier,
    userEmail: seedEmail,
  });

  if (!result.ok) {
    if (isForm) {
      redirect(`/plans?error=${encodeURIComponent(result.error)}`);
    }
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  if (isForm) {
    redirect(result.checkoutUrl);
  }

  return NextResponse.json({ ok: true, checkoutUrl: result.checkoutUrl });
}
