import type { DbOrTx } from './prisma';

export const DEFAULT_SETTINGS = {
  companyName: 'บริษัท ประมงตัวอย่าง จำกัด',
  docReminderDays: [90, 60, 30, 7],
  gpsSignalLostMinutes: 60,
  maintenanceReminderDays: 14,
  maintenanceReminderHours: 50,
  /** warn when payroll deductions exceed this % of gross (Labour Protection Act s.76 caps many deductions) */
  payrollDeductionWarnPercent: 20,
  /** role codes that must use 2FA */
  require2faRoles: [] as string[],
};
export type Settings = typeof DEFAULT_SETTINGS;

let cache: { at: number; v: Settings } | null = null;
/** Settings for hot paths (auth), refreshed every 30 s or after an update. */
export async function getSettingsCached(): Promise<Settings> {
  if (cache && Date.now() - cache.at < 30_000) return cache.v;
  const { prisma } = await import('./prisma');
  cache = { at: Date.now(), v: await getSettings(prisma) };
  return cache.v;
}
export const invalidateSettingsCache = () => {
  cache = null;
};

export async function getSettings(db: DbOrTx): Promise<Settings> {
  const rows = await db.appSetting.findMany();
  const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = r.value;
  return s as Settings;
}
