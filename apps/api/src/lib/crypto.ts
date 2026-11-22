// Application-level encryption for secrets at rest (AES-256-GCM).
// Keys: APP_ENCRYPTION_KEY (current, base64 32 bytes) + APP_ENCRYPTION_KEYS_OLD (comma-separated previous keys, for rotation).
// Format: v2:<key id>:<iv>:<tag>:<data> (v1 = no key id, written before 0.12 — tried against every key).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config';
import { AppError } from './errors';

interface Key { id: string; key: Buffer }
const keyId = (k: Buffer) => createHash('sha256').update(k).digest('hex').slice(0, 8);
function parse(b64: string, name: string): Key {
  const k = Buffer.from(b64.trim(), 'base64');
  if (k.length !== 32) throw new AppError(500, 'CONFIG', `${name} ต้องเป็น base64 ขนาด 32 ไบต์`);
  return { id: keyId(k), key: k };
}
let warned = false;
function currentKey(): Key {
  if (config.APP_ENCRYPTION_KEY) return parse(config.APP_ENCRYPTION_KEY, 'APP_ENCRYPTION_KEY');
  if (config.NODE_ENV === 'production') throw new AppError(500, 'CONFIG', 'ยังไม่ได้ตั้งค่า APP_ENCRYPTION_KEY บนเซิร์ฟเวอร์');
  if (!warned && config.NODE_ENV === 'development') {
    warned = true;
    console.warn('[crypto] APP_ENCRYPTION_KEY not set — using the development-only key');
  }
  const k = createHash('sha256').update('fisher-dev-only-key').digest(); // dev/test only
  return { id: keyId(k), key: k };
}
/** current key first, then previous keys */
function allKeys(): Key[] {
  const old = (config.APP_ENCRYPTION_KEYS_OLD ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => parse(s, 'APP_ENCRYPTION_KEYS_OLD'));
  return [currentKey(), ...old];
}

export const currentKeyId = () => currentKey().id;

export function encrypt(plain: string) {
  const k = currentKey();
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k.key, iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v2:${k.id}:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

function open(k: Buffer, iv: string, tag: string, data: string) {
  const d = createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}
const failed = (why: string) => new AppError(500, 'DECRYPT_FAILED', `ถอดรหัสข้อมูลไม่ได้ — ${why}`);

export function decrypt(enc: string) {
  const parts = enc.split(':');
  if (parts[0] === 'v2' && parts.length === 5) {
    const [, id, iv, tag, data] = parts as [string, string, string, string, string];
    const k = allKeys().find((x) => x.id === id);
    if (!k) throw failed(`ไม่พบกุญแจรหัส ${id} (ใส่กุญแจเดิมไว้ใน APP_ENCRYPTION_KEYS_OLD)`);
    try {
      return open(k.key, iv, tag, data);
    } catch {
      throw failed('ข้อมูลเสียหายหรือกุญแจไม่ถูกต้อง');
    }
  }
  if (parts[0] === 'v1' && parts.length === 4) {
    const [, iv, tag, data] = parts as [string, string, string, string];
    for (const k of allKeys()) {
      try {
        return open(k.key, iv, tag, data);
      } catch {
        /* try the next key */
      }
    }
    throw failed('APP_ENCRYPTION_KEY ของเซิร์ฟเวอร์ไม่ตรงกับกุญแจที่ใช้เข้ารหัสข้อมูล');
  }
  throw new AppError(500, 'CRYPTO', 'ข้อมูลเข้ารหัสไม่ถูกต้อง');
}

export const isEncrypted = (v: unknown): v is string => typeof v === 'string' && /^v[12]:/.test(v);
/** true when the value is not encrypted with the current key (should be re-encrypted) */
export const needsReencrypt = (v: string) => !v.startsWith(`v2:${currentKeyId()}:`);
