# UI Design Guide

แนวทาง: ERP องค์กร — เรียบ, ข้อมูลแน่นแต่อ่านง่าย, ไม่ใช้ gradient/ม่วง AI/แอนิเมชันเกินจำเป็น

## Tokens (`apps/web/src/index.css` @theme)
| token | ค่า | ใช้ |
|---|---|---|
| navy-900 / 800 / 700 | #0b1f3a / #12294a / #1b365d | sidebar, ปุ่มหลัก, กราฟ |
| accent / accent-soft | #2563eb / #eff4ff | ลิงก์, focus, แถว hover |
| page / line / ink / muted | #f5f7fa / #e2e8f0 / #0f172a / #64748b | พื้นหลัง, เส้น, ตัวอักษร |
| ok / warn / bad (+ -soft) | เขียว / เหลืองอำพัน / แดง | สถานะเท่านั้น |
ฟอนต์ Sarabun (self-host ผ่าน @fontsource → ใช้ offline ได้) ขนาดฐาน 15px · มุมโค้ง `rounded`/`rounded-md` เท่านั้น

## Layout
Sidebar navy (กรองเมนูตามสิทธิ์; มือถือ = drawer) · Topbar: breadcrumb, สถานะซิงก์ออฟไลน์, กระดิ่งแจ้งเตือน, เมนูผู้ใช้ · เนื้อหา max 1440px

## Components (`components/ui`)
Button(primary/accent/outline/ghost/danger) · Input/Select/Textarea/Checkbox · Field (label+error+hint) · FormGrid/FormSection · Panel (แทน card) · DL · Stat · Badge(tone) · DataTable (TanStack: server paging/sort, empty/loading/error, footer รวม) · Dialog/ConfirmDialog (requireReason) · Tabs · Dropdown · QueryView

## รูปแบบ
- รายการ: PageHeader + FilterBar (search debounce, select) + DataTable; สถานะ list เก็บใน URL (แชร์ลิงก์ได้)
- รายละเอียด: PageHeader (actions ตามสิทธิ์+สถานะ) + Stat + Tabs
- Workflow เที่ยวเรือ: Stepper + ปุ่ม action เฉพาะสถานะที่ทำได้ (ไม่มีปุ่มหลอก)
- ฟอร์ม: validation ฝั่ง client ด้วย Zod schema เดียวกับ server; error ภาษาไทยใต้ช่อง; server fieldErrors map กลับเข้าฟอร์ม
- การลบ/ยกเลิก: ConfirmDialog; ธุรกรรมต้องใส่เหตุผล
- วันที่แสดง พ.ศ. (`formatDate`), เงิน 2 ตำแหน่ง, กก. ตัดทศนิยมศูนย์
- ข้อมูลส่วนบุคคล: แสดง mask (`AB*****67`) เมื่อไม่มีสิทธิ์

## คำศัพท์
เที่ยวเรือ, ออกเรือ, เข้าท่า, ไต้ก๋ง/นายเรือ, ลูกเรือ, สัตว์น้ำ, เข่ง/ลัง, ปลาเป็ด, น้ำมันคงเหลือ, ประมาณการ/วัดจริง, ยืนยันแล้ว
