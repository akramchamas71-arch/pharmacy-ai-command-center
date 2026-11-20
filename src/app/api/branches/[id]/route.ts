import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS } from "@/lib/rbac";
import { getBranch, updateBranch, enableBranch, disableBranch, deleteBranch } from "@/lib/branches";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";

const branchUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  whatsappNumber: z.string().optional().nullable(),
  workingHours: z.string().optional().nullable(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const session = getSession(req);
  if (!session) {
    return NextResponse.json({ error: "غير مصرح — الرجاء تسجيل الدخول" }, { status: 401 });
  }
  const { id } = await params;

  try {
    const branch = await getBranch(id);
    return NextResponse.json({ branch });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requirePermission(req, PERMISSIONS.BRANCHES_MANAGE);
  if (guard instanceof NextResponse) return guard;
  const session = guard;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = branchUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "البيانات المُدخلة غير صالحة", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { status, ...rest } = parsed.data;
    let branch = await updateBranch(id, rest);
    // status is a separate, explicit action (enable/disable) rather than a plain field
    // write, so the plan doc's "add/remove without code changes" stays an intentional
    // admin action, not a side effect of an unrelated PATCH.
    if (status === "DISABLED") branch = await disableBranch(id, session.userId);
    if (status === "ACTIVE") branch = await enableBranch(id, session.userId);
    return NextResponse.json({ branch });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const guard = await requirePermission(req, PERMISSIONS.BRANCHES_MANAGE);
  if (guard instanceof NextResponse) return guard;
  const session = guard;
  const { id } = await params;

  try {
    await deleteBranch(id, session.userId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof BusinessRuleError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
