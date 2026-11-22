# Security Plan

| ด้าน | Phase 1 (ทำแล้ว) |
|---|---|
| รหัสผ่าน | argon2id (@node-rs/argon2), นโยบาย ≥8 ตัว+พิมพ์ใหญ่/เล็ก/ตัวเลข, บังคับเปลี่ยนครั้งแรก/หลังรีเซ็ต, lockout 5 ครั้ง/15 นาที, timing เท่ากันกรณีไม่มี user |
| Session | token สุ่ม 256-bit ใน cookie httpOnly SameSite=Lax (+Secure ใน prod); DB เก็บ sha256; idle 12 ชม./สูงสุด 7 วัน; เปลี่ยนรหัส = revoke session อื่น |
| CSRF | double-submit (`fcsrf` cookie ↔ `x-csrf-token`) ทุก POST/PUT/PATCH/DELETE |
| RBAC | guard ทุก route (`app.can`) + ซ่อนเมนู/ปุ่มฝั่ง UI; vessel scope ต่อผู้ใช้ |
| Input | Zod ทั้ง client/server; Prisma parameterized (กัน SQLi); React escape (กัน XSS); CSP ผ่าน helmet |
| 2FA (M8) | TOTP RFC 6238 (แอป Authenticator) เปิดใช้เองที่ "บัญชีของฉัน" (ยืนยันรหัสผ่าน + รหัสจากแอป); secret เข้ารหัส AES-256-GCM ด้วย `APP_ENCRYPTION_KEY`; กันใช้รหัสซ้ำ (เก็บ step ล่าสุด); รหัสกู้คืน 10 ชุดใช้ครั้งเดียว (เก็บ sha256); ขั้นที่ 2 ผ่าน challenge อายุ 5 นาที/5 ครั้ง และนับรวม lockout; ผู้ดูแลกำหนดบทบาทที่ต้องใช้ 2FA (ผู้ใช้ถูกจำกัดให้อยู่หน้า "บัญชีของฉัน" จนกว่าจะเปิดใช้) และรีเซ็ต 2FA ได้ (audit) |
| Rate limit | 600 req/นาที/IP, login และขั้น 2FA อย่างละ 10/นาที (`LOGIN_RATE_LIMIT`) |
| ไฟล์ | ตรวจ magic bytes (file-type), whitelist JPG/PNG/WEBP/PDF, ≤10MB, ชื่อไฟล์ sanitize, path traversal guard, ไฟล์ private เสิร์ฟผ่าน API + permission; S3 SSE-AES256 |
| เข้ารหัสข้อมูลส่วนบุคคล (M8.1) | เลขบัตรประชาชน, เลขบัญชีธนาคารพนักงาน, เลขเอกสาร เก็บเป็น AES-256-GCM (`lib/pii` ผ่าน Prisma extension — เข้ารหัสตอนเขียน ถอดตอนอ่าน รวม include ซ้อน); ข้อมูลเดิมถูกเข้ารหัสเมื่อรัน `pnpm db:seed`; คอลัมน์เหล่านี้ค้นหา/เรียงใน SQL ไม่ได้ (ออกแบบไว้แล้ว) |
| PDPA | national_id/bank/document_no mask ถ้าไม่มี `employee.sensitive`; ดูข้อมูล/ไฟล์ส่วนบุคคล = audit `VIEW_SENSITIVE`; audit snapshot redact ฟิลด์อ่อนไหว; VIEWER ไม่เห็นข้อมูลส่วนบุคคล |
| Audit | append-only (DB trigger), เก็บ user/ip/ua/request-id |
| Logging | redact cookie/csrf header |
| Secrets | `.env` (ไม่ commit), `.env.example` |
| Backup | `scripts/backup.sh` (pg_dump custom + ไฟล์, retention), `scripts/restore.sh` (ยืนยันก่อน) |
| ส่งออก CSV/Excel | BOM UTF-8 + กัน formula injection (เฉพาะข้อความ ตัวเลขคงเป็นตัวเลข); .xlsx สร้างในเบราว์เซอร์ (ไม่ส่งข้อมูลออกนอกระบบ) |
| Dependencies | `pnpm audit --prod` ไม่มีช่องโหว่ที่ทราบ (M8; override `effect` ที่ Prisma ตรึงไว้) |
| ทดสอบ | API integration + E2E Playwright ใน CI (เข้าสู่ระบบ, 2FA, ทุกหน้าโมดูลไม่มี error, งบสมดุล, ส่งออก, มือถือ) |

## ยังต้องทำ / ข้อจำกัด
- **กุญแจ `APP_ENCRYPTION_KEY` ต้องสำรองแยกจาก backup ฐานข้อมูล** — ถ้าหาย ข้อมูลส่วนบุคคลที่เข้ารหัสและ 2FA จะกู้คืนไม่ได้; หมุนกุญแจได้ (M8.2: ciphertext ระบุ key id, `APP_ENCRYPTION_KEYS_OLD`, seed เข้ารหัสใหม่ — ขั้นตอนใน README)
- เลขบัญชีธนาคารของผู้ขาย (นิติบุคคล) ไม่ได้เข้ารหัส
- 2FA เป็นแบบเลือกเปิด — แนะนำกำหนดให้บทบาทผู้ดูแลระบบ/เจ้าของ/บัญชีต้องใช้ ที่ "ตั้งค่าระบบ"
- ทดสอบโหลดแล้ว (docs/PERFORMANCE.md); ยังไม่มี penetration test โดยบุคคลที่สาม
- นโยบายระยะเก็บข้อมูล (retention) + กระบวนการคำขอเจ้าของข้อมูล (DSAR) — ต้องกำหนดโดยองค์กร
- Malware scan ไฟล์อัปโหลด (ClamAV) — แนะนำใน production
- ไม่อ้างว่าสอดคล้อง PDPA/กฎหมายแรงงานจนกว่าผู้เชี่ยวชาญตรวจสอบ
- Penetration test ก่อน go-live
