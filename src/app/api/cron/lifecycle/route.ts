import { NextRequest, NextResponse } from "next/server";
import { runLifecycle } from "@/server/lifecycle/runLifecycle";
import { runRenewals } from "@/server/lifecycle/runRenewals";

export const dynamic = "force-dynamic";

/**
 * Daily cron route protected by CRON_SECRET (Rule L-10, S-8).
 * Executes runLifecycle, then runRenewals.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("Authorization");
  const providedSecret = authHeader?.replace("Bearer ", "") || request.nextUrl.searchParams.get("secret");

  if (!cronSecret || providedSecret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const lifecycleResult = await runLifecycle();
    const renewalsResult = await runRenewals();

    return NextResponse.json({
      ok: true,
      lifecycle: lifecycleResult,
      renewals: renewalsResult,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
