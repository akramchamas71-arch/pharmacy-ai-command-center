import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS } from "@/lib/rbac";
import { getDocumentDownloadUrl } from "@/lib/documents";
import { StorageConfigError } from "@/lib/storage";
import { NotFoundError } from "@/lib/errors";

type Params = { params: Promise<{ id: string }> };

// Returns a time-limited link rather than the file itself — the route handler never
// proxies the bytes through Next.js, it just asks the storage adapter for a signed URL
// (or direct URL, for a public-read bucket) and hands that back.
export async function GET(req: NextRequest, { params }: Params) {
  const guard = await requirePermission(req, PERMISSIONS.DOCUMENTS_READ);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

  const sp = req.nextUrl.searchParams;
  const expiresInSeconds = sp.get("expiresInSeconds") ? Number(sp.get("expiresInSeconds")) : undefined;

  try {
    const url = await getDocumentDownloadUrl(id, expiresInSeconds);
    return NextResponse.json({ url, expiresInSeconds: expiresInSeconds ?? 300 });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof StorageConfigError) return NextResponse.json({ error: e.message }, { status: 501 });
    throw e;
  }
}
