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

## GPS
`modules/gps/adapters.ts`: `GpsAdapter.parse(raw) → ParsedPosition[]` — generic JSON, OsmAnd/Traccar Client (มือถือ/เครื่องติดตาม), AIS push (จับคู่ด้วย MMSI). เพิ่มผู้ให้บริการ = เพิ่ม adapter
→ `service.ingest()` ตรวจพิกัด/เวลา → `gps_positions` (createMany skipDuplicates) → ประเมิน geofence (ก่อน/หลัง) → event + แจ้งเตือน
ขาดสัญญาณ: job ทุก 5 นาที (เรือในทะเลไม่มีตำแหน่งจริงเกิน N นาที) · โหมดสาธิต `is_demo` ไม่ถูกใช้คำนวณสัญญาณ/แจ้งเตือน · แผนที่ Leaflet + OSM tiles (production ควรใช้ tile provider ของตนเอง)
MQTT: ยังไม่ทำ — bridge จะเรียก `ingest()` เดิม

## Fuel
ถังบริษัท = ledger `fuel_transactions` (append-only) + ยอด/ต้นทุนเฉลี่ยใน `fuel_tanks` อัปเดตใน transaction เดียวกันด้วย `SELECT … FOR UPDATE`; จ่ายเข้าเที่ยวสร้าง `trip_fuel` ผูกกลับ (ลบจากเที่ยวไม่ได้ ต้องปรับยอด)

## Background jobs
`server.ts`: สแกนเอกสารหมดอายุ + ล้าง session ทุก 6 ชม. (single instance; หลาย instance → ใช้ scheduler/advisory lock)

## Deployment
Docker: `apps/api/Dockerfile` (migrate deploy → start), `apps/web/Dockerfile` (nginx + proxy /api), `docker-compose.yml`. TLS ด้านหน้า + `COOKIE_SECURE=true`
