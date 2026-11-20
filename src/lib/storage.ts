/**
 * The Storage Adapter for Phase 8 (Document AI) — "رفع، تصنيف، OCR عند الحاجة". The plan
 * doc's own decisions table lists file storage as a real open decision ("تخزين الملفات —
 * قرار معلق: S3 / Cloudflare R2 / Google Cloud Storage — أيهم متاح أو مفضّل لديك؟"), and
 * this project's hard rule is to never invent a fake API for an integration that isn't
 * decided yet — build the Adapter Interface instead. This file IS that interface: every
 * other Phase 8 file (documents.ts, documentAi.ts, the API routes) talks to storage only
 * through `StorageAdapter`, never to a vendor SDK directly, so picking S3 vs. R2 vs. GCS
 * later is a one-file change here, not a rewrite of the business logic.
 *
 * DECIDED (this session, as part of the hosting decision — see DEPLOY.md and README's
 * "Hosting & storage decision" section): Cloudflare R2. Reasoning, not a coin flip — R2 is
 * S3-API-compatible (so `R2Adapter` below is really a thin `@aws-sdk/client-s3` config, the
 * real documented S3 SDK, never an invented client) and has zero egress fees, which matters
 * because `documentAi.ts`'s OCR/classification path downloads every file's bytes back out of
 * storage on every classification call. R2 was chosen independently of where the app server
 * itself runs (see DEPLOY.md) — nothing here requires the app to run ON Cloudflare Workers.
 */
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface UploadInput {
  /** Storage key/path — callers (documents.ts) generate this, not the adapter. */
  key: string;
  buffer: Buffer;
  contentType: string;
}

export interface UploadResult {
  /** A durable reference to the stored object — NOT assumed to be a public URL (R2/S3
   *  buckets are typically private; see getDownloadUrl()). Stored as Document.fileUrl. */
  key: string;
}

export interface StorageAdapter {
  upload(input: UploadInput): Promise<UploadResult>;
  /** A time-limited signed URL (or direct URL, for a public-read bucket) good for
   *  `expiresInSeconds`. Every real object-storage provider supports this natively. */
  getDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  /** Fetches the raw bytes — needed by documentAi.ts to hand the file to the OCR/
   *  classification call; not every adapter method needs a signed URL round-trip. */
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageConfigError";
  }
}

/**
 * R2 is S3-API-compatible — this is a real `@aws-sdk/client-s3` client pointed at R2's
 * S3-compatible endpoint (`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`), per Cloudflare's
 * own documented R2 + aws-sdk-js-v3 integration. No invented client, no stand-in: this is
 * the same SDK you'd use for real AWS S3, just repointed.
 *
 * UNTESTED IN THIS SANDBOX: there is no real R2 bucket/credentials here to call against —
 * same "written and type-checked, not yet exercised against a live account" posture as
 * src/lib/anthropic.ts before its key existed. Create the bucket and credentials per
 * DEPLOY.md, fill in .env, and the Phase 8 routes (currently returning a clean 501 via
 * getStorageAdapter()'s throw) will start actually moving bytes — no other code change.
 */
class R2Adapter implements StorageAdapter {
  private client: S3Client;
  private bucket: string;

  constructor(opts: { accountId: string; bucket: string; accessKeyId: string; secretAccessKey: string }) {
    this.bucket = opts.bucket;
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${opts.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
      },
    });
  }

  async upload(input: UploadInput): Promise<UploadResult> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.buffer,
        ContentType: input.contentType,
      })
    );
    return { key: input.key };
  }

  async getDownloadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async download(key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const chunks: Uint8Array[] = [];
    // AWS SDK v3's Body is a web/node stream depending on runtime — both expose an async
    // iterator, which is all this needs (keeps this file runnable under both Node hosting
    // and a Cloudflare Workers runtime, consistent with DEPLOY.md's chosen architecture).
    for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

let cachedAdapter: StorageAdapter | null = null;

/**
 * The one place that needed editing once a provider was picked (R2 — see this file's top
 * comment). Nothing else in Phase 8 needed to change — every caller already goes through
 * this one function, same as `getStorageAdapter()` was designed for from the start.
 */
export function getStorageAdapter(): StorageAdapter {
  if (cachedAdapter) return cachedAdapter;

  const provider = process.env.FILE_STORAGE_PROVIDER;
  if (provider === "r2") {
    const accountId = process.env.R2_ACCOUNT_ID;
    const bucket = process.env.R2_BUCKET;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
      throw new StorageConfigError(
        "FILE_STORAGE_PROVIDER=r2 لكن أحد المتغيرات التالية ناقص: R2_ACCOUNT_ID, R2_BUCKET, " +
          "R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY — راجع .env.example وDEPLOY.md."
      );
    }
    cachedAdapter = new R2Adapter({ accountId, bucket, accessKeyId, secretAccessKey });
    return cachedAdapter;
  }

  throw new StorageConfigError(
    "لم يُضبط FILE_STORAGE_PROVIDER في .env بعد. المزوّد المختار لهذا المشروع هو Cloudflare R2 " +
      "(راجع DEPLOY.md) — أضف FILE_STORAGE_PROVIDER=r2 ومتغيرات R2_* الأربعة بعد إنشاء الـ bucket."
  );
}
