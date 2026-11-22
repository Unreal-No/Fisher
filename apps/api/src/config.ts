import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  SESSION_IDLE_HOURS: z.coerce.number().default(12),
  SESSION_MAX_DAYS: z.coerce.number().default(7),
  COOKIE_SECURE: bool.default(false),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('ap-southeast-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool.default(true),
  MAX_UPLOAD_MB: z.coerce.number().default(10),
  /** base64 32-byte key for secrets at rest (2FA). Required in production: `openssl rand -base64 32` */
  APP_ENCRYPTION_KEY: z.string().optional(),
  /** previous keys (comma-separated) still accepted for decryption during key rotation */
  APP_ENCRYPTION_KEYS_OLD: z.string().optional(),
  /** login attempts per IP per minute (password and 2FA steps each) */
  LOGIN_RATE_LIMIT: z.coerce.number().int().min(1).default(10),
  /** API requests per IP per minute (all routes) */
  RATE_LIMIT_PER_MIN: z.coerce.number().int().min(10).default(600),
  /** GPS over MQTT (optional): broker URL e.g. mqtts://broker:8883 — devices publish to {MQTT_TOPIC_PREFIX}/{adapter}/{device identifier} */
  MQTT_URL: z.string().optional(),
  MQTT_USERNAME: z.string().optional(),
  MQTT_PASSWORD: z.string().optional(),
  MQTT_TOPIC_PREFIX: z.string().default('fisher/gps'),
});

export type Config = z.infer<typeof schema>;
export const config: Config = schema.parse(process.env);
