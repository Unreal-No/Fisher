# System Architecture

```
Browser/PWA (React 19 + Vite + Tailwind v4)
  │  cookie session + CSRF header, /api/v1 (REST JSON)
  ▼
API (Fastify 5, TypeScript) ── routes → services (business rules, $transaction, audit) → Prisma 7 (pg adapter)
  │                                     │
  ▼                                     ▼
PostgreSQL 16 (constraints, partial unique idx, triggers)   Private file storage (local | S3-compatible)
```

## Monorepo
| path | หน้าที่ |
|---|---|
| `packages/shared` | Zod schemas (ใช้ทั้ง client+server), enums, ป้ายภาษาไทย, RBAC catalogue, trip state machine, format พ.ศ. |
| `apps/api` | Fastify, Prisma schema/migrations/seed, modules/*, tests (Vitest + test DB) |
| `apps/web` | React SPA/PWA, features/*, components/ui (shadcn-style), offline queue |

## API layering
- `modules/<m>/routes.ts` — HTTP, `parse(schema)`, `app.can(perm)` guard
- `modules/<m>/service.ts` — กฎธุรกิจ/transaction (เฉพาะโมดูลที่ซับซ้อน: trips, employees, notifications)
- Prisma = repository layer (ไม่สร้าง repo wrapper ซ้ำซ้อน); query เฉพาะทางใช้ `$queryRaw` แบบ parameterized
- `lib/` — errors (Thai messages), audit (redact PDPA), http (paging, scope, sequence), storage, settings
- Errors: `{ error: { code, message, fieldErrors?, details? } }`

## Data integrity
- Partial unique: เที่ยว active ต่อเรือ, assignment เปิดต่อพนักงาน · CHECK: น้ำหนัก>0, ลิตร>0, arrived≥departed, lat/lng range
- เลขเอกสาร gap-free: `doc_sequences` (INSERT … ON CONFLICT … RETURNING ภายใน transaction)
- Optimistic locking: `version` (trips, catch) → 409 `STALE_DATA`
- Idempotency: `catch_records.client_request_id` unique (offline retry ปลอดภัย)

## Offline / PWA
- Workbox precache app shell; `/api` = NetworkOnly (ไม่เสิร์ฟข้อมูลธุรกิจเก่าแบบเงียบ)
- คิว IndexedDB (`lib/offline-queue.ts`) สำหรับบันทึกสัตว์น้ำ: retry อัตโนมัติเมื่อ online/ทุก 60 วิ; network error = รอ, 4xx = FAILED ให้ผู้ใช้ตรวจ (ไม่เขียนทับ)
- การเงิน/ข้อมูลอ่อนไหว ต้องออนไลน์เสมอ

## GPS (ออกแบบ Phase 2)
`GpsAdapter { source: DEDICATED|MOBILE|AIS; parse(raw) → Position[] }` → `POST /api/v1/gps/ingest` (device API key hash) หรือ MQTT bridge → `gps_positions` (unique device+time, index vessel+time). ไม่มีอุปกรณ์ = โหมดสาธิตที่ติดป้ายชัดเจน (`is_demo`). ตาราง `gps_devices`, `gps_positions` มีแล้ว

## Background jobs
`server.ts`: สแกนเอกสารหมดอายุ + ล้าง session ทุก 6 ชม. (single instance; หลาย instance → ใช้ scheduler/advisory lock)

## Deployment
Docker: `apps/api/Dockerfile` (migrate deploy → start), `apps/web/Dockerfile` (nginx + proxy /api), `docker-compose.yml`. TLS ด้านหน้า + `COOKIE_SECURE=true`
