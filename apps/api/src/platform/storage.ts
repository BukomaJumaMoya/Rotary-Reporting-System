import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config, isProduction } from './config.js';

/**
 * Object storage (ADR-007).
 *
 * **KEYS, never URLs.** Nothing in the database holds a URL: a URL bakes in the provider,
 * the bucket and the CDN hostname, and changing any of them becomes a data migration across
 * every table that ever stored a photograph. A key plus a driver is one config change.
 *
 * **Keys are GENERATED, never a user's filename.** The incumbent system kept spaces and
 * apostrophes in stored names, which is how "Rotaract Club of Bugolobi's medical camp.JPG"
 * becomes three different URLs depending on who encoded it. A key here is
 * `<prefix>/<yyyy>/<mm>/<uuid>.<ext>` and the original name is not part of it — a
 * user-supplied filename in a storage key is also a path-traversal waiting for somebody to
 * try `../`.
 *
 * **Reads are short-lived signed URLs.** A photograph of a member is not public, and a
 * permanent URL is a permanent URL whoever ends up holding it.
 *
 * Two drivers. S3-compatible for anything deployed; a local directory for development and
 * tests, so neither needs credentials or a MinIO container to run.
 */

export interface StoredObject {
  key: string;
  size: number;
  contentType: string;
  /** SHA-256 of the bytes, so a re-upload of the same file is recognisable. */
  digest: string;
}

export interface StorageDriver {
  put(input: { key: string; body: Buffer; contentType: string }): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  /** A URL that stops working. `expiresInSeconds` is a ceiling, not a suggestion. */
  signedUrl(key: string, expiresInSeconds: number): Promise<string>;
}

/**
 * A storage key. Date-partitioned, so a bucket listing is navigable and a lifecycle rule
 * can be written against a prefix rather than against a database query.
 */
export function generateKey(prefix: string, extension: string): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  // The extension is chosen by US from the sniffed content type, never taken from the
  // upload. `.php` in a storage key is only a problem if something later serves it.
  const safeExtension = extension.replace(/[^a-z0-9]/gi, '').slice(0, 8);
  return `${prefix}/${year}/${month}/${randomUUID()}.${safeExtension}`;
}

function digestOf(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

// ─── S3-compatible ───────────────────────────────────────────────────────────

class S3Driver implements StorageDriver {
  private readonly client: S3Client;

  constructor(private readonly bucket: string) {
    this.client = new S3Client({
      region: config.S3_REGION,
      // Cloudflare R2 and Backblaze B2 both need an explicit endpoint, and both need
      // path-style addressing — virtual-host style assumes an AWS-shaped DNS name.
      ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT, forcePathStyle: true } : {}),
      ...(config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
        ? {
            credentials: {
              accessKeyId: config.S3_ACCESS_KEY_ID,
              secretAccessKey: config.S3_SECRET_ACCESS_KEY,
            },
          }
        : {}),
    });
  }

  async put(input: { key: string; body: Buffer; contentType: string }): Promise<StoredObject> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        // No public ACL, ever. Reads go through a signed URL.
        CacheControl: 'private, max-age=31536000, immutable',
      }),
    );
    return {
      key: input.key,
      size: input.body.byteLength,
      contentType: input.contentType,
      digest: digestOf(input.body),
    };
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const bytes = await response.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Storage object ${key} has no body`);
    return Buffer.from(bytes);
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async signedUrl(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }
}

// ─── Local directory ─────────────────────────────────────────────────────────

/**
 * Development and tests. Not for production — the application filesystem does not survive
 * a redeployment, which is the whole reason ADR-007 chose object storage.
 *
 * Its "signed URL" is a local path with a token, honest about being neither signed nor a
 * URL: nothing in development should depend on the difference, and pretending otherwise
 * would hide a missing configuration until the first deploy.
 */
class LocalDriver implements StorageDriver {
  constructor(private readonly root: string) {}

  private pathFor(key: string): string {
    // Resolved and then checked, because a key is the one part of this that could ever
    // carry `..` — and a traversal here writes anywhere the process can write.
    const full = resolve(this.root, key);
    if (!full.startsWith(resolve(this.root))) throw new Error('Storage key escapes the root');
    return full;
  }

  async put(input: { key: string; body: Buffer; contentType: string }): Promise<StoredObject> {
    const path = this.pathFor(input.key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.body);
    return {
      key: input.key,
      size: input.body.byteLength,
      contentType: input.contentType,
      digest: digestOf(input.body),
    };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async remove(key: string): Promise<void> {
    await unlink(this.pathFor(key)).catch(() => undefined);
  }

  async signedUrl(key: string, expiresInSeconds: number): Promise<string> {
    await Promise.resolve();
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    return `/api/v1/media/local/${encodeURIComponent(key)}?expires=${expires}`;
  }
}

let driver: StorageDriver | undefined;

export function storage(): StorageDriver {
  if (driver) return driver;

  if (config.STORAGE_DRIVER === 's3') {
    if (!config.S3_BUCKET) {
      // Loud at first use rather than silently writing nowhere. A misconfigured bucket in
      // production is a member's photograph that was accepted and does not exist.
      throw new Error('STORAGE_DRIVER=s3 requires S3_BUCKET');
    }
    driver = new S3Driver(config.S3_BUCKET);
    return driver;
  }

  if (isProduction) {
    // The application filesystem does not survive a redeployment (ADR-007). Refusing here
    // is better than a deploy that quietly loses every photograph uploaded since the last.
    throw new Error(
      'The local storage driver must not be used in production — set STORAGE_DRIVER=s3',
    );
  }

  driver = new LocalDriver(join(process.cwd(), config.LOCAL_STORAGE_DIR));
  return driver;
}

/** Tests replace the driver rather than reaching for a bucket. */
export function setStorageDriver(replacement: StorageDriver | undefined): void {
  driver = replacement;
}
