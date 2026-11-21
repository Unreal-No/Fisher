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
| gps_devices / gps_positions | โครงสำหรับ Phase 2 (is_demo แยกข้อมูลสาธิต) | unique (device, recorded_at); idx (vessel, time) |
| notifications | แจ้งเตือนต่อผู้ใช้ | unique (user, dedupe_key) |
| audit_logs | append-only (trigger), before/after redact PDPA | idx (entity), (user,time), time |
| app_settings | key/value JSON (docReminderDays ฯลฯ) | PK key |
| doc_sequences | เลขรันต่อ key/period | PK (key, period) |

## แผนตารางเฟสถัดไป
- Fuel: `fuel_tanks`, `fuel_transactions` (รับเข้า/จ่ายเรือ/ปรับ, measured vs estimated), `engine_hour_logs`
- Purchasing/Inventory: `suppliers`, `purchase_requests`, `purchase_orders`, `purchase_items`, `goods_receipts`, `warehouses`, `inventory_items`, `stock_movements` (ledger, ห้ามติดลบเว้นอนุมัติ), `stock_balances` (view/materialized)
- Sales: `customers`, `catch_lots` (catch→lot), `sales_orders`, `sales_items` (lot_id), `sales_invoices`, `sales_payments`, `sales_returns`
- Maintenance: `maintenance_plans`, `maintenance_orders`, `service_providers`
- Payroll: `compensation_rules` (ต่อเรือ/ตำแหน่ง, JSON formula versioned), `payroll_periods`, `payroll_records`, `payroll_items`, `employee_advances`, `loans`, `deductions`, `payment_vouchers`
- Accounting: `chart_of_accounts`, `fiscal_periods` (closing), `journal_entries` (DRAFT/POSTED/REVERSED), `journal_lines` (Σdr=Σcr ตรวจด้วย deferred constraint trigger), `bank_accounts`, `cost_allocations` (vessel/trip/department)
- GPS: `geofences`, `geofence_events`
