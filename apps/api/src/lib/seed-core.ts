// Idempotent reference data required in every environment (prod included).
import { PERMISSIONS, ROLE_DEFS } from '@fisher/shared';
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

export async function seedCore(db: Db) {
  // permissions
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
    if (!existing || code === 'SUPER_ADMIN') {
      await db.rolePermission.createMany({
        data: def.permissions.map((p) => ({ roleId: role.id, permissionId: permId.get(p)! })),
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
}
