import { useSyncExternalStore } from 'react';
import type {
  Base, ChatRec, EventRec, FoodRec, FridgeRec, GoalRec, LedgerRec, MarkRec, NoteRec, PriceRec, ProductRec,
  RewardRec, RoutineRec, SettingsRec, SolutionRec, TaskRec, VariableRec, WeightRec,
} from '../types';
import { idbGetAll, idbPutMany, TABLES, type TableName } from './idb';

export interface TableTypes {
  events: EventRec;
  tasks: TaskRec;
  goals: GoalRec;
  variables: VariableRec;
  routines: RoutineRec;
  marks: MarkRec;
  food: FoodRec;
  products: ProductRec;
  weights: WeightRec;
  fridge: FridgeRec;
  rewards: RewardRec;
  ledger: LedgerRec;
  chat: ChatRec;
  settings: SettingsRec;
  prices: PriceRec;
  notes: NoteRec;
  solutions: SolutionRec;
}

type Rec = Base & Record<string, unknown>;

const data = Object.fromEntries(TABLES.map((t) => [t, new Map<string, Rec>()])) as Record<TableName, Map<string, Rec>>;
const versions = Object.fromEntries(TABLES.map((t) => [t, 0])) as Record<TableName, number>;
const cache = new Map<TableName, { v: number; list: unknown[] }>();
const listeners = new Set<() => void>();
let syncHook: (() => void) | null = null;

export function uid() {
  try {
    return crypto.randomUUID();
  } catch {
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }
}

export function setSyncHook(fn: () => void) {
  syncHook = fn;
}

function notify(table: TableName) {
  versions[table] += 1;
  for (const l of listeners) l();
}

// Пакетная запись в IndexedDB
const pending = new Map<TableName, Map<string, Rec>>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
function persist(table: TableName, rec: Rec) {
  let m = pending.get(table);
  if (!m) pending.set(table, (m = new Map()));
  m.set(rec.id, rec);
  if (!flushTimer) flushTimer = setTimeout(flush, 30);
}

export async function flush() {
  flushTimer = null;
  const batches = [...pending.entries()];
  pending.clear();
  await Promise.all(batches.map(([t, m]) => idbPutMany(t, [...m.values()])));
}

export async function loadAll() {
  await Promise.all(
    TABLES.map(async (t) => {
      const recs = await idbGetAll<Rec>(t);
      const map = data[t];
      for (const r of recs) if (r && r.id) map.set(r.id, r);
      versions[t] += 1;
    }),
  );
  for (const l of listeners) l();
}

export function all<T extends TableName>(table: T): TableTypes[T][] {
  const c = cache.get(table);
  if (c && c.v === versions[table]) return c.list as TableTypes[T][];
  const list = [...data[table].values()].filter((r) => !r.deleted) as unknown as TableTypes[T][];
  cache.set(table, { v: versions[table], list });
  return list;
}

export function get<T extends TableName>(table: T, id: string | null | undefined): TableTypes[T] | undefined {
  if (!id) return undefined;
  const r = data[table].get(id);
  return r && !r.deleted ? (r as unknown as TableTypes[T]) : undefined;
}

/** С учётом удалённых — чтобы не «воскрешать» удалённые стартовые записи */
export function getRaw<T extends TableName>(table: T, id: string): TableTypes[T] | undefined {
  return data[table].get(id) as unknown as TableTypes[T] | undefined;
}

type Input<T> = Omit<T, 'id' | 'updatedAt'> & { id?: string; updatedAt?: number };

export function put<T extends TableName>(table: T, rec: Input<TableTypes[T]>, opts: { updatedAt?: number } = {}): TableTypes[T] {
  const id = rec.id || uid();
  const full = { ...rec, id, updatedAt: opts.updatedAt ?? Math.max(Date.now(), (data[table].get(id)?.updatedAt ?? 0) + 1), _dirty: 1 } as unknown as Rec;
  data[table].set(id, full);
  persist(table, full);
  notify(table);
  syncHook?.();
  return full as unknown as TableTypes[T];
}

export function patch<T extends TableName>(table: T, id: string, fields: Partial<TableTypes[T]>): TableTypes[T] | undefined {
  const cur = data[table].get(id);
  if (!cur) return undefined;
  return put(table, { ...(cur as unknown as TableTypes[T]), ...fields, id });
}

