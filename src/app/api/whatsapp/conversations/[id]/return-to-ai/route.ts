import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS } from "@/lib/rbac";
import { returnToAI } from "@/lib/conversations";
import { NotFoundError } from "@/lib/errors";

type Params = { params: Promise<{ id: string }> };

// The inbox's "RETURN TO AI" button — the other half of §15's human/AI handoff. Note: in
// Phase 4 this only flips the flag; nothing actually auto-replies yet (that's Phase 5), so
// a returned conversation simply waits for Phase 5's orchestrator to pick it up.
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await requirePermission(req, PERMISSIONS.WHATSAPP_TAKEOVER);
  if (guard instanceof NextResponse) return guard;
  const session = guard;
  const { id } = await params;

  try {
    const conversation = await returnToAI(id, session.userId);
    return NextResponse.json({ conversation });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
