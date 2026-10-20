import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const txRef = searchParams.get("txRef");

  if (!txRef) {
    return NextResponse.json(
      { error: "Missing txRef query parameter" },
      { status: 400 }
    );
  }

  try {
    const session = await db.checkoutSession.findUnique({
      where: { txRef },
      include: { targetPlan: true },
    });

    if (!session) {
      return NextResponse.json(
        { error: "Checkout session not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      status: session.status,
      plan: session.targetPlan.tier,
    });
  } catch {
    return NextResponse.json(
      { error: "Database error reading checkout status" },
      { status: 500 }
    );
  }
}
