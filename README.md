# Fisher ERP — ระบบบริหารจัดการประมง

ERP สำหรับธุรกิจประมงไทย: ทะเบียนเรือ · เที่ยวเรือ (ออก/เข้า/สรุป/ปิด) · บันทึกสัตว์น้ำ (ใช้งานออฟไลน์ได้) · พนักงาน/แรงงานต่างด้าว + เอกสารและแจ้งเตือนหมดอายุ · ติดตามเรือ GPS (แผนที่/เส้นทาง/geofence/ขาดสัญญาณ) · น้ำมัน (ถังบริษัท, ประสิทธิภาพการใช้) · จัดซื้อ (ใบขอซื้อ→ใบสั่งซื้อ→รับสินค้า) · คลังสินค้า (เบิกเข้าเที่ยว, โอน, ตรวจนับ) · RBAC · Audit log · แดชบอร์ด

Stack: React 19 + Vite + Tailwind v4 + TanStack Query/Table + RHF/Zod · Fastify 5 + Prisma 7 + PostgreSQL 16 · PWA (Workbox) · pnpm monorepo
เอกสาร: [docs/](docs) (PRD, Architecture, DB schema, ER, API, UI, Security, Roadmap)

## Local development
ต้องมี Node ≥22, pnpm 10, PostgreSQL 16

```bash
pnpm install
```

```bash
cp .env.example .env   # แก้ DATABASE_URL / TEST_DATABASE_URL
```

```bash
createdb fisher_dev && createdb fisher_test
```

```bash
pnpm db:migrate && pnpm db:seed
```

```bash
pnpm dev
```

เปิด http://localhost:5173 — ผู้ใช้ทดลอง (เฉพาะ dev, รหัส = `SEED_ADMIN_PASSWORD` ค่าเริ่มต้น `Admin@12345`):
`admin` (ผู้ดูแลระบบ) · `owner` · `ops` (อนุมัติจัดซื้อ) · `captain1` (เห็นเฉพาะเรือ V-001) · `hr` · `buyer` (จัดซื้อ) · `store` (คลัง) · `viewer`
ข้อมูลตัวอย่างมีป้าย `[ข้อมูลตัวอย่าง]`; production seed สร้างเฉพาะข้อมูลอ้างอิง + `admin` (บังคับเปลี่ยนรหัส)

## ตรวจคุณภาพ
```bash
pnpm check
```
(typecheck → ESLint → Vitest [shared, api integration กับ DB จริง, web] → production build)

## Production (Docker)
```bash
cp .env.example .env   # ตั้ง DB_PASSWORD, PUBLIC_URL, COOKIE_SECURE=true, SEED_ADMIN_PASSWORD
```

```bash
docker compose up -d --build
```

```bash
docker compose exec api node apps/api/dist/seed.js
```
API รัน `prisma migrate deploy` อัตโนมัติก่อนเริ่ม · วาง HTTPS (Caddy/Traefik/Cloudflare) หน้า `web:8080` · ไฟล์เก็บที่ volume `files` หรือ S3 (`STORAGE_DRIVER=s3`)

## Backup / Restore
```bash
DATABASE_URL=postgresql://... STORAGE_DIR=/path/to/storage ./scripts/backup.sh ./backups 14
```

```bash
DATABASE_URL=postgresql://... ./scripts/restore.sh backups/db-YYYYmmdd-HHMMSS.dump backups/files-YYYYmmdd-HHMMSS.tar.gz /path/to/storage
```
แนะนำ cron รายวัน + เก็บสำเนานอกเครื่อง + ทดสอบ restore รายเดือน

## Known limitations (Phase 1)
- ขาย, ซ่อมบำรุง, เงินเดือน, บัญชี (รวมใบแจ้งหนี้ผู้ขาย/เจ้าหนี้), รายงาน PDF/Excel — ยังไม่ทำ (ซ่อนจากเมนู, ดู Roadmap)
- GPS: รับข้อมูลผ่าน HTTP (generic/OsmAnd-Traccar/AIS push) และมือถือ; ยังไม่มี MQTT bridge และการดึงข้อมูลจากผู้ให้บริการ AIS/VMS (ต้องมี credential); แผนที่ใช้ tile ของ OpenStreetMap (production ควรใช้ผู้ให้บริการ tile ของตนเอง)
- มือถือส่งตำแหน่งได้เฉพาะตอนเปิดหน้าเว็บค้างไว้ (ติดตามต่อเนื่องแนะนำแอป Traccar Client)
- หลังอัปเกรดให้รัน `pnpm db:deploy && pnpm db:seed` (seed เพิ่มสิทธิ์ใหม่ให้บทบาทเดิมโดยไม่ทับที่แก้ไว้)
- ช่องกรอกวันที่ใช้ date picker ของเบราว์เซอร์ (ปี ค.ศ.); การแสดงผลเป็น พ.ศ.
- Offline: รองรับบันทึกสัตว์น้ำ; ฟอร์มอื่นต้องออนไลน์
- Background job เป็น single-instance (setInterval)
- ยังไม่มี 2FA / column encryption / malware scan — ดู docs/SECURITY_PLAN.md
- ไม่ได้รับรองการปฏิบัติตาม PDPA/กฎหมายแรงงาน — ต้องให้ผู้เชี่ยวชาญตรวจ
