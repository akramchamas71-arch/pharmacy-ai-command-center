import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS, canAccessBranch } from "@/lib/rbac";
import { getConversationWithMessages } from "@/lib/conversations";
import { NotFoundError } from "@/lib/errors";

type Params = { params: Promise<{ id: string }> };

// The full thread behind one inbox row.
export async function GET(req: NextRequest, { params }: Params) {
  const guard = await requirePermission(req, PERMISSIONS.WHATSAPP_SEND);
  if (guard instanceof NextResponse) return guard;
  const session = guard;
  const { id } = await params;

  try {
    const conversation = await getConversationWithMessages(id);
    if (conversation.assignedBranchId && !canAccessBranch(session.branchId, conversation.assignedBranchId)) {
      return NextResponse.json({ error: "لا يمكنك الاطلاع على محادثة فرع آخر" }, { status: 403 });
    }
    return NextResponse.json({ conversation });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
