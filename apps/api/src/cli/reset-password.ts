// Server-console recovery when nobody can sign in: give a user (default "admin") a new one-time password,
// unlock the account and sign out its sessions; `--2fa` also removes its two-factor setup (lost phone).
// Needs access to the server itself:  ./fisher.sh reset-password [username] [--2fa]
// (inside the API container: node apps/api/dist/reset-password.js [username] [--2fa])
import { randomBytes } from 'node:crypto';
import { audit } from '../lib/audit';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../modules/auth/routes';

export async function resetPassword(username: string, reset2fa: boolean) {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) throw new Error(`ไม่พบผู้ใช้ ${username}`);
  const password = `Fisher-${randomBytes(5).toString('hex')}1`; // policy: upper + lower + digit
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(password), mustChangePassword: true, failedLogins: 0, lockedUntil: null, isActive: true,
        ...(reset2fa ? { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [] } : {}),
      },
    });
    await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.loginChallenge.deleteMany({ where: { userId: user.id } });
    await audit(tx, null, { action: 'PASSWORD_RESET', entityType: 'User', entityId: user.id, username: 'server-console', note: reset2fa ? 'console reset incl. 2FA' : 'console reset' });
  });
  return password;
}

if (process.argv[1]?.includes('reset-password')) {
  const args = process.argv.slice(2);
  const username = args.find((a) => !a.startsWith('--')) ?? 'admin';
  resetPassword(username, args.includes('--2fa'))
    .then((pw) => {
      console.log(`ตั้งรหัสผ่านใหม่ให้ ${username}: ${pw}`);
      console.log('ใช้ได้ครั้งเดียว — ระบบจะให้ตั้งรหัสผ่านใหม่เมื่อเข้าสู่ระบบ');
    })
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
