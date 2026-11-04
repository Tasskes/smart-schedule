import { api, ApiError, hasServer } from './api';
import { metaGet, metaSet, TABLES, type TableName } from './db/idb';
import { applyRemote, createStore, dirtyRecords, flush, markClean, setSyncHook, touchTables } from './db/store';

export const syncStore = createStore<{
  status: 'idle' | 'syncing' | 'error' | 'offline' | 'local';
  lastSync: number | null;
  error: string | null;
}>({ status: 'idle', lastSync: null, error: null });

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let again = false;
const afterSync: (() => void)[] = [];

export function onAfterSync(fn: () => void) {
  afterSync.push(fn);
}

export function requestSync(delay = 1500) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncNow();
  }, delay);
}

setSyncHook(() => requestSync());

interface SyncResponse {
  seq: number;
  changes: { tbl: string; id: string; data: Record<string, unknown>; updatedAt: number; deleted: boolean }[];
}

export async function syncNow() {
  if (!hasServer()) {
    syncStore.set({ status: 'local' });
    return;
  }
  if (running) {
    again = true;
    return;
  }
  running = true;
  syncStore.set({ status: 'syncing' });
  try {
    let seq = (await metaGet<number>('lastSeq')) ?? 0;
    const changes = dirtyRecords().map(({ tbl, rec }) => {
      const { _dirty, ...data } = rec;
      return { tbl, id: rec.id, updatedAt: rec.updatedAt, deleted: !!rec.deleted, data };
    });
    const touched = new Set<TableName>();
    const CHUNK = 400;
    for (let i = 0; i === 0 || i < changes.length; i += CHUNK) {
      const chunk = changes.slice(i, i + CHUNK);
      const res = await api<SyncResponse>('/api/sync', { body: { since: seq, changes: chunk }, timeoutMs: 60000 });
      for (const c of chunk) markClean(c.tbl, c.id, c.updatedAt);
      for (const ch of res.changes) {
        if (!(TABLES as readonly string[]).includes(ch.tbl)) continue;
        const ok = applyRemote(ch.tbl as TableName, { ...ch.data, id: ch.id, updatedAt: ch.updatedAt, deleted: ch.deleted });
        if (ok) touched.add(ch.tbl as TableName);
      }
      seq = res.seq;
    }
    await metaSet('lastSeq', seq);
    touchTables([...touched]);
    await flush();
    syncStore.set({ status: 'idle', lastSync: Date.now(), error: null });
    for (const fn of afterSync) {
      try {
        fn();
      } catch (e) {
        console.warn(e);
      }
    }
  } catch (e) {
    const err = e as ApiError;
    syncStore.set({ status: err.status === 0 ? 'offline' : 'error', error: err.message });
  } finally {
    running = false;
    if (again) {
      again = false;
      requestSync(500);
    }
  }
}

export async function resetSyncCursor() {
  await metaSet('lastSeq', 0);
}
