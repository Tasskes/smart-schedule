import crypto from 'node:crypto';
import { config } from './config.js';
import { db, kv } from './db.js';
import { addDays, fmtDay, localDateStr } from './time.js';

const listeners = [];
export function onScheduleChanges(fn) {
  listeners.push(fn);
}

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex');

function toIsoDate(dmy) {
  const [d, m, y] = String(dmy).trim().split('.');
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// Сайт отдаёт по строке на каждую аудиторию (у физкультуры их ~20 в одно время).
// Склеиваем их в одну пару со списком аудиторий.
export function normalizeSchedule(raw) {
  const map = new Map();
  for (const it of Array.isArray(raw) ? raw : []) {
    if (!it || !it.DATE_Z || !it.TIME_Z) continue;
    const date = toIsoDate(it.DATE_Z);
    const [start, end] = String(it.TIME_Z).split('-').map((s) => s.trim());
    if (!/^\d{1,2}:\d{2}$/.test(start || '') || !/^\d{1,2}:\d{2}$/.test(end || '')) continue;
    const title = String(it.DISCIP || 'Пара').trim();
    const kind = String(it.KOW || '').trim();
    const key = `${date}|${start}|${title}|${kind}`;
    let c = map.get(key);
    if (!c) {
      c = {
        id: hash(key).slice(0, 12),
        date,
        start: start.padStart(5, '0'),
        end: end.padStart(5, '0'),
        title,
        kind,
        type: String(it.CLASS || ''),
        rooms: [],
        teachers: [],
        notes: [],
      };
      map.set(key, c);
    }
    const room = String(it.AUD || '').trim();
    if (room && !c.rooms.includes(room)) c.rooms.push(room);
    const prep = String(it.PREP || '').trim();
    if (prep && !c.teachers.includes(prep)) c.teachers.push(prep);
    for (const g of it.GROUPS || []) {
      const note = String(g?.PRIM || '').trim();
      if (note && !c.notes.includes(note)) c.notes.push(note);
    }
  }
  return [...map.values()].sort((a, b) => (a.date + a.start + a.title).localeCompare(b.date + b.start + b.title));
}

export function normalizePeriods(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((p) => p && p.BEGIN_DATE && p.END_DATE)
    .map((p) => ({ begin: toIsoDate(p.BEGIN_DATE), end: toIsoDate(p.END_DATE), title: String(p.VID || '').trim() }));
}

const slotKey = (c) => `${c.date}|${c.start}|${c.title}|${c.kind}`;

export function diffSchedules(oldList, newList, from, to) {
  const inRange = (c) => c.date >= from && c.date <= to;
  const before = oldList.filter(inRange);
  const after = newList.filter(inRange);
  const beforeMap = new Map(before.map((c) => [slotKey(c), c]));
  const afterMap = new Map(after.map((c) => [slotKey(c), c]));
  const removed = before.filter((c) => !afterMap.has(slotKey(c)));
  const added = after.filter((c) => !beforeMap.has(slotKey(c)));
  const changes = [];

  for (const c of after) {
    const prev = beforeMap.get(slotKey(c));
    if (!prev) continue;
    const a = prev.rooms.join(', ');
    const b = c.rooms.join(', ');
    if (a !== b && c.rooms.length <= 3 && prev.rooms.length <= 3) {
      changes.push({ type: 'room', date: c.date, start: c.start, title: c.title, kind: c.kind, from: a, to: b });
    }
  }

  const used = new Set();
  for (const r of removed) {
    const sameDay = added.find((x) => !used.has(x) && x.title === r.title && x.kind === r.kind && x.date === r.date);
    const any = sameDay || added.find((x) => !used.has(x) && x.title === r.title && x.kind === r.kind);
    if (any) {
      used.add(any);
      changes.push({
        type: 'moved', title: r.title, kind: r.kind,
        fromDate: r.date, fromStart: r.start, date: any.date, start: any.start, end: any.end,
      });
    } else {
      changes.push({ type: 'removed', date: r.date, start: r.start, end: r.end, title: r.title, kind: r.kind });
    }
  }
  for (const a of added) {
    if (!used.has(a)) changes.push({ type: 'added', date: a.date, start: a.start, end: a.end, title: a.title, kind: a.kind });
  }
  return changes.sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start));
}

export function describeChange(c) {
  const name = c.kind ? `${c.title} (${c.kind})` : c.title;
  switch (c.type) {
    case 'added':
      return `${fmtDay(c.date)} ${c.start} — добавлена: ${name}`;
    case 'removed':
      return `${fmtDay(c.date)} ${c.start} — отменена: ${name}`;
    case 'moved':
      return `${name}: ${fmtDay(c.fromDate)} ${c.fromStart} → ${fmtDay(c.date)} ${c.start}`;
    case 'room':
      return `${fmtDay(c.date)} ${c.start} ${c.title}: ауд. ${c.from || '—'} → ${c.to || '—'}`;
    default:
      return c.title;
  }
}

