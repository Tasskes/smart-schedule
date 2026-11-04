import { describe, expect, it } from 'vitest';
import type { ClassItem, EventRec, GoalRec, TaskRec } from '../types';
import { autoPlan, isWorkTask, workWeekState, WORK_SESSION_MIN } from './autoplan';
import { personalFactors } from './estimate';
import { createPlanner } from './planner';
import { computeTaskLoads } from './priority';

const task = (id: string, deadline: string | null, estimateMin: number, extra: Partial<TaskRec> = {}): TaskRec => ({
  id, title: `Задача ${id}`, category: 'study', status: 'todo', createdAt: 1, updatedAt: 1, deadline, estimateMin, ...extra,
});
const goal = (id: string, extra: Partial<GoalRec> = {}): GoalRec => ({
  id, title: `Цель ${id}`, horizon: '3m', status: 'active', progress: 0, createdAt: 1, updatedAt: 1, targetDate: '2027-01-25', ...extra,
});

function setup(tasks: TaskRec[], goals: GoalRec[] = [], events: EventRec[] = [], classes: ClassItem[] = [], at: { today?: string; nowMin?: number } = {}) {
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
  const today = at.today ?? '2026-11-09'; // понедельник
  const nowMin = at.nowMin ?? 8 * 60;
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

describe('work tasks: one hour a week', () => {
  const work = (id: string, extra: Partial<TaskRec> = {}) => task(id, null, 600, { category: 'work', title: `Заказ ${id}`, ...extra });
  const ongoingWork = goal('job', { title: 'Работа', horizon: 'ongoing' });
  const ev = (id: string, date: string, start: string, end: string, extra: Partial<EventRec> = {}): EventRec => ({
    id, date, start, end, title: 'Заказ', kind: 'work', source: 'auto', status: 'planned', updatedAt: 1, ...extra,
  });
  const forTask = (drafts: ReturnType<typeof setup>['drafts'], id: string, from: string, to: string) =>
    drafts.filter((d) => d.taskId === id && d.date >= from && d.date <= to);

  it('detects work tasks by category or by the ongoing «Работа» goal', () => {
    const goals = new Map([['job', ongoingWork], ['toefl', goal('toefl')]]);
    expect(isWorkTask({ category: 'work', goalId: null }, goals)).toBe(true);
    expect(isWorkTask({ category: 'study', goalId: 'job' }, goals)).toBe(true);
    expect(isWorkTask({ category: 'study', goalId: 'toefl' }, goals)).toBe(false);
  });

  it('gives every work task exactly one 60-minute hour per week, on different days', () => {
    const tasks = [work('a'), work('b'), task('c', null, 300, { goalId: 'job' })];
    const { drafts } = setup(tasks, [ongoingWork]);
    for (const id of ['a', 'b', 'c']) {
      for (const [from, to] of [['2026-11-09', '2026-11-15'], ['2026-11-16', '2026-11-22']]) {
        const week = forTask(drafts, id, from, to);
        expect(week).toHaveLength(1);
        expect(minutes(week[0])).toBe(WORK_SESSION_MIN);
        expect(week[0].kind).toBe('work');
        expect(week[0].key).toBe(`work|${id}|${from}`);
      }
      expect(drafts.filter((d) => d.taskId === id)).toHaveLength(2); // никаких подходов «по оценке»
    }
    const days = ['a', 'b', 'c'].map((id) => forTask(drafts, id, '2026-11-09', '2026-11-15')[0].date);
    expect(new Set(days).size).toBe(3);
    // ставим пораньше, чтобы при пропуске было куда перенести
    expect([...days].sort()).toEqual(['2026-11-09', '2026-11-10', '2026-11-11']);
  });

  it('a done hour closes the week; the next week still gets its hour', () => {
    const events = [ev('e1', '2026-11-09', '10:00', '11:00', { taskId: 'a', status: 'done' })];
    const { drafts } = setup([work('a')], [], events, [], { nowMin: 12 * 60 });
    expect(forTask(drafts, 'a', '2026-11-09', '2026-11-15')).toHaveLength(0);
    expect(forTask(drafts, 'a', '2026-11-16', '2026-11-22')).toHaveLength(1);
  });

  it('a missed hour moves to another day of the same week', () => {
    // вторник прошёл, час не отмечен (runAutoPlan пометил его пропущенным); сегодня среда
    const events = [ev('e1', '2026-11-10', '18:00', '19:00', { taskId: 'a', status: 'skipped', autoKey: 'work|a|2026-11-09' })];
    const { drafts } = setup([work('a')], [], events, [], { today: '2026-11-11' });
    const week = forTask(drafts, 'a', '2026-11-09', '2026-11-15');
    expect(week).toHaveLength(1);
    expect(week[0].date >= '2026-11-11').toBe(true);
    // своё (не авто) дело в прошлом, так и не сделанное, тоже переносится
    const own = [ev('m1', '2026-11-10', '18:00', '19:00', { taskId: 'a', source: 'manual' })];
    expect(forTask(setup([work('a')], [], own, [], { today: '2026-11-11' }).drafts, 'a', '2026-11-09', '2026-11-15')).toHaveLength(1);
  });

  it('skipped today → goes to another day, not later today', () => {
    const events = [ev('e1', '2026-11-11', '09:00', '10:00', { taskId: 'a', status: 'skipped' })];
    const { drafts } = setup([work('a')], [], events, [], { today: '2026-11-11', nowMin: 9 * 60 });
    const week = forTask(drafts, 'a', '2026-11-09', '2026-11-15');
    expect(week).toHaveLength(1);
    expect(week[0].date > '2026-11-11').toBe(true);
  });

  it('an hour still ahead today is kept as this week’s hour', () => {
    const events = [ev('e1', '2026-11-09', '09:00', '10:00', { taskId: 'a' })];
    const { drafts } = setup([work('a')], [], events, [], { nowMin: 12 * 60 }); // время прошло, но день ещё не кончился
    expect(forTask(drafts, 'a', '2026-11-09', '2026-11-15')).toHaveLength(0);
  });

  it('due this week → the hour is before the deadline, and no hour is planned for the next week', () => {
    const { drafts, unplaced } = setup([work('a', { deadline: '2026-11-10', estimateMin: 300 })]);
    const all = drafts.filter((d) => d.taskId === 'a');
    expect(all).toHaveLength(1);
    expect(all[0].date <= '2026-11-10').toBe(true);
    expect(unplaced.filter((u) => u.taskId === 'a')).toEqual([]); // оценка больше часа — не повод для «не помещается»
  });

  it('reports a work task when there is no free hour left this week', () => {
    const events = ['2026-11-13', '2026-11-14', '2026-11-15'].map((d, i) => ev(`busy${i}`, d, '08:00', '23:00', { source: 'manual', kind: 'other', title: 'Занято' }));
    const { unplaced } = setup([work('a')], [], events, [], { today: '2026-11-13' });
    expect(unplaced).toEqual([{ taskId: 'a', minutes: 60, reason: 'week' }]);
  });

  it('week state: done, planned ahead, missed', () => {
    const events = [
      ev('d', '2026-11-09', '10:00', '11:00', { taskId: 'a', status: 'done' }),
      ev('p', '2026-11-12', '10:00', '11:00', { taskId: 'b' }),
      ev('m', '2026-11-10', '10:00', '11:00', { taskId: 'c' }),
    ];
    expect(workWeekState('a', events, '2026-11-09', '2026-11-11').done).toBe(true);
    expect(workWeekState('b', events, '2026-11-09', '2026-11-11').planned?.id).toBe('p');
    expect(workWeekState('c', events, '2026-11-09', '2026-11-11').missed.map((e) => e.id)).toEqual(['m']);
  });
});
