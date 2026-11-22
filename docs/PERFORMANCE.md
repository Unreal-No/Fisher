# Performance / Load test

สคริปต์: `node scripts/loadtest.mjs [baseUrl] [concurrency] [seconds]` (ไม่มี dependency; เข้าสู่ระบบด้วย `LT_USER`/`LT_PASSWORD` แล้วยิง 10 endpoint หลักวนกัน)
ต้องตั้ง `RATE_LIMIT_PER_MIN` ของเซิร์ฟเวอร์ให้สูงพอระหว่างทดสอบ (ค่าเริ่มต้น 600/นาที/IP จะตอบ 429)

## ผลทดสอบ (22 พ.ย. 2569, v0.11)
สภาพแวดล้อม: เครื่องเดียว 4 vCPU — API (`node dist/server.js`, NODE_ENV=production, 1 process) + PostgreSQL 16 + ตัวยิงโหลด อยู่เครื่องเดียวกัน (ผลจริงบนเครื่องแยกจะดีกว่านี้)
ข้อมูล: ข้อมูลตัวอย่าง + รายการบัญชีสังเคราะห์ 20,000 รายการ (80,000 บรรทัด) + บันทึกสัตว์น้ำ 50,000 รายการ (ตอนเพิ่มข้อมูล trigger ตรวจความสมดุลของทั้ง 20,000 รายการผ่าน)

| concurrency | req/s | error | p95 สูงสุด (endpoint) | p95 /auth/me |
|---|---|---|---|---|
| 20 | 131 | 0% | 372 ms (dashboard summary) | 123 ms |
| 50 | 143 | 0% | 675 ms (dashboard summary) | 258 ms |

รายละเอียด p50/p95 (concurrency 20): dashboard 299/372 · กำไรขาดทุน 243/308 · งบทดลอง 157/199 · เที่ยวเรือ 147/198 · GPS fleet 126/189 · สัตว์น้ำ 116/169 · ใบขาย 111/172 · คลัง 100/154 · สมุดรายวัน 94/141 ms
ข้อมูลน้อย (เฉพาะข้อมูลตัวอย่าง) ได้ ~306 req/s ที่ concurrency 20, p95 ≤ 126 ms

## สรุป
- ไม่มี error/timeout; throughput อิ่มที่ ~140 req/s เพราะ CPU (Node 1 process + Postgres + ตัวยิงบน 4 vCPU) — latency เพิ่มตามคิว ไม่ใช่ query ช้าผิดปกติ
- เพียงพอสำหรับบริษัทประมงขนาดเล็ก–กลาง (ผู้ใช้พร้อมกันหลักสิบ; การใช้งานจริงยิงคำขอห่างกันหลายวินาที)
- ถ้าต้องการมากขึ้น: รัน API หลาย instance หลัง reverse proxy (background job ต้องเหลือ instance เดียว — ดู README), แยกเครื่องฐานข้อมูล, เพิ่ม cache ให้ dashboard summary (หนักที่สุด: ~15 query ต่อครั้ง)
