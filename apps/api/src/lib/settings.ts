import type { DbOrTx } from './prisma';

export const DEFAULT_SETTINGS = {
  companyName: 'บริษัท ประมงตัวอย่าง จำกัด',
  docReminderDays: [90, 60, 30, 7],
  gpsSignalLostMinutes: 60,
};
export type Settings = typeof DEFAULT_SETTINGS;

export async function getSettings(db: DbOrTx): Promise<Settings> {
  const rows = await db.appSetting.findMany();
  const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = r.value;
  return s as Settings;
}
