# Development Roadmap

| Milestone | เนื้อหา | สถานะ |
|---|---|---|
| M1 Foundation | monorepo, Prisma schema+migration+seed, auth, RBAC, audit, layout, dashboard, เรือ, พนักงาน+เอกสาร, เที่ยวเรือ, สัตว์น้ำ, แจ้งเตือน, PWA/offline catch, Docker, docs | ✅ |
| M2 Fleet ops | GPS adapter (HTTP ingest + API key, MQTT bridge, AIS), แผนที่ Leaflet+OSM, route history, signal-lost, geofence; โมดูลน้ำมัน (ถัง/รับ/จ่าย/ชั่วโมงเครื่อง/รายงาน ลิตร/กก.) | ⏳ |
| M3 Supply chain | ผู้ขาย, PR→PO→GR, คลัง (ledger, ห้ามติดลบ, โอน, ปรับยอด, จุดสั่งซื้อ, มูลค่า), จ่ายเสบียงเข้าเรือ→เที่ยว | ⏳ |
| M4 Sales | ลูกค้า, lot สัตว์น้ำ, ใบสั่งขาย/ใบแจ้งหนี้/รับชำระ/คืนสินค้า, ลูกหนี้ aging, รายได้ต่อเที่ยว/เรือ/ชนิด | ⏳ |
| M5 Maintenance | แผน/ใบสั่งซ่อม, อะไหล่จากคลัง, ชั่วโมงเครื่อง, แจ้งเตือนรอบซ่อม | ⏳ |
| M6 Payroll | กฎค่าตอบแทนตั้งค่าได้ (รายเดือน/วัน/เที่ยว/ส่วนแบ่ง/ตามปริมาณ), เบิกล่วงหน้า/เงินกู้/หัก, งวด, สลิป PDF, โอนธนาคาร, traceable | ⏳ |
| M7 Accounting | ผังบัญชี, JE คู่ (posting/approval/reverse), งวดปิด, GL/AR/AP/ธนาคาร, TB/P&L/BS/Cash flow, ปันส่วนเรือ/เที่ยว, VAT/WHT | ⏳ |
| M8 Reports & hardening | รายงาน PDF/Excel/CSV ทุกโมดูล, 2FA, เข้ารหัสคอลัมน์, E2E Playwright CI, load test, pen-test | ⏳ |

แต่ละ milestone: typecheck → lint → unit/integration/API tests → build → อัปเดต docs
