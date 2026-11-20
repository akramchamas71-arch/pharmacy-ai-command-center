import { prisma } from "@/lib/prisma";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { Prisma, ProductType } from "@prisma/client";

export interface ProductInput {
  name: string;
  brand?: string | null;
  barcode?: string | null;
  genericName?: string | null;
  activeIngredient?: string | null;
  category?: string | null;
  type?: ProductType;
  imageUrl?: string | null;
}

export interface ProductSearchOptions {
  query?: string;
  type?: ProductType;
  category?: string;
  limit?: number;
}

/**
 * Case-insensitive substring match across the fields a pharmacist or the Phase 5 AI agent
 * would actually search by. Deliberately NOT fuzzy/typo-tolerant yet — the plan doc's AI
 * search layer (Phase 5) is where real fuzzy matching belongs (it can fall back to this
 * same query with normalized/transliterated terms); adding a Postgres trigram index here
 * now would be premature for a catalog screen that just needs "find by name or barcode."
 */
export async function searchProducts(opts: ProductSearchOptions = {}) {
  const { query, type, category, limit = 50 } = opts;

  return prisma.product.findMany({
    where: {
      AND: [
        type ? { type } : {},
        category ? { category: { equals: category, mode: "insensitive" } } : {},
        query
          ? {
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { brand: { contains: query, mode: "insensitive" } },
                { barcode: { contains: query, mode: "insensitive" } },
                { genericName: { contains: query, mode: "insensitive" } },
                { activeIngredient: { contains: query, mode: "insensitive" } },
              ],
            }
          : {},
      ],
    },
    orderBy: { name: "asc" },
    take: Math.min(limit, 200),
  });
}

export async function getProduct(id: string) {
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) throw new NotFoundError(`لا يوجد منتج بهذا المعرّف: ${id}`);
  return product;
}

export async function createProduct(input: ProductInput) {
  return prisma.product.create({ data: input });
}

export async function updateProduct(id: string, input: Partial<ProductInput>) {
  await getProduct(id);
  return prisma.product.update({ where: { id }, data: input });
}

/**
 * Catalog hygiene: a product referenced by any inventory row or past order line is part
 * of real history and must never disappear from under those records — discontinue it by
 * leaving it out of branch inventory instead of deleting the catalog entry.
 *
 * Phase 10 hardening: now also writes an audit_logs row — same gap as branches.ts
 * (disableBranch/enableBranch/deleteBranch), found during the same §16 traceability review.
 */
export async function deleteProduct(id: string, userId: string | null = null) {
  const product = await getProduct(id);

  const [inventoryCount, orderItemCount] = await Promise.all([
    prisma.inventory.count({ where: { productId: id } }),
    prisma.orderItem.count({ where: { productId: id } }),
  ]);

  if (inventoryCount > 0 || orderItemCount > 0) {
    throw new BusinessRuleError(
      "لا يمكن حذف منتج موجود في المخزون أو ضمن طلبات سابقة — أزل كمياته من كل الفروع بدلاً من حذف المنتج."
    );
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.product.delete({ where: { id } });
    await logAudit({ userId, action: "product.delete", entity: `Product:${id}`, oldValue: { name: product.name } }, tx);
  });
}
