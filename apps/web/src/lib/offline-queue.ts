// Offline submission queue (IndexedDB). Used for at-sea catch entry.
// Each item carries a clientRequestId -> server dedupes retries (idempotent). Conflicts/validation
// errors are kept as FAILED for the user to review; nothing is silently overwritten or dropped.
import { createStore, del, entries, set } from 'idb-keyval';
import { api, ApiError } from './api';

export interface QueueItem {
  id: string; // = clientRequestId
  path: string;
  body: Record<string, unknown>;
  label: string;
  createdAt: string;
  attempts: number;
  status: 'PENDING' | 'FAILED';
  error?: string;
}

const store = typeof indexedDB !== 'undefined' ? createStore('fisher-offline', 'queue') : undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export async function enqueue(path: string, body: Record<string, unknown>, label: string) {
  const id = (body.clientRequestId as string) ?? crypto.randomUUID();
  const item: QueueItem = { id, path, body: { ...body, clientRequestId: id }, label, createdAt: new Date().toISOString(), attempts: 0, status: 'PENDING' };
  await set(id, item, store);
  emit();
  return item;
}

export async function list(): Promise<QueueItem[]> {
  const all = await entries<string, QueueItem>(store);
  return all.map(([, v]) => v).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function remove(id: string) {
  await del(id, store);
  emit();
}

let syncing = false;
/** Push pending items. Network errors keep the item PENDING (retry later); API rejections mark FAILED. */
export async function sync(): Promise<{ sent: number; failed: number }> {
  if (syncing || (typeof navigator !== 'undefined' && !navigator.onLine)) return { sent: 0, failed: 0 };
  syncing = true;
  let sent = 0;
  let failed = 0;
  try {
    for (const item of await list()) {
      if (item.status !== 'PENDING') continue;
      try {
        await api.post(item.path, item.body);
        await del(item.id, store);
        sent++;
      } catch (e) {
        if (e instanceof ApiError && e.status !== 0 && e.status !== 401 && e.status < 500) {
          await set(item.id, { ...item, attempts: item.attempts + 1, status: 'FAILED', error: e.message }, store);
          failed++;
        } else {
          await set(item.id, { ...item, attempts: item.attempts + 1 }, store);
          break; // offline / server down: stop and retry later
        }
      }
    }
  } finally {
    syncing = false;
    emit();
  }
  return { sent, failed };
}

export async function retry(id: string) {
  const all = await list();
  const it = all.find((x) => x.id === id);
  if (it) await set(id, { ...it, status: 'PENDING', error: undefined }, store);
  return sync();
}

/** Auto-sync on reconnect and every 60s. */
export function startAutoSync() {
  const run = () => void sync();
  window.addEventListener('online', run);
  const t = setInterval(run, 60_000);
  run();
  return () => {
    window.removeEventListener('online', run);
    clearInterval(t);
  };
}
