import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS, canAccessBranch } from "@/lib/rbac";
import { listConversations } from "@/lib/conversations";
import { AssignedAgent, ConversationStatus } from "@prisma/client";

// The WhatsApp Inbox (plan doc §15): every conversation, newest-activity first, with a
// one-message preview — gated behind WHATSAPP_SEND (the same permission CUSTOMER_SERVICE
// already holds) rather than a separate read-only permission, to keep Phase 4's footprint
// to the permissions Phase 1 already seeded.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, PERMISSIONS.WHATSAPP_SEND);
  if (guard instanceof NextResponse) return guard;
  const session = guard;

  const sp = req.nextUrl.searchParams;
  let branchId = sp.get("branchId") ?? undefined;
  if (session.branchId !== null) {
    if (branchId && !canAccessBranch(session.branchId, branchId)) {
      return NextResponse.json({ error: "لا يمكنك الاطلاع على محادثات فرع آخر" }, { status: 403 });
    }
    branchId = session.branchId;
  }

  const statusParam = sp.get("status");
  const status = statusParam && statusParam in ConversationStatus ? (statusParam as ConversationStatus) : undefined;
  const agentParam = sp.get("assignedAgent");
  const assignedAgent = agentParam && agentParam in AssignedAgent ? (agentParam as AssignedAgent) : undefined;

  const conversations = await listConversations({
    branchId,
    status,
    assignedAgent,
    limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
  });
  return NextResponse.json({ conversations });
}
