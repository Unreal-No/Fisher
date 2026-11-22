// Seed: core reference data (always) + admin user + DEV/DEMO data (never in production).
// Demo records are tagged "[ข้อมูลตัวอย่าง]" in notes so they are clearly identifiable.
import { hash } from '@node-rs/argon2';
import { beYear } from '@fisher/shared';
import { prisma } from '../src/lib/prisma';
import { seedCore } from '../src/lib/seed-core';

const DEMO = '[ข้อมูลตัวอย่าง]';
const day = (offset: number) => {
  const x = new Date();
  x.setUTCHours(0, 0, 0, 0);
  x.setUTCDate(x.getUTCDate() + offset);
  return x;
};
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);

async function main() {
  const isProd = process.env.NODE_ENV === 'production';
  await seedCore(prisma);

  const pwd = process.env.SEED_ADMIN_PASSWORD;
  if (!pwd) throw new Error('SEED_ADMIN_PASSWORD is required');
  const passwordHash = await hash(pwd, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const role = (code: string) => prisma.role.findUniqueOrThrow({ where: { code } });

  const mkUser = async (username: string, fullName: string, roleCode: string, vesselIds: string[] = []) => {
    const r = await role(roleCode);
    return prisma.user.upsert({
      where: { username },
      update: {},
      create: {
        username, fullName, passwordHash, mustChangePassword: isProd,
        roles: { create: [{ roleId: r.id }] },
        vessels: { create: vesselIds.map((vesselId) => ({ vesselId })) },
      },
    });
  };
  await mkUser('admin', 'ผู้ดูแลระบบ', 'SUPER_ADMIN');

  if (isProd || process.env.SEED_DEMO_DATA !== 'true') {
    console.log('Seed done (core only).');
    return;
  }
  await seedSupplyDemo();
  await seedPayrollDemo();
  // demo installs show moving vessels (simulated AIS/VMS) until a real feed is connected
  if (!(await prisma.appSetting.findUnique({ where: { key: 'gpsSimulator' } })))
    await prisma.appSetting.create({ data: { key: 'gpsSimulator', value: true } });
  if (!(await prisma.bankAccount.count())) {
    const gl = await prisma.account.findUnique({ where: { code: '1120' } });
    if (gl) await prisma.bankAccount.create({ data: { code: 'BA-01', name: 'บัญชีกระแสรายวันหลัก', bankName: 'ธนาคารตัวอย่าง', accountNo: '000-0-00000-0', glAccountId: gl.id, notes: DEMO } });
  }
  await mkUser('acc', 'เจ้าหน้าที่บัญชี (ตัวอย่าง)', 'ACCOUNTANT');
  if (await prisma.vessel.count()) {
    console.log('Demo data already present – skipped.');
    return;
  }

  // ---------- demo vessels ----------
  const vessels = await Promise.all(
    [
      ['V-001', 'ส.ทะเลทอง 1', 'สข 01234', 'อวนลากแผ่นตะเฆ่', 18.5, 45, 'สงขลา', 'AT_PORT'],
      ['V-002', 'ส.ทะเลทอง 2', 'สข 01235', 'อวนล้อมจับ', 22, 60, 'สงขลา', 'AT_PORT'],
      ['V-003', 'โชคอนันต์ 9', 'ปน 00987', 'อวนลากคู่', 16, 32, 'ปัตตานี', 'MAINTENANCE'],
    ].map(([code, name, registrationNo, vesselType, lengthM, grossTonnage, homePort, status], i) =>
      prisma.vessel.create({
        data: {
          code: code as string, name: name as string, registrationNo: registrationNo as string, vesselType: vesselType as string,
          lengthM: lengthM as number, grossTonnage: grossTonnage as number, homePort: homePort as string, status: status as never,
          engineMake: 'Mitsubishi', engineModel: 'S6R2', engineSerialNo: `ENG-DEMO-${i + 1}`, enginePowerHp: 650 + i * 50,
          fuelTankCapacityL: 12000 + i * 2000, ownerName: 'บริษัท ประมงตัวอย่าง จำกัด',
          licenseNo: `LIC-DEMO-${i + 1}`, licenseExpiry: i === 1 ? day(20) : day(240), registrationExpiry: day(400),
          notes: DEMO,
        },
      }),
    ),
  );
  await prisma.docSequence.upsert({ where: { key_period: { key: 'VESSEL', period: 'ALL' } }, create: { key: 'VESSEL', period: 'ALL', lastValue: 3 }, update: {} });

  // ---------- demo employees ----------
  const people = [
    ['สมชาย', 'ใจดี', 'TH', 'CAPTAIN', 'MALE', 0],
    ['ประเสริฐ', 'ทองคำ', 'TH', 'CAPTAIN', 'MALE', 1],
    ['อาวุธ', 'แสงทอง', 'TH', 'ENGINEER', 'MALE', 0],
    ['Aung', 'Kyaw', 'MM', 'DECKHAND', 'MALE', 0],
    ['Min', 'Thu', 'MM', 'DECKHAND', 'MALE', 0],
    ['Zaw', 'Lin', 'MM', 'DECKHAND', 'MALE', 0],
    ['Sokha', 'Chan', 'KH', 'DECKHAND', 'MALE', 1],
    ['Dara', 'Kim', 'KH', 'FISH_HANDLER', 'MALE', 1],
    ['Thida', 'Win', 'MM', 'COOK', 'FEMALE', 0],
    ['มาลี', 'ศรีสุข', 'TH', 'OFFICE', 'FEMALE', -1],
  ] as const;
  const types = Object.fromEntries((await prisma.documentType.findMany()).map((t) => [t.code, t.id]));
  const emps = [];
  for (const [i, [firstName, lastName, nationality, position, gender, v]] of people.entries()) {
    const e = await prisma.employee.create({
      data: {
        code: `EMP-${String(i + 1).padStart(5, '0')}`, firstName, lastName, nationality, position, gender,
        startDate: day(-400 + i * 10), payType: position === 'OFFICE' ? 'MONTHLY' : 'PER_TRIP',
        currentVesselId: v >= 0 ? vessels[v]!.id : null, phone: `08${String(10000000 + i * 1111111).slice(0, 8)}`, notes: DEMO,
      },
    });
    emps.push(e);
    await prisma.employmentHistory.create({ data: { employeeId: e.id, eventType: 'HIRED', effectiveDate: e.startDate, toValue: position } });
    if (v >= 0)
      await prisma.vesselAssignment.create({ data: { employeeId: e.id, vesselId: vessels[v]!.id, position, startDate: e.startDate } });
    // documents: realistic mix (one expired, some expiring) to exercise alerts
    const codes = nationality === 'TH' ? ['NATIONAL_ID', 'SEAMAN_BOOK', 'MEDICAL_CERT', 'EMPLOYMENT_CONTRACT'] : ['PASSPORT', 'VISA', 'WORK_PERMIT', 'SEAMAN_BOOK', 'MEDICAL_CERT', 'EMPLOYMENT_CONTRACT'];
    for (const [j, c] of codes.entries()) {
      if (i === 5 && c === 'MEDICAL_CERT') continue; // missing doc
      const expiry = c === 'EMPLOYMENT_CONTRACT' ? null : i === 4 && c === 'WORK_PERMIT' ? day(-3) : i === 6 && c === 'VISA' ? day(25) : day(180 + j * 30 + i * 5);
      await prisma.employeeDocument.create({
        data: { employeeId: e.id, documentTypeId: types[c]!, documentNo: `DEMO${i}${j}${1000 + i * 7}`, issueDate: day(-300), expiryDate: expiry, notes: DEMO },
      });
    }
  }
  vessels[0] = await prisma.vessel.update({ where: { id: vessels[0]!.id }, data: { captainId: emps[0]!.id } });
  vessels[1] = await prisma.vessel.update({ where: { id: vessels[1]!.id }, data: { captainId: emps[1]!.id } });
  await prisma.docSequence.upsert({ where: { key_period: { key: 'EMPLOYEE', period: 'ALL' } }, create: { key: 'EMPLOYEE', period: 'ALL', lastValue: people.length }, update: {} });

  // ---------- demo trips ----------
  const year = beYear();
  const species = Object.fromEntries((await prisma.fishSpecies.findMany()).map((s) => [s.code, s.id]));
  const gradeA = (await prisma.catchGrade.findUniqueOrThrow({ where: { code: 'A' } })).id;
  const crew0 = [emps[0]!, emps[2]!, emps[3]!, emps[5]!, emps[8]!];

  // closed trip (vessel 1)
  const closed = await prisma.fishingTrip.create({
    data: {
      tripNo: `TRP-${year}-0001`, vesselId: vessels[0]!.id, captainId: emps[0]!.id, status: 'PENDING_SETTLEMENT',
      departedAt: hoursAgo(24 * 20), departurePort: 'ท่าเรือสงขลา', fuelAtDepartureL: 800, fuelAtDepartureMeasurement: 'MEASURED',
      arrivedAt: hoursAgo(24 * 12), arrivalPort: 'ท่าเรือสงขลา', fuelAtArrivalL: 1500, fuelAtArrivalMeasurement: 'ESTIMATED',
      fishingArea: 'อ่าวไทยตอนล่าง', notes: DEMO,
      crew: { create: crew0.map((e) => ({ employeeId: e.id, role: e.position })) },
      fuel: { create: [{ recordedAt: hoursAgo(24 * 20 + 3), fuelType: 'DIESEL_B7', liters: 9000, pricePerLiter: 31.94, totalCost: 287460, supplierName: 'สถานีน้ำมันประมงสงขลา' }] },
      supplies: { create: [{ category: 'ICE', description: 'น้ำแข็งซอง', quantity: 300, unit: 'ซอง', unitCost: 45, totalCost: 13500 }, { category: 'FOOD', description: 'เสบียงอาหาร', quantity: 1, unit: 'ชุด', unitCost: 18000, totalCost: 18000 }] },
      expenses: { create: [{ category: 'UNLOADING', description: 'ค่าขนถ่ายสัตว์น้ำ', amount: 6500, expenseDate: day(-12) }] },
    },
  });
  const catchRows: [string, number, number][] = [['MACK-S', 2350.5, 94], ['THRD', 1280, 51], ['SQID', 860.25, 34], ['TRASH', 3100, 124]];
  for (const [code, kg, baskets] of catchRows)
    await prisma.catchRecord.create({
      data: { tripId: closed.id, vesselId: vessels[0]!.id, speciesId: species[code]!, gradeId: code === 'TRASH' ? null : gradeA, catchDate: day(-12), weightKg: kg, basketCount: baskets, storageType: 'ICE', notes: DEMO },
    });

  // trip at sea (vessel 2)
  const crew1 = [emps[1]!, emps[6]!, emps[7]!];
  const atSea = await prisma.fishingTrip.create({
    data: {
      tripNo: `TRP-${year}-0002`, vesselId: vessels[1]!.id, captainId: emps[1]!.id, status: 'AT_SEA',
      departedAt: hoursAgo(72), departurePort: 'ท่าเรือสงขลา', fuelAtDepartureL: 1200, fuelAtDepartureMeasurement: 'MEASURED',
      plannedReturnAt: new Date(Date.now() + 5 * 86400_000), fishingArea: 'อ่าวไทยตอนกลาง', notes: DEMO,
      crew: { create: crew1.map((e) => ({ employeeId: e.id, role: e.position })) },
      fuel: { create: [{ recordedAt: hoursAgo(75), fuelType: 'DIESEL_B7', liters: 10000, pricePerLiter: 32.14, totalCost: 321400 }] },
    },
  });
  await prisma.vessel.update({ where: { id: vessels[1]!.id }, data: { status: 'AT_SEA' } });
  for (const [code, kg] of [['MACK-I', 980], ['SPMK', 420.5]] as const)
    await prisma.catchRecord.create({
      data: { tripId: atSea.id, vesselId: vessels[1]!.id, speciesId: species[code]!, gradeId: gradeA, catchDate: day(-1), weightKg: kg, storageType: 'ICE', notes: DEMO },
    });
  for (const [t, steps] of [[closed, ['DRAFT', 'PREPARING', 'DEPARTED', 'AT_SEA', 'ARRIVED', 'PENDING_SETTLEMENT']], [atSea, ['DRAFT', 'PREPARING', 'DEPARTED', 'AT_SEA']]] as const) {
    let prev: string | null = null;
    for (const s of steps) {
      await prisma.tripStatusHistory.create({ data: { tripId: t.id, fromStatus: prev as never, toStatus: s as never, note: DEMO } });
      prev = s;
    }
  }
  await prisma.docSequence.upsert({ where: { key_period: { key: 'TRIP', period: String(year) } }, create: { key: 'TRIP', period: String(year), lastValue: 2 }, update: {} });

  // demo users per role
  await mkUser('owner', 'เจ้าของกิจการ (ตัวอย่าง)', 'OWNER');
  await mkUser('ops', 'ผู้จัดการปฏิบัติการ (ตัวอย่าง)', 'OPERATIONS_MANAGER');
  await mkUser('captain1', 'ไต้ก๋ง เรือ 1 (ตัวอย่าง)', 'CAPTAIN', [vessels[0]!.id]);
  await mkUser('hr', 'เจ้าหน้าที่บุคคล (ตัวอย่าง)', 'HR_OFFICER');
  await mkUser('viewer', 'ผู้ดูข้อมูล (ตัวอย่าง)', 'VIEWER');
  await mkUser('buyer', 'เจ้าหน้าที่จัดซื้อ (ตัวอย่าง)', 'PURCHASING_OFFICER');
  await mkUser('store', 'เจ้าหน้าที่คลัง (ตัวอย่าง)', 'WAREHOUSE_OFFICER');
  console.log('Seed done (core + demo).');
}

/** DEV/DEMO: example compensation rules (idempotent; skipped once any rule exists). */
async function seedPayrollDemo() {
  if (await prisma.compensationRule.count()) return;
  const from = new Date('2026-01-01');
  await prisma.compensationRule.createMany({
    data: [
      { name: 'ค่าจ้างรายวันลูกเรือ', method: 'DAILY', position: 'DECKHAND', rate: 400, effectiveFrom: from, notes: DEMO },
      { name: 'ส่วนแบ่งไต้ก๋ง 5% ของยอดขาย', method: 'REVENUE_SHARE', basis: 'GROSS_REVENUE', position: 'CAPTAIN', rate: 5, effectiveFrom: from, notes: DEMO },
      { name: 'ค่าปลาลูกเรือ 0.30 บาท/กก.', method: 'CATCH_BASED', basis: 'CAUGHT_KG', position: 'DECKHAND', rate: 0.3, effectiveFrom: from, notes: DEMO },
    ],
  });
}

/** DEV/DEMO: warehouse, items, supplier and opening stock (idempotent; skipped once any warehouse exists). */
async function seedSupplyDemo() {
  if (await prisma.warehouse.count()) return;
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' } });
  const wh = await prisma.warehouse.create({ data: { code: 'WH-01', name: 'คลังหลักสงขลา', location: 'ท่าเรือสงขลา', notes: DEMO } });
  await prisma.warehouse.create({ data: { code: 'WH-02', name: 'คลังท่าเรือปัตตานี', location: 'ท่าเรือปัตตานี', notes: DEMO } });
  await prisma.supplier.create({ data: { code: 'SUP-0001', name: 'ร้านอุปกรณ์ประมงตัวอย่าง', taxId: '0900000000001', paymentTermDays: 30, phone: '074000000', notes: DEMO } });
  await prisma.supplier.create({ data: { code: 'SUP-0002', name: 'โรงน้ำแข็งตัวอย่าง', paymentTermDays: 7, notes: DEMO } });
  const items = [
    ['ITM-00001', 'เชือก PE 12 มม.', 'ROPE', 'ม้วน', 20, 40, 115],
    ['ITM-00002', 'อวนลาก (ผืน)', 'NET', 'ผืน', 2, 3, 18500],
    ['ITM-00003', 'น้ำมันเครื่อง 15W-40', 'MAINTENANCE', 'แกลลอน', 10, 24, 890],
    ['ITM-00004', 'เสื้อชูชีพ', 'SAFETY', 'ตัว', 30, 18, 450],
    ['ITM-00005', 'ไส้กรองน้ำมันเชื้อเพลิง', 'SPARE_PART', 'ชิ้น', 6, 12, 320],
  ] as const;
  const { postMovement } = await import('../src/modules/inventory/stock');
  for (const [code, name, category, unit, minStock, qty, cost] of items) {
    const it = await prisma.inventoryItem.create({ data: { code, name, category, unit, minStock, notes: DEMO } });
    await prisma.$transaction((tx) =>
      postMovement(tx, { type: 'RECEIPT', warehouseId: wh.id, itemId: it.id, quantity: qty, unitCost: cost, movedAt: new Date(), refType: 'MANUAL', notes: `ยอดยกมา ${DEMO}`, userId: admin.id }),
    );
  }
  await prisma.docSequence.upsert({ where: { key_period: { key: 'ITEM', period: 'ALL' } }, create: { key: 'ITEM', period: 'ALL', lastValue: items.length }, update: {} });
  await prisma.docSequence.upsert({ where: { key_period: { key: 'SUPPLIER', period: 'ALL' } }, create: { key: 'SUPPLIER', period: 'ALL', lastValue: 2 }, update: {} });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
