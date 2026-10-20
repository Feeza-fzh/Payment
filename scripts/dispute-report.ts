import { PrismaClient, PaymentOutcome } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Dispute report script per PRD §7.1, §10, Appendix A L23.
 * Queries PaymentLog for flagged rows:
 * - DUPLICATE_PAYMENT
 * - UNMATCHED_REFERENCE
 * - PAID_EXPIRED_SESSION
 * - UPGRADE_PERIOD_DRIFT
 * - PROVIDER_ERROR
 *
 * Supports manual review and refunds in the Flutterwave dashboard.
 */
async function generateDisputeReport(): Promise<void> {
  console.log("===============================================================");
  console.log("SubSlice — Payment Dispute and Manual Review Report");
  console.log("===============================================================\n");

  const flaggedLogs = await prisma.paymentLog.findMany({
    where: {
      outcome: {
        in: [
          PaymentOutcome.DUPLICATE_PAYMENT,
          PaymentOutcome.UNMATCHED_REFERENCE,
          PaymentOutcome.PAID_EXPIRED_SESSION,
          PaymentOutcome.UPGRADE_PERIOD_DRIFT,
          PaymentOutcome.PROVIDER_ERROR,
        ],
      },
    },
    include: {
      user: true,
      checkoutSession: true,
    },
    orderBy: { createdAt: "desc" },
  });

  if (flaggedLogs.length === 0) {
    console.log("No disputed or flagged payment logs found. All payments clear.\n");
    return;
  }

  console.log(`Found ${flaggedLogs.length} flagged transaction(s):\n`);

  for (const log of flaggedLogs) {
    console.log(`[${log.outcome}] ID: ${log.id}`);
    console.log(`  Event: ${log.eventType} | Source: ${log.source}`);
    console.log(`  Created: ${log.createdAt.toISOString()}`);
    console.log(`  User: ${log.user?.email ?? "N/A"} (${log.userId ?? "None"})`);
    console.log(`  Provider Ref: ${log.providerRef}`);
    console.log(`  Provider Tx ID: ${log.providerTransactionId ?? "None"}`);
    console.log(`  Amount: ${log.amountMinor ?? 0} ${log.currency ?? "NGN"}`);
    console.log(`  Payload: ${JSON.stringify(log.payload)}`);
    console.log("---------------------------------------------------------------");
  }

  console.log("\nReview complete.\n");
}

generateDisputeReport()
  .catch((err) => {
    console.error("Dispute report error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
