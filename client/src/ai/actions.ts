import { completeTask } from '../db/ops';
import { getPlanner } from '../db/planState';
import { all, get, getRaw, patch, put, remove, restore } from '../db/store';
import { fmtShort, isDateStr, minToTime, normTime, nowTime, todayStr } from '../lib/dates';
import { clampReward, defaultReward } from '../lib/game';
import { isCategory, isHorizon, isKind, isMeal, mealByTime } from '../lib/meta';
import { fixMacros } from '../lib/nutrition';
import { validateDayPlan } from '../lib/planner';
import { normalizeVarName, VAR_NAME_RE } from '../lib/vars';
import type { Action, AppliedInfo, ChatMode, ChatRec, Kind, PlanItemDraft, TaskRec } from '../types';
import { planFromMin } from './context';
import type { RefMap } from './refs';

type Raw = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const numOr = (v: unknown, d: number | null = null) => {
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : d;
};
const isNewRef = (v: unknown) => typeof v === 'string' && /^new/i.test(v.trim());

function resolveRef(refs: RefMap, v: unknown): { id: string | null; ref: string | null } {
  if (v == null || v === '') return { id: null, ref: null };
  const id = refs.resolve(v);
  if (id) return { id, ref: null };
  if (isNewRef(v)) return { id: null, ref: str(v).toLowerCase() };
  return { id: null, ref: null };
}

function planItem(raw: Raw, refs: RefMap): PlanItemDraft | null {
  const start = normTime(str(raw.s ?? raw.start));
  const end = normTime(str(raw.e ?? raw.end));
  const title = str(raw.t ?? raw.title).slice(0, 120);
  if (!start || !end || !title) return null;
  const k = str(raw.k ?? raw.kind);
  const task = resolveRef(refs, raw.task ?? raw.taskId);
  const goal = resolveRef(refs, raw.goal ?? raw.goalId);
  return {
    start,
    end,
    title,
    kind: isKind(k) && k !== 'class' ? k : task.id || task.ref ? 'study' : 'other',
    taskId: task.id,
    taskRef: task.ref,
    goalId: goal.id,
    reward: numOr(raw.r ?? raw.reward),
    notes: str(raw.n ?? raw.notes).slice(0, 300),
  };
}

