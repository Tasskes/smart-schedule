import { useMemo } from 'react';
import { createPlanner } from '../lib/planner';
import { scheduleStore, semesterStart, useSchedule } from './schedule';
import { all, useVersion } from './store';

export function getPlanner() {
  const s = scheduleStore.get();
  return createPlanner({
    classesByDate: s.byDate,
    events: all('events'),
    routines: all('routines'),
    variables: all('variables'),
    marks: all('marks'),
    semesterStart: semesterStart(s.data),
  });
}

export function usePlanner() {
  const v = useVersion(['events', 'routines', 'variables', 'marks']);
  const sched = useSchedule();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => getPlanner(), [v, sched.byDate]);
}
