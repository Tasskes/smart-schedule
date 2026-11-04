import type { ClassItem, DayItem, EventRec, MarkRec, PlanItemDraft, RoutineRec, VariableRec } from '../types';
import { academicWeek, dow, minToTime, timeToMin } from './dates';
import { defaultReward } from './game';
import { isKind } from './meta';
import { NULL, VarEngine, type DayCtx, type Val } from './vars';

export interface PlanState {
  classesByDate: Map<string, ClassItem[]>;
  events: EventRec[];
  routines: RoutineRec[];
  variables: VariableRec[];
  marks: MarkRec[];
  semesterStart?: string | null;
}

export type Window = [number, number];

export const markId = (src: 'class' | 'routine', srcId: string, date: string) => `${src}:${srcId}:${date}`;

export const DEFAULT_WAKE = 7 * 60 + 30;
export const DEFAULT_SLEEP = 23 * 60 + 30;

function shortRooms(rooms: string[]) {
  if (rooms.length > 3) return `${rooms.slice(0, 2).join(', ')} и ещё ${rooms.length - 2}`;
  return rooms.join(', ');
}

export function createPlanner(st: PlanState) {
  const marks = new Map(st.marks.map((m) => [m.id, m]));
  const eventsByDate = new Map<string, EventRec[]>();
  for (const e of st.events) {
    const list = eventsByDate.get(e.date);
    if (list) list.push(e);
    else eventsByDate.set(e.date, [e]);
  }

  const visibleClasses = (date: string) =>
    (st.classesByDate.get(date) || []).filter((c) => !marks.get(markId('class', c.id, date))?.hidden);

  const ctxCache = new Map<string, DayCtx>();
  const ctxFor = (date: string): DayCtx => {
    const cached = ctxCache.get(date);
    if (cached) return cached;
    const cls = visibleClasses(date);
    const first = cls.length ? timeToMin(cls[0].start) : null;
    const last = cls.length ? Math.max(...cls.map((c) => timeToMin(c.end) ?? 0)) : null;
    const week = academicWeek(date, st.semesterStart);
    const d = dow(date);
    const builtins: Record<string, Val> = {
      первая_пара: first != null ? { t: 'time', v: first } : NULL,
      конец_пар: last != null ? { t: 'time', v: last } : NULL,
      пар: { t: 'num', v: cls.length },
      день_недели: { t: 'num', v: d },
      чётная_неделя: week ? { t: 'num', v: week.even ? 1 : 0 } : NULL,
      четная_неделя: week ? { t: 'num', v: week.even ? 1 : 0 } : NULL,
      выходной: { t: 'num', v: d >= 6 ? 1 : 0 },
    };
    const ctx = { date, builtins };
    ctxCache.set(date, ctx);
    return ctx;
  };

  const engine = new VarEngine(st.variables, ctxFor);

  function routineSpan(r: RoutineRec, date: string): { start: number; end: number } | { error: string } | null {
    if (!r.enabled || !r.days.includes(dow(date))) return null;
    const hasClasses = visibleClasses(date).length > 0;
    if (r.when === 'study' && !hasClasses) return null;
    if (r.when === 'free' && hasClasses) return null;
    const s = engine.evalExpr(r.startExpr, date);
    if (s.error) return { error: s.error };
    if (!s.val || s.val.t === 'null') return null;
    if (s.val.t === 'text') return { error: 'Начало должно быть временем' };
    const start = s.val.t === 'time' ? ((Math.round(s.val.v) % 1440) + 1440) % 1440 : Math.round(s.val.v);
    let dur = 0;
    if (r.durationExpr?.trim()) {
      const d = engine.evalExpr(r.durationExpr, date);
      if (d.error) return { error: d.error };
      if (d.val && (d.val.t === 'dur' || d.val.t === 'num')) dur = Math.max(0, Math.round(d.val.v));
      else if (d.val && d.val.t === 'time') return { error: 'Длительность не может быть временем' };
    }
    return { start, end: Math.min(1440, start + dur) };
  }

  /** Отбой после полуночи (00:30) показываем в конце дня, а не в начале */
  function isOvernight(r: RoutineRec, startMin: number, date: string) {
    return r.kind === 'sleep' && startMin < wakeSleep(date).wake;
  }

  function dayItems(date: string, opts: { includeHidden?: boolean } = {}): DayItem[] {
    const items: DayItem[] = [];
    for (const c of st.classesByDate.get(date) || []) {
      const m = marks.get(markId('class', c.id, date));
      if (m?.hidden && !opts.includeHidden) continue;
      items.push({
        key: `class:${c.id}`,
        src: 'class',
        srcId: c.id,
        date,
        start: c.start,
        end: c.end,
        title: c.title,
        kind: 'class',
        fixed: true,
        location: shortRooms(c.rooms),
        subtitle: [c.kind, c.notes.join(', ')].filter(Boolean).join(' · '),
        notes: c.teachers.slice(0, 3).join(', '),
        status: m?.status ?? null,
        reward: defaultReward('class', 95),
        startedAt: m?.startedAt ?? null,
        actualMin: m?.actualMin ?? null,
        hidden: !!m?.hidden,
      });
    }
    for (const r of st.routines) {
      const span = routineSpan(r, date);
      if (!span || 'error' in span) continue;
      const m = marks.get(markId('routine', r.id, date));
      if (m?.hidden && !opts.includeHidden) continue;
      const start = m?.start ? m.start : minToTime(span.start);
      const end = m?.end ? m.end : minToTime(span.end);
      const overnight = isOvernight(r, timeToMin(start) ?? span.start, date);
      items.push({
        overnight,
        key: `routine:${r.id}:${date}`,
        src: 'routine',
        srcId: r.id,
        date,
        start,
        end,
        title: r.title,
        kind: r.kind,
        fixed: r.fixed,
        status: m?.status ?? null,
        reward: r.reward ?? defaultReward(r.kind, span.end - span.start),
        startedAt: m?.startedAt ?? null,
        actualMin: m?.actualMin ?? null,
        remindMin: r.remindMin ?? null,
        hidden: !!m?.hidden,
      });
    }
    for (const e of eventsByDate.get(date) || []) {
      items.push({
        key: `event:${e.id}`,
        src: 'event',
        srcId: e.id,
        date,
        start: e.start,
        end: e.end,
        title: e.title,
        kind: isKind(e.kind) ? e.kind : 'other',
        fixed: !!e.fixed || e.source === 'tutor' || e.kind === 'tutor',
        notes: e.notes,
        status: e.status ?? 'planned',
        reward: e.reward ?? defaultReward(e.kind, (timeToMin(e.end) ?? 0) - (timeToMin(e.start) ?? 0)),
        startedAt: e.startedAt ?? null,
        actualMin: e.actualMin ?? null,
        taskId: e.taskId ?? null,
        goalId: e.goalId ?? null,
        remindMin: e.remindMin ?? null,
        source: e.source,
        autoKey: e.autoKey ?? null,
      });
    }
    return items.sort(
      (a, b) => Number(!!a.overnight) - Number(!!b.overnight) || a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || order(a) - order(b),
    );
  }

  function wakeSleep(date: string) {
    const wake = engine.timeOf('подъём', date) ?? engine.timeOf('подъем', date) ?? DEFAULT_WAKE;
    let sleep = engine.timeOf('отбой', date) ?? DEFAULT_SLEEP;
    if (sleep <= wake) sleep = 1440; // отбой после полуночи
    return { wake, sleep };
  }

  /**
   * Каркас дня для планирования: занятые блоки и свободные окна.
   * replaceAi — не учитывать запланированные ИИ дела (их заменят новые).
   * fromMin — для сегодняшнего дня планировать только с текущего времени.
   */
  function skeleton(date: string, opts: { replaceAi?: boolean; fromMin?: number | null } = {}) {
    const { wake, sleep } = wakeSleep(date);
    const all = dayItems(date);
    // час по работе (раз в неделю) ИИ-план не трогает — он для плана как занятое время
    const isReplaceable = (it: DayItem) =>
      !!opts.replaceAi && it.src === 'event' && (it.source === 'ai' || (it.source === 'auto' && !(it.autoKey || '').startsWith('work|'))) &&
      it.status === 'planned' &&
      (opts.fromMin == null || (timeToMin(it.start) ?? 0) >= opts.fromMin);
    const oldAi = all.filter(isReplaceable);
    const busy = all.filter((it) => !isReplaceable(it) && it.status !== 'skipped' && !it.overnight);
    const from = Math.max(wake, opts.fromMin ?? 0);
    const free = freeWindows(from, sleep, busy.map((b) => [timeToMin(b.start) ?? 0, timeToMin(b.end) ?? 0] as Window));
    return { date, wake, sleep, busy, free, oldAi };
  }

  return { engine, ctxFor, visibleClasses, dayItems, skeleton, routineSpan, wakeSleep };
}

