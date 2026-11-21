// Expiry reminder scan: worker documents, vessel licences/documents. Idempotent via (user_id, dedupe_key).
import { daysUntil, formatDate } from '@fisher/shared';
import { prisma } from '../../lib/prisma';
import { getSettings } from '../../lib/settings';
import { checklist } from '../employees/docs';

interface Alert {
  type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  message: string;
  link: string;
  entityType: string;
  entityId: string;
  key: string;
  perm: string;
}

/** Pick the reminder bucket for N days left (e.g. 25 days with [90,60,30,7] -> 30). */
export function bucket(days: number, thresholds: number[]): number | 'expired' | null {
  if (days < 0) return 'expired';
  const t = [...thresholds].sort((a, b) => a - b).find((x) => days <= x);
  return t ?? null;
}

async function usersWith(perm: string) {
  const users = await prisma.user.findMany({
    where: { isActive: true, deletedAt: null, roles: { some: { role: { permissions: { some: { permission: { code: perm } } } } } } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

export async function scanExpirations(now = new Date()) {
  const { docReminderDays } = await getSettings(prisma);
  const alerts: Alert[] = [];
  const push = (days: number, base: Omit<Alert, 'severity' | 'key' | 'title'> & { label: string; keyBase: string; expiry: Date }) => {
    const b = bucket(days, docReminderDays);
    if (b === null) return;
    const expired = b === 'expired';
    alerts.push({
      ...base,
      severity: expired ? 'CRITICAL' : days <= 7 ? 'WARNING' : 'INFO',
      key: `${base.keyBase}:${expired ? 'expired' : `t${b}`}:${base.expiry.toISOString().slice(0, 10)}`,
      title: expired ? `${base.label} หมดอายุแล้ว` : `${base.label} จะหมดอายุใน ${days} วัน`,
      message: `${base.message} (หมดอายุ ${formatDate(base.expiry)})`,
    });
  };

  // employee documents
  const docs = await prisma.employeeDocument.findMany({
    where: { status: 'ACTIVE', expiryDate: { not: null }, employee: { deletedAt: null, status: { in: ['ACTIVE', 'ON_LEAVE', 'SUSPENDED'] } } },
    include: { documentType: true, employee: { select: { id: true, code: true, firstName: true, lastName: true } } },
  });
  for (const x of docs) {
    push(daysUntil(x.expiryDate, now)!, {
      type: 'EMP_DOC_EXPIRY', label: x.documentType.nameTh, keyBase: `empdoc:${x.id}`, expiry: x.expiryDate!,
      message: `${x.employee.code} ${x.employee.firstName} ${x.employee.lastName}`,
      link: `/employees/${x.employee.id}`, entityType: 'Employee', entityId: x.employee.id, perm: 'employee.view',
    });
  }

  // missing required documents
  const [emps, types] = await Promise.all([
    prisma.employee.findMany({
      where: { deletedAt: null, status: 'ACTIVE' },
      select: { id: true, code: true, firstName: true, lastName: true, nationality: true, documents: { where: { status: 'ACTIVE' }, select: { documentTypeId: true, expiryDate: true, status: true } } },
    }),
    prisma.documentType.findMany(),
  ]);
  for (const e of emps) {
    for (const c of checklist(e.nationality, e.documents, types, now).filter((c) => c.state === 'MISSING')) {
      alerts.push({
        type: 'EMP_DOC_MISSING', severity: 'WARNING', title: `ขาดเอกสาร: ${c.nameTh}`, message: `${e.code} ${e.firstName} ${e.lastName}`,
        link: `/employees/${e.id}`, entityType: 'Employee', entityId: e.id, key: `empmissing:${e.id}:${c.documentTypeId}`, perm: 'employee.view',
      });
    }
  }

  // vessel licence / registration / documents
  const vessels = await prisma.vessel.findMany({
    where: { deletedAt: null, status: { not: 'INACTIVE' } },
    include: { documents: { where: { deletedAt: null, expiryDate: { not: null } } } },
  });
  for (const v of vessels) {
    const items: [string, Date | null, string][] = [
      ['ใบอนุญาตทำการประมง', v.licenseExpiry, 'license'],
      ['ทะเบียนเรือ', v.registrationExpiry, 'registration'],
      ...v.documents.map((x) => [`เอกสารเรือ ${x.docNo ?? ''}`.trim(), x.expiryDate, `doc:${x.id}`] as [string, Date | null, string]),
    ];
    for (const [label, exp, k] of items) {
      if (!exp) continue;
      push(daysUntil(exp, now)!, {
        type: 'VESSEL_DOC_EXPIRY', label, keyBase: `vessel:${v.id}:${k}`, expiry: exp,
        message: `${v.code} ${v.name}`, link: `/vessels/${v.id}`, entityType: 'Vessel', entityId: v.id, perm: 'vessel.view',
      });
    }
  }

  const recipients = new Map<string, string[]>();
  for (const perm of new Set(alerts.map((a) => a.perm))) recipients.set(perm, await usersWith(perm));
  const rows = alerts.flatMap((a) =>
    (recipients.get(a.perm) ?? []).map((userId) => ({
      userId, type: a.type, severity: a.severity, title: a.title, message: a.message, link: a.link,
      entityType: a.entityType, entityId: a.entityId, dedupeKey: a.key,
    })),
  );
  const res = rows.length ? await prisma.notification.createMany({ data: rows, skipDuplicates: true }) : { count: 0 };
  return { alerts: alerts.length, created: res.count };
}
