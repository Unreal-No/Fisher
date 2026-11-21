# Database Schema & Data Dictionary

แหล่งจริง: `apps/api/prisma/schema.prisma` + `prisma/migrations/*` · PostgreSQL 16
Conventions: ตาราง/คอลัมน์ snake_case · PK UUIDv7 (`audit_logs`,`gps_positions` = bigserial) · เงิน `numeric(14,2)` · น้ำหนัก กก. `numeric(12,3)` · วันที่ล้วน `date` · เวลา `timestamptz` (UTC) · master = soft delete `deleted_at`

## Phase 1 (มีแล้ว)
| ตาราง | คำอธิบาย | คีย์/ข้อจำกัดสำคัญ |
|---|---|---|
| users | บัญชีผู้ใช้ (argon2id), lockout | username unique, employee_id unique |
| roles / permissions / role_permissions / user_roles | RBAC | permission.code `<module>.<action>` |
| user_vessels | ขอบเขตข้อมูลตามเรือ (ว่าง = ทุกลำ) | PK(user, vessel) |
| sessions | id = sha256(token), csrf_token, expiry | idx user, expires |
| files | metadata ไฟล์ (storage_key, sha256, sensitivity INTERNAL/CONFIDENTIAL/PERSONAL) | storage_key unique |
| vessels | ทะเบียนเรือ ขนาด เครื่องยนต์ ใบอนุญาต สถานะ | code, registration_no, mmsi unique |
| vessel_documents | เอกสารเรือ + วันหมดอายุ | idx expiry |
| employees | พนักงาน/ลูกเรือ (national_id_no, bank_account_no = PDPA) | code unique |
| document_types | checklist เอกสาร (applies_to ALL/THAI/FOREIGN, is_required, requires_expiry) | code unique |
| employee_documents | เอกสารพนักงาน; ต่ออายุ = แถวใหม่ + เก่า REPLACED (replaced_by_id) | idx (employee,status), expiry |
| employment_history | HIRED/STATUS/POSITION/PAY/VESSEL_ASSIGN | idx (employee, date) |
| vessel_assignments | ประวัติประจำเรือ | **partial unique**: 1 แถวเปิด/พนักงาน |
| fishing_trips | เที่ยวเรือ + ข้อมูลออก/เข้า/น้ำมัน/สรุป (settlement_snapshot) + version | trip_no unique; **partial unique** 1 active/เรือ; CHECK arrived≥departed |
| trip_status_history | log สถานะ | idx (trip, time) |
| trip_crew | ลูกเรือในเที่ยว + doc_check snapshot ตอนออกเรือ | unique (trip, employee) |
| trip_fuel / trip_supplies / trip_expenses / trip_incidents | รายการย่อยของเที่ยว | CHECK ค่า > 0 |
| fish_species / catch_grades | master สัตว์น้ำ/เกรด | code unique |
| catch_records | น้ำหนักจับ (ไม่ใช่ขาย), vessel_id denormalised, client_request_id (idempotency), void | idx (vessel,date),(species,date); CHECK weight>0 |
| catch_adjustments | ประวัติแก้ไข {field:{from,to}} + เหตุผล | idx record |
| catch_losses | เน่าเสีย/เสียหาย/ส่วนต่าง | CHECK weight>0 |
| gps_devices / gps_positions | อุปกรณ์ (api_key_hash unique) / ตำแหน่ง (is_demo แยกข้อมูลสาธิต) | unique (vessel, device, recorded_at); idx (vessel, time) |
| geofences / geofence_events | เขต CIRCLE/POLYGON + เหตุการณ์ ENTER/EXIT | CHECK radius>0 |
| fuel_tanks | ถังน้ำมันบริษัท: balance_l, avg_cost (คำนวณจาก ledger, row lock) | code unique |
| fuel_transactions | ledger รับ/จ่าย/ปรับยอด (liters/total_cost แบบมีเครื่องหมาย), ผูก trip_fuel เมื่อจ่ายเข้าเที่ยว | **append-only trigger**; trip_fuel FK RESTRICT |
| fishing_trips.engine_hours_at_departure/arrival | ชั่วโมงเครื่องยนต์ | CHECK arrival ≥ departure |
| suppliers | ผู้ขาย (เลขผู้เสียภาษี 13 หลัก, เครดิตเทอม) | code unique, soft delete |
| warehouses / inventory_items | คลัง / สินค้า (หมวด = supply category, จุดสั่งซื้อ min_stock) | code unique |
| stock_balances | ยอดคงเหลือ + ต้นทุนเฉลี่ยต่อคลัง×สินค้า (row lock) | PK (warehouse, item) |
| stock_movements | ledger รับ/เบิก/โอนออก-เข้า (transfer_pair_id)/ปรับยอด; ผูก trip_supply เมื่อเบิกเข้าเที่ยว | **append-only trigger**; CHECK qty≠0; trip_supply FK RESTRICT |
| purchase_requests / _items | ใบขอซื้อ DRAFT→SUBMITTED→APPROVED/REJECTED→ORDERED | |
| purchase_orders / _items | ใบสั่งซื้อ (ส่วนลด, VAT, ยอดรวม), received_qty ต่อรายการ | CHECK received ≤ ordered |
| goods_receipts / _items | ใบรับสินค้า: ต้นทุนสุทธิ (หลังส่วนลด ไม่รวม VAT), ผูก stock_movement หรือ trip_supply | |
| customers | ลูกค้า (เลขผู้เสียภาษี, เครดิตเทอม) | code unique |
| sales_invoices | DRAFT (ใบสั่งขาย SO) → CONFIRMED (ใบแจ้งหนี้ INV) → VOID; paid_amount/credited_amount ดูแลใน transaction | CHECK paid+credited ≤ total; CONFIRMED ต้องมี invoice_no |
| sales_items | ขายจากล็อต trip×species×grade; discount_share, returned_kg/amount | CHECK returned ≤ sold |
| sales_payments | ใบเสร็จ RC (ยกเลิกด้วยเหตุผล ไม่ลบ) | CHECK amount > 0 |
| sales_returns / _items | ใบลดหนี้ CN (ไม่คืนสต็อก) | |
| notifications | แจ้งเตือนต่อผู้ใช้ | unique (user, dedupe_key) |
| audit_logs | append-only (trigger), before/after redact PDPA | idx (entity), (user,time), time |
| app_settings | key/value JSON (docReminderDays ฯลฯ) | PK key |
| doc_sequences | เลขรันต่อ key/period | PK (key, period) |

## แผนตารางเฟสถัดไป
- Maintenance: `maintenance_plans`, `maintenance_orders`, `service_providers`
- Payroll: `compensation_rules` (ต่อเรือ/ตำแหน่ง, JSON formula versioned), `payroll_periods`, `payroll_records`, `payroll_items`, `employee_advances`, `loans`, `deductions`, `payment_vouchers`
- Accounting: `chart_of_accounts`, `fiscal_periods` (closing), `journal_entries` (DRAFT/POSTED/REVERSED), `journal_lines` (Σdr=Σcr ตรวจด้วย deferred constraint trigger), `bank_accounts`, `cost_allocations` (vessel/trip/department)