async function fetchJSON(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SmartSchedule/1.0)', Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Сайт ТулГУ ответил ${res.status}`);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Сайт ТулГУ вернул не JSON');
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchSchedule(group = config.tulsu.group) {
  const base = config.tulsu.base;
  const q = encodeURIComponent(group);
  const dates = await fetchJSON(`${base}/GetDates.php?search_value=${q}`);
  if (!dates || !dates.MIN_DATE) throw new Error(`Расписание для «${group}» не найдено`);
  const field = encodeURIComponent(dates.SEARCH_FIELD || 'GROUP_P');
  const raw = await fetchJSON(`${base}/GetSchedule.php?search_field=${field}&search_value=${q}`);
  let periods = [];
  try {
    periods = normalizePeriods(await fetchJSON(`${base}/GetCalendar.php?search_value=${q}`));
  } catch {
    /* график сессии не обязателен */
  }
  return {
    group,
    minDate: String(dates.MIN_DATE).slice(0, 10),
    maxDate: String(dates.MAX_DATE).slice(0, 10),
    classes: normalizeSchedule(raw),
    periods,
  };
}

export function getSnapshot() {
  return kv.get('schedule', null);
}

const insertChange = db.prepare('INSERT INTO schedule_changes (ts, data) VALUES (?, ?)');
const recentChangesStmt = db.prepare('SELECT id, ts, data FROM schedule_changes WHERE ts > ? ORDER BY id DESC LIMIT 100');

export function recentChanges(days = 21) {
  return recentChangesStmt
    .all(Date.now() - days * 86400000)
    .map((r) => ({ id: r.id, ts: r.ts, ...JSON.parse(r.data) }));
}

let refreshing = null;

// Сайт ТулГУ иногда (например, ночью во время обновления базы) отдаёт пустое расписание.
// Если раньше пары были, пустому ответу не верим сразу — иначе пришли бы уведомления
// «отменена» по всем парам, а через полчаса «добавлена». Принимаем пустоту, только если она держится сутки.
export const EMPTY_TRUST_MS = 24 * 3600000;

export function refreshSchedule() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const prev = getSnapshot();
    try {
      const fresh = await fetchSchedule();
      if (!fresh.classes.length && prev?.classes?.length) {
        const emptySince = prev.emptySince || Date.now();
        if (Date.now() - emptySince < EMPTY_TRUST_MS) {
          const err = new Error('сайт вернул пустое расписание — показываю последнее сохранённое');
          err.emptySince = emptySince;
          throw err;
        }
      }
      const h = hash(JSON.stringify([fresh.classes, fresh.periods])).slice(0, 16);
      const snapshot = { ...fresh, hash: h, fetchedAt: Date.now(), lastAttempt: Date.now(), error: null };
      if (prev && prev.hash !== h && Array.isArray(prev.classes) && prev.classes.length) {
        const today = localDateStr();
        const changes = diffSchedules(prev.classes, fresh.classes, today, addDays(today, 14));
        if (changes.length) {
          const ts = Date.now();
          for (const c of changes) insertChange.run(ts, JSON.stringify({ ...c, text: describeChange(c) }));
          for (const fn of listeners) {
            try {
              await fn(changes.map((c) => ({ ...c, text: describeChange(c) })));
            } catch (e) {
              console.error('schedule listener failed', e);
            }
          }
        }
      }
      kv.set('schedule', snapshot);
      return snapshot;
    } catch (e) {
      const failed = { ...(prev || { group: config.tulsu.group, classes: [], periods: [] }), lastAttempt: Date.now(), error: String(e.message || e) };
      if (e.emptySince) failed.emptySince = e.emptySince;
      kv.set('schedule', failed);
      console.warn('[tulsu] fetch failed:', failed.error);
      return failed;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export function startSchedulePolling() {
  if (config.tulsu.disabled) return;
  const snap = getSnapshot();
  const stale = !snap || !snap.fetchedAt || Date.now() - snap.fetchedAt > config.tulsu.pollMin * 60000;
  if (stale) refreshSchedule();
  setInterval(() => refreshSchedule(), config.tulsu.pollMin * 60000).unref();
}

export function classesForDates(dates) {
  const snap = getSnapshot();
  if (!snap?.classes) return [];
  const set = new Set(dates);
  return snap.classes.filter((c) => set.has(c.date));
}
