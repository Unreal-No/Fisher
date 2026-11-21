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
});

export type Config = z.infer<typeof schema>;
export const config: Config = schema.parse(process.env);
