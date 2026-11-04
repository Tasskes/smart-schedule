import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-test-'));
process.env.APP_PASSWORD = 'test';
process.env.TZ_OFFSET_MIN = '180';

const fixtures = path.join(import.meta.dirname, 'fixtures');
const raw = JSON.parse(fs.readFileSync(path.join(fixtures, 'schedule-nov.json'), 'utf8'));

const { normalizeSchedule, diffSchedules, describeChange, normalizePeriods } = await import('../src/tulsu.js');
const { applySync } = await import('../src/sync.js');
const { buildIcs, saveAgenda, itemsForDates } = await import('../src/push.js');
const { mockComplete } = await import('../src/ai/mock.js');
const { kv } = await import('../src/db.js');
const { localTs } = await import('../src/time.js');

test('normalize merges PE rooms into one class', () => {
  const classes = normalizeSchedule(raw);
  const nov2 = classes.filter((c) => c.date === '2026-11-02');
  assert.equal(nov2.length, 3);
  const pe = nov2.find((c) => c.title.startsWith('Физическая культура'));
  assert.ok(pe.rooms.length > 5, 'PE has many rooms');
  assert.equal(pe.start, '11:35');
  assert.equal(pe.end, '13:10');
  const ids = new Set(classes.map((c) => c.id));
  assert.equal(ids.size, classes.length, 'ids are unique');
});

test('periods are parsed', () => {
  const p = normalizePeriods(JSON.parse(fs.readFileSync(path.join(fixtures, 'calendar.json'), 'utf8')));
  assert.ok(p.find((x) => x.title.includes('сессия') && x.begin === '2026-12-23'));
});

test('diff detects removed, added, moved and room changes', () => {
  const before = normalizeSchedule(raw);
  const after = structuredClone(before);
  // отменяем пару 03.11 13:40
  const idx = after.findIndex((c) => c.date === '2026-11-03' && c.start === '13:40');
  const removed = after.splice(idx, 1)[0];
  // переносим пару 05.11 09:40 на 06.11 09:40
  const mv = after.find((c) => c.date === '2026-11-05' && c.start === '09:40');
  mv.date = '2026-11-06';
  // меняем аудиторию 02.11 09:40
  after.find((c) => c.date === '2026-11-02' && c.start === '09:40').rooms = ['5-101'];
  // добавляем новую пару
  after.push({ id: 'x', date: '2026-11-07', start: '09:40', end: '11:15', title: 'Новая дисциплина', kind: 'Лекции', rooms: ['1-1'], teachers: [], notes: [] });

  const changes = diffSchedules(before, after, '2026-11-01', '2026-11-15');
  const types = changes.map((c) => c.type).sort();
  assert.deepEqual(types, ['added', 'moved', 'removed', 'room']);
  const rem = changes.find((c) => c.type === 'removed');
  assert.equal(rem.title, removed.title);
  assert.match(describeChange(changes.find((c) => c.type === 'moved')), /Чт 05\.11 09:40 → Пт 06\.11 09:40/);
});

test('sync: last write wins and pull returns other changes', () => {
  const a = applySync({ since: 0, changes: [{ tbl: 'tasks', id: 't1', updatedAt: 100, data: { id: 't1', title: 'A' } }] });
  assert.equal(a.accepted, 1);
  assert.match(a.serverId, /^[0-9a-f]{16}$/);
  // более старая версия отклоняется
  const b = applySync({ since: a.seq, changes: [{ tbl: 'tasks', id: 't1', updatedAt: 50, data: { id: 't1', title: 'old' } }] });
  assert.equal(b.accepted, 0);
  // второе устройство получает запись
  const c = applySync({ since: 0, changes: [] });
  assert.equal(c.changes.length, 1);
  assert.equal(c.changes[0].data.title, 'A');
  // неизвестные таблицы игнорируются
  const d = applySync({ since: c.seq, changes: [{ tbl: 'evil', id: 'x', updatedAt: 1, data: {} }] });
  assert.equal(d.accepted, 0);
});

test('agenda + ics include classes and own items with alarms', () => {
  kv.set('schedule', { classes: normalizeSchedule(raw), periods: [], hash: 'h' });
  saveAgenda({
    tzOffsetMin: 180,
    classRemindMin: 20,
    items: [{ uid: 'event:1', date: '2026-11-05', start: '18:00', end: '19:00', title: 'Репетитор, английский', kind: 'tutor', remindMin: 10 }],
  });
  const items = itemsForDates(['2026-11-05']);
  assert.ok(items.find((i) => i.kind === 'class'));
  assert.ok(items.find((i) => i.title.startsWith('Репетитор')));
  const ics = buildIcs(localTs('2026-11-04', '12:00'));
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /SUMMARY:Репетитор\\, английский/);
  assert.match(ics, /TRIGGER:-PT20M/);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, `line too long: ${line}`);
});

test('mock AI produces a plan inside free windows', async () => {
  const data = {
    mode: 'plan',
    targetDays: ['2026-11-05'],
    days: [{ date: '2026-11-05', free: [['15:00', '18:00'], ['19:00', '22:00']] }],
    tasks: [{ id: 'tabc', title: 'Курсовая', cat: 'study', left: 120 }],
  };
  const out = await mockComplete({ messages: [{ role: 'user', content: `план\n<данные>${JSON.stringify(data)}</данные>` }] });
  const parsed = JSON.parse(out.text);
  assert.equal(parsed.actions[0].type, 'plan');
  assert.ok(parsed.actions[0].days[0].items.length >= 2);
});
