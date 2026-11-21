// Private object storage. Files are only served through the API (permission-checked); never public URLs.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { config } from '../config';

export interface Storage {
  put(key: string, body: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

class LocalStorage implements Storage {
  constructor(private root: string) {}
  private p(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error('invalid storage key');
    return full;
  }
  async put(key: string, body: Buffer) {
    const f = this.p(key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, body, { mode: 0o600 });
  }
  get(key: string) {
    return readFile(this.p(key));
  }
  async remove(key: string) {
    await rm(this.p(key), { force: true });
  }
}

class S3Storage implements Storage {
  private s3 = new S3Client({
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT || undefined,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials:
      config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY }
        : undefined,
  });
  constructor(private bucket: string) {}
  async put(key: string, body: Buffer, mime: string) {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: mime, ServerSideEncryption: 'AES256' }),
    );
  }
  async get(key: string) {
    const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  async remove(key: string) {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export const storage: Storage =
  config.STORAGE_DRIVER === 's3'
    ? new S3Storage(config.S3_BUCKET ?? (() => { throw new Error('S3_BUCKET required'); })())
    : new LocalStorage(config.STORAGE_LOCAL_DIR);