export type Planner = ReturnType<typeof createPlanner>;

function order(it: DayItem) {
  return it.src === 'class' ? 0 : it.src === 'routine' ? 1 : 2;
}

export function freeWindows(from: number, to: number, busy: Window[], minLen = 25): Window[] {
  const sorted = busy.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const out: Window[] = [];
  let cur = from;
  for (const [s, e] of sorted) {
    if (e <= cur) continue;
    if (s > cur && s - cur >= minLen) out.push([cur, Math.min(s, to)]);
    cur = Math.max(cur, e);
    if (cur >= to) break;
  }
  if (to - cur >= minLen) out.push([cur, to]);
  return out.filter(([s, e]) => e - s >= minLen && s < to);
}

export interface ValidatedItem extends PlanItemDraft {
  startMin: number;
  endMin: number;
  adjusted?: boolean;
}

/** Проверка плана от ИИ: только в свободные окна, без пересечений, шаг 5 минут */
export function validateDayPlan(items: PlanItemDraft[], free: Window[]) {
  const ok: ValidatedItem[] = [];
  const dropped: { item: PlanItemDraft; reason: string }[] = [];
  const parsed = items
    .map((it) => ({ it, s: timeToMin(it.start), e: timeToMin(it.end) }))
    .sort((a, b) => (a.s ?? 0) - (b.s ?? 0));
  let lastEnd = -1;
  for (const { it, s, e } of parsed) {
    if (s == null || e == null) {
      dropped.push({ item: it, reason: 'неверное время' });
      continue;
    }
    if (e <= s) {
      dropped.push({ item: it, reason: 'конец раньше начала' });
      continue;
    }
    let best: Window | null = null;
    let bestOverlap = 0;
    for (const w of free) {
      const ov = Math.min(e, w[1]) - Math.max(s, w[0]);
      if (ov > bestOverlap) {
        bestOverlap = ov;
        best = w;
      }
    }
    if (!best) {
      dropped.push({ item: it, reason: 'пересекается с занятым временем' });
      continue;
    }
    let ns = Math.max(s, best[0], lastEnd);
    let ne = Math.min(e, best[1]);
    ns = Math.ceil(ns / 5) * 5;
    ne = Math.floor(ne / 5) * 5;
    if (ne - ns < 10) {
      dropped.push({ item: it, reason: 'не помещается в свободное окно' });
      continue;
    }
    const adjusted = ns !== s || ne !== e;
    ok.push({ ...it, start: minToTime(ns), end: minToTime(ne), startMin: ns, endMin: ne, adjusted });
    lastEnd = ne;
  }
  return { ok, dropped };
}

export function fmtWindow([s, e]: Window) {
  return `${minToTime(s)}–${minToTime(e)}`;
}

export function totalFree(free: Window[]) {
  return free.reduce((a, [s, e]) => a + (e - s), 0);
}
