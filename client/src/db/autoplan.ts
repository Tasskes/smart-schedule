import { hasServer } from '../api';
import { estimateTask, estimateGoalBudgets } from '../ai/tools';
import { addDays, daysBetween, fmtShort, nowMin, timeToMin, todayStr, weekStart } from '../lib/dates';
import { autoPlan, isWorkTask, workWeekState, type Unplaced } from '../lib/autoplan';
import { personalFactors } from '../lib/estimate';
import { consumeGrams, estimateExpiry, isActive, matchFridge, SPOIL_GRACE_DAYS } from '../lib/fridge';
import { isOngoing, weeklyMinutes } from '../lib/goalbudget';
import { calcNorms, latestWeight } from '../lib/nutrition';
import { createPlanner } from '../lib/planner';
import { computeTaskLoads, type TaskLoad } from '../lib/priority';
import { shoppingStatus } from '../lib/shopping';
import type { EventRec } from '../types';
import { metaGet, metaSet } from './idb';
import { scheduleStore, semesterStart } from './schedule';
import { all, createStore, get, patch, put, remove } from './store';

export const autoStore = createStore<{ lastRun: number | null; unplaced: Unplaced[]; loads: Map<string, TaskLoad> }>({
  lastRun: null,
  unplaced: [],
  loads: new Map(),
});

function minutesVar(planner: ReturnType<typeof createPlanner>, name: string, date: string, fallback: number) {
  const r = planner.engine.evalName(name, date);
  return r.val && (r.val.t === 'dur' || r.val.t === 'num') ? Math.round(r.val.v) : fallback;
}

const isShopEvent = (e: EventRec) => /🛒|магазин|продукт/i.test(e.title);
const isWorkSession = (e: Pick<EventRec, 'source' | 'autoKey'>) => e.source === 'auto' && (e.autoKey || '').startsWith('work|');

const evMin = (e: Pick<EventRec, 'start' | 'end'>) => Math.max(0, (timeToMin(e.end) ?? 0) - (timeToMin(e.start) ?? 0));
const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];

/**
 * Пересчитать авто-расписание: задачи по приоритету, час в неделю на каждую задачу по работе, время на цели,
 * поход в магазин. Уже поставленные авто-дела остаются на своих местах (план не «ползёт»), убираются только
 * лишние и ставшие невозможными. Если срочная задача не помещается — всё авто-расписание пересобирается.
 */
