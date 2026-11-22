// Application-level encryption for secrets at rest (AES-256-GCM). Key: APP_ENCRYPTION_KEY (base64, 32 bytes).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config';
import { AppError } from './errors';

function key() {
  if (config.APP_ENCRYPTION_KEY) {
    const k = Buffer.from(config.APP_ENCRYPTION_KEY, 'base64');
    if (k.length !== 32) throw new AppError(500, 'CONFIG', 'APP_ENCRYPTION_KEY ต้องเป็น base64 ขนาด 32 ไบต์');
    return k;
  }
  if (config.NODE_ENV === 'production') throw new AppError(500, 'CONFIG', 'ยังไม่ได้ตั้งค่า APP_ENCRYPTION_KEY บนเซิร์ฟเวอร์');
  if (!warned && config.NODE_ENV === 'development') {
    warned = true;
    console.warn('[crypto] APP_ENCRYPTION_KEY not set — using the development-only key');
  }
  return createHash('sha256').update('fisher-dev-only-key').digest(); // dev/test only
}
let warned = false;

export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

export function decrypt(enc: string) {
  const [v, iv, tag, data] = enc.split(':');
  if (v !== 'v1' || !iv || !tag || !data) throw new AppError(500, 'CRYPTO', 'ข้อมูลเข้ารหัสไม่ถูกต้อง');
  try {
    const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch {
    throw new AppError(500, 'DECRYPT_FAILED', 'ถอดรหัสข้อมูลไม่ได้ — APP_ENCRYPTION_KEY ของเซิร์ฟเวอร์ไม่ตรงกับกุญแจที่ใช้เข้ารหัสข้อมูล');
  }
}
