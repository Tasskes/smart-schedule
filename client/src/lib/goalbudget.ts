import type { EventRec, GoalRec, Horizon, TaskRec } from '../types';
import { daysBetween } from './dates';
import type { personalFactors } from './estimate';
import { remainingMinutes } from './priority';

/**
 * Сколько времени в неделю уделять цели. Основной расчёт делает нейросеть (по прогрессу, сложности,
 * задачам и загруженности), а это — запасной вариант без интернета: оставшийся объём / недели до срока.
 */

const BASE_EFFORT_H: Record<Horizon, number> = { ongoing: 0, '1w': 3, '1m': 10, '3m': 25, '6m': 45, '1y': 90, '5y': 300 };
const DEFAULT_WEEKS: Record<Horizon, number> = { ongoing: 0, '1w': 1, '1m': 4, '3m': 13, '6m': 26, '1y': 52, '5y': 260 };

const round5 = (n: number) => Math.round(n / 5) * 5;

export function isOngoing(g: Pick<GoalRec, 'horizon'>) {
  return g.horizon === 'ongoing';
}

export function fallbackBudget(goal: GoalRec, tasks: TaskRec[], events: EventRec[], factors: ReturnType<typeof personalFactors>, today: string) {
  if (isOngoing(goal) || goal.status !== 'active') return null;
  const linked = tasks.filter((t) => t.goalId === goal.id && t.status === 'todo');
  const tasksMin = linked.reduce((s, t) => s + remainingMinutes(t, events, factors), 0);
  const base = BASE_EFFORT_H[goal.horizon] * 60 * (1 - Math.min(100, Math.max(0, goal.progress || 0)) / 100);
  const effortMin = Math.max(tasksMin, base);
  const weeks = goal.targetDate ? Math.max(1, daysBetween(today, goal.targetDate) / 7) : DEFAULT_WEEKS[goal.horizon] || 4;
  const weeklyMin = Math.min(8 * 60, Math.max(30, round5(effortMin / weeks)));
  return { effortMin: Math.round(effortMin), weeklyMin, sessionMin: weeklyMin >= 180 ? 60 : 45 };
}

/** Итоговое время в неделю: ручное → посчитанное нейросетью → запасной расчёт */
export function weeklyMinutes(goal: GoalRec, tasks: TaskRec[], events: EventRec[], factors: ReturnType<typeof personalFactors>, today: string) {
  if (isOngoing(goal) || goal.status !== 'active') return 0;
  if (goal.weeklyMin != null && goal.weeklyMin >= 0) return goal.weeklyMin;
  return fallbackBudget(goal, tasks, events, factors, today)?.weeklyMin ?? 0;
}

export function fmtWeekly(min: number) {
  if (!min) return '—';
  if (min < 60) return `${min} мин/нед`;
  const h = Math.round((min / 60) * 10) / 10;
  return `${String(h).replace('.', ',')} ч/нед`;
}
