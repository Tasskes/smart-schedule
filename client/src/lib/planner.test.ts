import { describe, expect, it } from 'vitest';
import type { ClassItem, EventRec, RoutineRec, VariableRec } from '../types';
import { createPlanner, freeWindows, validateDayPlan } from './planner';

const cls = (date: string, start: string, end: string, title: string): ClassItem => ({
  id: `${date}-${start}`, date, start, end, title, kind: 'Лекции', type: 'lecture', rooms: ['5-406'], teachers: [], notes: [],
});

const v = (name: string, expr: string): VariableRec => ({ id: name, name, expr, updatedAt: 1 });

const routine = (id: string, title: string, startExpr: string, durationExpr: string, when: RoutineRec['when'] = 'always'): RoutineRec => ({
  id, title, kind: 'routine', days: [1, 2, 3, 4, 5, 6, 7], when, startExpr, durationExpr, fixed: true, enabled: true, updatedAt: 1,
});

function planner(events: EventRec[] = []) {
  const classesByDate = new Map<string, ClassItem[]>([
    ['2026-11-03', [cls('2026-11-03', '07:45', '09:20', 'Экономика'), cls('2026-11-03', '09:40', '11:15', 'Право')]],
  ]);
  return createPlanner({
    classesByDate,
    events,
    marks: [],
    semesterStart: '2026-08-31',
    variables: [
      v('дорога_до_вуза', '40 мин'),
      v('сборы', '45 мин'),
      v('обычный_подъём', '08:00'),
      v('подъём', 'min({обычный_подъём}, {первая_пара} - {дорога_до_вуза} - {сборы})'),
      v('сон', '8ч'),
      v('отбой', '{завтра:подъём} - {сон}'),
    ],
    routines: [
      routine('wake', 'Подъём и сборы', '{подъём}', '{сборы}'),
      routine('road', 'Дорога до вуза', '{первая_пара} - {дорога_до_вуза}', '{дорога_до_вуза}', 'study'),
      routine('home', 'Дорога домой', '{конец_пар}', '{дорога_до_вуза}', 'study'),
    ],
  });
}

describe('planner', () => {
  it('builds a study day from classes and routines', () => {
    const p = planner();
    const items = p.dayItems('2026-11-03');
    expect(items.map((i) => `${i.start} ${i.title}`)).toEqual([
      '06:20 Подъём и сборы',
      '07:05 Дорога до вуза',
      '07:45 Экономика',
      '09:40 Право',
      '11:15 Дорога домой',
    ]);
    const sk = p.skeleton('2026-11-03');
    expect(sk.wake).toBe(6 * 60 + 20);
    // отбой во вторник = подъём в среду (08:00, пар нет) - 8ч = 00:00 → конец дня
    expect(sk.sleep).toBe(1440);
    expect(sk.free[0]).toEqual([11 * 60 + 55, 1440]);
  });

  it('skips study-day routines on free days', () => {
    const p = planner();
    const items = p.dayItems('2026-11-07');
    expect(items.map((i) => i.title)).toEqual(['Подъём и сборы']);
  });

  it('replaces only future AI events when regenerating today', () => {
    const ev = (id: string, start: string, end: string, source: EventRec['source']): EventRec => ({
      id, date: '2026-11-07', start, end, title: id, kind: 'study', source, status: 'planned', updatedAt: 1,
    });
    const p = planner([ev('past', '09:00', '10:00', 'ai'), ev('future', '15:00', '16:00', 'ai'), ev('mine', '17:00', '18:00', 'manual')]);
    const sk = p.skeleton('2026-11-07', { replaceAi: true, fromMin: 12 * 60 });
    expect(sk.oldAi.map((i) => i.srcId)).toEqual(['future']);
    expect(sk.busy.map((i) => i.srcId)).toContain('past');
    expect(sk.free).toEqual([
      [12 * 60, 17 * 60],
      [18 * 60, 1440],
    ]);
  });

  it('validates AI plan against free windows', () => {
    const free = freeWindows(8 * 60, 22 * 60, [[9 * 60, 11 * 60]]);
    const { ok, dropped } = validateDayPlan(
      [
        { start: '08:00', end: '09:30', title: 'A', kind: 'study' }, // обрежется до 09:00
        { start: '09:15', end: '10:00', title: 'B', kind: 'study' }, // целиком в занятом
        { start: '11:00', end: '12:00', title: 'C', kind: 'study' },
        { start: '11:30', end: '12:30', title: 'D', kind: 'study' }, // наложение на C → сдвиг
        { start: 'xx', end: '12:30', title: 'E', kind: 'study' },
      ],
      free,
    );
    expect(ok.map((i) => `${i.title} ${i.start}-${i.end}`)).toEqual(['A 08:00-09:00', 'C 11:00-12:00', 'D 12:00-12:30']);
    expect(dropped.map((d) => d.item.title).sort()).toEqual(['B', 'E']);
  });
});