export function runAutoPlan() {
  const settings = get('settings', 'main');
  const today = todayStr();
  const now = nowMin();
  const isFutureAuto = (e: EventRec) =>
    e.source === 'auto' && e.status === 'planned' && (e.date > today || (e.date === today && (timeToMin(e.start) ?? 0) >= now));
  if (settings?.autoPlan === false) {
    for (const e of all('events').filter(isFutureAuto)) remove('events', e.id);
    return;
  }
  // Час по работе, который так и не отметили в свой день, — пропущен; ниже план поставит его на другой день недели
  for (const e of all('events')) {
    if (isWorkSession(e) && (e.status ?? 'planned') === 'planned' && e.date < today) patch('events', e.id, { status: 'skipped' });
  }
  const events = all('events');
  const existing = events.filter(isFutureAuto);
  const base = events.filter((e) => !isFutureAuto(e));
  const sched = scheduleStore.get();
  const mkPlanner = (evs: EventRec[]) =>
    createPlanner({
      classesByDate: sched.byDate,
      events: evs,
      routines: all('routines'),
      variables: all('variables'),
      marks: all('marks'),
      semesterStart: semesterStart(sched.data),
    });
  const basePlanner = mkPlanner(base);
  const dailyCap = minutesVar(basePlanner, 'макс_фокус_в_день', today, 240);
  const tasks = all('tasks');
  const goals = all('goals');
  const factors = personalFactors(tasks, events);
  const loads = computeTaskLoads(tasks, base, basePlanner, { today, nowMin: now, dailyCap });

  // в магазин — если ведёшь холодильник, еды мало и поход ещё не стоит в плане
  const fridge = all('fridge');
  let shopping: { minutes: number; title: string } | null = null;
  if (fridge.length) {
    const w = latestWeight(all('weights'));
    const norms = calcNorms(settings?.nutrition, w?.kg ?? null, today);
    const st = shoppingStatus(fridge, all('products'), norms.kcal, today);
    const planned = base.some((e) => isShopEvent(e) && e.status === 'planned' && e.date >= today && e.date <= addDays(today, 2));
    if (st.needed && !planned) {
      const stores = settings?.shopping?.stores?.map((x) => x.store) || [];
      shopping = { minutes: 45, title: `🛒 Магазин${stores.length ? `: ${stores.slice(0, 2).join(', ')}` : ''}` };
    }
  }

  // --- какие авто-дела оставить на месте ---
  const busyCache = new Map<string, [number, number][]>();
  const busyOf = (date: string) => {
    let b = busyCache.get(date);
    if (!b) {
      b = basePlanner
        .dayItems(date)
        .filter((it) => it.status !== 'skipped' && !it.overnight)
        .map((it) => [timeToMin(it.start) ?? 0, timeToMin(it.end) ?? 0] as [number, number]);
      busyCache.set(date, b);
    }
    return b;
  };
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const goalById = new Map(goals.map((g) => [g.id, g]));
  const plannedBase = (pred: (e: EventRec) => boolean, from: string, to: string, includeDone: boolean) =>
    base
      .filter((e) => e.date >= from && e.date <= to && pred(e) && (e.status === 'planned' || (includeDone && e.status === 'done')))
      .filter((e) => includeDone || e.date > today || (timeToMin(e.start) ?? 0) >= now)
      .reduce((s, e) => s + evMin(e), 0);

  const keep: EventRec[] = [];
  const sorted = [...existing].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const used = new Map<string, number>(); // сколько уже оставили по задаче/цели-неделе
  for (const e of sorted) {
    const key = e.autoKey || '';
    const span: [number, number] = [timeToMin(e.start) ?? 0, timeToMin(e.end) ?? 0];
    if (busyOf(e.date).some((b) => overlaps(b, span))) continue; // на это время теперь что-то стоит
    if (key.startsWith('shop|')) {
      if (shopping) {
        keep.push(e);
        shopping = null; // поход уже стоит
      }
      continue;
    }
    if (key.startsWith('work|')) {
      const t = e.taskId ? taskById.get(e.taskId) : undefined;
      if (!t || t.status !== 'todo' || !isWorkTask(t, goalById)) continue;
      const ws = weekStart(e.date);
      const st = workWeekState(t.id, base, ws, today);
      if (st.done || st.planned) continue; // в этой неделе час уже сделан или стоит отдельно
      if (t.deadline && t.deadline >= today && t.deadline >= ws && e.date > t.deadline) continue; // срок сдвинули раньше
      if (used.has(`w|${t.id}|${ws}`)) continue; // не больше одного часа в неделю
      used.set(`w|${t.id}|${ws}`, 1);
      keep.push(e);
      continue;
    }
    if (key.startsWith('task|')) {
      const t = e.taskId ? taskById.get(e.taskId) : undefined;
      if (!t || t.status !== 'todo' || isWorkTask(t, goalById) || (t.deadline && e.date > t.deadline)) continue;
      const need = (loads.get(t.id)?.remainingMin ?? 60) - plannedBase((x) => x.taskId === t.id, today, addDays(today, 365), false);
      const already = used.get(`t|${t.id}`) ?? 0;
      if (already + evMin(e) > need + 10) continue; // лишнее — задача стала меньше
      used.set(`t|${t.id}`, already + evMin(e));
      keep.push(e);
      continue;
    }
    if (key.startsWith('goal|')) {
      const g = e.goalId ? goalById.get(e.goalId) : undefined;
      if (!g || g.status !== 'active' || isOngoing(g)) continue;
      const weekly = weeklyMinutes(g, tasks, base, factors, today);
      const ws = weekStart(e.date);
      const share = ws === weekStart(today) ? Math.min(1, (daysBetween(today, addDays(ws, 6)) + 1) / 7) : 1;
      const goalTaskIds = new Set(tasks.filter((t) => t.goalId === g.id).map((t) => t.id));
      const done = plannedBase((x) => x.goalId === g.id || (!!x.taskId && goalTaskIds.has(x.taskId)), ws, addDays(ws, 6), true);
      const quota = Math.round(weekly * share) - done;
      const k = `g|${g.id}|${ws}`;
      const already = used.get(k) ?? 0;
      if (already + evMin(e) > quota + 10) continue;
      if (e.taskId) {
        const t = taskById.get(e.taskId);
        if (!t || t.status !== 'todo' || isWorkTask(t, goalById)) continue; // задача цели закрыта — блок пересоберём
      }
      used.set(k, already + evMin(e));
      keep.push(e);
    }
  }

  const plan = (kept: EventRec[]) =>
    autoPlan({
      planner: mkPlanner([...base, ...kept]),
      events: [...base, ...kept],
      tasks,
      goals,
      loads,
      factors,
      today,
      nowMin: now,
      days: 14,
      dailyCap,
      focusBlock: minutesVar(basePlanner, 'фокус_блок', today, 50),
      breakMin: minutesVar(basePlanner, 'перерыв', today, 10),
      shopping,
    });

  let kept = keep;
  let res = plan(kept);
  // срочное не влезает из-за уже стоящих авто-дел — пересобираем всё с нуля по приоритетам
  if (kept.length && res.unplaced.some((u) => u.reason !== 'week' && loads.get(u.taskId)?.priority === 1)) {
    kept = [];
    if (!shopping && existing.some((e) => (e.autoKey || '').startsWith('shop|'))) {
      shopping = { minutes: 45, title: existing.find((e) => (e.autoKey || '').startsWith('shop|'))!.title };
    }
    res = plan(kept);
  }

  const keepIds = new Set(kept.map((e) => e.id));
  for (const e of existing) if (!keepIds.has(e.id)) remove('events', e.id);
  for (const d of res.drafts) {
    let notes = d.notes || '';
    if (d.key.startsWith('work|') && d.taskId) {
      // перенос: последний пропущенный час этой задачи на той же неделе
      const ws = weekStart(d.date);
      const missed = all('events')
        .filter((e) => isWorkSession(e) && e.taskId === d.taskId && e.status === 'skipped' && e.date < d.date && weekStart(e.date) === ws)
        .sort((a, b) => a.date.localeCompare(b.date))
        .pop();
      if (missed) {
        notes = `↪️ перенос с ${fmtShort(missed.date)}`;
        patch('events', missed.id, { notes: `↪️ перенесено на ${fmtShort(d.date)}` });
      }
    }
    put('events', {
      date: d.date, start: d.start, end: d.end, title: d.title, kind: d.kind, source: 'auto', autoKey: d.key,
      status: 'planned', taskId: d.taskId ?? null, goalId: d.goalId ?? null, reward: d.reward, fixed: false, notes,
    });
  }
  autoStore.set({ lastRun: Date.now(), unplaced: res.unplaced, loads });
}

