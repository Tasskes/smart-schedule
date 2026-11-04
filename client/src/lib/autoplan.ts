import type { EventRec, GoalRec, Kind, TaskRec } from '../types';
import { addDays, minToTime, roundUp5, timeToMin, weekStart } from './dates';
import { defaultReward } from './game';
import type { personalFactors } from './estimate';
import { weeklyMinutes } from './goalbudget';
import { CATEGORIES } from './meta';
import type { Planner, Window } from './planner';
import type { TaskLoad } from './priority';

/**
 * Автоматическое расписание (без нейросети, работает и офлайн).
 * Порядок: срочные задачи → поход в магазин (если нужен) → время на цели → остальные задачи по приоритету и сроку.
 * Ставит «подходы» в свободные окна, с перерывами и не больше дневного лимита сосредоточенной работы.
 */

export interface AutoDraft {
  key: string;
  date: string;
  start: string;
  end: string;
  title: string;
  kind: Kind;
  taskId?: string | null;
  goalId?: string | null;
  reward: number;
}

export interface AutoPlanInput {
  planner: Planner; // собран из событий БЕЗ авто-событий
  events: EventRec[]; // события без авто
  tasks: TaskRec[];
  goals: GoalRec[];
  loads: Map<string, TaskLoad>;
  factors: ReturnType<typeof personalFactors>;
  today: string;
  nowMin: number;
  days?: number;
  dailyCap?: number;
  focusBlock?: number;
  breakMin?: number;
  shopping?: { minutes: number; title: string } | null;
}

export interface AutoPlanResult {
  drafts: AutoDraft[];
  unplaced: { taskId: string; minutes: number }[];
}

const FOCUS_KINDS = new Set<Kind>(['study', 'work', 'task']);
const evMin = (e: Pick<EventRec, 'start' | 'end'>) => Math.max(0, (timeToMin(e.end) ?? 0) - (timeToMin(e.start) ?? 0));

