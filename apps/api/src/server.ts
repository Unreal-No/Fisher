import { buildApp } from './app';
import { config } from './config';
import { prisma } from './lib/prisma';
import { scanSignalLost } from './modules/gps/service';
import { scanExpirations } from './modules/notifications/service';

const app = await buildApp();
await app.listen({ port: config.PORT, host: '0.0.0.0' });

// Background jobs (single-instance). For multi-instance deploys move to a scheduler / advisory lock.
const job = async () => {
  try {
    const r = await scanExpirations();
    await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    app.log.info(r, 'expiry scan done');
  } catch (err) {
    app.log.error({ err }, 'expiry scan failed');
  }
};
setTimeout(job, 10_000);
const timer = setInterval(job, 6 * 3600_000);
// GPS signal-lost check every 5 minutes
const gpsTimer = setInterval(() => scanSignalLost().catch((err) => app.log.error({ err }, 'gps scan failed')), 5 * 60_000);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    clearInterval(timer);
    clearInterval(gpsTimer);
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}
