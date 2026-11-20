import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { getStorageAdapter } from "@/lib/storage";
import { Prisma } from "@prisma/client";

// Storage keys are namespaced by what the document belongs to — "order"/"customer"/
// "carelink_job"/"general" per the Document model's own `ownerType` comment in
// schema.prisma — plus a random suffix so two uploads of the same filename never collide,
// without needing the storage provider to support any particular collision-handling
// behavior (S3/R2/GCS all differ on overwrite semantics; this sidesteps the question).
function buildStorageKey(ownerType: string, ownerId: string | null | undefined, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  return `${ownerType}/${ownerId ?? "general"}/${randomUUID()}-${safeName}`;
}

export interface UploadDocumentInput {
  ownerType: string;
  ownerId?: string | null;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  tags?: string[];
  metadata?: Prisma.InputJsonValue;
  uploadedBy?: string | null;
}

/**
 * Uploads the bytes through whatever StorageAdapter is configured (today: none —
 * getStorageAdapter() throws StorageConfigError, see src/lib/storage.ts) and records the
 * metadata row. Throws StorageConfigError before touching the database at all if storage
 * isn't configured yet — never creates an orphaned Document row pointing at a file that
 * was never actually stored.
 */
export async function uploadDocument(input: UploadDocumentInput) {
  const { ownerType, ownerId, fileName, mimeType, buffer, tags, metadata, uploadedBy } = input;

  const adapter = getStorageAdapter();
  const key = buildStorageKey(ownerType, ownerId, fileName);
  const { key: storedKey } = await adapter.upload({ key, buffer, contentType: mimeType });

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const doc = await tx.document.create({
      data: {
        ownerType,
        ownerId: ownerId ?? null,
        fileUrl: storedKey,
        fileName,
        mimeType,
        tags: tags ?? [],
        metadata: metadata ?? undefined,
        uploadedBy: uploadedBy ?? undefined,
      },
    });

    await logAudit(
      {
        userId: uploadedBy ?? null,
        action: "document.upload",
        entity: `Document:${doc.id}`,
        newValue: { fileName, mimeType, ownerType, ownerId: ownerId ?? null },
      },
      tx
    );

    return doc;
  });
}

export interface DocumentSearchOptions {
  query?: string;
  ownerType?: string;
  ownerId?: string;
  tag?: string;
  limit?: number;
}

/**
 * The canonical documents search — filename/tag substring matching only, no OCR or
 * semantic search yet (that needs documentAi.ts's classification to have actually run on
 * existing rows first). src/lib/aiTools.ts's search_documents Tool delegates to this
 * instead of keeping its own copy of the query.
 */
export async function searchDocuments(opts: DocumentSearchOptions = {}) {
  const { query, ownerType, ownerId, tag, limit = 20 } = opts;

  return prisma.document.findMany({
    where: {
      ownerType,
      ownerId,
      tags: tag ? { has: tag } : undefined,
      OR: query ? [{ fileName: { contains: query, mode: "insensitive" } }, { tags: { has: query } }] : undefined,
    },
    take: Math.min(limit, 100),
    orderBy: { createdAt: "desc" },
  });
}

export async function getDocument(id: string) {
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc) throw new NotFoundError(`لا يوجد مستند بهذا المعرّف: ${id}`);
  return doc;
}

/**
 * A time-limited link to the actual bytes — never returns `fileUrl` (the raw storage key)
 * directly to a caller, since that key is meaningless (and potentially provider-specific)
 * outside the adapter that wrote it.
 */
export async function getDocumentDownloadUrl(id: string, expiresInSeconds = 300): Promise<string> {
  const doc = await getDocument(id);
  const adapter = getStorageAdapter();
  return adapter.getDownloadUrl(doc.fileUrl, expiresInSeconds);
}

/**
 * Deletes both the stored bytes and the metadata row. Per the plan doc's §25 human-approval
 * list, "حذف ملفات" (deleting files) is one of the actions that needs a human — enforced by
 * DOCUMENTS_DELETE being excluded from the AI_AGENT role's grant (src/lib/aiTools.ts has no
 * delete tool at all), not by anything in this function; a human caller with the permission
 * can delete directly, same as every other DELETE route in this project.
 */
export async function deleteDocument(id: string, userId: string | null = null): Promise<void> {
  const doc = await getDocument(id);
  const adapter = getStorageAdapter();
  await adapter.delete(doc.fileUrl);

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.document.delete({ where: { id } });
    await logAudit(
      { userId, action: "document.delete", entity: `Document:${id}`, oldValue: { fileName: doc.fileName, ownerType: doc.ownerType } },
      tx
    );
  });
}
