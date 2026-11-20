import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS } from "@/lib/rbac";
import { getDocument, deleteDocument } from "@/lib/documents";
import { StorageConfigError } from "@/lib/storage";
import { NotFoundError } from "@/lib/errors";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const guard = await requirePermission(req, PERMISSIONS.DOCUMENTS_READ);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

  try {
    const document = await getDocument(id);
    return NextResponse.json({ document });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const guard = await requirePermission(req, PERMISSIONS.DOCUMENTS_DELETE);
  if (guard instanceof NextResponse) return guard;
  const session = guard;
  const { id } = await params;

  try {
    await deleteDocument(id, session.userId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof StorageConfigError) return NextResponse.json({ error: e.message }, { status: 501 });
    throw e;
  }
}
