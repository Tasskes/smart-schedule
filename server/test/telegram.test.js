import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-tg-'));
process.env.APP_PASSWORD = 'test';
process.env.AI_PROVIDER = 'mock';
process.env.TELEGRAM_BOT_TOKEN = '123:test';
process.env.TZ_OFFSET_MIN = '180';

const { setTransport } = await import('../src/tgapi.js');
const sent = [];
setTransport(async (method, params) => {
  sent.push({ method, params });
  if (method === 'getMe') return { id: 1, username: 'raspisanie_test_bot' };
  return { message_id: sent.length };
});

const { handleUpdate, pairCode, tgStatus } = await import('../src/telegram.js');
const { normalizeTgActions, parseDurationMin } = await import('../src/tgactions.js');
const { listRecords } = await import('../src/records.js');
const { applySync } = await import('../src/sync.js');
const { RefMap } = await import('../src/util.js');
const { localDateStr, addDays } = await import('../src/time.js');

const OWNER = 555;
const msg = (text, extra = {}) => ({ update_id: Math.floor(Math.random() * 1e9), message: { message_id: 7, chat: { id: OWNER, type: 'private' }, from: { id: OWNER, first_name: 'Тест' }, text, ...extra } });
const lastSend = () => [...sent].reverse().find((s) => s.method === 'sendMessage');

test('pairing requires the one-time code', async () => {
  await handleUpdate(msg('/start wrongcode'));
  assert.match(lastSend().params.text, /личный бот/);
  assert.equal(tgStatus().linked, false);
  await handleUpdate(msg(`/start ${pairCode()}`));
  assert.equal(tgStatus().linked, true);
  assert.match(lastSend().params.text, /подключён/);
});

test('strangers are ignored after pairing', async () => {
  const before = sent.length;
  await handleUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 999, type: 'private' }, text: 'привет' } });
  assert.equal(sent.length, before);
});

test('a plain message becomes a task with an undo button, and sync delivers it', async () => {
  await handleUpdate(msg('Сделать реферат по конституционному праву'));
  const reply = lastSend().params;
  assert.match(reply.text, /Задача/);
  assert.match(reply.reply_markup.inline_keyboard[0][0].callback_data, /^undo:/);
  const tasks = listRecords('tasks');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].source, 'telegram');
  assert.equal(tasks[0].status, 'todo');
  // телефон получит задачу при синхронизации
  const pulled = applySync({ since: 0, changes: [] }).changes.filter((c) => c.tbl === 'tasks');
  assert.equal(pulled.length, 1);

  // отмена
  const data = reply.reply_markup.inline_keyboard[0][0].callback_data;
  await handleUpdate({ update_id: 2, callback_query: { id: 'q1', data, message: { message_id: 9, chat: { id: OWNER } } } });
  assert.equal(listRecords('tasks').length, 0);
});

test('forwarded tutor message becomes a fixed event, food and fridge are logged', async () => {
  await handleUpdate(msg('Давай завтра в 18:00, как обычно', { forward_origin: { type: 'user', sender_user: { first_name: 'Анна', last_name: 'Петровна' } } }));
  const ev = listRecords('events');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].kind, 'tutor');
  assert.equal(ev[0].fixed, true);
  assert.equal(ev[0].end, '19:00');
  assert.equal(ev[0].date, addDays(localDateStr(), 1));
  assert.match(ev[0].notes, /Анна Петровна/);

  await handleUpdate(msg('съел гречку на обед'));
  assert.equal(listRecords('food').length, 1);
  await handleUpdate(msg('купил курицу'));
  assert.equal(listRecords('fridge').length, 1);
  await handleUpdate(msg('идея: сделать сайт-портфолио'));
  assert.equal(listRecords('notes').length, 1);
});

test('questions get an answer without creating records', async () => {
  const before = listRecords('tasks').length;
  await handleUpdate(msg('что у меня завтра?'));
  assert.match(lastSend().params.text, /Завтра/);
  assert.equal(listRecords('tasks').length, before);
});

test('/today command works', async () => {
  await handleUpdate(msg('/today'));
  assert.match(lastSend().params.text, /📅/);
});

test('normalization drops invalid actions and fixes times', () => {
  const refs = new RefMap();
  const actions = normalizeTgActions(
    [
      { type: 'add_event', date: '2026-13-01', start: '18:00', title: 'x' },
      { type: 'add_event', date: '2026-11-06', start: '18:00', end: '17:00', title: 'Репетитор', kind: 'tutor' },
      { type: 'add_task', title: '', estimateMin: 30 },
      { type: 'add_task', title: 'Курсовая', estimateMin: '90', category: 'nope' },
      { type: 'unknown' },
    ],
    refs,
    { tutorMin: 90 },
  );
  assert.equal(actions.length, 2);
  assert.equal(actions[0].end, '19:30');
  assert.equal(actions[1].category, 'other');
  assert.equal(actions[1].reward, 18);
  assert.equal(parseDurationMin('1ч 30м'), 90);
  assert.equal(parseDurationMin('1,5 ч'), 90);
  assert.equal(parseDurationMin('45 мин'), 45);
  assert.equal(parseDurationMin(''), 60);
});
