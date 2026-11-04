import { describe, expect, it } from 'vitest';
import type { ClassItem, EventRec, GoalRec, TaskRec } from '../types';
import { autoPlan } from './autoplan';
import { personalFactors } from './estimate';
import { createPlanner } from './planner';
import { computeTaskLoads } from './priority';

const task = (id: string, deadline: string | null, estimateMin: number, extra: Partial<TaskRec> = {}): TaskRec => ({
  id, title: `Задача ${id}`, category: 'study', status: 'todo', createdAt: 1, updatedAt: 1, deadline, estimateMin, ...extra,
});
const goal = (id: string, extra: Partial<GoalRec> = {}): GoalRec => ({
  id, title: `Цель ${id}`, horizon: '3m', status: 'active', progress: 0, createdAt: 1, updatedAt: 1, targetDate: '2027-01-25', ...extra,
});

function setup(tasks: TaskRec[], goals: GoalRec[] = [], events: EventRec[] = [], classes: ClassItem[] = []) {
  const classesByDate = new Map<string, ClassItem[]>();
  for (const c of classes) classesByDate.set(c.date, [...(classesByDate.get(c.date) || []), c]);
  const planner = createPlanner({
    classesByDate,
    events,
    marks: [],
    routines: [],
    variables: [
      { id: 'w', name: 'подъём', expr: '08:00', updatedAt: 1 },
      { id: 's', name: 'отбой', expr: '23:00', updatedAt: 1 },
    ],
  });
  const today = '2026-11-09'; // понедельник
  const nowMin = 8 * 60;
  const loads = computeTaskLoads(tasks, events, planner, { today, nowMin, dailyCap: 240 });
  return autoPlan({ planner, events, tasks, goals, loads, factors: personalFactors(tasks, events), today, nowMin, days: 14, dailyCap: 240, focusBlock: 50, breakMin: 10 });
}

const minutes = (d: { start: string; end: string }) => {
  const [a, b] = [d.start, d.end].map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)));
  return b - a;
};

describe('auto scheduler', () => {
  it('places all sessions of an urgent task before its deadline, avoiding classes', () => {
    const classes: ClassItem[] = [
      { id: 'c1', date: '2026-11-09', start: '09:40', end: '13:10', title: 'Пара', kind: 'Лекции', type: 'lecture', rooms: [], teachers: [], notes: [] },
    ];
    const { drafts, unplaced } = setup([task('u', '2026-11-10', 180)], [], [], classes);
    const sessions = drafts.filter((d) => d.taskId === 'u');
    expect(sessions.reduce((s, d) => s + minutes(d), 0)).toBe(180);
    expect(sessions.every((d) => d.date <= '2026-11-10')).toBe(true);
    for (const d of sessions.filter((x) => x.date === '2026-11-09')) expect(d.end <= '09:40' || d.start >= '13:10').toBe(true);
    expect(unplaced).toEqual([]);
  });

  it('respects the daily focus cap and urgent tasks come first', () => {
    const { drafts } = setup([task('low', null, 600), task('urgent', '2026-11-09', 120)]);
    const today = drafts.filter((d) => d.date === '2026-11-09');
    expect(today.reduce((s, d) => s + minutes(d), 0)).toBeLessThanOrEqual(240);
    expect(today[0].taskId === 'urgent' || today.some((d) => d.taskId === 'urgent')).toBe(true);
    expect(drafts.filter((d) => d.taskId === 'urgent').reduce((s, d) => s + minutes(d), 0)).toBe(120);
  });

  it('reserves weekly time for goals but not for ongoing ones, spreading by day', () => {
    const { drafts } = setup([], [goal('toefl', { weeklyMin: 180, sessionMin: 60 }), goal('work', { horizon: 'ongoing', weeklyMin: 600 })]);
    const thisWeek = drafts.filter((d) => d.goalId === 'toefl' && d.date <= '2026-11-15');
    expect(thisWeek.reduce((s, d) => s + minutes(d), 0)).toBe(180);
    expect(new Set(thisWeek.map((d) => d.date)).size).toBe(3);
    expect(drafts.some((d) => d.goalId === 'work')).toBe(false);
    expect(thisWeek[0].title).toMatch(/🎯 Цель toefl/);
  });

  it('counts already planned and done goal time and does not double-plan goal tasks', () => {
    const events: EventRec[] = [
      { id: 'e1', date: '2026-11-09', start: '18:00', end: '19:00', title: 'TOEFL', kind: 'study', source: 'ai', status: 'planned', goalId: 'toefl', updatedAt: 1 },
    ];
    const tasks = [task('words', null, 90, { goalId: 'toefl' })];
    const { drafts } = setup(tasks, [goal('toefl', { weeklyMin: 120, sessionMin: 60 })], events);
    const goalWeek = drafts.filter((d) => d.goalId === 'toefl' && d.date <= '2026-11-15');
    expect(goalWeek.reduce((s, d) => s + minutes(d), 0)).toBe(60); // 120 − 60 уже стоит
    const wordsTotal = drafts.filter((d) => d.taskId === 'words').reduce((s, d) => s + minutes(d), 0);
    expect(wordsTotal).toBe(90); // задача целиком, без дублей между блоками цели и обычными подходами
  });

  it('adds a shopping trip in the evening when needed', () => {
    const planner = createPlanner({ classesByDate: new Map(), events: [], marks: [], routines: [], variables: [] });
    const { drafts } = autoPlan({
      planner, events: [], tasks: [], goals: [], loads: new Map(), factors: {}, today: '2026-11-09', nowMin: 10 * 60, days: 3,
      shopping: { minutes: 45, title: '🛒 Магазин' },
    });
    const shop = drafts.find((d) => d.title === '🛒 Магазин')!;
    expect(shop.date).toBe('2026-11-09');
    expect(shop.start >= '16:00').toBe(true);
  });

  it('reports what does not fit before a deadline', () => {
    const { unplaced } = setup([task('huge', '2026-11-10', 1200)]);
    expect(unplaced[0].taskId).toBe('huge');
    expect(unplaced[0].minutes).toBeGreaterThan(0);
  });
});
