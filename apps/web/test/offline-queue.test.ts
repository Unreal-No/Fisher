import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
vi.mock('../src/lib/api', async (orig) => {
  const m = await orig<typeof import('../src/lib/api')>();
  return { ...m, api: { ...m.api, post: (...a: unknown[]) => post(...a) } };
});
const { ApiError } = await import('../src/lib/api');
const q = await import('../src/lib/offline-queue');

describe('offline catch queue', () => {
  beforeEach(async () => {
    post.mockReset();
    for (const i of await q.list()) await q.remove(i.id);
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });
  afterEach(() => vi.restoreAllMocks());

  it('keeps an idempotency key and removes items once accepted', async () => {
    const it1 = await q.enqueue('/catch/records', { weightKg: 10 }, 'ปลาทู 10 กก.');
    expect(it1.body.clientRequestId).toBe(it1.id);
    post.mockResolvedValue({});
    expect(await q.sync()).toEqual({ sent: 1, failed: 0 });
    expect(post).toHaveBeenCalledWith('/catch/records', expect.objectContaining({ clientRequestId: it1.id }));
    expect(await q.list()).toHaveLength(0);
  });

  it('network failure keeps item pending; validation failure marks FAILED (never dropped)', async () => {
    await q.enqueue('/catch/records', { weightKg: 1 }, 'a');
    post.mockRejectedValueOnce(new ApiError(0, 'NETWORK', 'offline'));
    await q.sync();
    let items = await q.list();
    expect(items[0]!.status).toBe('PENDING');
    expect(items[0]!.attempts).toBe(1);

    post.mockRejectedValueOnce(new ApiError(409, 'INVALID_TRIP_STATUS', 'เที่ยวปิดแล้ว'));
    expect((await q.sync()).failed).toBe(1);
    items = await q.list();
    expect(items[0]!.status).toBe('FAILED');
    expect(items[0]!.error).toBe('เที่ยวปิดแล้ว');
  });

  it('does not send while offline', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await q.enqueue('/catch/records', { weightKg: 2 }, 'b');
    expect(await q.sync()).toEqual({ sent: 0, failed: 0 });
    expect(post).not.toHaveBeenCalled();
  });
});