export function normalizeActions(rawActions: unknown, refs: RefMap, ctx: { mode: ChatMode; targetDays?: string[] }): Action[] {
  if (!Array.isArray(rawActions)) return [];
  const today = todayStr();
  const out: Action[] = [];
  for (const a of rawActions as Raw[]) {
    if (!a || typeof a !== 'object') continue;
    const type = str(a.type).toLowerCase();
    switch (type) {
      case 'plan': {
        const daysRaw = Array.isArray(a.days) ? (a.days as Raw[]) : [];
        const days = daysRaw
          .filter((d) => d && isDateStr(d.date) && (d.date as string) >= today)
          .filter((d) => ctx.mode !== 'plan' || !ctx.targetDays?.length || ctx.targetDays.includes(d.date as string))
          .map((d) => ({
            date: d.date as string,
            replace: ctx.mode === 'plan' ? d.replace !== false : d.replace === true,
            items: (Array.isArray(d.items) ? (d.items as Raw[]) : []).map((it) => planItem(it, refs)).filter((x): x is PlanItemDraft => !!x),
          }));
        if (days.length) out.push({ type: 'plan', days });
        break;
      }
      case 'add_event': {
        const date = str(a.date);
        const start = normTime(str(a.start));
        let end = normTime(str(a.end));
        const title = str(a.title).slice(0, 120);
        if (!isDateStr(date) || !start || !title) break;
        if (!end) end = minToTime(Math.min(1440, (Number(start.slice(0, 2)) * 60 + Number(start.slice(3))) + 60));
        const k = str(a.kind);
        const kind: Kind = isKind(k) && k !== 'class' ? k : ctx.mode === 'tutor' ? 'tutor' : 'other';
        out.push({ type: 'add_event', date, start, end, title, kind, fixed: a.fixed !== false && (kind === 'tutor' || a.fixed === true), notes: str(a.notes).slice(0, 300) });
        break;
      }
      case 'update_event': {
        const id = refs.resolve(a.id);
        if (!id) break;
        out.push({
          type: 'update_event', id,
          date: isDateStr(a.date) ? (a.date as string) : undefined,
          start: normTime(str(a.start)) || undefined,
          end: normTime(str(a.end)) || undefined,
          title: str(a.title) || undefined,
          notes: str(a.notes) || undefined,
        });
        break;
      }
      case 'remove_event': {
        const id = refs.resolve(a.id);
        if (id) out.push({ type: 'remove_event', id });
        break;
      }
      case 'set_variable': {
        const name = normalizeVarName(str(a.name));
        const expr = str(a.expr ?? a.value);
        if (!VAR_NAME_RE.test(name) || !expr) break;
        out.push({ type: 'set_variable', name, expr: expr.slice(0, 300), description: str(a.description).slice(0, 200) || undefined });
        break;
      }
      case 'delete_variable': {
        const name = normalizeVarName(str(a.name));
        if (name) out.push({ type: 'delete_variable', name });
        break;
      }
      case 'add_task': {
        const title = str(a.title).slice(0, 150);
        if (!title) break;
        const cat = str(a.category);
        const goal = resolveRef(refs, a.goal ?? a.goalId);
        const prio = numOr(a.priority, 2);
        out.push({
          type: 'add_task',
          ref: isNewRef(a.ref) ? str(a.ref).toLowerCase() : null,
          title,
          category: isCategory(cat) ? cat : 'other',
          context: str(a.context).slice(0, 1000) || undefined,
          deadline: isDateStr(a.deadline) ? (a.deadline as string) : null,
          priority: (Math.min(3, Math.max(1, Math.round(prio ?? 2))) as 1 | 2 | 3),
          estimateMin: numOr(a.estimateMin),
          complexity: numOr(a.complexity),
          reward: numOr(a.reward),
          goalId: goal.id,
          goalRef: goal.ref,
        });
        break;
      }
      case 'update_task': {
        const id = refs.resolve(a.id);
        if (!id) break;
        const fields: Partial<TaskRec> = {};
        if (a.status === 'done' || a.status === 'todo' || a.status === 'archived') fields.status = a.status;
        if (isDateStr(a.deadline)) fields.deadline = a.deadline as string;
        if (a.deadline === null) fields.deadline = null;
        const pr = numOr(a.priority);
        if (pr) fields.priority = Math.min(3, Math.max(1, Math.round(pr))) as 1 | 2 | 3;
        const est = numOr(a.estimateMin);
        if (est) fields.estimateMin = est;
        if (str(a.context)) fields.context = str(a.context).slice(0, 1000);
        if (str(a.title)) fields.title = str(a.title).slice(0, 150);
        out.push({ type: 'update_task', id, fields });
        break;
      }
      case 'add_goal': {
        const title = str(a.title).slice(0, 150);
        if (!title) break;
        const h = str(a.horizon);
        const parent = resolveRef(refs, a.parent ?? a.parentId);
        out.push({
          type: 'add_goal',
          ref: isNewRef(a.ref) ? str(a.ref).toLowerCase() : null,
          title,
          horizon: isHorizon(h) ? h : '1m',
          parentId: parent.id,
          parentRef: parent.ref,
          targetDate: isDateStr(a.targetDate) ? (a.targetDate as string) : null,
          context: str(a.context).slice(0, 1000) || undefined,
        });
        break;
      }
      case 'update_goal': {
        const id = refs.resolve(a.id);
        if (!id) break;
        const fields: Record<string, unknown> = {};
        const pr = numOr(a.progress);
        if (pr != null) fields.progress = Math.min(100, Math.max(0, Math.round(pr)));
        if (a.status === 'active' || a.status === 'done' || a.status === 'archived') fields.status = a.status;
        if (str(a.context)) fields.context = str(a.context).slice(0, 1000);
        out.push({ type: 'update_goal', id, fields });
        break;
      }
      case 'add_routine': {
        const title = str(a.title);
        const startExpr = str(a.startExpr ?? a.start);
        if (!title || !startExpr) break;
        const k = str(a.kind);
        const days = Array.isArray(a.days) ? (a.days as unknown[]).map(Number).filter((d) => d >= 1 && d <= 7) : [];
        out.push({
          type: 'add_routine',
          title: title.slice(0, 100),
          kind: isKind(k) && k !== 'class' ? k : 'routine',
          days: days.length ? days : [1, 2, 3, 4, 5, 6, 7],
          when: a.when === 'study' || a.when === 'free' ? a.when : 'always',
          startExpr,
          durationExpr: str(a.durationExpr ?? a.duration) || '30 мин',
          fixed: a.fixed !== false,
          remindMin: numOr(a.remindMin),
        });
        break;
      }
      case 'log_food': {
        const items = (Array.isArray(a.items) ? (a.items as Raw[]) : [])
          .map((it) => {
            const m = fixMacros({ kcal: numOr(it.kcal, 0)!, p: numOr(it.p, 0)!, f: numOr(it.f, 0)!, c: numOr(it.c, 0)! });
            const meal = str(it.meal);
            return { name: str(it.name).slice(0, 120), grams: numOr(it.grams), ...m, meal: isMeal(meal) ? meal : undefined };
          })
          .filter((it) => it.name && it.kcal >= 0);
        if (items.length) out.push({ type: 'log_food', date: isDateStr(a.date) ? (a.date as string) : undefined, items });
        break;
      }
      case 'bonus': {
        const amount = Math.min(50, Math.max(0, Math.round(numOr(a.amount, 0)!)));
        if (amount > 0) out.push({ type: 'bonus', amount, reason: str(a.reason).slice(0, 120) || 'Бонус' });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** Предпросмотр плана: что встанет, что обрежется, сколько старых дел ИИ уйдёт */
export function previewPlanDay(day: { date: string; replace: boolean; items: PlanItemDraft[] }) {
  const planner = getPlanner();
  const fromMin = planFromMin(day.date);
  const sk = planner.skeleton(day.date, { replaceAi: day.replace, fromMin });
  const { ok, dropped } = validateDayPlan(day.items, sk.free);
  return { ok, dropped, removeCount: day.replace ? sk.oldAi.length : 0 };
}

export function applyActions(msg: ChatRec): AppliedInfo {
  const actions = msg.actions || [];
  const info: AppliedInfo = { at: Date.now(), created: [], removed: [], varsBefore: [], summary: [] };
  const newRefs = new Map<string, string>();
  const today = todayStr();
  const byType = (t: Action['type']) => actions.filter((a) => a.type === t);

  for (const a of byType('set_variable') as Extract<Action, { type: 'set_variable' }>[]) {
    const cur = all('variables').find((v) => v.name.toLowerCase() === a.name.toLowerCase());
    info.varsBefore.push({ name: a.name, expr: cur ? cur.expr : null, id: cur?.id ?? null });
    if (cur) patch('variables', cur.id, { expr: a.expr, description: a.description ?? cur.description });
    else {
      const rec = put('variables', { name: a.name, expr: a.expr, description: a.description || '' });
      info.created.push({ tbl: 'variables', id: rec.id });
    }
    info.summary.push(`Переменная {${a.name}} = ${a.expr}`);
  }
  for (const a of byType('delete_variable') as Extract<Action, { type: 'delete_variable' }>[]) {
    const cur = all('variables').find((v) => v.name.toLowerCase() === a.name.toLowerCase());
    if (!cur) continue;
    remove('variables', cur.id);
    info.removed.push({ tbl: 'variables', id: cur.id });
    info.summary.push(`Удалена переменная {${a.name}}`);
  }

  for (const a of byType('add_goal') as Extract<Action, { type: 'add_goal' }>[]) {
    const parentId = a.parentId ?? (a.parentRef ? newRefs.get(a.parentRef) ?? null : null);
    const rec = put('goals', {
      title: a.title, horizon: a.horizon, parentId, targetDate: a.targetDate ?? null, context: a.context || '',
      status: 'active', progress: 0, createdAt: Date.now(),
    });
    if (a.ref) newRefs.set(a.ref, rec.id);
    info.created.push({ tbl: 'goals', id: rec.id });
    info.summary.push(`Цель: ${a.title}`);
  }

  for (const a of byType('add_task') as Extract<Action, { type: 'add_task' }>[]) {
    const goalId = a.goalId ?? (a.goalRef ? newRefs.get(a.goalRef) ?? null : null);
    const est = a.estimateMin && a.estimateMin > 0 ? Math.round(a.estimateMin) : null;
    const rec = put('tasks', {
      title: a.title, category: a.category, context: a.context || '', deadline: a.deadline ?? null, priority: a.priority ?? 2,
      estimateMin: est, complexity: a.complexity ?? null,
      reward: a.reward != null ? clampReward(a.reward) : est ? defaultReward('task', est) : null,
      goalId, status: 'todo', createdAt: Date.now(),
    });
    if (a.ref) newRefs.set(a.ref, rec.id);
    info.created.push({ tbl: 'tasks', id: rec.id });
    info.summary.push(`Задача: ${a.title}${est ? ` (~${est} мин)` : ''}`);
  }

  for (const a of byType('update_task') as Extract<Action, { type: 'update_task' }>[]) {
    const t = get('tasks', a.id);
    if (!t) continue;
    const { status, ...rest } = a.fields;
    if (Object.keys(rest).length) patch('tasks', a.id, rest);
    if (status === 'done' && t.status !== 'done') completeTask(a.id, true);
    else if (status && status !== 'done') patch('tasks', a.id, { status });
    info.summary.push(`Обновлена задача: ${t.title}`);
  }

  for (const a of byType('update_goal') as Extract<Action, { type: 'update_goal' }>[]) {
    const g = get('goals', a.id);
    if (!g) continue;
    patch('goals', a.id, a.fields);
    info.summary.push(`Обновлена цель: ${g.title}`);
  }

  for (const a of byType('add_routine') as Extract<Action, { type: 'add_routine' }>[]) {
    const rec = put('routines', {
      title: a.title, kind: a.kind, days: a.days, when: a.when, startExpr: a.startExpr, durationExpr: a.durationExpr,
      fixed: a.fixed, enabled: true, remindMin: a.remindMin ?? null, order: 5,
    });
    info.created.push({ tbl: 'routines', id: rec.id });
    info.summary.push(`Распорядок: ${a.title}`);
  }

  for (const a of byType('add_event') as Extract<Action, { type: 'add_event' }>[]) {
    const rec = put('events', {
      date: a.date, start: a.start, end: a.end, title: a.title, kind: a.kind, fixed: !!a.fixed,
      source: a.kind === 'tutor' ? 'tutor' : 'manual', status: 'planned', notes: a.notes || '',
      reward: defaultReward(a.kind, 60), batch: msg.id,
    });
    info.created.push({ tbl: 'events', id: rec.id });
    info.summary.push(`${fmtShort(a.date)} ${a.start}–${a.end}: ${a.title}`);
  }

  for (const a of byType('update_event') as Extract<Action, { type: 'update_event' }>[]) {
    const e = get('events', a.id);
    if (!e) continue;
    const fields: Record<string, unknown> = {};
    for (const k of ['date', 'start', 'end', 'title', 'notes'] as const) if (a[k]) fields[k] = a[k];
    // дело из авторасписания, которое двигают вручную, становится «своим» — автоплан его больше не трогает
    if (e.source === 'auto') fields.source = 'manual';
    patch('events', a.id, fields);
    info.summary.push(`Изменено: ${e.title}`);
  }

  for (const a of byType('remove_event') as Extract<Action, { type: 'remove_event' }>[]) {
    const e = get('events', a.id);
    if (!e) continue;
    remove('events', a.id);
    info.removed.push({ tbl: 'events', id: a.id });
    info.summary.push(`Убрано: ${e.title}`);
  }

  for (const a of byType('plan') as Extract<Action, { type: 'plan' }>[]) {
    for (const day of a.days) {
      if (day.date < today) continue;
      const fromMin = planFromMin(day.date);
      if (day.replace) {
        const sk = getPlanner().skeleton(day.date, { replaceAi: true, fromMin });
        for (const old of sk.oldAi) {
          remove('events', old.srcId);
          info.removed.push({ tbl: 'events', id: old.srcId });
        }
      }
      const sk2 = getPlanner().skeleton(day.date, { fromMin });
      const { ok, dropped } = validateDayPlan(day.items, sk2.free);
      for (const it of ok) {
        const taskId = it.taskId ?? (it.taskRef ? newRefs.get(it.taskRef) ?? null : null);
        const task = taskId ? get('tasks', taskId) : undefined;
        const minutes = it.endMin - it.startMin;
        const rec = put('events', {
          date: day.date, start: it.start, end: it.end, title: it.title, kind: it.kind,
          source: 'ai', status: 'planned', taskId: task ? taskId : null, goalId: it.goalId ?? task?.goalId ?? null,
          reward: it.reward != null ? clampReward(it.reward) : defaultReward(it.kind, minutes),
          notes: it.notes || '', fixed: false, batch: msg.id,
        });
        info.created.push({ tbl: 'events', id: rec.id });
      }
      info.summary.push(`${fmtShort(day.date)}: ${ok.length} дел${dropped.length ? ` (не влезло ${dropped.length})` : ''}`);
    }
  }

  for (const a of byType('log_food') as Extract<Action, { type: 'log_food' }>[]) {
    const date = a.date || today;
    const time = nowTime();
    for (const it of a.items) {
      const rec = put('food', {
        date, time, meal: it.meal || mealByTime(Number(time.slice(0, 2)) * 60), name: it.name, grams: it.grams ?? null,
        kcal: it.kcal, p: it.p, f: it.f, c: it.c, source: 'ai',
      });
      info.created.push({ tbl: 'food', id: rec.id });
    }
    info.summary.push(`Еда: ${a.items.map((i) => i.name).join(', ')}`);
  }

  for (const a of byType('bonus') as Extract<Action, { type: 'bonus' }>[]) {
    const id = `bonus:${today}`;
    const cur = getRaw('ledger', id);
    if (cur && !cur.deleted) {
      info.summary.push('Бонус за сегодня уже был');
      continue;
    }
    put('ledger', { id, ts: Date.now(), amount: a.amount, reason: a.reason, kind: 'bonus' });
    info.created.push({ tbl: 'ledger', id });
    info.summary.push(`Бонус +${a.amount} 🪙`);
  }

  patch('chat', msg.id, { applied: info });
  return info;
}

export function undoApplied(msg: ChatRec) {
  const info = msg.applied;
  if (!info || info.undone) return;
  for (const c of info.created) remove(c.tbl as never, c.id);
  for (const r of info.removed) restore(r.tbl as never, r.id);
  for (const v of info.varsBefore) {
    if (v.id && v.expr != null) patch('variables', v.id, { expr: v.expr });
  }
  patch('chat', msg.id, { applied: { ...info, undone: true } });
}
