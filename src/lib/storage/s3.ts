import 'server-only';
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@/lib/env';
import { assertSafeKey, type StorageDriver, type UploadTicket } from './types';

const EXPIRES = 900; // 15 minutes

/**
 * S3-compatible object storage: AWS S3, Cloudflare R2, Backblaze B2, MinIO…
 * Large media never passes through a serverless function — the browser PUTs
 * straight to the bucket with a presigned URL.
 */
export class S3Storage implements StorageDriver {
  readonly name = 's3';
  readonly durable = true;
  readonly directUpload = true;
  private client: S3Client;
  private bucket: string;

  constructor() {
    this.bucket = env.STORAGE_BUCKET!;
    this.client = new S3Client({
      region: env.STORAGE_REGION,
      endpoint: env.STORAGE_URL!,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.STORAGE_ACCESS_KEY!,
        secretAccessKey: env.STORAGE_SECRET_KEY!,
      },
    });
  }

  async createUploadTicket(input: { key: string; contentType: string }): Promise<UploadTicket> {
    assertSafeKey(input.key);
    const uploadUrl = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: input.key, ContentType: input.contentType }),
      { expiresIn: EXPIRES },
    );
    return {
      uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': input.contentType },
      key: input.key,
      publicUrl: this.publicUrl(input.key),
      direct: true,
      expiresIn: EXPIRES,
    };
  }

  async put(key: string, body: Uint8Array | Buffer, contentType: string) {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
    return { key, url: this.publicUrl(key) };
  }

  async get(key: string) {
    assertSafeKey(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const bytes = await res.Body?.transformToByteArray();
      if (!bytes) return null;
      return { body: bytes, contentType: res.ContentType ?? 'application/octet-stream' };
    } catch {
      return null;
    }
  }

  publicUrl(key: string): string {
    assertSafeKey(key);
    if (env.STORAGE_PUBLIC_URL) return `${env.STORAGE_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
    // Without a public base we serve reads through our own route, which
    // signs/streams the object server-side.
    return `/api/files/${key}`;
  }

  async remove(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
