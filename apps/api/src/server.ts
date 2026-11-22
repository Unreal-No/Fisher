import { buildApp } from './app';
import { config } from './config';
import { sendNotificationDigests } from './lib/mail';
import { prisma } from './lib/prisma';
import { startMqttBridge } from './modules/gps/mqtt';
import { scanSignalLost } from './modules/gps/service';
import { runSimulatorTick } from './modules/gps/simulator';
import { getSettingsCached } from './lib/settings';
import { scanLowStock } from './modules/inventory/alerts';
import { scanMaintenanceDue } from './modules/maintenance/service';
import { scanExpirations } from './modules/notifications/service';

const app = await buildApp();
await app.listen({ port: config.PORT, host: '0.0.0.0' });
// GPS over MQTT (only when MQTT_URL is set)
const mqttClient = startMqttBridge(app.log);

// Background jobs (single-instance). For multi-instance deploys move to a scheduler / advisory lock.
const job = async () => {
  try {
    const r = { ...(await scanExpirations()), lowStock: (await scanLowStock()).low, maintenanceDue: (await scanMaintenanceDue()).due, digests: (await sendNotificationDigests()).sent };
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
// Simulated AIS/VMS feed (setting "gpsSimulator"), one step per minute
let simBusy = false;
const simTimer = setInterval(async () => {
  if (simBusy || !(await getSettingsCached()).gpsSimulator) return;
  simBusy = true;
  try {
    await runSimulatorTick();
  } catch (err) {
    app.log.error({ err }, 'gps simulator failed');
  } finally {
    simBusy = false;
  }
}, 60_000);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    clearInterval(timer);
    clearInterval(gpsTimer);
    clearInterval(simTimer);
    mqttClient?.end();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}
