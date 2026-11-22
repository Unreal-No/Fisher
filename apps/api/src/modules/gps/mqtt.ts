// GPS over MQTT: subscribes to {prefix}/{adapter}/{identifier} and feeds the same adapters + ingest as HTTP.
// Trust model: the broker authenticates devices and must restrict each device to its own topic (ACL);
// the bridge only accepts identifiers of registered, active devices.
import mqtt, { type MqttClient } from 'mqtt';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../../config';
import { prisma } from '../../lib/prisma';
import { ADAPTERS } from './adapters';
import { ingest } from './service';

export type MqttResult = { ok: true; accepted: number } | { ok: false; reason: string };

/** Handle one message (exported for tests; never throws). */
export async function handleMqttMessage(topic: string, payload: Buffer | string, prefix = config.MQTT_TOPIC_PREFIX): Promise<MqttResult> {
  const rest = topic.startsWith(`${prefix}/`) ? topic.slice(prefix.length + 1).split('/') : [];
  if (rest.length !== 2 || !rest[0] || !rest[1]) return { ok: false, reason: 'topic' };
  const [adapterName, identifier] = rest as [string, string];
  const adapter = ADAPTERS[adapterName];
  if (!adapter) return { ok: false, reason: 'adapter' };
  let body: unknown;
  try {
    body = JSON.parse(payload.toString('utf8'));
  } catch {
    return { ok: false, reason: 'json' };
  }
  const device = await prisma.gpsDevice.findUnique({ where: { identifier } });
  if (!device || !device.isActive) return { ok: false, reason: 'device' };
  if (adapter.source === 'AIS' && device.source !== 'AIS') return { ok: false, reason: 'source' };
  try {
    const query = body && typeof body === 'object' && !Array.isArray(body)
      ? Object.fromEntries(Object.entries(body as Record<string, unknown>).map(([k, v]) => [k, v == null ? undefined : String(v)]))
      : {};
    const positions = adapter.parse({ body, query });
    const r = await ingest({ id: device.id, vesselId: device.vesselId, source: adapter.source === 'AIS' ? 'AIS' : device.source }, positions);
    return { ok: true, accepted: r.accepted };
  } catch (err) {
    return { ok: false, reason: (err as Error).message.slice(0, 200) };
  }
}

/** Connect when MQTT_URL is configured; returns the client (or null). Reconnects automatically. */
export function startMqttBridge(log: FastifyBaseLogger): MqttClient | null {
  if (!config.MQTT_URL) return null;
  const client = mqtt.connect(config.MQTT_URL, {
    username: config.MQTT_USERNAME, password: config.MQTT_PASSWORD, clientId: `fisher-api-${process.pid}`, reconnectPeriod: 5000,
  });
  const topic = `${config.MQTT_TOPIC_PREFIX}/+/+`;
  client.on('connect', () => {
    client.subscribe(topic, { qos: 1 }, (err) => (err ? log.error({ err }, 'mqtt subscribe failed') : log.info({ topic }, 'mqtt subscribed')));
  });
  client.on('error', (err) => log.error({ err: err.message }, 'mqtt error'));
  client.on('message', (t, payload) => {
    void handleMqttMessage(t, payload).then((r) => {
      if (!r.ok) log.warn({ topic: t, reason: r.reason }, 'mqtt message rejected');
    });
  });
  return client;
}
