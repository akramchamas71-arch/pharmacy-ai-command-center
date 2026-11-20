import { Prisma } from "@prisma/client";

/**
 * ORD-YYYY-NNNNNN (e.g. ORD-2026-000125), per the plan doc's order numbering scheme.
 * NNNNNN resets to 1 every calendar year and is zero-padded to 6 digits.
 *
 * Must be called with the `tx` of the SAME transaction that creates the Order row — the
 * increment on `order_sequences` and the Order insert commit or roll back together, and
 * Postgres's row-level lock on the sequence row is what makes two concurrent order
 * creations never collide on a number (the second transaction simply waits for the first
 * UPDATE to commit before its own increment reads the new value).
 */
export async function generateOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear();

  const seq = await tx.orderSequence.upsert({
    where: { year },
    update: { lastNumber: { increment: 1 } },
    create: { year, lastNumber: 1 },
  });

  const padded = String(seq.lastNumber).padStart(6, "0");
  return `ORD-${year}-${padded}`;
}
