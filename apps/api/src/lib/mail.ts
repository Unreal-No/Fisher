// Outgoing email. With SMTP_URL the message is sent; without it the message is only recorded (SIMULATED).
// Every message is kept in email_outbox either way, so administrators can see what was (or would be) sent.
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config';
import { prisma } from './prisma';

let transport: Transporter | null | undefined;
const getTransport = () => (transport === undefined ? (transport = config.SMTP_URL ? nodemailer.createTransport(config.SMTP_URL) : null) : transport);
export const mailMode = () => (config.SMTP_URL ? 'SMTP' : 'SIMULATED');

export async function sendMail(m: { to: string; subject: string; text: string; relatedType?: string; relatedId?: string }) {
  const t = getTransport();
  let status: 'SIMULATED' | 'SENT' | 'FAILED' = 'SIMULATED';
  let error: string | null = null;
  if (t) {
    try {
      await t.sendMail({ from: config.MAIL_FROM, to: m.to, subject: m.subject, text: m.text });
      status = 'SENT';
    } catch (e) {
      status = 'FAILED';
      error = (e as Error).message.slice(0, 500);
    }
  }
  return prisma.emailOutbox.create({
    data: { to: m.to, subject: m.subject, body: m.text, status, error, relatedType: m.relatedType ?? null, relatedId: m.relatedId ?? null, sentAt: status === 'SENT' ? new Date() : null },
  });
}

/** Once a day per user: unread warnings/critical notifications of the last 24 h, to users with an email address. */
export async function sendNotificationDigests(now = new Date()) {
  const since = new Date(now.getTime() - 24 * 3600_000);
  const users = await prisma.user.findMany({
    where: { isActive: true, deletedAt: null, email: { not: null }, notifications: { some: { readAt: null, createdAt: { gte: since }, severity: { in: ['WARNING', 'CRITICAL'] } } } },
    select: { id: true, email: true, fullName: true, notifications: { where: { readAt: null, createdAt: { gte: since }, severity: { in: ['WARNING', 'CRITICAL'] } }, orderBy: { createdAt: 'desc' }, take: 50, select: { title: true, message: true, severity: true } } },
  });
  let sent = 0;
  for (const u of users) {
    const recent = await prisma.emailOutbox.findFirst({ where: { to: u.email!, relatedType: 'DIGEST', createdAt: { gte: new Date(now.getTime() - 20 * 3600_000) } } });
    if (recent) continue;
    const lines = u.notifications.map((n) => `${n.severity === 'CRITICAL' ? '[ด่วน] ' : ''}${n.title}${n.message ? ` — ${n.message}` : ''}`);
    await sendMail({
      to: u.email!, subject: `Fisher ERP: การแจ้งเตือน ${lines.length} รายการ`, relatedType: 'DIGEST', relatedId: u.id,
      text: `เรียน ${u.fullName}\n\nรายการที่ต้องดำเนินการ (24 ชั่วโมงล่าสุด):\n\n${lines.map((l) => `• ${l}`).join('\n')}\n\nเข้าสู่ระบบเพื่อดูรายละเอียด`,
    });
    sent++;
  }
  return { sent };
}
