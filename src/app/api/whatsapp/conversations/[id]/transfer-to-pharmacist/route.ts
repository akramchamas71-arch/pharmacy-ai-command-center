import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS } from "@/lib/rbac";
import { transferToPharmacist } from "@/lib/conversations";
import { NotFoundError } from "@/lib/errors";

type Params = { params: Promise<{ id: string }> };

// The plan doc's mandatory medication-safety handoff (§7) — manual in Phase 4; Phase 5
// will have the AI trigger this itself the moment it detects a PRESCRIPTION/CONTROLLED
// product or a clinical question in the conversation.
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await requirePermission(req, PERMISSIONS.WHATSAPP_TAKEOVER);
  if (guard instanceof NextResponse) return guard;
  const session = guard;
  const { id } = await params;

  try {
    const conversation = await transferToPharmacist(id, session.userId);
    return NextResponse.json({ conversation });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
