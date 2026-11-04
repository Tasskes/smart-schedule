import webpush from 'web-push';
import { calSecret, safeEqual } from './auth.js';
import { config } from './config.js';
import { db, kv } from './db.js';
import { classesForDates } from './tulsu.js';
import { addDays, localDateStr, localTs, tzOffsetMin } from './time.js';
import { esc, sendToOwner, tgNotifyEnabled } from './tgapi.js';
import { sendVkToOwner, vkNotifyEnabled } from './vkapi.js';

let vapid = kv.get('vapid');
if (!vapid) {
  vapid = webpush.generateVAPIDKeys();
  kv.set('vapid', vapid);
}
webpush.setVapidDetails(config.vapidSubject, vapid.publicKey, vapid.privateKey);
export const vapidPublicKey = vapid.publicKey;

const subsAll = db.prepare('SELECT endpoint, data FROM push_subs');
const subsUpsert = db.prepare(
  'INSERT INTO push_subs (endpoint, data, created_at) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET data = excluded.data',
);
const subsDelete = db.prepare('DELETE FROM push_subs WHERE endpoint = ?');
const sentGet = db.prepare('SELECT 1 FROM sent WHERE key = ?');
const sentPut = db.prepare('INSERT OR IGNORE INTO sent (key, ts) VALUES (?, ?)');
const sentCleanup = db.prepare('DELETE FROM sent WHERE ts < ?');

export function subscriptionCount() {
  return subsAll.all().length;
}

export function addSubscription(sub) {
  if (!sub || typeof sub.endpoint !== 'string' || !sub.keys) throw new Error('Некорректная подписка');
  subsUpsert.run(sub.endpoint, JSON.stringify(sub), Date.now());
}

export function removeSubscription(endpoint) {
  subsDelete.run(String(endpoint || ''));
}

export async function sendToAll(payload) {
  const subs = subsAll.all();
  let ok = 0;
  await Promise.all(
    subs.map(async (row) => {
      try {
        await webpush.sendNotification(JSON.parse(row.data), JSON.stringify(payload), { TTL: 6 * 3600, urgency: 'high' });
        ok += 1;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) subsDelete.run(row.endpoint);
        else console.warn('[push] send failed', e.statusCode || '', e.body || e.message);
      }
    }),
  );
  return ok;
}

/** Уведомление: web push на телефон + (если включено) дубль в Telegram и ВКонтакте */
export async function notify(payload) {
  let n = await sendToAll(payload);
  if (tgNotifyEnabled()) {
    try {
      if (await sendToOwner(`🔔 <b>${esc(payload.title)}</b>${payload.body ? `\n${esc(payload.body)}` : ''}`)) n += 1;
    } catch (e) {
      console.warn('[tg] notify failed:', e.message);
    }
  }
  if (vkNotifyEnabled()) {
    try {
      if (await sendVkToOwner(`🔔 ${payload.title}${payload.body ? `\n${payload.body}` : ''}`)) n += 1;
    } catch (e) {
      console.warn('[vk] notify failed:', e.message);
    }
  }
  return n;
}

function once(key) {
  if (sentGet.get(key)) return false;
  sentPut.run(key, Date.now());
  return true;
}

// ---------- Повестка (то, что клиент рассчитал: дела, распорядок) ----------

export function saveAgenda(body) {
  const items = (Array.isArray(body?.items) ? body.items : [])
    .filter((it) => it && /^\d{4}-\d{2}-\d{2}$/.test(it.date) && /^\d{2}:\d{2}$/.test(it.start))
    .slice(0, 2000)
    .map((it) => ({
      uid: String(it.uid || `${it.date}-${it.start}-${it.title}`).slice(0, 200),
      date: it.date,
      start: it.start,
      end: /^\d{2}:\d{2}$/.test(it.end || '') ? it.end : it.start,
      title: String(it.title || '').slice(0, 200),
      kind: String(it.kind || 'other'),
      location: it.location ? String(it.location).slice(0, 200) : '',
      notes: it.notes ? String(it.notes).slice(0, 500) : '',
      remindMin: Number.isFinite(it.remindMin) ? it.remindMin : null,
    }));
  const agenda = {
    updatedAt: Date.now(),
    items,
    classRemindMin: Number.isFinite(body?.classRemindMin) ? body.classRemindMin : 15,
    hiddenClassIds: Array.isArray(body?.hiddenClassIds) ? body.hiddenClassIds.map(String).slice(0, 2000) : [],
    digest: body?.digest && typeof body.digest === 'object' ? body.digest : {},
  };
  if (Number.isFinite(body?.tzOffsetMin) && Math.abs(body.tzOffsetMin) <= 14 * 60) kv.set('tzOffsetMin', body.tzOffsetMin);
  kv.set('agenda', agenda);
  return agenda;
}

