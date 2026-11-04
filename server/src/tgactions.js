import crypto from 'node:crypto';
import { kv } from './db.js';
import { putMany, setDeleted } from './records.js';
import { classesForDates } from './tulsu.js';
import { fmtDay, localDateStr, localTimeStr } from './time.js';
import { esc } from './tgapi.js';
import { isDate, normTime, numOr, str, toMin, toTime } from './util.js';

const CATEGORIES = new Set(['study', 'work', 'english', 'sport', 'home', 'other']);
const EVENT_KINDS = new Set(['tutor', 'work', 'other', 'sport', 'study', 'meal', 'rest', 'task']);
const MEALS = new Set(['breakfast', 'lunch', 'dinner', 'snack']);
const UNITS = new Set(['г', 'кг', 'шт', 'л', 'мл', 'уп', '']);

/** «1ч», «1,5 ч», «90 мин», «45» → минуты */
export function parseDurationMin(expr, fallback = 60) {
  const s = str(expr).toLowerCase().replace(',', '.');
  if (!s) return fallback;
  let total = 0;
  let found = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*(ч|час|h|мин|м|min|m)?/g)) {
    const n = Number(m[1]);
    if (!Number.isFinite(n)) continue;
    found = true;
    total += m[2] && /^(ч|час|h)/.test(m[2]) ? n * 60 : n;
  }
  return found && total > 0 ? Math.round(total) : fallback;
}

export function mealByTime(time) {
  const m = toMin(time);
  if (m < 11 * 60) return 'breakfast';
  if (m < 16 * 60) return 'lunch';
  if (m < 21 * 60) return 'dinner';
  return 'snack';
}

function macros(it) {
  const p = Math.max(0, numOr(it.p, 0));
  const f = Math.max(0, numOr(it.f, 0));
  const c = Math.max(0, numOr(it.c, 0));
  let kcal = Math.max(0, numOr(it.kcal, 0));
  if (!kcal) kcal = p * 4 + f * 9 + c * 4;
  const r1 = (x) => Math.round(x * 10) / 10;
  return { kcal: Math.round(kcal), p: r1(p), f: r1(f), c: r1(c) };
}

/** Приводим ответ нейросети к проверенному списку действий */
export function normalizeTgActions(raw, refs, { tutorMin = 60 } = {}) {
  const out = [];
  for (const a of Array.isArray(raw) ? raw : []) {
    if (!a || typeof a !== 'object') continue;
    const type = str(a.type).toLowerCase();
    if (type === 'add_task') {
      const title = str(a.title).slice(0, 150);
      if (!title) continue;
      const est = numOr(a.estimateMin);
      const estimateMin = est && est > 0 ? Math.round(est) : null;
      const reward = numOr(a.reward);
      out.push({
        type,
        title,
        category: CATEGORIES.has(a.category) ? a.category : 'other',
        deadline: isDate(a.deadline) ? a.deadline : null,
        priority: Math.min(3, Math.max(1, Math.round(numOr(a.priority, 2)))),
        estimateMin,
        complexity: numOr(a.complexity) ? Math.min(5, Math.max(1, Math.round(numOr(a.complexity)))) : null,
        reward: reward != null ? Math.min(150, Math.max(0, Math.round(reward))) : estimateMin ? Math.max(1, Math.round(estimateMin / 5)) : null,
        goalId: refs.resolve(a.goal ?? a.goalId) || null,
        context: str(a.context).slice(0, 1000),
      });
    } else if (type === 'add_event') {
      const date = str(a.date);
      const start = normTime(a.start);
      const title = str(a.title).slice(0, 120);
      if (!isDate(date) || !start || !title) continue;
      const kind = EVENT_KINDS.has(a.kind) ? a.kind : 'other';
      let end = normTime(a.end);
      if (!end || toMin(end) <= toMin(start)) end = toTime(Math.min(23 * 60 + 59, toMin(start) + (kind === 'tutor' ? tutorMin : 60)));
      out.push({ type, date, start, end, title, kind, notes: str(a.notes).slice(0, 300) });
    } else if (type === 'log_food') {
      const items = (Array.isArray(a.items) ? a.items : [])
        .map((it) => ({
          name: str(it?.name).slice(0, 120),
          grams: numOr(it?.grams) ? Math.round(numOr(it.grams)) : null,
          ...macros(it || {}),
          meal: MEALS.has(it?.meal) ? it.meal : null,
        }))
        .filter((it) => it.name);
      if (items.length) out.push({ type, items });
    } else if (type === 'add_fridge') {
      const items = (Array.isArray(a.items) ? a.items : [])
        .map((it) => ({
          name: str(it?.name).slice(0, 80),
          amount: numOr(it?.amount) || null,
          unit: UNITS.has(str(it?.unit)) ? str(it.unit) : '',
          expires: isDate(it?.expires) ? it.expires : null,
        }))
        .filter((it) => it.name);
      if (items.length) out.push({ type, items });
    } else if (type === 'add_note') {
      const text = str(a.text || a.title).slice(0, 4000);
      if (!text) continue;
      out.push({ type, title: str(a.title).slice(0, 120) || text.split('\n')[0].slice(0, 80), text });
    }
  }
  return out;
}

