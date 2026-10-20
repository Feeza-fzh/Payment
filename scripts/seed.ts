import { PrismaClient, PlanTier, Interval } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL_MIGRATE || process.env.DATABASE_URL,
    },
  },
});

async function main(): Promise<void> {
  const secretKey = process.env.FLW_SECRET_KEY;

  // Rule P-21 / FR-20: Refuse to run against live keys
  if (!secretKey || !secretKey.startsWith("FLWSECK_TEST-")) {
    console.error(
      "Refusing to seed: FLW_SECRET_KEY is not a valid Flutterwave test key (must start with 'FLWSECK_TEST-')."
    );
    process.exit(1);
  }

  const seedEmail = process.env.SEED_USER_EMAIL || "ada@example.com";

  console.log("Seeding plans...");
  // 1. Seed Plans (PRD §8, Decisions Log Q8)
  const plans = [
    {
      tier: PlanTier.FREE,
      interval: null,
      amountMinor: 0,
      currency: "NGN",
      active: true,
    },
    {
      tier: PlanTier.MONTHLY,
      interval: Interval.MONTH,
      amountMinor: 500000, // ₦5,000 in kobo
      currency: "NGN",
      active: true,
    },
    {
      tier: PlanTier.YEARLY,
      interval: Interval.YEAR,
      amountMinor: 5000000, // ₦50,000 in kobo
      currency: "NGN",
      active: true,
    },
  ];

  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { tier: plan.tier },
      update: {
        interval: plan.interval,
        amountMinor: plan.amountMinor,
        currency: plan.currency,
        active: plan.active,
      },
      create: plan,
    });
  }

  console.log(`Seeding user: ${seedEmail}...`);
  // 2. Seed User (PRD §7.3, FR-20)
  await prisma.user.upsert({
    where: { email: seedEmail },
    update: {},
    create: {
      email: seedEmail,
      plan: PlanTier.FREE,
    },
  });

  console.log("Seed completed successfully.");
}

main()
  .catch((err) => {
    console.error("Seeding error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
