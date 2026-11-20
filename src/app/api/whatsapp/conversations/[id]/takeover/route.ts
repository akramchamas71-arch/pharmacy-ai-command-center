import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS } from "@/lib/rbac";
import { takeOverConversation } from "@/lib/conversations";
import { NotFoundError } from "@/lib/errors";

type Params = { params: Promise<{ id: string }> };

// The inbox's "TAKE OVER" button (plan doc §15) — moves assignedAgent AI -> HUMAN so a
// person, not the (future, Phase 5) AI, is the one replying from here on.
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await requirePermission(req, PERMISSIONS.WHATSAPP_TAKEOVER);
  if (guard instanceof NextResponse) return guard;
  const session = guard;
  const { id } = await params;

  try {
    const conversation = await takeOverConversation(id, session.userId);
    return NextResponse.json({ conversation });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
