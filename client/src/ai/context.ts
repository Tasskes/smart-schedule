import { getPlanner } from '../db/planState';
import { scheduleStore, semesterStart } from '../db/schedule';
import { all, get } from '../db/store';
import { academicWeek, addDays, DOW_SHORT, dow, fmtDM, minToTime, nowMin, roundUp5, timeToMin, todayStr, weekDays } from '../lib/dates';
import { adjustedEstimate, personalFactors, taskScheduled, taskSpent } from '../lib/estimate';
import { fmtWeekly, isOngoing, weeklyMinutes } from '../lib/goalbudget';
import { computeTaskLoads } from '../lib/priority';
import { balance, streak } from '../lib/game';
import { horizonLabel } from '../lib/meta';
import { calcNorms, latestWeight, sumMacros } from '../lib/nutrition';
import { fmtWindow } from '../lib/planner';
import { formatVal } from '../lib/vars';
import type { ChatMode, DayItem } from '../types';
import { RefMap } from './refs';

const cut = (s: string | undefined | null, n: number) => {
  const t = (s || '').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

const WHEN_LABEL = { always: 'каждый день', study: 'в учебные дни', free: 'в дни без пар' } as const;

/** Для сегодняшнего дня планируем не раньше, чем через 10 минут от «сейчас» */
export function planFromMin(date: string) {
  return date === todayStr() ? roundUp5(nowMin() + 10) : null;
}

export function remainingWeekDays() {
  const today = todayStr();
  const days = weekDays(today).filter((d) => d >= today);
  // поздно вечером в воскресенье — сразу следующая неделя
  if (days.length === 1 && nowMin() > 20 * 60) return weekDays(addDays(today, 1));
  return days;
}

export function nextWeekDays() {
  return weekDays(addDays(todayStr(), 7));
}

function itemBrief(it: DayItem, refs: RefMap) {
  const o: Record<string, unknown> = { s: it.start, e: it.end, t: cut(it.title, 60), k: it.kind };
  if (it.fixed) o.fix = true;
  if (it.src === 'event') o.id = refs.ref('e', it.srcId);
  if (it.status && it.status !== 'planned') o.st = it.status;
  return o;
}

export function buildContext(opts: { mode: ChatMode; targetDays?: string[]; goalId?: string | null; refs: RefMap }) {
  const { mode, refs } = opts;
  const planner = getPlanner();
  const sched = scheduleStore.get().data;
  const today = todayStr();
  const now = nowMin();
  const settings = get('settings', 'main');
  const events = all('events');
  const tasks = all('tasks');
  const factors = personalFactors(tasks, events);
  const week = academicWeek(today, semesterStart(sched));

  const vars = all('variables').map((v) => {
    const r = planner.engine.evalName(v.name, today);
    return { name: v.name, expr: v.expr, value: r.error ? `ошибка: ${r.error}` : formatVal(r.val), desc: cut(v.description, 80) || undefined };
  });

  const routines = all('routines')
    .filter((r) => r.enabled)
    .map((r) => ({ title: r.title, when: WHEN_LABEL[r.when], start: r.startExpr, dur: r.durationExpr }));

  const goals = all('goals')
    .filter((g) => g.status === 'active')
    .slice(0, 30)
    .map((g) => ({
      id: refs.ref('g', g.id),
      title: cut(g.title, 80),
      horizon: horizonLabel(g.horizon),
      parent: g.parentId ? refs.ref('g', g.parentId) : null,
      target: g.targetDate || null,
      progress: isOngoing(g) ? undefined : g.progress ?? 0,
      weekly: isOngoing(g) ? 'постоянная' : fmtWeekly(weeklyMinutes(g, tasks, events, factors, today)),
      ctx: cut(g.context, 300) || undefined,
    }));

  const loads = computeTaskLoads(tasks, events, planner, { today, nowMin: now, dailyCap: planner.engine.minutes('{макс_фокус_в_день}', today) ?? 240 });
  const openTasks = tasks
    .filter((t) => t.status === 'todo')
    .sort((a, b) => (loads.get(a.id)?.priority ?? 2) - (loads.get(b.id)?.priority ?? 2) || (a.deadline || '9999').localeCompare(b.deadline || '9999'))
    .slice(0, 40)
    .map((t) => {
      const est = adjustedEstimate(t, factors);
      const spent = taskSpent(t, events);
      const planned = taskScheduled(t, events, today, now);
      return {
        id: refs.ref('t', t.id),
        title: cut(t.title, 80),
        cat: t.category,
        deadline: t.deadline || null,
        prio: loads.get(t.id)?.priority ?? t.priority ?? 2,
        prioWhy: loads.get(t.id)?.reason,
        est,
        spent: spent || undefined,
        planned: planned || undefined,
        left: est != null ? Math.max(0, est - spent - planned) : null,
        reward: t.reward ?? undefined,
        goal: t.goalId ? refs.ref('g', t.goalId) : null,
        ctx: cut(t.context, 200) || undefined,
      };
    });

  const factorOut: Record<string, number> = {};
  for (const [k, f] of Object.entries(factors)) if (f) factorOut[k] = Math.round(f.factor * 100) / 100;

  const isPlan = mode === 'plan';
  const dayList = isPlan && opts.targetDays?.length
    ? opts.targetDays
    : Array.from({ length: mode === 'tutor' ? 14 : 7 }, (_, i) => addDays(today, i));

  const days = dayList.map((date) => {
    const fromMin = isPlan ? planFromMin(date) : null;
    const sk = planner.skeleton(date, { replaceAi: isPlan, fromMin });
    const busy = sk.busy.filter((b) => !(date === today && isPlan && (timeToMin(b.end) ?? 0) <= (fromMin ?? 0)));
    const d: Record<string, unknown> = {
      date,
      dow: DOW_SHORT[dow(date) - 1],
      wake: minToTime(sk.wake),
      sleep: minToTime(sk.sleep),
      busy: busy.map((b) => itemBrief(b, refs)),
      free: sk.free.map((w) => fmtWindow(w).split('–')),
    };
    if (fromMin != null) d.from = minToTime(fromMin);
    if (isPlan && sk.oldAi.length) d.old = sk.oldAi.map((b) => itemBrief(b, refs));
    return d;
  });

  const ctx: Record<string, unknown> = {
    mode,
    today,
    now: minToTime(now),
    dow: DOW_SHORT[dow(today) - 1],
    week: week ? { num: week.num, even: week.even } : null,
    semester: (sched?.periods || [])
      .filter((p) => p.end >= today)
      .slice(0, 4)
      .map((p) => `${fmtDM(p.begin)}–${fmtDM(p.end)}: ${p.title}`),
    profile: cut(settings?.profileNote, 600),
    vars,
    routines,
    goals,
    tasks: openTasks,
    factors: factorOut,
    days,
  };
  if (isPlan) ctx.targetDays = opts.targetDays;

  if (mode === 'review') {
    const items = planner.dayItems(today);
    ctx.todayItems = items.map((it) => ({ s: it.start, e: it.end, t: cut(it.title, 60), k: it.kind, st: it.status || 'planned', r: it.reward }));
    const food = all('food').filter((f) => f.date === today);
    const w = latestWeight(all('weights'));
    const norms = calcNorms(settings?.nutrition, w?.kg ?? null, today);
    const eaten = sumMacros(food);
    ctx.food = { eaten: { kcal: Math.round(eaten.kcal), p: Math.round(eaten.p), f: Math.round(eaten.f), c: Math.round(eaten.c) }, norm: { kcal: norms.kcal, p: norms.p, f: norms.f, c: norms.c } };
    const ledger = all('ledger');
    ctx.coins = { balance: balance(ledger), streak: streak(ledger) };
  }

  if (mode === 'decompose' && opts.goalId) {
    const g = get('goals', opts.goalId);
    if (g) {
      ctx.goal = {
        id: refs.ref('g', g.id),
        title: g.title,
        horizon: horizonLabel(g.horizon),
        target: g.targetDate,
        ctx: cut(g.context, 800),
        children: all('goals').filter((x) => x.parentId === g.id).map((x) => ({ id: refs.ref('g', x.id), title: x.title, horizon: horizonLabel(x.horizon) })),
        tasks: tasks.filter((t) => t.goalId === g.id).map((t) => ({ id: refs.ref('t', t.id), title: t.title, status: t.status })),
      };
    }
  }
  return ctx;
}
