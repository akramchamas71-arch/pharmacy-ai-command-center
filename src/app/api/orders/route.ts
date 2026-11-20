import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS, canAccessBranch } from "@/lib/rbac";
import { createOrder, listOrders } from "@/lib/orders";
import { BusinessRuleError } from "@/lib/errors";
import { OrderStatus, PaymentMethod } from "@prisma/client";

const createOrderSchema = z.object({
  branchId: z.string().min(1),
  customerPhone: z.string().min(3),
  customerName: z.string().optional(),
  deliveryAddress: z.string().optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  notes: z.string().optional(),
  items: z
    .array(z.object({ productId: z.string().min(1), qty: z.number().int().positive() }))
    .min(1),
});

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, PERMISSIONS.ORDERS_READ);
  if (guard instanceof NextResponse) return guard;
  const session = guard;

  const sp = req.nextUrl.searchParams;
  let branchId = sp.get("branchId") ?? undefined;

  if (session.branchId !== null) {
    if (branchId && !canAccessBranch(session.branchId, branchId)) {
      return NextResponse.json({ error: "لا يمكنك الاطلاع على طلبات فرع آخر" }, { status: 403 });
    }
    branchId = session.branchId;
  }

  const statusParam = sp.get("status");
  const status = statusParam && statusParam in OrderStatus ? (statusParam as OrderStatus) : undefined;

  const orders = await listOrders({
    branchId,
    status,
    customerId: sp.get("customerId") ?? undefined,
    limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
  });
  return NextResponse.json({ orders });
}

// Creates the order AND holds its stock atomically — see src/lib/orders.ts createOrder().
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, PERMISSIONS.ORDERS_WRITE);
  if (guard instanceof NextResponse) return guard;
  const session = guard;

  const body = await req.json().catch(() => null);
  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "البيانات المُدخلة غير صالحة", details: parsed.error.flatten() }, { status: 400 });
  }

  if (!canAccessBranch(session.branchId, parsed.data.branchId)) {
    return NextResponse.json({ error: "لا يمكنك إنشاء طلب لفرع آخر" }, { status: 403 });
  }

  try {
    const order = await createOrder({ ...parsed.data, userId: session.userId });
    return NextResponse.json({ order }, { status: 201 });
  } catch (e) {
    if (e instanceof BusinessRuleError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