// ---------- Холодильник: списание съеденного и порча ----------

/** Списать из холодильника всё съеденное, что ещё не списано (в т.ч. записи из бота) */
export function processFoodConsumption() {
  if (get('settings', 'main')?.fridgeAuto === false) return [];
  const since = addDays(todayStr(), -2);
  const log: { food: string; item: string; before: number | null; after: number }[] = [];
  for (const f of all('food')) {
    if (f.date < since || f.fridgeChecked) continue;
    patch('food', f.id, { fridgeChecked: true });
    if (!f.grams || f.source === 'recipe') continue;
    const item = matchFridge(f.name, all('fridge'));
    if (!item) continue;
    const res = consumeGrams(item, f.grams);
    if (!res) continue;
    patch('fridge', item.id, res.used ? { amount: 0, status: 'used', closedAt: Date.now() } : { amount: res.amount });
    log.push({ food: f.name, item: item.name, before: item.amount ?? null, after: res.amount });
  }
  return log;
}

/** Просроченное: через SPOIL_GRACE_DAYS дней после срока — считаем испорченным */
export function processSpoilage() {
  const today = todayStr();
  const limit = addDays(today, -SPOIL_GRACE_DAYS);
  const spoiled: string[] = [];
  for (const f of all('fridge')) {
    if (!isActive(f)) continue;
    if (!f.expires) {
      patch('fridge', f.id, { expires: estimateExpiry(f.name, today), expiresEstimated: true, addedAt: f.addedAt ?? Date.now() });
      continue;
    }
    if (f.expires < limit) {
      patch('fridge', f.id, { status: 'spoiled', closedAt: Date.now() });
      spoiled.push(f.name);
    }
  }
  return spoiled;
}

// ---------- Нейросеть в фоне: оценки задач и время на цели ----------

let aiBusy = false;

export async function backgroundAi() {
  if (aiBusy || !hasServer() || !navigator.onLine) return;
  aiBusy = true;
  try {
    // 1) задачи без оценки — оцениваем (не больше трёх за раз, повтор не чаще раза в 6 часов)
    const pending = all('tasks')
      .filter((t) => t.status === 'todo' && !t.estimateMin && (!t.estimateTriedAt || Date.now() - t.estimateTriedAt > 6 * 3600000))
      .slice(0, 3);
    for (const t of pending) {
      patch('tasks', t.id, { estimateTriedAt: Date.now() });
      try {
        const est = await estimateTask(t);
        patch('tasks', t.id, {
          estimateMin: est.estimateMin,
          complexity: est.complexity,
          reward: t.reward ?? est.reward,
          steps: est.steps,
          estimateNote: est.explanation,
        });
      } catch {
        /* попробуем позже */
      }
    }
    // 2) время на цели: раз в неделю или когда появилась цель без расчёта
    const goals = all('goals').filter((g) => g.status === 'active' && !isOngoing(g));
    const lastBudget = (await metaGet<number>('goalBudgetAt')) ?? 0;
    const fresh = goals.some((g) => !g.budgetAt && !g.weeklyManual);
    if (goals.length && (fresh || Date.now() - lastBudget > 7 * 86400000)) {
      await metaSet('goalBudgetAt', Date.now());
      await estimateGoalBudgets().catch(() => undefined);
    }
  } finally {
    aiBusy = false;
  }
}
