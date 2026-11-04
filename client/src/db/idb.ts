// Минимальная обёртка над IndexedDB: по хранилищу на таблицу + key/value «meta».
export const TABLES = [
  'events', 'tasks', 'goals', 'variables', 'routines', 'marks', 'food', 'products',
  'weights', 'fridge', 'rewards', 'ledger', 'chat', 'settings', 'prices', 'notes', 'solutions',
] as const;

export type TableName = (typeof TABLES)[number];

const DB_NAME = 'smart-schedule';
const VERSION = 3;
let dbPromise: Promise<IDBDatabase> | null = null;
let memoryFallback = false;
const memMeta = new Map<string, unknown>();

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const t of TABLES) if (!db.objectStoreNames.contains(t)) db.createObjectStore(t, { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB заблокирована'));
  });
  dbPromise.catch(() => {
    memoryFallback = true;
  });
  return dbPromise;
}

function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function isMemoryOnly() {
  return memoryFallback;
}

export async function idbGetAll<T>(table: TableName): Promise<T[]> {
  try {
    const db = await open();
    return await new Promise<T[]>((resolve, reject) => {
      const req = db.transaction(table, 'readonly').objectStore(table).getAll();
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    memoryFallback = true;
    return [];
  }
}

export async function idbPutMany(table: TableName, recs: unknown[]) {
  if (!recs.length) return;
  try {
    const db = await open();
    const tx = db.transaction(table, 'readwrite');
    const store = tx.objectStore(table);
    for (const r of recs) store.put(r);
    await done(tx);
  } catch {
    memoryFallback = true;
  }
}

export async function idbClearAll() {
  try {
    const db = await open();
    const tx = db.transaction([...TABLES, 'meta'], 'readwrite');
    for (const t of [...TABLES, 'meta']) tx.objectStore(t).clear();
    await done(tx);
  } catch {
    /* ignore */
  }
  memMeta.clear();
}

export async function metaGet<T>(key: string): Promise<T | undefined> {
  if (memMeta.has(key)) return memMeta.get(key) as T;
  try {
    const db = await open();
    return await new Promise<T | undefined>((resolve, reject) => {
      const req = db.transaction('meta', 'readonly').objectStore('meta').get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

export async function metaSet(key: string, value: unknown) {
  memMeta.set(key, value);
  try {
    const db = await open();
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(value, key);
    await done(tx);
  } catch {
    memoryFallback = true;
  }
}

export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    /* ignore */
  }
}
