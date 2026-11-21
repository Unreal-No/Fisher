# Development Roadmap

| Milestone | เนื้อหา | สถานะ |
|---|---|---|
| M1 Foundation | monorepo, Prisma schema+migration+seed, auth, RBAC, audit, layout, dashboard, เรือ, พนักงาน+เอกสาร, เที่ยวเรือ, สัตว์น้ำ, แจ้งเตือน, PWA/offline catch, Docker, docs | ✅ |
| M2 Fleet ops | GPS: adapter HTTP (generic JSON, OsmAnd/Traccar Client, AIS push) + device key, ส่งตำแหน่งจากมือถือ (PWA), แผนที่ Leaflet+OSM, เส้นทางย้อนหลัง, ขาดสัญญาณ, geofence, โหมดสาธิตติดป้าย; น้ำมัน: ถังบริษัท ledger (ต้นทุนเฉลี่ยเคลื่อนที่), รับ/จ่ายเข้าเที่ยว/ปรับยอด, ชั่วโมงเครื่อง, รายงาน ลิตร/กก. · บาท/กก. · ลิตร/ชม. | ✅ |
| M2.1 | MQTT bridge (ใช้ ingest service เดิม), ดึงข้อมูลจากผู้ให้บริการ AIS/VMS (ต้องมี credential), เลือกพื้นที่ geofence บนแผนที่ | ⏳ |
| M3 Supply chain | ผู้ขาย, PR→PO→GR (แยกผู้สร้าง/ผู้อนุมัติ, รับบางส่วน, ปิด/ยกเลิก), คลัง (ledger append-only, ต้นทุนเฉลี่ยเคลื่อนที่, ห้ามติดลบเว้นอนุมัติ, โอน, ตรวจนับ, จุดสั่งซื้อ+แจ้งเตือน, มูลค่า), เบิกเข้าเรือ→ต้นทุนเที่ยว, ซื้อส่งตรงเข้าเที่ยว | ✅ |
| M3.1 | ใบแจ้งหนี้ผู้ขาย/เจ้าหนี้ (ทำพร้อม M7 บัญชี), รับคืนสินค้า, lot/วันหมดอายุของวัสดุ | ⏳ |
| M4 Sales | ลูกค้า, lot สัตว์น้ำ, ใบสั่งขาย/ใบแจ้งหนี้/รับชำระ/คืนสินค้า, ลูกหนี้ aging, รายได้ต่อเที่ยว/เรือ/ชนิด | ⏳ |
| M5 Maintenance | แผน/ใบสั่งซ่อม, อะไหล่จากคลัง, ชั่วโมงเครื่อง, แจ้งเตือนรอบซ่อม | ⏳ |
| M6 Payroll | กฎค่าตอบแทนตั้งค่าได้ (รายเดือน/วัน/เที่ยว/ส่วนแบ่ง/ตามปริมาณ), เบิกล่วงหน้า/เงินกู้/หัก, งวด, สลิป PDF, โอนธนาคาร, traceable | ⏳ |
| M7 Accounting | ผังบัญชี, JE คู่ (posting/approval/reverse), งวดปิด, GL/AR/AP/ธนาคาร, TB/P&L/BS/Cash flow, ปันส่วนเรือ/เที่ยว, VAT/WHT | ⏳ |
| M8 Reports & hardening | รายงาน PDF/Excel/CSV ทุกโมดูล, 2FA, เข้ารหัสคอลัมน์, E2E Playwright CI, load test, pen-test | ⏳ |

แต่ละ milestone: typecheck → lint → unit/integration/API tests → build → อัปเดต docs
