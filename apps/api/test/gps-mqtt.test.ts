import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleMqttMessage, startMqttBridge } from '../src/modules/gps/mqtt';
import { ago, createUser, fixtures, login, makeApp, prisma, resetDb, type Agent } from './helpers';

let app: FastifyInstance;
let admin: Agent;
beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  await createUser('admin', 'SUPER_ADMIN');
  admin = await login(app, 'admin');
});
afterAll(() => app.close());

describe('GPS over MQTT', () => {
  it('accepts registered devices on {prefix}/{adapter}/{identifier}, rejects everything else', async () => {
    expect(startMqttBridge(app.log)).toBeNull(); // disabled without MQTT_URL
    const f = await fixtures(admin);
    await admin.patch(`/vessels/${f.vessel.id}`, { mmsi: '567000777' });
    const dev = (await admin.post('/gps/devices', { vesselId: f.vessel.id, source: 'DEDICATED', identifier: 'IMEI-MQTT-1' })).body.device;
    await admin.post('/gps/devices', { source: 'AIS', identifier: 'ais-mqtt' });

    const t = ago(0.5);
    const msg = JSON.stringify({ positions: [{ recordedAt: t, lat: 7.21, lng: 100.61, speedKnots: 6 }] });
    expect(await handleMqttMessage('fisher/gps/generic/IMEI-MQTT-1', msg)).toEqual({ ok: true, accepted: 1 });
    expect(await handleMqttMessage('fisher/gps/generic/IMEI-MQTT-1', msg)).toEqual({ ok: true, accepted: 0 }); // duplicate
    const stored = await prisma.gpsPosition.findMany({ where: { deviceId: dev.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ vesselId: f.vessel.id });

    // AIS feed resolves the vessel by MMSI
    const ais = await handleMqttMessage('fisher/gps/ais/ais-mqtt', JSON.stringify([{ mmsi: '567000777', lat: 7.3, lon: 100.7, timestamp: new Date().toISOString() }]));
    expect(ais).toEqual({ ok: true, accepted: 1 });

    expect(await handleMqttMessage('fisher/gps/generic/UNKNOWN', msg)).toEqual({ ok: false, reason: 'device' });
    expect(await handleMqttMessage('fisher/gps/nope/IMEI-MQTT-1', msg)).toEqual({ ok: false, reason: 'adapter' });
    expect(await handleMqttMessage('other/topic/generic/IMEI-MQTT-1', msg)).toEqual({ ok: false, reason: 'topic' });
    expect(await handleMqttMessage('fisher/gps/generic/IMEI-MQTT-1', '{not json')).toEqual({ ok: false, reason: 'json' });
    expect(await handleMqttMessage('fisher/gps/ais/IMEI-MQTT-1', msg)).toEqual({ ok: false, reason: 'source' }); // dedicated device cannot speak AIS
    const bad = await handleMqttMessage('fisher/gps/generic/IMEI-MQTT-1', JSON.stringify({ positions: [{ recordedAt: t, lat: 95, lng: 100 }] }));
    expect(bad.ok).toBe(false); // validation error, not a crash

    await prisma.gpsDevice.update({ where: { id: dev.id }, data: { isActive: false } });
    expect(await handleMqttMessage('fisher/gps/generic/IMEI-MQTT-1', msg)).toEqual({ ok: false, reason: 'device' });
  });
});
