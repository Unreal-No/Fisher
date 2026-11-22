// Idempotent reference data required in every environment (prod included).
import { PERMISSIONS, ROLE_DEFS, type AccountMapKey } from '@fisher/shared';
import type { Db } from './prisma';

export const DOCUMENT_TYPES = [
  { code: 'PASSPORT', nameTh: 'หนังสือเดินทาง (Passport)', nameEn: 'Passport', appliesTo: 'FOREIGN', isRequired: true, requiresExpiry: true },
  { code: 'CI', nameTh: 'เอกสารรับรองบุคคล (CI)', nameEn: 'Certificate of Identity', appliesTo: 'FOREIGN', isRequired: false, requiresExpiry: true },
  { code: 'VISA', nameTh: 'การตรวจลงตรา (Visa)', nameEn: 'Visa', appliesTo: 'FOREIGN', isRequired: true, requiresExpiry: true },
  { code: 'WORK_PERMIT', nameTh: 'ใบอนุญาตทำงาน', nameEn: 'Work Permit', appliesTo: 'FOREIGN', isRequired: true, requiresExpiry: true },
  { code: 'PINK_CARD', nameTh: 'บัตรประจำตัวคนซึ่งไม่มีสัญชาติไทย (บัตรชมพู)', nameEn: 'Pink Card', appliesTo: 'FOREIGN', isRequired: false, requiresExpiry: true },
  { code: 'SEAMAN_BOOK', nameTh: 'หนังสือคนประจำเรือ', nameEn: 'Seaman Book', appliesTo: 'ALL', isRequired: true, requiresExpiry: true },
  { code: 'MEDICAL_CERT', nameTh: 'ใบรับรองแพทย์', nameEn: 'Medical Certificate', appliesTo: 'ALL', isRequired: true, requiresExpiry: true },
  { code: 'HEALTH_INSURANCE', nameTh: 'ประกันสุขภาพ', nameEn: 'Health Insurance', appliesTo: 'FOREIGN', isRequired: false, requiresExpiry: true },
  { code: 'EMPLOYMENT_CONTRACT', nameTh: 'สัญญาจ้าง', nameEn: 'Employment Contract', appliesTo: 'ALL', isRequired: true, requiresExpiry: false },
  { code: 'NATIONAL_ID', nameTh: 'บัตรประจำตัวประชาชน', nameEn: 'Thai National ID', appliesTo: 'THAI', isRequired: true, requiresExpiry: true },
] as const;

export const GRADES = [
  { code: 'A', nameTh: 'เกรด A', sortOrder: 1 },
  { code: 'B', nameTh: 'เกรด B', sortOrder: 2 },
  { code: 'C', nameTh: 'เกรด C', sortOrder: 3 },
  { code: 'MIX', nameTh: 'คละเกรด', sortOrder: 4 },
  { code: 'REJECT', nameTh: 'ตกเกรด', sortOrder: 5 },
];

export const SPECIES = [
  ['MACK-S', 'ปลาทู', 'Short mackerel', 'Rastrelliger brachysoma', 'FISH'],
  ['MACK-I', 'ปลาลัง', 'Indian mackerel', 'Rastrelliger kanagurta', 'FISH'],
  ['SPMK', 'ปลาอินทรี', 'Spanish mackerel', 'Scomberomorus commerson', 'FISH'],
  ['SNAP-R', 'ปลากะพงแดง', 'Red snapper', 'Lutjanus spp.', 'FISH'],
  ['THRD', 'ปลาทรายแดง', 'Threadfin bream', 'Nemipterus spp.', 'FISH'],
  ['SARD', 'ปลาหลังเขียว', 'Sardine', 'Sardinella spp.', 'FISH'],
  ['TUNA-K', 'ปลาโอ', 'Kawakawa', 'Euthynnus affinis', 'FISH'],
  ['POMF', 'ปลาจาระเม็ด', 'Pomfret', 'Pampus spp.', 'FISH'],
  ['GROU', 'ปลาเก๋า', 'Grouper', 'Epinephelus spp.', 'FISH'],
  ['SCAD', 'ปลาสีกุน', 'Yellowstripe scad', 'Selaroides leptolepis', 'FISH'],
  ['SQID', 'หมึกกล้วย', 'Squid', 'Loligo spp.', 'SQUID'],
  ['CUTL', 'หมึกกระดอง', 'Cuttlefish', 'Sepia spp.', 'SQUID'],
  ['OCTO', 'หมึกสาย', 'Octopus', 'Octopus spp.', 'SQUID'],
  ['PRWN-B', 'กุ้งแชบ๊วย', 'Banana prawn', 'Penaeus merguiensis', 'SHRIMP'],
  ['CRAB-B', 'ปูม้า', 'Blue swimming crab', 'Portunus pelagicus', 'CRAB'],
  ['CLAM', 'หอยลาย', 'Undulated surf clam', 'Paphia undulata', 'SHELLFISH'],
  ['TRASH', 'ปลาเป็ด', 'Trash fish', null, 'TRASH_FISH'],
] as const;

