import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

// Поддельный сайт ТулГУ: отдаёт расписание из фикстуры или «пустое», как бывает ночью.
const fixtures = path.join(import.meta.dirname, 'fixtures');
const schedule = fs.readFileSync(path.join(fixtures, 'schedule-nov.json'), 'utf8');
const calendar = fs.readFileSync(path.join(fixtures, 'calendar.json'), 'utf8');
let siteMode = 'ok';

const site = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('Content-Type', 'application/json');
  if (url.pathname.endsWith('/GetDates.php')) {
    const empty = siteMode === 'no-dates';
    return res.end(JSON.stringify({ MIN_DATE: empty ? '' : '2026-09-01 00:00:00', MAX_DATE: empty ? '' : '2026-12-31 00:00:00', SEARCH_FIELD: 'GROUP_P' }));
  }
  if (url.pathname.endsWith('/GetSchedule.php')) return res.end(siteMode === 'ok' ? schedule : '[]');
  if (url.pathname.endsWith('/GetCalendar.php')) return res.end(calendar);
  res.statusCode = 404;
  res.end('{}');
});
await new Promise((r) => site.listen(0, '127.0.0.1', r));
after(() => site.close());

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-tulsu-'));
process.env.APP_PASSWORD = 'test';
process.env.TULSU_BASE = `http://127.0.0.1:${site.address().port}/schedule/queries`;

const { refreshSchedule, getSnapshot, onScheduleChanges, EMPTY_TRUST_MS } = await import('../src/tulsu.js');
const { kv } = await import('../src/db.js');

const notified = [];
onScheduleChanges((changes) => notified.push(changes));

test('a temporarily empty TulSU answer keeps the saved schedule and sends no notifications', async () => {
  siteMode = 'ok';
  const first = await refreshSchedule();
  assert.equal(first.error, null);
  const count = first.classes.length;
  assert.ok(count > 10, 'fixture schedule loaded');

  // «даты есть, а пар нет» — не верим
  siteMode = 'empty-classes';
  const s1 = await refreshSchedule();
  assert.equal(s1.classes.length, count, 'classes are kept');
  assert.match(s1.error, /пустое расписание/);
  assert.ok(s1.emptySince > 0);
  const since = s1.emptySince;

  // «даты пустые» (то, что сайт отдаёт ночью) — тоже держим прежнее, отметка пустоты не сбрасывается
  siteMode = 'no-dates';
  const s2 = await refreshSchedule();
  assert.equal(s2.classes.length, count);
  assert.match(s2.error, /не найдено/);
  assert.equal(s2.emptySince, since);
  assert.equal(notified.length, 0, 'no «cancelled» notifications');

  // сайт ожил — всё как было, без уведомлений и без отметки пустоты
  siteMode = 'ok';
  const s3 = await refreshSchedule();
  assert.equal(s3.error, null);
  assert.equal(s3.classes.length, count);
  assert.equal(s3.emptySince, undefined);
  assert.equal(notified.length, 0);
});

test('an empty schedule is accepted once it has stayed empty for a day', async () => {
  siteMode = 'empty-classes';
  await refreshSchedule();
  kv.set('schedule', { ...getSnapshot(), emptySince: Date.now() - EMPTY_TRUST_MS - 1000 });
  const s = await refreshSchedule();
  assert.equal(s.error, null);
  assert.equal(s.classes.length, 0);
});
