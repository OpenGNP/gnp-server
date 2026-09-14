import { Client } from "minio";

import { env } from "../config/env";

/**
 * Private object storage for uploaded assets (currently: form cover images).
 * Deliberately never exposed to the browser — no public bucket policy, no
 * presigned URLs handed to a client. The MinIO host itself may not even be
 * reachable outside the KMUTT network, and even where it is, "private bucket +
 * server-side fetch" means every read is forced through the API's own
 * accessType checks (assertAccessible in formService.ts) instead of a
 * guessable/leakable direct link.
 */
export const minioClient = new Client({
  endPoint: env.MINIO_ENDPOINT,
  port: env.MINIO_PORT,
  useSSL: env.MINIO_USE_SSL,
  accessKey: env.MINIO_ACCESS_KEY,
  secretKey: env.MINIO_SECRET_KEY,
});

const BUCKET = env.MINIO_BUCKET;

// Memoized so we only check/create the bucket once per process, not per request.
let bucketReady: Promise<void> | null = null;

function ensureBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      const exists = await minioClient.bucketExists(BUCKET).catch(() => false);
      if (!exists) {
        await minioClient.makeBucket(BUCKET);
      }
    })().catch((error: unknown) => {
      bucketReady = null; // let the next call retry instead of caching a failure forever
      throw error;
    });
  }
  return bucketReady;
}

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const ALLOWED_COVER_IMAGE_MIME_TYPES = Object.keys(EXT_BY_MIME);

/** Derives the Content-Type to serve from the object key's extension — the key IS the format record, so no separate DB column is needed for it. */
export function contentTypeForKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream";
}

export function extensionForMimeType(mimeType: string): string | null {
  return EXT_BY_MIME[mimeType] ?? null;
}

/** Uploads a buffer under `key`, creating the bucket first if it doesn't exist yet. */
export async function putObject(key: string, buffer: Buffer, contentType: string): Promise<void> {
  await ensureBucket();
  await minioClient.putObject(BUCKET, key, buffer, buffer.length, { "Content-Type": contentType });
}

/** Downloads an object fully into memory — fine for small assets like cover images (capped well under 10MB). */
export async function getObjectBuffer(key: string): Promise<Buffer> {
  await ensureBucket();
  const stream = await minioClient.getObject(BUCKET, key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** Best-effort delete — never throws. An already-gone or never-uploaded object shouldn't fail the caller. */
export async function removeObjectSafely(key: string): Promise<void> {
  try {
    await ensureBucket();
    await minioClient.removeObject(BUCKET, key);
  } catch {
    // ignore
  }
}
