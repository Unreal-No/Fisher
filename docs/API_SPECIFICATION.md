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
| GET/POST /inventory/warehouses · PATCH …/:id | inventory.view∨purchase.view / inventory.edit | |
| GET/POST /inventory/items · GET/PATCH/DELETE …/:id | inventory.view / inventory.edit | delete = ปิดใช้งานถ้ามีความเคลื่อนไหว |
| GET /inventory/balances?warehouseId&belowMin · /inventory/movements | inventory.view | |
| POST /inventory/receipts · /issues · /transfers · /adjustments | inventory.edit (+inventory.approve เมื่อเบิกเกิน) | 422 INSUFFICIENT_STOCK · 409 NO_DIFFERENCE |
| GET/POST /purchasing/suppliers · PATCH …/:id | purchase.view / purchase.create | |
| GET/POST /purchasing/requests · GET/PUT …/:id · POST …/:id/{submit,approve,reject,cancel} | purchase.view/create/approve | ผู้สร้างอนุมัติเองไม่ได้ (403) |
| GET/POST /purchasing/orders · GET/PUT …/:id · POST …/:id/{approve,cancel,close} | purchase.view/create/approve | ยกเลิกได้ก่อนรับของ; ปิดเมื่อรับบางส่วน |
| POST /purchasing/orders/:id/receive | inventory.edit | 409 OVER_RECEIPT; ล็อกใบสั่งซื้อ FOR UPDATE |
| GET /purchasing/summary?from&to | purchase.view | ตามผู้ขาย/เดือน (ไม่รวมร่าง/ยกเลิก) |
| GET/POST /sales/customers · PATCH …/:id | sales.view / sales.create | |
| GET /sales/lots?tripId&speciesId&availableOnly | sales.view∨catch.view | ล็อต = เที่ยว×ชนิด×เกรด |
| GET/POST /sales/invoices · GET/PUT …/:id · POST …/:id/confirm | sales.view / sales.create | 409 LOT_INSUFFICIENT (บันทึก) / LOT_OVERSOLD (ยืนยัน) |
| POST /sales/invoices/:id/void | sales.approve | 409 HAS_PAYMENTS / HAS_CREDIT_NOTES |
| POST /sales/invoices/:id/payments · /sales/payments/:id/void | sales.create∨finance.edit / sales.approve∨finance.approve | 409 OVERPAYMENT |
| POST /sales/invoices/:id/returns | sales.approve | ใบลดหนี้ (ยอด ex-VAT × (1+VAT)); 409 OVER_RETURN / CREDIT_EXCEEDS_OUTSTANDING |
| GET /sales/receivables · /sales/report?from&to&groupBy | sales.view(∨finance.view) / sales.view | aging ตามวันครบกำหนด; ยอดขายสุทธิ ex-VAT |
| GET/POST /maintenance/plans · PUT …/:id | maintenance.view / maintenance.edit | due คำนวณจากวัน/ชั่วโมงเครื่อง |
| GET/POST /maintenance/engine-hours | maintenance.view / maintenance.create | 409 ENGINE_HOURS_DECREASE (รีเซ็ตต้องมีเหตุผล) |
| GET/POST /maintenance/orders · GET/PATCH …/:id · POST …/:id/{start,parts,complete,cancel,attachments} | maintenance.view/create/edit | 409 VESSEL_AT_SEA / HAS_PARTS · 422 INSUFFICIENT_STOCK |
| GET /maintenance/report?from&to&groupBy=vessel\|category\|month | maintenance.view | ใบสั่งซ่อมที่เสร็จแล้ว |
| GET/POST /payroll/rules · PUT …/:id | payroll.view / payroll.edit | REVENUE_SHARE ต้องมี basis และ ≤ 100% |
| GET/POST /payroll/advances · POST …/:id/cancel | payroll.view / payroll.edit / payroll.approve | LOAN ต้องมี installment; ยกเลิกได้เมื่อยังไม่เคยหัก |
| GET/POST /payroll/periods · GET/PUT …/:id | payroll.view / payroll.edit | แก้ไขแล้วงวดกลับเป็น DRAFT (needsRecalc) |
| POST /payroll/periods/:id/calculate | payroll.edit | คืน skipped [{employeeId,name,reason}] (ซ้อนงวด/หักเกินรายได้) |
| POST /payroll/periods/:id/{approve,pay,cancel} | payroll.approve | 403 ผู้คำนวณอนุมัติเอง · 409 ADVANCE_CHANGED / PERIOD_OVERLAP / INVALID_STATUS |
| POST/DELETE /payroll/periods/:id/adjustments[/:adjId] | payroll.edit | เฉพาะงวดที่ยังไม่อนุมัติ |
| GET /payroll/periods/:id/records/:recordId | payroll.view | สลิป (เลขบัญชี mask ถ้าไม่มี employee.sensitive) |
| GET /payroll/periods/:id/bank-file | payroll.approve + employee.sensitive | CSV ทั่วไป (UTF-8 BOM), header x-missing-accounts; audit EXPORT |
| GET /payroll/employees/:id/history | payroll.view | งวดและเงินเบิกของพนักงาน |
| GET/POST /accounting/accounts · PUT …/:id | finance.view / finance.approve | บัญชีมีรายการแล้วเปลี่ยนรหัส/หมวดไม่ได้ (409 ACCOUNT_IN_USE); ผู้ใช้จำกัดเรือ → 403 ทั้งโมดูล |
| GET/PUT /accounting/mappings | finance.view / finance.approve | บัญชีต้องรับรายการและเปิดใช้งาน |
| GET /accounting/periods?year · GET …/:year/:month/checklist · POST …/close · POST …/reopen {reason} | finance.view / finance.approve | 409 PERIOD_NOT_READY (details = รายการร่าง/เอกสารรอลง) |
| GET/POST /accounting/journals · GET/PUT …/:id · POST …/:id/{post,void,reverse} | finance.view/edit/approve | ผู้บันทึกผ่านรายการเองไม่ได้ (403); 409 PERIOD_CLOSED / AUTO_ENTRY (รายการอัตโนมัติให้ยกเลิกที่เอกสาร) |
| GET /accounting/auto-post/pending?to · POST /accounting/auto-post {to?} | finance.view / finance.approve | คืน {posted, byType, exceptions[]} |
| GET /accounting/reports/{trial-balance,profit-loss,balance-sheet,general-ledger} | finance.view | from/to (asOf), vesselId, accountId |
| GET/POST /accounting/ap/bills · GET/PUT …/:id · POST …/:id/{approve,void} · GET /accounting/ap/unbilled-receipts?supplierId | finance.view/edit/approve | 409 DUPLICATE_INVOICE / GR_NOT_BILLABLE / HAS_PAYMENTS; ผู้บันทึกอนุมัติเองไม่ได้ |
| GET/POST /accounting/ap/payments · POST …/:id/void · GET /accounting/ap/aging?asOf | finance.view / finance.approve | 409 OVERPAY; WHT = ฐาน × อัตรา |
| GET/POST /accounting/bank-accounts · PUT …/:id | finance.view / finance.approve | บัญชีแยกประเภทต้องเป็นสินทรัพย์ที่รับรายการ |
| GET/POST /accounting/bank-recs · GET/DELETE …/:id · PUT …/:id/items · POST …/:id/complete | finance.view/edit/approve | 409 NOT_RECONCILED / ALREADY_CLEARED / DRAFT_EXISTS |
| GET /accounting/tax/vat?year&month · GET /accounting/tax/wht?year&month | finance.view | ภาษีขาย/ซื้อ (ไม่รวมยอดขายยกเว้น VAT ในตาราง), ภ.ง.ด.3 (บุคคลธรรมดา) / ภ.ง.ด.53 |
| GET/POST /users · PATCH /users/:id · POST /users/:id/reset-password | user.manage | |
| GET /roles · /permissions · PUT /roles/:id/permissions | role.manage∨user.manage / role.manage | SUPER_ADMIN แก้ไม่ได้ |
| GET /audit-logs | audit.view | |
| GET/PATCH /settings | auth / settings.manage | |
