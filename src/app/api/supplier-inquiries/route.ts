import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS } from "@/lib/rbac";
import { listSupplierInquiries } from "@/lib/suppliers";

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, PERMISSIONS.ORDERS_READ);
  if (guard instanceof NextResponse) return guard;
  const inquiries = await listSupplierInquiries(100);
  return NextResponse.json({ inquiries });
}