export function autoPlan(input: AutoPlanInput): AutoPlanResult {
  const { planner, events, tasks, goals, loads, factors, today, nowMin } = input;
  const days = input.days ?? 14;
  const dailyCap = input.dailyCap ?? 240;
  const block = Math.max(20, input.focusBlock ?? 50);
  const breakMin = input.breakMin ?? 10;
  const drafts: AutoDraft[] = [];
  const unplaced: AutoPlanResult['unplaced'] = [];
  const dates = Array.from({ length: days }, (_, i) => addDays(today, i));
  const fromToday = roundUp5(nowMin + 15);

  // свободные окна и уже занятый «фокус» по дням
  const windows = new Map<string, Window[]>();
  const focusUsed = new Map<string, number>();
  const perDayCount = new Map<string, number>(); // сколько подходов к одной задаче/цели в день
  for (const d of dates) {
    const sk = planner.skeleton(d, { fromMin: d === today ? fromToday : null });
    const lateEdge = Math.max(sk.wake, sk.sleep - 45); // за 45 мин до отбоя тяжёлое не ставим
    windows.set(
      d,
      sk.free.map(([a, b]) => [a, Math.min(b, lateEdge)] as Window).filter(([a, b]) => b - a >= 20),
    );
    focusUsed.set(
      d,
      events
        .filter((e) => e.date === d && e.status !== 'skipped' && FOCUS_KINDS.has(e.kind) && (d !== today || (timeToMin(e.start) ?? 0) >= nowMin))
        .reduce((s, e) => s + evMin(e), 0),
    );
  }

  const take = (date: string, minutes: number, opts: { focus: boolean; after?: number } = { focus: true }): [number, number] | null => {
    if (opts.focus && (focusUsed.get(date) ?? 0) + minutes > dailyCap) return null;
    const ws = windows.get(date) || [];
    for (let i = 0; i < ws.length; i += 1) {
      const [a, b] = ws[i];
      const s = Math.max(a, opts.after ?? 0);
      if (b - s < minutes) continue;
      const e = s + minutes;
      const rest: Window[] = [];
      if (s - a >= 20) rest.push([a, s]);
      if (b - (e + breakMin) >= 20) rest.push([e + breakMin, b]);
      ws.splice(i, 1, ...rest);
      if (opts.focus) focusUsed.set(date, (focusUsed.get(date) ?? 0) + minutes);
      return [s, e];
    }
    return null;
  };

  const plannedFor = (pred: (e: EventRec) => boolean, from: string, to: string, includeDone = false) =>
    events
      .filter((e) => e.date >= from && e.date <= to && pred(e) && (e.status === 'planned' || (includeDone && e.status === 'done')))
      .filter((e) => includeDone || e.date > today || (timeToMin(e.start) ?? 0) >= nowMin)
      .reduce((s, e) => s + evMin(e), 0);

  const taskKind = (t: TaskRec): Kind => CATEGORIES[t.category]?.kind || 'task';
  const draftTaskMin = new Map<string, number>(); // сколько минут задачи уже поставили в этом проходе
  const addDraftTask = (taskId: string | null | undefined, min: number) => {
    if (taskId) draftTaskMin.set(taskId, (draftTaskMin.get(taskId) ?? 0) + min);
  };

  const taskLeft = (t: TaskRec) =>
    (loads.get(t.id)?.remainingMin ?? 60) - plannedFor((e) => e.taskId === t.id, today, addDays(today, 365)) - (draftTaskMin.get(t.id) ?? 0);

  const placeTask = (t: TaskRec, maxPerDay: number) => {
    const load = loads.get(t.id);
    let need = taskLeft(t);
    if (need < 15) return;
    const lastDay = t.deadline && t.deadline < addDays(today, days - 1) ? t.deadline : addDays(today, days - 1);
    const total = load?.remainingMin || 60;
    for (const d of dates) {
      if (d > lastDay || need < 15) break;
      let count = perDayCount.get(`${t.id}|${d}`) ?? 0;
      while (need >= 15 && count < maxPerDay) {
        let len = Math.min(block, need);
        if (need - len < 15) len = Math.min(need, block + 15);
        const slot = take(d, len);
        if (!slot) break;
        need -= len;
        count += 1;
        perDayCount.set(`${t.id}|${d}`, count);
        addDraftTask(t.id, len);
        drafts.push({
          key: `task|${t.id}|${d}|${slot[0]}`,
          date: d,
          start: minToTime(slot[0]),
          end: minToTime(slot[1]),
          title: t.title,
          kind: taskKind(t),
          taskId: t.id,
          goalId: t.goalId ?? null,
          reward: t.reward ? Math.max(1, Math.round((t.reward * len) / total)) : defaultReward(taskKind(t), len),
        });
      }
    }
    if (need >= 15 && t.deadline) unplaced.push({ taskId: t.id, minutes: Math.round(need) });
  };

  const open = tasks.filter((t) => t.status === 'todo');
  const prio = (t: TaskRec) => loads.get(t.id)?.priority ?? t.priority ?? 2;
  const ordered = [...open].sort(
    (a, b) => prio(a) - prio(b) || (a.deadline || '9999-12-31').localeCompare(b.deadline || '9999-12-31') || a.createdAt - b.createdAt,
  );

  // 1. Срочные задачи
  for (const t of ordered.filter((x) => prio(x) === 1)) placeTask(t, 4);

  // 2. Поход в магазин — сегодня вечером или завтра
  if (input.shopping) {
    for (const d of dates.slice(0, 3)) {
      const slot = take(d, input.shopping.minutes, { focus: false, after: 16 * 60 }) || take(d, input.shopping.minutes, { focus: false });
      if (slot) {
        drafts.push({ key: `shop|${d}|${slot[0]}`, date: d, start: minToTime(slot[0]), end: minToTime(slot[1]), title: input.shopping.title, kind: 'other', reward: 3 });
        break;
      }
    }
  }

  // 3. Время на цели (кроме постоянных): недельная норма минус то, что уже сделано/стоит в плане
  const weeks = [...new Set(dates.map((d) => weekStart(d)))];
  for (const g of goals.filter((x) => x.status === 'active' && x.horizon !== 'ongoing')) {
    const weekly = weeklyMinutes(g, tasks, events, factors, today);
    if (weekly < 15) continue;
    const session = Math.max(25, Math.min(120, g.sessionMin || block));
    const goalTaskIds = new Set(tasks.filter((t) => t.goalId === g.id).map((t) => t.id));
    const goalTasks = ordered.filter((t) => t.goalId === g.id);
    // в блоке цели работаем над её задачей, пока у той остаётся работа; потом — просто «время на цель»
    const pickTask = () => {
      for (const t of goalTasks) {
        const left = taskLeft(t);
        if (left >= 25) return { t, left };
      }
      return null;
    };
    for (const ws of weeks) {
      const we = addDays(ws, 6);
      const weekDates = dates.filter((d) => d >= ws && d <= we);
      if (!weekDates.length) continue;
      // в текущей неделе — пропорционально оставшимся дням
      const share = ws === weekStart(today) ? Math.min(1, weekDates.length / 7) : 1;
      const done = plannedFor((e) => e.goalId === g.id || (!!e.taskId && goalTaskIds.has(e.taskId)), ws, we, true);
      const draftsThisWeek = drafts.filter((x) => x.date >= ws && x.date <= we && x.goalId === g.id).reduce((s, x) => s + ((timeToMin(x.end) ?? 0) - (timeToMin(x.start) ?? 0)), 0);
      let need = Math.round(weekly * share) - done - draftsThisWeek;
      // раскладываем по одному подходу в день, начиная с наименее загруженных дней
      const byLoad = [...weekDates].sort((a, b) => (focusUsed.get(a) ?? 0) - (focusUsed.get(b) ?? 0) || a.localeCompare(b));
      for (const d of byLoad) {
        if (need < 15) break;
        const cand = pickTask();
        const len = Math.max(25, Math.min(session, need, cand ? cand.left : Infinity));
        const slot = take(d, len);
        if (!slot) continue;
        need -= len;
        addDraftTask(cand?.t.id, len);
        drafts.push({
          key: `goal|${g.id}|${d}|${slot[0]}`,
          date: d,
          start: minToTime(slot[0]),
          end: minToTime(slot[1]),
          title: `🎯 ${g.title}${cand ? `: ${cand.t.title}` : ''}`,
          kind: 'study',
          goalId: g.id,
          taskId: cand?.t.id ?? null,
          reward: defaultReward('study', len),
        });
      }
    }
  }

  // 4. Остальные задачи
  for (const t of ordered.filter((x) => prio(x) !== 1)) placeTask(t, 2);

  drafts.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  return { drafts, unplaced };
}
