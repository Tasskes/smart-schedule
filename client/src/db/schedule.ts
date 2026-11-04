import { api, hasServer } from '../api';
import type { ClassItem, ScheduleData } from '../types';
import { metaGet, metaSet } from './idb';
import { createStore } from './store';

interface ScheduleState {
  data: ScheduleData | null;
  byDate: Map<string, ClassItem[]>;
  loading: boolean;
  error: string | null;
  checkedAt: number | null;
}

export const scheduleStore = createStore<ScheduleState>({
  data: null,
  byDate: new Map(),
  loading: false,
  error: null,
  checkedAt: null,
});

function index(data: ScheduleData | null) {
  const byDate = new Map<string, ClassItem[]>();
  for (const c of data?.classes || []) {
    const list = byDate.get(c.date);
    if (list) list.push(c);
    else byDate.set(c.date, [c]);
  }
  for (const list of byDate.values()) list.sort((a, b) => a.start.localeCompare(b.start));
  return byDate;
}

export function setSchedule(data: ScheduleData | null) {
  scheduleStore.set({ data, byDate: index(data) });
}

export async function loadScheduleCache() {
  const cached = await metaGet<ScheduleData>('schedule');
  if (cached) setSchedule(cached);
}

export async function refreshSchedule(force = false) {
  if (!hasServer()) return;
  const cur = scheduleStore.get().data;
  scheduleStore.set({ loading: true });
  try {
    const q = force ? '?force=1' : cur?.version ? `?since=${encodeURIComponent(cur.version)}` : '';
    const res = await api<ScheduleData & { notModified?: boolean }>(`/api/schedule${q}`, { timeoutMs: 60000 });
    if (res && !res.notModified) {
      setSchedule(res);
      await metaSet('schedule', res);
    }
    scheduleStore.set({ loading: false, error: res?.error || null, checkedAt: Date.now() });
  } catch (e) {
    scheduleStore.set({ loading: false, error: (e as Error).message });
  }
}

export function useSchedule() {
  return scheduleStore.use();
}

export function semesterStart(data: ScheduleData | null) {
  if (!data) return null;
  const teach = data.periods?.find((p) => /теорет/i.test(p.title));
  return data.minDate || teach?.begin || null;
}

export function classLocation(c: ClassItem) {
  if (c.rooms.length > 3) return `${c.rooms.slice(0, 2).join(', ')} и ещё ${c.rooms.length - 2}`;
  return c.rooms.join(', ');
}
