import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/errors";

export interface CustomerUpsertInput {
  phone: string;
  name?: string | null;
  address?: string | null;
}

/**
 * Phone is the customer's identity (it's the WhatsApp identity too, per the plan doc) —
 * taking a phone/walk-in order looks the customer up by phone first and only creates a
 * new record when none exists, rather than ever creating a duplicate per order.
 *
 * Accepts an optional transaction client so order creation (src/lib/orders.ts) can run the
 * customer lookup/create as part of the SAME transaction as the order + reservation — if
 * the order fails, the customer row it would have created never commits either.
 */
export async function findOrCreateCustomerByPhone(
  input: CustomerUpsertInput,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  const { phone, name, address } = input;

  const existing = await client.customer.findUnique({ where: { phone } });
  if (existing) {
    // A name/address given on a later order fills in what was missing, but never
    // overwrites what the customer (or WhatsApp, in Phase 4) already told us.
    if ((name && !existing.name) || (address && !existing.address)) {
      return client.customer.update({
        where: { id: existing.id },
        data: {
          name: existing.name ?? name,
          address: existing.address ?? address,
        },
      });
    }
    return existing;
  }

  return client.customer.create({ data: { phone, name, address } });
}

export async function getCustomer(id: string) {
  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) throw new NotFoundError(`لا يوجد عميل بهذا المعرّف: ${id}`);
  return customer;
}

export async function searchCustomers(query?: string, limit = 50) {
  return prisma.customer.findMany({
    where: query
      ? {
          OR: [
            { phone: { contains: query, mode: "insensitive" } },
            { name: { contains: query, mode: "insensitive" } },
          ],
        }
      : {},
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
  });
}
