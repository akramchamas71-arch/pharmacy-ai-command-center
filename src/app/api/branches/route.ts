import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS } from "@/lib/rbac";
import { listBranches, createBranch } from "@/lib/branches";

const branchInputSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  whatsappNumber: z.string().optional().nullable(),
  workingHours: z.string().optional().nullable(),
});

// Branch reference data is low-sensitivity and every role needs it (branch pickers, the
// WhatsApp routing screen, delivery assignment) — any logged-in user may list branches;
// only BRANCHES_MANAGE may create one. `?includeDisabled=true` is for the admin screen
// that manages disabled branches; everyone else sees only ACTIVE ones by default.
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) {
    return NextResponse.json({ error: "غير مصرح — الرجاء تسجيل الدخول" }, { status: 401 });
  }

  const includeDisabled = req.nextUrl.searchParams.get("includeDisabled") === "true";
  const branches = await listBranches(includeDisabled);
  return NextResponse.json({ branches });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, PERMISSIONS.BRANCHES_MANAGE);
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => null);
  const parsed = branchInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "البيانات المُدخلة غير صالحة", details: parsed.error.flatten() }, { status: 400 });
  }

  const branch = await createBranch(parsed.data);
  return NextResponse.json({ branch }, { status: 201 });
}
