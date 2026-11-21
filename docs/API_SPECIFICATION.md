# API Specification — `/api/v1`

Auth: cookie `fsid` (httpOnly) · mutating requests ต้องส่ง header `x-csrf-token` = cookie `fcsrf` · JSON · Decimal ส่งเป็น string · วันที่ `YYYY-MM-DD`, เวลา ISO-8601
List: `?page&pageSize(≤200)&q&sort&order` → `{ items, total, page, pageSize }` · Error: `{ error: { code, message, fieldErrors?, details? } }`
Codes: 400 VALIDATION_ERROR/BAD_REQUEST · 401 · 403 FORBIDDEN/CSRF/MUST_CHANGE_PASSWORD · 404 · 409 DUPLICATE/VESSEL_HAS_ACTIVE_TRIP/INVALID_TRIP_STATUS/STALE_DATA · 422 DEPARTURE_CHECK_FAILED (details = issues) · 423 LOCKED

| Method & Path | Permission | หมายเหตุ |
|---|---|---|
| GET /api/health | public | DB ping |
| POST /auth/login · /auth/logout · GET /auth/me · POST /auth/change-password | public/auth | rate limit 10/นาที, lockout 5 ครั้ง |
| GET /dashboard/summary?from&to&vesselId | dashboard.view (+finance สำหรับตัวเงิน) | |
| GET/POST /vessels · GET/PATCH/DELETE /vessels/:id | vessel.* | delete = soft, บล็อกถ้ามีเที่ยวเปิด |
| GET /vessels/:id/trips · /history · POST/DELETE /vessels/:id/documents[/:docId] | trip.view / vessel.view / vessel.edit | |
| GET/POST /employees · GET/PATCH/DELETE /employees/:id | employee.* | mask PDPA ถ้าไม่มี employee.sensitive |
| POST /employees/:id/assign-vessel | employee.edit | ปิด assignment เดิมอัตโนมัติ |
| POST /employees/:id/documents · PATCH …/:docId · POST …/:docId/renew · …/:docId/cancel | employee_doc.manage | |
| GET /employees/reports/documents?days | employee.view | |
| GET/POST /document-types · PATCH /document-types/:id | auth / settings.manage∨employee_doc.manage | |
| GET/POST /trips · GET/PATCH /trips/:id | trip.view/create/edit | PATCH เฉพาะ DRAFT/PREPARING |
| POST /trips/:id/status {status} | trip.edit | DRAFT/PREPARING/AT_SEA/RETURNING/PENDING_SETTLEMENT/ARRIVED(reopen: approve) |
| PUT /trips/:id/crew · GET /trips/:id/crew-check | trip.edit / trip.view | |
| POST /trips/:id/depart · /arrive | trip.edit | override ต้อง trip.approve + reason |
| GET /trips/:id/settlement · POST /trips/:id/close · /cancel | trip.view / trip.approve / trip.delete | |
| POST/DELETE /trips/:id/{fuel,supplies,expenses,incidents}[/:itemId] | trip.edit | |
| GET/POST /catch/species · PATCH/DELETE /catch/species/:id · GET /catch/grades | auth / species.manage | |
| GET/POST /catch/records · GET/PATCH /catch/records/:id · POST /catch/records/:id/void | catch.* | POST idempotent (clientRequestId); PATCH ต้อง version+reason |
| GET/POST /catch/losses · GET /catch/summary?groupBy=species\|vessel\|trip\|month | catch.view/create | |
| POST /files?sensitivity · GET /files/:id | auth (PERSONAL: employee.sensitive + audit) | ตรวจชนิดไฟล์จาก bytes; JPG/PNG/WEBP/PDF ≤10MB |
| GET /notifications · POST /notifications/:id/read · /read-all · /scan | auth / settings.manage∨employee_doc.manage | |
| POST\|GET /gps/ingest/:adapter[/:key] (adapter = generic \| osmand \| ais) | device key (`x-device-key` หรือ path) | ไม่ใช้ session; ตำแหน่งย้อนหลัง ≤30 วัน, ไม่เกินอนาคต 5 นาที, ซ้ำ = ข้าม |
| POST /gps/mobile | gps.report + vessel scope | ตำแหน่งจากเบราว์เซอร์มือถือ |
| GET /gps/fleet · /gps/track?vesselId&from&to&includeDemo · /gps/geofence-events | gps.view | track ≤93 วัน, downsample ≤5000 จุด |
| GET/POST /gps/devices · PATCH /gps/devices/:id · POST /gps/devices/:id/rotate-key | gps.view / gps.manage | คีย์แสดงครั้งเดียว (เก็บ sha256) |
| GET/POST /gps/geofences · PUT /gps/geofences/:id | gps.view / gps.manage | |
| POST/DELETE /gps/demo | gps.manage | ข้อมูลสาธิต is_demo (ไม่ใช้คำนวณสัญญาณ/แจ้งเตือน) |
| GET/POST /fuel/tanks · PATCH /fuel/tanks/:id | fuel.view / fuel.edit | ยอด/ต้นทุนแก้ไม่ได้ (มาจาก ledger) |
| POST /fuel/receipts · /fuel/issues · /fuel/adjustments | fuel.edit (+fuel.approve เมื่อจ่ายเกินยอด) | 422 INSUFFICIENT_FUEL |
| GET /fuel/transactions · /fuel/entries · /fuel/report?from&to&vesselId | fuel.view | |
| GET/POST /users · PATCH /users/:id · POST /users/:id/reset-password | user.manage | |
| GET /roles · /permissions · PUT /roles/:id/permissions | role.manage∨user.manage / role.manage | SUPER_ADMIN แก้ไม่ได้ |
| GET /audit-logs | audit.view | |
| GET/PATCH /settings | auth / settings.manage | |
