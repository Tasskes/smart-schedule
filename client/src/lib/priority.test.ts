import { describe, expect, it } from 'vitest';
import type { EventRec, TaskRec } from '../types';
import { createPlanner } from './planner';
import { computeTaskLoads } from './priority';

const task = (id: string, deadline: string | null, estimateMin: number, extra: Partial<TaskRec> = {}): TaskRec => ({
  id, title: id, category: 'study', status: 'todo', createdAt: 1, updatedAt: 1, deadline, estimateMin, ...extra,
});

// Пустые дни: свободно с 08:00 до 23:00; лимит фокуса 4 ч/день
function planner(events: EventRec[] = []) {
  return createPlanner({
    classesByDate: new Map(),
    events,
    marks: [],
    routines: [],
    variables: [
      { id: 'w', name: 'подъём', expr: '08:00', updatedAt: 1 },
      { id: 's', name: 'отбой', expr: '23:00', updatedAt: 1 },
    ],
  });
}

const opts = { today: '2026-11-09', nowMin: 8 * 60, dailyCap: 240 };

describe('task priority by deadline and workload', () => {
  it('overdue and tomorrow are high, roomy deadline is low, no deadline is low', () => {
    const tasks = [task('late', '2026-11-08', 60), task('tomorrow', '2026-11-10', 30), task('roomy', '2026-11-30', 60), task('free', null, 60)];
    const loads = computeTaskLoads(tasks, [], planner(), opts);
    expect(loads.get('late')!.priority).toBe(1);
    expect(loads.get('tomorrow')!.priority).toBe(1);
    expect(loads.get('roomy')!.priority).toBe(3);
    expect(loads.get('free')!.priority).toBe(3);
  });

  it('a big task due in 5 days becomes high when there is not enough free time', () => {
    // до срока 6 дней × 4 ч = 24 ч; задача на 20 ч → 83% → высокий
    const loads = computeTaskLoads([task('big', '2026-11-14', 20 * 60)], [], planner(), opts);
    expect(loads.get('big')!.priority).toBe(1);
    expect(loads.get('big')!.reason).toMatch(/мало времени/);
  });

  it('earlier deadlines eat time of later ones (workload is cumulative)', () => {
    const alone = computeTaskLoads([task('b', '2026-11-16', 9 * 60)], [], planner(), opts).get('b')!;
    expect(alone.priority).toBe(3);
    const crowded = computeTaskLoads([task('a', '2026-11-14', 14 * 60), task('b', '2026-11-16', 9 * 60)], [], planner(), opts).get('b')!;
    expect(crowded.priority).toBe(1);
  });

  it('manual priority wins', () => {
    const loads = computeTaskLoads([task('m', '2026-11-30', 60, { priority: 1, priorityManual: true })], [], planner(), opts);
    expect(loads.get('m')!.priority).toBe(1);
    expect(loads.get('m')!.manual).toBe(true);
  });
});
