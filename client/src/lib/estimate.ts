import type { Category, EventRec, TaskRec } from '../types';
import { timeToMin } from './dates';

const dur = (e: EventRec) => Math.max(0, (timeToMin(e.end) ?? 0) - (timeToMin(e.start) ?? 0));

/** Сколько минут реально потрачено на задачу (по отмеченным делам или вручную) */
export function taskSpent(task: TaskRec, events: EventRec[]) {
  if (task.actualMin != null) return task.actualMin;
  return events
    .filter((e) => e.taskId === task.id && e.status === 'done')
    .reduce((s, e) => s + (e.actualMin ?? dur(e)), 0);
}

/** Сколько минут задачи уже стоит в плане на будущее */
export function taskScheduled(task: TaskRec, events: EventRec[], today: string, nowMin: number) {
  return events
    .filter((e) => e.taskId === task.id && e.status === 'planned' && (e.date > today || (e.date === today && (timeToMin(e.start) ?? 0) >= nowMin)))
    .reduce((s, e) => s + dur(e), 0);
}

export interface Factor {
  factor: number;
  n: number;
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Персональный коэффициент: во сколько раз реальное время отличается от оценки ИИ.
 * Считается по последним выполненным задачам категории (нужно хотя бы 3).
 */
export function personalFactors(tasks: TaskRec[], events: EventRec[]) {
  const samples: { cat: Category; ratio: number; at: number }[] = [];
  for (const t of tasks) {
    if (t.status !== 'done' || !t.estimateMin) continue;
    const spent = taskSpent(t, events);
    if (spent < 5) continue;
    samples.push({ cat: t.category, ratio: spent / t.estimateMin, at: t.doneAt || t.updatedAt });
  }
  samples.sort((a, b) => b.at - a.at);
  const clamp = (x: number) => Math.min(3, Math.max(0.5, x));
  const result: Partial<Record<Category | 'all', Factor>> = {};
  const all = samples.slice(0, 30).map((s) => s.ratio);
  if (all.length >= 3) result.all = { factor: clamp(median(all)), n: all.length };
  const byCat = new Map<Category, number[]>();
  for (const s of samples) {
    const list = byCat.get(s.cat) || [];
    if (list.length < 15) list.push(s.ratio);
    byCat.set(s.cat, list);
  }
  for (const [cat, list] of byCat) if (list.length >= 3) result[cat] = { factor: clamp(median(list)), n: list.length };
  return result;
}

export function factorFor(cat: Category, factors: ReturnType<typeof personalFactors>) {
  return factors[cat]?.factor ?? factors.all?.factor ?? 1;
}

export function adjustedEstimate(task: TaskRec, factors: ReturnType<typeof personalFactors>) {
  if (!task.estimateMin) return null;
  return Math.max(5, Math.round((task.estimateMin * factorFor(task.category, factors)) / 5) * 5);
}
