import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-vk-'));
process.env.APP_PASSWORD = 'test';
process.env.AI_PROVIDER = 'mock';
process.env.VK_GROUP_TOKEN = 'vk1.a.test';
process.env.VK_GROUP_ID = 'club123';
process.env.TZ_OFFSET_MIN = '180';

const { setVkTransport } = await import('../src/vkapi.js');
const calls = [];
setVkTransport(async (url, init) => {
  const method = url.split('/method/')[1];
  const params = Object.fromEntries(new URLSearchParams(init.body));
  calls.push({ method, params });
  switch (method) {
    case 'groups.getById':
      return { response: { groups: [{ id: 123, name: 'Распорядок', screen_name: 'raspisanie' }] } };
    case 'users.get':
      return { response: [{ id: 555, first_name: 'Тест', last_name: 'Тестов' }, { id: 777, first_name: 'Анна', last_name: 'Петровна' }] };
    case 'messages.send':
      return { response: 1 };
    default:
      return { response: 1 };
  }
});

const { handleVkUpdate, vkStatus } = await import('../src/vk.js');
const { listRecords } = await import('../src/records.js');
const { localDateStr, addDays } = await import('../src/time.js');
const { config } = await import('../src/config.js');

const OWNER = 555;
const sends = () => calls.filter((c) => c.method === 'messages.send');
const lastSend = () => sends().at(-1).params;
const msg = (text, extra = {}) => ({ type: 'message_new', object: { message: { id: 1, from_id: OWNER, peer_id: OWNER, text, fwd_messages: [], ...extra } } });

test('group id is normalized and status shows a pairing code', () => {
  assert.equal(config.vk.groupId, '123');
  const st = vkStatus();
  assert.equal(st.configured, true);
  assert.equal(st.linked, false);
  assert.match(st.code, /^\d{6}$/);
  assert.equal(st.link, 'https://vk.me/club123');
});

test('pairing with the code from the app', async () => {
  await handleVkUpdate(msg('привет'));
  assert.match(lastSend().message, /личный бот/);
  const code = vkStatus().code;
  await handleVkUpdate(msg(`код ${code}`));
  assert.equal(vkStatus().linked, true);
  assert.equal(vkStatus().ownerName, 'Тест Тестов');
  assert.match(lastSend().message, /подключён/);
  assert.doesNotMatch(lastSend().message, /<b>/, 'no HTML in VK messages');
});

test('strangers and group chats are ignored', async () => {
  const before = sends().length;
  await handleVkUpdate({ type: 'message_new', object: { message: { from_id: 999, peer_id: 999, text: 'привет' } } });
  await handleVkUpdate({ type: 'message_new', object: { message: { from_id: OWNER, peer_id: 2000000001, text: 'в беседе' } } });
  assert.equal(sends().length, before);
});

test('forwarded tutor message from VK becomes a tutor lesson with undo', async () => {
  await handleVkUpdate(msg('', { fwd_messages: [{ from_id: 777, text: 'Давай завтра в 18:00, как обычно' }] }));
  const ev = listRecords('events');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].kind, 'tutor');
  assert.equal(ev[0].date, addDays(localDateStr(), 1));
  assert.match(ev[0].notes, /Анна Петровна/);
  const sent = lastSend();
  assert.match(sent.message, /Репетитор/);
  const kb = JSON.parse(sent.keyboard);
  const payload = JSON.parse(kb.buttons[0][0].action.payload);
  assert.ok(payload.undo);

  // нажатие «Отменить»
  await handleVkUpdate({ type: 'message_event', object: { user_id: OWNER, peer_id: OWNER, event_id: 'e1', payload } });
  assert.equal(listRecords('events').length, 0);
  assert.ok(calls.find((c) => c.method === 'messages.sendMessageEventAnswer'));
});

test('plain message becomes a task, commands work, voice transcript is used', async () => {
  await handleVkUpdate(msg('Сделать курсовую по экономике'));
  assert.equal(listRecords('tasks').length, 1);
  await handleVkUpdate(msg('задачи'));
  assert.match(lastSend().message, /Открытые задачи/);
  await handleVkUpdate(msg('сегодня'));
  assert.match(lastSend().message, /📅/);
  await handleVkUpdate(msg('', { attachments: [{ type: 'audio_message', audio_message: { transcript: 'съел гречку на обед' } }] }));
  assert.equal(listRecords('food').length, 1);
});

test('long poll loop receives updates and refreshes an expired key', async () => {
  const { startVkBot } = await import('../src/vk.js');
  let polls = 0;
  let keys = 0;
  const seen = [];
  setVkTransport(async (url, init) => {
    if (url.includes('a_check')) {
      polls += 1;
      if (polls === 1) return { failed: 2 }; // ключ устарел
      if (polls === 2) return { ts: '11', updates: [msg('завтра')] };
      return new Promise(() => {}); // дальше «висим», как настоящий long poll
    }
    const method = url.split('/method/')[1];
    seen.push(method);
    if (method === 'groups.getLongPollServer') {
      keys += 1;
      return { response: { server: 'https://lp.vk.com/wh123', key: `k${keys}`, ts: '10' } };
    }
    if (method === 'groups.getById') return { response: { groups: [{ id: 123, name: 'Распорядок', screen_name: 'raspisanie' }] } };
    return { response: 1 };
  });
  void startVkBot();
  for (let i = 0; i < 50 && !seen.includes('messages.send'); i += 1) await new Promise((r) => setTimeout(r, 20));
  assert.equal(keys, 2, 'requested a new key after failed=2');
  assert.ok(seen.includes('messages.send'), 'answered the message from long poll');
  assert.equal(vkStatus().link, 'https://vk.me/raspisanie');
});

test('non-JSON answers (proxies, firewalls) give a readable error instead of a crash', async () => {
  const { vk, setVkTransport: set } = await import('../src/vkapi.js');
  set(async () => {
    throw new Error('ВКонтакте ответил не JSON (HTTP 403): Blocked');
  });
  await assert.rejects(() => vk('groups.getById', {}), /не JSON/);
  set(async () => ({}));
  await assert.rejects(() => vk('groups.getById', {}), /неожиданный ответ/);
});