export function remove(table: TableName, id: string) {
  const cur = data[table].get(id);
  if (!cur || cur.deleted) return;
  put(table, { ...(cur as Record<string, unknown>), id, deleted: true } as never);
}

export function restore(table: TableName, id: string) {
  const cur = data[table].get(id);
  if (!cur) return;
  put(table, { ...(cur as Record<string, unknown>), id, deleted: false } as never);
}

/** Применить запись с сервера (без пометки «грязная») */
export function applyRemote(table: TableName, rec: Rec) {
  const local = data[table].get(rec.id);
  if (local && local._dirty && local.updatedAt > rec.updatedAt) return false;
  if (local && !local._dirty && local.updatedAt > rec.updatedAt) return false;
  const full = { ...rec, _dirty: 0 } as Rec;
  data[table].set(rec.id, full);
  persist(table, full);
  return true;
}

export function markClean(table: TableName, id: string, updatedAt: number) {
  const local = data[table].get(id);
  if (local && local.updatedAt === updatedAt && local._dirty) {
    const clean = { ...local, _dirty: 0 } as Rec;
    data[table].set(id, clean);
    persist(table, clean);
  }
}

export function touchTables(tables: TableName[]) {
  for (const t of tables) versions[t] += 1;
  for (const l of listeners) l();
}

/** Пометить все записи для повторной выгрузки (например, сервер переустановлен с нуля) */
export function markAllDirty() {
  for (const t of TABLES) {
    for (const r of data[t].values()) {
      if (r._dirty) continue;
      const d = { ...r, _dirty: 1 } as Rec;
      data[t].set(r.id, d);
      persist(t, d);
    }
  }
}

export function dirtyRecords() {
  const out: { tbl: TableName; rec: Rec }[] = [];
  for (const t of TABLES) for (const r of data[t].values()) if (r._dirty) out.push({ tbl: t, rec: r });
  return out;
}

export function exportAll() {
  const out: Record<string, unknown[]> = {};
  for (const t of TABLES) out[t] = [...data[t].values()].map(({ _dirty, ...r }) => r);
  return out;
}

export function importAll(dump: Record<string, Rec[]>) {
  let n = 0;
  for (const t of TABLES) {
    for (const r of dump[t] || []) {
      if (!r || !r.id) continue;
      const cur = data[t].get(r.id);
      if (cur && cur.updatedAt >= (r.updatedAt || 0)) continue;
      const full = { ...r, updatedAt: r.updatedAt || Date.now(), _dirty: 1 } as Rec;
      data[t].set(r.id, full);
      persist(t, full);
      n += 1;
    }
    versions[t] += 1;
  }
  for (const l of listeners) l();
  syncHook?.();
  return n;
}

/** Вызвать fn, когда меняется любая из таблиц (с задержкой, чтобы пачка изменений дала один вызов) */
export function onTablesChange(tables: TableName[], fn: () => void, delay = 1200) {
  let snapshot = tables.map((t) => versions[t]).join('.');
  let timer: ReturnType<typeof setTimeout> | null = null;
  const check = () => {
    const now = tables.map((t) => versions[t]).join('.');
    if (now === snapshot) return;
    snapshot = now;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, delay);
  };
  listeners.add(check);
  return () => listeners.delete(check);
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useTable<T extends TableName>(table: T): TableTypes[T][] {
  useSyncExternalStore(subscribe, () => versions[table]);
  return all(table);
}

export function useRecord<T extends TableName>(table: T, id: string | null | undefined): TableTypes[T] | undefined {
  useSyncExternalStore(subscribe, () => versions[table]);
  return get(table, id);
}

export function useVersion(tables: TableName[]) {
  return useSyncExternalStore(subscribe, () => tables.map((t) => versions[t]).join('.'));
}

/** Небольшой реактивный «стор» для состояния приложения */
export function createStore<S>(initial: S) {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(next: Partial<S> | ((s: S) => S)) {
      state = typeof next === 'function' ? (next as (s: S) => S)(state) : { ...state, ...next };
      for (const s of subs) s();
    },
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    use(): S {
      return useSyncExternalStore(
        (fn) => {
          subs.add(fn);
          return () => subs.delete(fn);
        },
        () => state,
      );
    },
  };
}
