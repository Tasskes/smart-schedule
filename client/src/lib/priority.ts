import type { EventRec, TaskRec } from '../types';
import { addDays, daysBetween, timeToMin } from './dates';
import { adjustedEstimate, personalFactors, taskSpent } from './estimate';
import type { Planner } from './planner';

/**
 * Приоритет задачи по сроку и загруженности.
 *
 * Идём по задачам в порядке дедлайнов (EDF) и копим, сколько работы надо успеть к каждому сроку.
 * Сравниваем с тем, сколько свободного времени есть до этого срока (не больше дневного лимита фокуса).
 * Чем больше доля «нужно / есть», тем выше приоритет. Просроченные и «на завтра» — всегда высокий.
 */

export interface TaskLoad {
  taskId: string;
  priority: 1 | 2 | 3;
  remainingMin: number;
  availableMin: number | null;
  ratio: number | null;
  daysLeft: number | null;
  reason: string;
  manual: boolean;
}

export const DEFAULT_TASK_MIN = 60;

const eventMin = (e: EventRec) => Math.max(0, (timeToMin(e.end) ?? 0) - (timeToMin(e.start) ?? 0));

export function remainingMinutes(task: TaskRec, events: EventRec[], factors: ReturnType<typeof personalFactors>) {
  const est = adjustedEstimate(task, factors) ?? DEFAULT_TASK_MIN;
  return Math.max(0, est - taskSpent(task, events));
}

/** Сколько минут можно отдать задачам в день: свободные окна + уже стоящие в плане подходы к задачам, но не больше лимита */
export function dayCapacity(planner: Planner, events: EventRec[], date: string, fromMin: number | null, dailyCap: number) {
  const sk = planner.skeleton(date, { fromMin });
  const free = sk.free.reduce((s, [a, b]) => s + (b - a), 0);
  const taskPlanned = events
    .filter((e) => e.date === date && e.status === 'planned' && e.taskId && (fromMin == null || (timeToMin(e.start) ?? 0) >= fromMin))
    .reduce((s, e) => s + eventMin(e), 0);
  return Math.min(dailyCap, free + taskPlanned);
}

const fmtH = (min: number) => (min >= 60 ? `${Math.round((min / 60) * 10) / 10} ч` : `${Math.round(min)} мин`);

export function computeTaskLoads(
  tasks: TaskRec[],
  events: EventRec[],
  planner: Planner,
  opts: { today: string; nowMin: number; dailyCap: number; horizonDays?: number },
): Map<string, TaskLoad> {
  const { today, nowMin, dailyCap } = opts;
  const factors = personalFactors(tasks, events);
  const open = tasks.filter((t) => t.status === 'todo');
  const result = new Map<string, TaskLoad>();

  // свободное время по дням (кэш), с накоплением
  const capCache = new Map<string, number>();
  const capacity = (date: string) => {
    let c = capCache.get(date);
    if (c == null) {
      c = dayCapacity(planner, events, date, date === today ? nowMin : null, dailyCap);
      capCache.set(date, c);
    }
    return c;
  };
  const availableUntil = (deadline: string) => {
    const days = Math.min(Math.max(0, daysBetween(today, deadline)), opts.horizonDays ?? 60);
    let sum = 0;
    for (let i = 0; i <= days; i += 1) sum += capacity(addDays(today, i));
    return sum;
  };

  const withDeadline = open.filter((t) => t.deadline).sort((a, b) => (a.deadline! < b.deadline! ? -1 : a.deadline! > b.deadline! ? 1 : a.createdAt - b.createdAt));
  let cumulative = 0;
  for (const t of withDeadline) {
    const remaining = remainingMinutes(t, events, factors);
    cumulative += remaining;
    const daysLeft = daysBetween(today, t.deadline!);
    const available = daysLeft < 0 ? 0 : availableUntil(t.deadline!);
    const ratio = available > 0 ? cumulative / available : cumulative > 0 ? Infinity : 0;
    let priority: 1 | 2 | 3;
    let reason: string;
    if (daysLeft < 0) {
      priority = 1;
      reason = 'срок прошёл';
    } else if (daysLeft <= 1) {
      priority = 1;
      reason = daysLeft === 0 ? 'срок сегодня' : 'срок завтра';
    } else if (ratio >= 0.7) {
      priority = 1;
      reason = `мало времени: нужно ${fmtH(cumulative)} из ${fmtH(available)} свободных`;
    } else if (ratio >= 0.35 || daysLeft <= 3) {
      priority = 2;
      reason = daysLeft <= 3 ? `срок через ${daysLeft} дн.` : `занято ${Math.round(ratio * 100)}% свободного времени до срока`;
    } else {
      priority = 3;
      reason = 'времени хватает';
    }
    result.set(t.id, { taskId: t.id, priority, remainingMin: remaining, availableMin: available, ratio: Number.isFinite(ratio) ? ratio : null, daysLeft, reason, manual: false });
  }
  for (const t of open.filter((x) => !x.deadline)) {
    result.set(t.id, {
      taskId: t.id,
      priority: 3,
      remainingMin: remainingMinutes(t, events, factors),
      availableMin: null,
      ratio: null,
      daysLeft: null,
      reason: 'без срока',
      manual: false,
    });
  }
  // ручной приоритет важнее расчётного
  for (const t of open) {
    if (!t.priorityManual || !t.priority) continue;
    const load = result.get(t.id);
    if (load) result.set(t.id, { ...load, priority: t.priority, manual: true, reason: 'выставлен вручную' });
  }
  return result;
}

export const PRIORITY_LABEL: Record<1 | 2 | 3, string> = { 1: 'Высокий', 2: 'Обычный', 3: 'Низкий' };
