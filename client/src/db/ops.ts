import { api, hasServer } from '../api';
import { addDays, timeToMin, todayStr } from '../lib/dates';
import { clampReward, streak, streakMultiplier } from '../lib/game';
import { markId } from '../lib/planner';
import type { DayItem, MarkRec } from '../types';
import { getPlanner } from './planState';
import { all, get, getRaw, patch, put, remove, restore } from './store';

function upsertMark(item: DayItem, fields: Partial<MarkRec>) {
  if (item.src === 'event') return;
  const id = markId(item.src, item.srcId, item.date);
  const cur = getRaw('marks', id);
  put('marks', { ...(cur || {}), id, src: item.src, srcId: item.srcId, date: item.date, ...fields, deleted: false } as MarkRec);
}

const earnId = (item: DayItem) => `earn:${item.key}${item.src === 'event' ? '' : ''}`;

export function award(item: DayItem) {
  const id = earnId(item);
  const cur = getRaw('ledger', id);
  if (cur && !cur.deleted) return 0;
  const s = streak(all('ledger'));
  const amount = clampReward(Math.round((item.reward || 0) * streakMultiplier(s)));
  if (amount <= 0) return 0;
  put('ledger', { id, ts: Date.now(), amount, reason: item.title, kind: 'earn', ref: item.key });
  return amount;
}

export function unaward(item: DayItem) {
  remove('ledger', earnId(item));
}

export function setItemStatus(item: DayItem, status: 'done' | 'skipped' | null, actualMin?: number | null) {
  if (item.src === 'event') {
    patch('events', item.srcId, { status: status ?? 'planned', actualMin: actualMin ?? null, startedAt: null });
  } else {
    upsertMark(item, { status, actualMin: actualMin ?? null, startedAt: null });
  }
  if (status === 'done') return award(item);
  unaward(item);
  return 0;
}

export function startTimer(item: DayItem) {
  stopAllTimers();
  if (item.src === 'event') patch('events', item.srcId, { startedAt: Date.now() });
  else upsertMark(item, { startedAt: Date.now() });
}

export function stopTimer(item: DayItem) {
  const started = item.startedAt;
  const minutes = started ? Math.max(1, Math.round((Date.now() - started) / 60000)) : null;
  return { minutes, coins: setItemStatus(item, 'done', minutes) };
}

export function cancelTimer(item: DayItem) {
  if (item.src === 'event') patch('events', item.srcId, { startedAt: null });
  else upsertMark(item, { startedAt: null });
}

export function stopAllTimers() {
  for (const e of all('events')) if (e.startedAt && e.status !== 'done') patch('events', e.id, { startedAt: null });
  for (const m of all('marks')) if (m.startedAt && m.status !== 'done') patch('marks', m.id, { startedAt: null });
}

export function runningTimer(): DayItem | null {
  const ev = all('events').find((e) => e.startedAt && e.status !== 'done');
  const mk = all('marks').find((m) => m.startedAt && m.status !== 'done');
  if (!ev && !mk) return null;
  const date = ev?.date || mk!.date;
  const items = getPlanner().dayItems(date, { includeHidden: true });
  return items.find((i) => i.startedAt && i.status !== 'done') || null;
}

export function setHidden(item: DayItem, hidden: boolean) {
  if (item.src === 'event') {
    if (hidden) remove('events', item.srcId);
    else restore('events', item.srcId);
  } else upsertMark(item, { hidden });
}

export function overrideTime(item: DayItem, start: string, end: string) {
  if (item.src === 'event') patch('events', item.srcId, { start, end });
  else upsertMark(item, { start, end });
}

export function resetOverride(item: DayItem) {
  if (item.src !== 'event') upsertMark(item, { start: null, end: null, hidden: false });
}

/** Награда за задачу целиком (сверх наград за отдельные подходы) */
export function completeTask(taskId: string, done: boolean) {
  const task = get('tasks', taskId);
  if (!task) return 0;
  patch('tasks', taskId, { status: done ? 'done' : 'todo', doneAt: done ? Date.now() : null });
  const id = `earn:task:${taskId}`;
  if (!done) {
    remove('ledger', id);
    return 0;
  }
  const cur = getRaw('ledger', id);
  if (cur && !cur.deleted) return 0;
  const bonus = clampReward(Math.round((task.reward || 0) * 0.3));
  if (bonus > 0) put('ledger', { id, ts: Date.now(), amount: bonus, reason: `Задача закрыта: ${task.title}`, kind: 'earn', ref: `task:${taskId}` });
  return bonus;
}

// ---------- Повестка для сервера (уведомления и календарь iPhone) ----------

let lastAgendaHash = '';
let agendaTimer: ReturnType<typeof setTimeout> | null = null;

function evalMinutes(name: string, date: string, fallback: number) {
  const r = getPlanner().engine.evalName(name, date);
  if (r.val && (r.val.t === 'dur' || r.val.t === 'num')) return Math.round(r.val.v);
  return fallback;
}

export function buildAgenda() {
  const planner = getPlanner();
  const today = todayStr();
  const items: Record<string, unknown>[] = [];
  const hiddenClassIds: string[] = [];
  const digest: Record<string, string> = {};
  const eventRemind = evalMinutes('напоминание', today, 10);
  for (let i = -1; i <= 14; i += 1) {
    const date = addDays(today, i);
    const { wake } = planner.wakeSleep(date);
    digest[date] = `${String(Math.floor(wake / 60)).padStart(2, '0')}:${String(wake % 60).padStart(2, '0')}`;
    for (const it of planner.dayItems(date, { includeHidden: true })) {
      if (it.src === 'class') {
        if (it.hidden || it.status === 'skipped') hiddenClassIds.push(it.srcId);
        continue;
      }
      if (it.hidden || it.status === 'skipped' || it.status === 'done') continue;
      let remind: number | null;
      if (it.src === 'routine') remind = it.remindMin ?? null;
      else remind = it.remindMin ?? (it.kind === 'meal' || it.kind === 'rest' ? null : eventRemind);
      items.push({
        uid: it.key,
        date,
        start: it.start,
        end: it.end,
        title: it.title,
        kind: it.kind,
        notes: it.notes || '',
        remindMin: remind,
      });
    }
  }
  return {
    tzOffsetMin: -new Date().getTimezoneOffset(),
    classRemindMin: evalMinutes('напоминание_пара', today, 15),
    hiddenClassIds,
    digest,
    items,
  };
}

export function scheduleAgendaUpload(delay = 3000) {
  if (!hasServer()) return;
  if (agendaTimer) clearTimeout(agendaTimer);
  agendaTimer = setTimeout(async () => {
    agendaTimer = null;
    const agenda = buildAgenda();
    const hash = JSON.stringify(agenda);
    if (hash === lastAgendaHash) return;
    try {
      await api('/api/agenda', { body: agenda });
      lastAgendaHash = hash;
    } catch {
      /* попробуем при следующей синхронизации */
    }
  }, delay);
}

export function minutesOf(item: Pick<DayItem, 'start' | 'end'>) {
  return Math.max(0, (timeToMin(item.end) ?? 0) - (timeToMin(item.start) ?? 0));
}
