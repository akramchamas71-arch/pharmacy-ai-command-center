import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS } from "@/lib/rbac";
import { uploadDocument, searchDocuments } from "@/lib/documents";
import { StorageConfigError } from "@/lib/storage";

const uploadSchema = z.object({
  ownerType: z.string().min(1), // "order" | "customer" | "carelink_job" | "general" — see Document model's comment
  ownerId: z.string().optional().nullable(),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  // No multipart upload yet (no frontend to post a real <form> from) — base64 in a JSON
  // body, same shape a WhatsApp media download or an admin-dashboard upload would produce.
  contentBase64: z.string().min(1),
  tags: z.array(z.string()).optional(),
});

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, PERMISSIONS.DOCUMENTS_READ);
  if (guard instanceof NextResponse) return guard;

  const sp = req.nextUrl.searchParams;
  const documents = await searchDocuments({
    query: sp.get("query") ?? undefined,
    ownerType: sp.get("ownerType") ?? undefined,
    ownerId: sp.get("ownerId") ?? undefined,
    tag: sp.get("tag") ?? undefined,
    limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
  });
  return NextResponse.json({ documents });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, PERMISSIONS.DOCUMENTS_WRITE);
  if (guard instanceof NextResponse) return guard;
  const session = guard;

  const body = await req.json().catch(() => null);
  const parsed = uploadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "البيانات المُدخلة غير صالحة", details: parsed.error.flatten() }, { status: 400 });
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(parsed.data.contentBase64, "base64");
  } catch {
    return NextResponse.json({ error: "contentBase64 غير صالح" }, { status: 400 });
  }

  try {
    const document = await uploadDocument({
      ownerType: parsed.data.ownerType,
      ownerId: parsed.data.ownerId,
      fileName: parsed.data.fileName,
      mimeType: parsed.data.mimeType,
      buffer,
      tags: parsed.data.tags,
      uploadedBy: session.userId,
    });
    return NextResponse.json({ document }, { status: 201 });
  } catch (e) {
    if (e instanceof StorageConfigError) return NextResponse.json({ error: e.message }, { status: 501 });
    throw e;
  }
}
