import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS, canAccessBranch } from "@/lib/rbac";
import { sendReply, getConversationWithMessages } from "@/lib/conversations";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { WhatsAppConfigError } from "@/lib/whatsapp";

const sendSchema = z.object({
  conversationId: z.string().min(1),
  text: z.string().min(1),
});

// A human's reply from the inbox. Does NOT check assignedAgent === HUMAN — a
// CUSTOMER_SERVICE rep can reply even to an AI-assigned conversation (e.g. jumping in
// without formally taking over first); the inbox UI is expected to nudge toward TAKE OVER
// first, but the API itself doesn't block a reply on it.
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, PERMISSIONS.WHATSAPP_SEND);
  if (guard instanceof NextResponse) return guard;
  const session = guard;

  const body = await req.json().catch(() => null);
  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "البيانات المُدخلة غير صالحة", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const existing = await getConversationWithMessages(parsed.data.conversationId);
    if (existing.assignedBranchId && !canAccessBranch(session.branchId, existing.assignedBranchId)) {
      return NextResponse.json({ error: "لا يمكنك الرد على محادثة فرع آخر" }, { status: 403 });
    }

    const message = await sendReply({ ...parsed.data, userId: session.userId });
    return NextResponse.json({ message }, { status: 201 });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof WhatsAppConfigError) return NextResponse.json({ error: e.message }, { status: 500 });
    if (e instanceof BusinessRuleError || e instanceof Error) {
      // Meta's own rejection (24h window closed, invalid token, etc.) surfaces as a plain
      // Error from sendTextMessage — relay its message rather than a generic 500.
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
    throw e;
  }
}
