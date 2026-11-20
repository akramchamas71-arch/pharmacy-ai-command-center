import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS } from "@/lib/rbac";
import { runDocumentAi } from "@/lib/documentAi";
import { StorageConfigError } from "@/lib/storage";
import { AnthropicConfigError } from "@/lib/anthropic";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";

type Params = { params: Promise<{ id: string }> };

/**
 * The "OCR عند الحاجة" trigger — explicit, not automatic on upload (see documentAi.ts's own
 * comment for why). DOCUMENTS_WRITE, same permission as uploading, since this writes new
 * tags/metadata onto the document rather than deleting or reading it.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await requirePermission(req, PERMISSIONS.DOCUMENTS_WRITE);
  if (guard instanceof NextResponse) return guard;
  const session = guard;
  const { id } = await params;

  try {
    const document = await runDocumentAi(id, session.userId);
    return NextResponse.json({ document });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof BusinessRuleError) return NextResponse.json({ error: e.message }, { status: 409 });
    if (e instanceof StorageConfigError) return NextResponse.json({ error: e.message }, { status: 501 });
    if (e instanceof AnthropicConfigError) return NextResponse.json({ error: e.message }, { status: 501 });
    throw e;
  }
}