function remember(batchId, items) {
  const all = kv.get('tgBatches', {});
  all[batchId] = { at: Date.now(), items };
  const keys = Object.keys(all).sort((x, y) => all[x].at - all[y].at);
  while (keys.length > 100) delete all[keys.shift()];
  kv.set('tgBatches', all);
}

export function undoBatch(batchId) {
  const all = kv.get('tgBatches', {});
  const b = all[batchId];
  if (!b) return 0;
  return setDeleted(b.items, true);
}

const kcalLine = (items) => items.reduce((s, i) => s + i.kcal, 0);

/** Создаём записи (они приедут в телефон при синхронизации) и готовим текст ответа */
export function applyTgActions(actions, { original = '', from = '' } = {}) {
  const batchId = crypto.randomBytes(6).toString('hex');
  const now = Date.now();
  const today = localDateStr();
  const time = localTimeStr();
  const list = [];
  const lines = [];
  const origin = from ? `Из Telegram (переслано от ${from}): ${original}` : `Из Telegram: ${original}`;

  for (const a of actions) {
    if (a.type === 'add_task') {
      list.push({
        tbl: 'tasks',
        data: {
          title: a.title, category: a.category, deadline: a.deadline, priority: a.priority, estimateMin: a.estimateMin,
          complexity: a.complexity, reward: a.reward, goalId: a.goalId, status: 'todo', createdAt: now, source: 'telegram',
          context: [a.context, original && original !== a.title ? origin : ''].filter(Boolean).join('\n\n').slice(0, 2000),
        },
      });
      const parts = [`✅ Задача: <b>${esc(a.title)}</b>`];
      if (a.deadline) parts.push(`до ${fmtDay(a.deadline)}`);
      if (a.estimateMin) parts.push(`~${a.estimateMin >= 60 ? `${Math.round((a.estimateMin / 60) * 10) / 10} ч` : `${a.estimateMin} мин`}`);
      if (a.reward) parts.push(`🪙${a.reward}`);
      lines.push(parts.join(' · '));
    } else if (a.type === 'add_event') {
      list.push({
        tbl: 'events',
        data: {
          date: a.date, start: a.start, end: a.end, title: a.title, kind: a.kind, fixed: a.kind === 'tutor',
          source: a.kind === 'tutor' ? 'tutor' : 'manual', status: 'planned', notes: a.notes || (from ? `Переслано от ${from}` : ''),
          reward: a.kind === 'tutor' ? 8 : 5, batch: `tg-${batchId}`,
        },
      });
      let line = `📅 ${fmtDay(a.date)} ${a.start}–${a.end} · <b>${esc(a.title)}</b>`;
      const clash = classesForDates([a.date]).find((c) => toMin(c.start) < toMin(a.end) && toMin(a.start) < toMin(c.end));
      if (clash) line += `\n⚠️ Пересекается с парой «${esc(clash.title)}» ${clash.start}–${clash.end}`;
      lines.push(line);
    } else if (a.type === 'log_food') {
      for (const it of a.items) {
        list.push({
          tbl: 'food',
          data: { date: today, time, meal: it.meal || mealByTime(time), name: it.name, grams: it.grams, kcal: it.kcal, p: it.p, f: it.f, c: it.c, source: 'ai' },
        });
      }
      lines.push(`🍽 Записал: ${a.items.map((i) => esc(i.name) + (i.grams ? ` ${i.grams} г` : '')).join(', ')} — ${kcalLine(a.items)} ккал`);
    } else if (a.type === 'add_fridge') {
      for (const it of a.items) list.push({ tbl: 'fridge', data: { name: it.name, amount: it.amount, unit: it.unit, expires: it.expires } });
      lines.push(`🧊 В холодильник: ${a.items.map((i) => esc(i.name) + (i.amount ? ` ${i.amount} ${i.unit}`.trimEnd() : '')).join(', ')}`);
    } else if (a.type === 'add_note') {
      list.push({ tbl: 'notes', data: { title: a.title, text: a.text, source: 'telegram', from: from || null, createdAt: now } });
      lines.push(`📝 Заметка: <b>${esc(a.title)}</b>`);
    }
  }
  if (!list.length) return { batchId: null, lines, created: [] };
  const created = putMany(list).map(({ tbl, rec }) => ({ tbl, id: rec.id }));
  remember(batchId, created);
  return { batchId, lines, created };
}
