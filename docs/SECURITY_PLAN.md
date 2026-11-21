# Security Plan

| ด้าน | Phase 1 (ทำแล้ว) |
|---|---|
| รหัสผ่าน | argon2id (@node-rs/argon2), นโยบาย ≥8 ตัว+พิมพ์ใหญ่/เล็ก/ตัวเลข, บังคับเปลี่ยนครั้งแรก/หลังรีเซ็ต, lockout 5 ครั้ง/15 นาที, timing เท่ากันกรณีไม่มี user |
| Session | token สุ่ม 256-bit ใน cookie httpOnly SameSite=Lax (+Secure ใน prod); DB เก็บ sha256; idle 12 ชม./สูงสุด 7 วัน; เปลี่ยนรหัส = revoke session อื่น |
| CSRF | double-submit (`fcsrf` cookie ↔ `x-csrf-token`) ทุก POST/PUT/PATCH/DELETE |
| RBAC | guard ทุก route (`app.can`) + ซ่อนเมนู/ปุ่มฝั่ง UI; vessel scope ต่อผู้ใช้ |
| Input | Zod ทั้ง client/server; Prisma parameterized (กัน SQLi); React escape (กัน XSS); CSP ผ่าน helmet |
| Rate limit | 600 req/นาที/IP, login 10/นาที |
| ไฟล์ | ตรวจ magic bytes (file-type), whitelist JPG/PNG/WEBP/PDF, ≤10MB, ชื่อไฟล์ sanitize, path traversal guard, ไฟล์ private เสิร์ฟผ่าน API + permission; S3 SSE-AES256 |
| PDPA | national_id/bank/document_no mask ถ้าไม่มี `employee.sensitive`; ดูข้อมูล/ไฟล์ส่วนบุคคล = audit `VIEW_SENSITIVE`; audit snapshot redact ฟิลด์อ่อนไหว; VIEWER ไม่เห็นข้อมูลส่วนบุคคล |
| Audit | append-only (DB trigger), เก็บ user/ip/ua/request-id |
| Logging | redact cookie/csrf header |
| Secrets | `.env` (ไม่ commit), `.env.example` |
| Backup | `scripts/backup.sh` (pg_dump custom + ไฟล์, retention), `scripts/restore.sh` (ยืนยันก่อน) |
| CSV export | BOM UTF-8 + กัน formula injection |

## ยังต้องทำ / ข้อจำกัด
- ยังไม่มี 2FA, ยังไม่เข้ารหัสระดับคอลัมน์ (เลขบัตร/บัญชี) — แนะนำ pgcrypto/KMS ก่อนใช้งานจริง
- นโยบายระยะเก็บข้อมูล (retention) + กระบวนการคำขอเจ้าของข้อมูล (DSAR) — ต้องกำหนดโดยองค์กร
- Malware scan ไฟล์อัปโหลด (ClamAV) — แนะนำใน production
- ไม่อ้างว่าสอดคล้อง PDPA/กฎหมายแรงงานจนกว่าผู้เชี่ยวชาญตรวจสอบ
- Penetration test ก่อน go-live