function classItems(dates, agenda) {
  const hidden = new Set(agenda?.hiddenClassIds || []);
  return classesForDates(dates)
    .filter((c) => !hidden.has(c.id))
    .map((c) => ({
      uid: `class-${c.id}`,
      date: c.date,
      start: c.start,
      end: c.end,
      title: c.title,
      kind: 'class',
      location: c.rooms.length > 3 ? `${c.rooms.slice(0, 2).join(', ')} и др.` : c.rooms.join(', '),
      notes: [c.kind, c.teachers.slice(0, 2).join(', ')].filter(Boolean).join(' · '),
      remindMin: agenda?.classRemindMin ?? 15,
    }));
}

export function itemsForDates(dates, agenda = kv.get('agenda', null)) {
  const set = new Set(dates);
  const own = (agenda?.items || []).filter((it) => set.has(it.date));
  return [...classItems(dates, agenda), ...own].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

// ---------- Напоминания ----------

export async function reminderTick(now = Date.now()) {
  const agenda = kv.get('agenda', null);
  const today = localDateStr(now);
  const tomorrow = addDays(today, 1);
  const items = itemsForDates([today, tomorrow], agenda);
  let sent = 0;
  for (const it of items) {
    if (it.remindMin == null || it.remindMin < 0) continue;
    const startTs = localTs(it.date, it.start);
    const fireAt = startTs - it.remindMin * 60000;
    if (fireAt > now || fireAt < now - 15 * 60000) continue;
    if (!once(`r|${it.uid}|${it.date}|${it.start}`)) continue;
    const title = it.remindMin > 0 ? `Через ${it.remindMin} мин: ${it.title}` : it.title;
    const body = [`${it.start}–${it.end}`, it.location, it.notes].filter(Boolean).join(' · ');
    sent += await notify({ title, body, tag: it.uid, url: `/?date=${it.date}` });
  }

  // Утренняя сводка
  const digestTime = agenda?.digest?.[today];
  if (digestTime && /^\d{2}:\d{2}$/.test(digestTime)) {
    const at = localTs(today, digestTime);
    if (now >= at && now < at + 60 * 60000 && once(`d|${today}`)) {
      const todays = itemsForDates([today], agenda);
      const classes = todays.filter((i) => i.kind === 'class');
      const rest = todays.filter((i) => i.kind !== 'class' && i.kind !== 'routine' && i.kind !== 'sleep');
      const parts = [];
      parts.push(classes.length ? `Пар: ${classes.length} (первая в ${classes[0].start})` : 'Пар нет');
      if (rest.length) parts.push(`Дел в плане: ${rest.length}. Первое: ${rest[0].start} ${rest[0].title}`);
      sent += await notify({ title: 'Доброе утро! План на сегодня', body: parts.join('. '), tag: `digest-${today}`, url: '/' });
    }
  }
  sentCleanup.run(now - 4 * 86400000);
  return sent;
}

export function startReminderLoop() {
  const run = () => reminderTick().catch((e) => console.error('[push] tick failed', e));
  setInterval(run, 30000).unref();
  run();
}

// ---------- Подписной календарь (.ics) для «Календаря» iPhone ----------

const icsEscape = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

function fold(line) {
  // RFC 5545: строки не длиннее 75 байт
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > 73) {
      out.push(cur);
      cur = ' ' + ch;
      bytes = 1 + b;
    } else {
      cur += ch;
      bytes += b;
    }
  }
  out.push(cur);
  return out.join('\r\n');
}

const icsTime = (ts) => new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function buildIcs(now = Date.now()) {
  const today = localDateStr(now);
  const dates = [];
  for (let i = -7; i <= 30; i += 1) dates.push(addDays(today, i));
  const items = itemsForDates(dates);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SmartSchedule//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Распорядок',
    'REFRESH-INTERVAL;VALUE=DURATION:PT30M',
    'X-PUBLISHED-TTL:PT30M',
  ];
  const stamp = icsTime(now);
  for (const it of items) {
    const start = localTs(it.date, it.start);
    let end = localTs(it.date, it.end || it.start);
    if (end <= start) end = start + 5 * 60000;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${icsEscape(it.uid)}-${it.date}@smart-schedule`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${icsTime(start)}`);
    lines.push(`DTEND:${icsTime(end)}`);
    lines.push(`SUMMARY:${icsEscape(it.title)}`);
    if (it.location) lines.push(`LOCATION:${icsEscape(it.location)}`);
    if (it.notes) lines.push(`DESCRIPTION:${icsEscape(it.notes)}`);
    if (it.remindMin != null && it.remindMin >= 0) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(it.title)}`, `TRIGGER:-PT${Math.round(it.remindMin)}M`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function icsHandler(req, res) {
  const secret = String(req.params.file || '').replace(/\.ics$/, '');
  if (!secret || !safeEqual(secret, calSecret())) return res.status(404).send('Not found');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(buildIcs());
}

export function calendarPath() {
  return `/cal/${calSecret()}.ics`;
}

export { tzOffsetMin };
