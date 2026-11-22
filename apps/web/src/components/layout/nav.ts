import {
  Anchor, Bell, BookOpen, Boxes, Fuel, HandCoins, MapPinned, ShoppingCart, Wallet, Wrench, ClipboardList, FileWarning, Fish, LayoutDashboard, ScrollText, Mail, Settings, Shield, Ship, Users, UserCog,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from '@fisher/shared';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  perm?: Permission[];
}
export const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'ภาพรวม', items: [{ to: '/', label: 'แดชบอร์ด', icon: LayoutDashboard, perm: ['dashboard.view'] }] },
  {
    group: 'ปฏิบัติการเรือ',
    items: [
      { to: '/trips', label: 'เที่ยวเรือ', icon: Anchor, perm: ['trip.view'] },
      { to: '/catch', label: 'สัตว์น้ำที่จับได้', icon: Fish, perm: ['catch.view'] },
      { to: '/gps', label: 'ติดตามเรือ (GPS)', icon: MapPinned, perm: ['gps.view'] },
      { to: '/fuel', label: 'น้ำมันเชื้อเพลิง', icon: Fuel, perm: ['fuel.view'] },
      { to: '/maintenance', label: 'ซ่อมบำรุง', icon: Wrench, perm: ['maintenance.view'] },
      { to: '/vessels', label: 'ทะเบียนเรือ', icon: Ship, perm: ['vessel.view'] },
    ],
  },
  {
    group: 'บุคลากร',
    items: [
      { to: '/employees', label: 'พนักงาน/ลูกเรือ', icon: Users, perm: ['employee.view'] },
      { to: '/payroll', label: 'เงินเดือน/ค่าตอบแทน', icon: Wallet, perm: ['payroll.view'] },
      { to: '/documents', label: 'เอกสารใกล้หมดอายุ', icon: FileWarning, perm: ['employee.view'] },
    ],
  },
  { group: 'การขาย', items: [{ to: '/sales', label: 'ขายสัตว์น้ำ', icon: HandCoins, perm: ['sales.view'] }] },
  { group: 'การเงิน', items: [{ to: '/accounting', label: 'บัญชี', icon: BookOpen, perm: ['finance.view'] }] },
  {
    group: 'จัดซื้อและคลัง',
    items: [
      { to: '/purchasing', label: 'จัดซื้อ', icon: ShoppingCart, perm: ['purchase.view'] },
      { to: '/inventory', label: 'คลังสินค้า', icon: Boxes, perm: ['inventory.view'] },
    ],
  },
  { group: 'ข้อมูลหลัก', items: [{ to: '/species', label: 'ชนิดสัตว์น้ำ', icon: ClipboardList, perm: ['catch.view'] }] },
  {
    group: 'ระบบ',
    items: [
      { to: '/notifications', label: 'การแจ้งเตือน', icon: Bell },
      { to: '/admin/users', label: 'ผู้ใช้งาน', icon: UserCog, perm: ['user.manage'] },
      { to: '/admin/roles', label: 'บทบาทและสิทธิ์', icon: Shield, perm: ['role.manage'] },
      { to: '/admin/audit', label: 'ประวัติการใช้งาน', icon: ScrollText, perm: ['audit.view'] },
      { to: '/admin/settings', label: 'ตั้งค่าระบบ', icon: Settings, perm: ['settings.manage'] },
      { to: '/admin/outbox', label: 'อีเมลขาออก', icon: Mail, perm: ['settings.manage'] },
    ],
  },
];

/** Breadcrumb labels for top-level path segments */
export const CRUMB: Record<string, string> = {
  trips: 'เที่ยวเรือ', catch: 'สัตว์น้ำ', vessels: 'ทะเบียนเรือ', employees: 'พนักงาน', documents: 'เอกสารใกล้หมดอายุ',
  species: 'ชนิดสัตว์น้ำ', notifications: 'การแจ้งเตือน', admin: 'ระบบ', users: 'ผู้ใช้งาน', roles: 'บทบาทและสิทธิ์',
  audit: 'ประวัติการใช้งาน', gps: 'ติดตามเรือ', fuel: 'น้ำมัน', purchasing: 'จัดซื้อ', inventory: 'คลังสินค้า', requests: 'ใบขอซื้อ', orders: 'ใบสั่งซื้อ', sales: 'ขายสัตว์น้ำ', invoices: 'ใบขาย', maintenance: 'ซ่อมบำรุง', payroll: 'เงินเดือน', periods: 'งวดเงินเดือน', slips: 'สลิปเงินเดือน', accounting: 'บัญชี', journals: 'สมุดรายวัน', bills: 'ใบแจ้งหนี้ผู้ขาย', assets: 'ทรัพย์สิน', 'bank-recs': 'กระทบยอดธนาคาร', settings: 'ตั้งค่า', outbox: 'อีเมลขาออก', new: 'เพิ่มใหม่', edit: 'แก้ไข', account: 'บัญชีของฉัน',
};