/** Standard chart of accounts for a Thai fishing SME (TFRS for NPAEs style). [code, nameTh, type, normal, parent, postable] */
type Acc = [string, string, 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE', 'DEBIT' | 'CREDIT', string | null, boolean];
export const CHART_OF_ACCOUNTS: Acc[] = [
  ['1000', 'สินทรัพย์', 'ASSET', 'DEBIT', null, false],
  ['1100', 'สินทรัพย์หมุนเวียน', 'ASSET', 'DEBIT', '1000', false],
  ['1110', 'เงินสด', 'ASSET', 'DEBIT', '1100', true],
  ['1120', 'เงินฝากธนาคาร', 'ASSET', 'DEBIT', '1100', true],
  ['1130', 'ลูกหนี้การค้า', 'ASSET', 'DEBIT', '1100', true],
  ['1140', 'เงินยืม/เงินเบิกล่วงหน้าพนักงาน', 'ASSET', 'DEBIT', '1100', true],
  ['1150', 'ภาษีซื้อ', 'ASSET', 'DEBIT', '1100', true],
  ['1160', 'สินค้าคงเหลือ – วัสดุและอะไหล่', 'ASSET', 'DEBIT', '1100', true],
  ['1170', 'น้ำมันเชื้อเพลิงคงเหลือ', 'ASSET', 'DEBIT', '1100', true],
  ['1200', 'สินทรัพย์ไม่หมุนเวียน', 'ASSET', 'DEBIT', '1000', false],
  ['1210', 'เรือและอุปกรณ์', 'ASSET', 'DEBIT', '1200', true],
  ['1219', 'ค่าเสื่อมราคาสะสม – เรือและอุปกรณ์', 'ASSET', 'CREDIT', '1200', true],
  ['2000', 'หนี้สิน', 'LIABILITY', 'CREDIT', null, false],
  ['2100', 'หนี้สินหมุนเวียน', 'LIABILITY', 'CREDIT', '2000', false],
  ['2110', 'เจ้าหนี้การค้า', 'LIABILITY', 'CREDIT', '2100', true],
  ['2120', 'สินค้า/บริการรับแล้วรอตั้งหนี้', 'LIABILITY', 'CREDIT', '2100', true],
  ['2130', 'ค่าแรงค้างจ่าย', 'LIABILITY', 'CREDIT', '2100', true],
  ['2140', 'ค่าใช้จ่ายค้างจ่าย', 'LIABILITY', 'CREDIT', '2100', true],
  ['2150', 'ภาษีขาย', 'LIABILITY', 'CREDIT', '2100', true],
  ['2160', 'ภาษีหัก ณ ที่จ่ายค้างจ่าย', 'LIABILITY', 'CREDIT', '2100', true],
  ['3000', 'ส่วนของเจ้าของ', 'EQUITY', 'CREDIT', null, false],
  ['3100', 'ทุนจดทะเบียน/ทุนเจ้าของ', 'EQUITY', 'CREDIT', '3000', true],
  ['3200', 'กำไร (ขาดทุน) สะสม', 'EQUITY', 'CREDIT', '3000', true],
  ['3900', 'ยอดยกมาเพื่อเปิดบัญชี', 'EQUITY', 'CREDIT', '3000', true],
  ['4000', 'รายได้', 'REVENUE', 'CREDIT', null, false],
  ['4100', 'รายได้จากการขายสัตว์น้ำ', 'REVENUE', 'CREDIT', '4000', true],
  ['4110', 'รับคืนและลดหนี้จากการขาย', 'REVENUE', 'DEBIT', '4000', true],
  ['4200', 'รายได้อื่น', 'REVENUE', 'CREDIT', '4000', true],
  ['5000', 'ต้นทุนและค่าใช้จ่าย', 'EXPENSE', 'DEBIT', null, false],
  ['5100', 'ต้นทุนการทำประมง', 'EXPENSE', 'DEBIT', '5000', false],
  ['5110', 'ค่าน้ำมันเชื้อเพลิง', 'EXPENSE', 'DEBIT', '5100', true],
  ['5120', 'ค่าเสบียง น้ำแข็ง และวัสดุสิ้นเปลือง', 'EXPENSE', 'DEBIT', '5100', true],
  ['5130', 'ค่าแรงลูกเรือ', 'EXPENSE', 'DEBIT', '5100', true],
  ['5140', 'ค่าใช้จ่ายเที่ยวเรืออื่น', 'EXPENSE', 'DEBIT', '5100', true],
  ['5150', 'ค่าซ่อมบำรุงเรือ', 'EXPENSE', 'DEBIT', '5100', true],
  ['5200', 'ค่าใช้จ่ายในการบริหาร', 'EXPENSE', 'DEBIT', '5000', false],
  ['5210', 'เงินเดือนพนักงานสำนักงาน', 'EXPENSE', 'DEBIT', '5200', true],
  ['5220', 'ผลต่างจากการตรวจนับ/ปรับยอดสินค้า', 'EXPENSE', 'DEBIT', '5200', true],
  ['5230', 'ค่าเสื่อมราคา', 'EXPENSE', 'DEBIT', '5200', true],
  ['5290', 'ค่าใช้จ่ายเบ็ดเตล็ด', 'EXPENSE', 'DEBIT', '5200', true],
];
export const DEFAULT_ACCOUNT_MAP: Record<AccountMapKey, string> = {
  CASH: '1110', BANK: '1120', AR: '1130', EMPLOYEE_ADVANCES: '1140', INVENTORY: '1160', FUEL_INVENTORY: '1170',
  GRNI: '2120', ACCRUED_EXPENSES: '2140', ACCRUED_WAGES: '2130', VAT_OUTPUT: '2150',
  SALES_REVENUE: '4100', SALES_RETURNS: '4110', OTHER_INCOME: '4200',
  FUEL_EXPENSE: '5110', SUPPLIES_EXPENSE: '5120', CREW_WAGES: '5130', TRIP_OTHER_EXPENSE: '5140', MAINTENANCE_EXPENSE: '5150', INVENTORY_VARIANCE: '5220',
  AP: '2110', VAT_INPUT: '1150', WHT_PAYABLE: '2160',
};

/** Chart of accounts + mappings: created once; never overwrites accountant edits. */
async function seedAccounting(db: Db) {
  for (const [code, nameTh, type, normalBalance, parent, isPostable] of CHART_OF_ACCOUNTS) {
    if (await db.account.findUnique({ where: { code } })) continue;
    const parentId = parent ? (await db.account.findUniqueOrThrow({ where: { code: parent } })).id : null;
    await db.account.create({ data: { code, nameTh, type, normalBalance, parentId, isPostable, isSystem: true } });
  }
  for (const [key, code] of Object.entries(DEFAULT_ACCOUNT_MAP)) {
    if (await db.accountMapping.findUnique({ where: { key } })) continue;
    const acc = await db.account.findUnique({ where: { code } });
    if (acc) await db.accountMapping.create({ data: { key, accountId: acc.id } });
  }
}

export async function seedCore(db: Db) {
  // permissions (remember which are new so existing roles receive their default grants once)
  const existingCodes = new Set((await db.permission.findMany({ select: { code: true } })).map((p) => p.code));
  for (const [code, description] of Object.entries(PERMISSIONS)) {
    const [module, action] = code.split('.') as [string, string];
    await db.permission.upsert({ where: { code }, create: { code, module, action, description }, update: { description } });
  }
  const perms = await db.permission.findMany();
  const permId = new Map(perms.map((p) => [p.code, p.id]));

  // roles: create if missing; system role permissions are only initialised once (admins may edit later),
  // except SUPER_ADMIN which always gets every permission.
  for (const [code, def] of Object.entries(ROLE_DEFS)) {
    const existing = await db.role.findUnique({ where: { code } });
    const role = existing ?? (await db.role.create({ data: { code, name: def.name, description: def.description, isSystem: true } }));
    // new role / SUPER_ADMIN: full default set; existing role: only permissions introduced by this release
    const grant = !existing || code === 'SUPER_ADMIN' ? def.permissions : def.permissions.filter((p) => !existingCodes.has(p));
    if (grant.length) {
      await db.rolePermission.createMany({
        data: grant.map((p) => ({ roleId: role.id, permissionId: permId.get(p)! })),
        skipDuplicates: true,
      });
    }
  }

  for (const [i, t] of DOCUMENT_TYPES.entries())
    await db.documentType.upsert({ where: { code: t.code }, create: { ...t, sortOrder: i + 1 }, update: {} });
  for (const g of GRADES) await db.catchGrade.upsert({ where: { code: g.code }, create: g, update: {} });
  for (const [i, [code, nameTh, nameEn, scientificName, category]] of SPECIES.entries())
    await db.fishSpecies.upsert({
      where: { code },
      create: { code, nameTh, nameEn, scientificName, category, sortOrder: i + 1 },
      update: {},
    });
  await seedAccounting(db);
}
