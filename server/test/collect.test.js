import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

// Поддельные SpeechKit и Vision OCR — проверяем, что запросы уходят в правильном формате
const yandexCalls = [];
const yandex = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    yandexCalls.push({ url: req.url, headers: req.headers, size: body.length, body: req.url.startsWith('/ocr') ? JSON.parse(body) : null });
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/stt')) return res.end(JSON.stringify({ result: 'кусок речи' }));
    return res.end(JSON.stringify({ result: { textAnnotation: { fullText: 'Эссе на 3 страницы до пятницы' } } }));
  });
});
await new Promise((r) => yandex.listen(0, '127.0.0.1', r));
after(() => yandex.close());
const Y = `http://127.0.0.1:${yandex.address().port}`;

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-collect-'));
process.env.APP_PASSWORD = 'test';
process.env.AI_PROVIDER = 'mock';
process.env.TELEGRAM_BOT_TOKEN = '123:test';
process.env.YANDEX_API_KEY = 'AQVNtest';
process.env.YANDEX_FOLDER_ID = 'b1gfolder';
process.env.SPEECHKIT_URL = `${Y}/stt`;
process.env.VISION_OCR_URL = `${Y}/ocr`;
process.env.INBOX_DEBOUNCE_MS = '40';
process.env.VK_GROUP_TOKEN = 'vk1.a.test';
process.env.VK_GROUP_ID = '123';

const { setTransport, setDownloader } = await import('../src/tgapi.js');
const sent = [];
setTransport(async (method, params) => {
  sent.push({ method, params });
  if (method === 'getMe') return { id: 1, username: 'test_bot' };
  return { message_id: sent.length };
});
setDownloader(async (fileId) => Buffer.from(`file-${fileId}`));

const { setMediaImpl, splitAudio, transcribe, recognizeImage } = await import('../src/media.js');
const { handleUpdate, pairCode, isCollecting } = await import('../src/telegram.js');
const { listRecords } = await import('../src/records.js');
const { filePath } = await import('../src/files.js');

const OWNER = 555;
let uid = 1;
const msg = (fields) => ({ update_id: uid++, message: { message_id: uid, date: 1793800000, chat: { id: OWNER, type: 'private' }, from: { id: OWNER, first_name: 'Тест' }, ...fields } });
const fwd = (fields) => msg({ forward_origin: { type: 'user', date: 1793790000, sender_user: { first_name: 'Анна', last_name: 'Петровна' } }, ...fields });
const lastText = () => [...sent].reverse().find((s) => s.method === 'sendMessage').params;

test('real Yandex request formats (SpeechKit, Vision OCR) and audio splitting with ffmpeg', async () => {
  const short = await transcribe(Buffer.from('OggS-fake'), { mime: 'audio/ogg', duration: 5 });
  assert.equal(short, 'кусок речи');
  const stt = yandexCalls.find((c) => c.url.startsWith('/stt'));
  assert.match(stt.url, /folderId=b1gfolder/);
  assert.match(stt.url, /lang=ru-RU/);
  assert.match(stt.url, /format=oggopus/);
  assert.equal(stt.headers.authorization, 'Api-Key AQVNtest');

  const text = await recognizeImage(Buffer.from('jpeg'), 'image/jpeg');
  assert.equal(text, 'Эссе на 3 страницы до пятницы');
  const ocr = yandexCalls.find((c) => c.url.startsWith('/ocr'));
  assert.equal(ocr.headers['x-folder-id'], 'b1gfolder');
  assert.equal(ocr.body.mimeType, 'JPEG');
  assert.deepEqual(ocr.body.languageCodes, ['ru', 'en']);
  assert.equal(ocr.body.content, Buffer.from('jpeg').toString('base64'));

  // длинное аудио (60 с mp3) → куски по 25 с в OGG Opus → три запроса к SpeechKit
  let hasFfmpeg = true;
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    hasFfmpeg = false;
  }
  if (!hasFfmpeg) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-a-'));
  const mp3 = path.join(dir, 'tone.mp3');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=60', '-c:a', 'libmp3lame', mp3]);
  const parts = await splitAudio(fs.readFileSync(mp3));
  assert.equal(parts.length, 3);
  assert.equal(parts[0].subarray(0, 4).toString(), 'OggS');
  const before = yandexCalls.filter((c) => c.url.startsWith('/stt')).length;
  const long = await transcribe(fs.readFileSync(mp3), { mime: 'audio/mpeg', duration: 60 });
  assert.equal(long, 'кусок речи кусок речи кусок речи');
  assert.equal(yandexCalls.filter((c) => c.url.startsWith('/stt')).length - before, 3);
});

test('pair the bot', async () => {
  await handleUpdate(msg({ text: `/start ${pairCode()}` }));
  assert.match(lastText().text, /подключён/);
  assert.ok(lastText().reply_markup.keyboard, 'main keyboard with buttons');
});

test('collect mode: forwarded text + photo + voice become ONE task with attachments', async () => {
  setMediaImpl({ stt: async () => 'Сделай, пожалуйста, эссе по праву, жду в пятницу', ocr: async () => 'Требования: 3 страницы, шрифт 14' });
  await handleUpdate(msg({ text: '📥 Собрать задачу' }));
  assert.equal(isCollecting(OWNER), true);
  assert.deepEqual(lastText().reply_markup.keyboard[0].map((b) => b.text), ['✅ Готово', '✖️ Отмена']);

  await handleUpdate(fwd({ text: 'Нужна помощь с эссе' }));
  await handleUpdate(fwd({ photo: [{ file_id: 'small', width: 90 }, { file_id: 'big', width: 1280 }], caption: 'вот требования' }));
  await handleUpdate(fwd({ voice: { file_id: 'v1', duration: 12, mime_type: 'audio/ogg' } }));
  assert.equal(listRecords('tasks').length, 0, 'nothing is processed until «Готово»');

  await handleUpdate(msg({ text: '✅ Готово' }));
  assert.equal(isCollecting(OWNER), false);
  const tasks = listRecords('tasks');
  assert.equal(tasks.length, 1, 'exactly one task');
  assert.equal(listRecords('notes').length, 0, 'extra actions from AI are ignored');
  const t = tasks[0];
  assert.match(t.context, /Требования: 3 страницы/);
  assert.match(t.context, /эссе по праву/);
  assert.match(t.context, /Анна Петровна/);
  const img = t.attachments.find((a) => a.kind === 'image');
  assert.ok(img && fs.existsSync(filePath(img.id)), 'image saved on the server');
  assert.equal(fs.readFileSync(filePath(img.id)).toString(), 'file-big', 'largest photo size downloaded');
  assert.ok(t.attachments.find((a) => a.kind === 'voice' && /эссе/.test(a.text)));
  const reply = lastText();
  assert.match(reply.text, /3 сообщения/);
  assert.match(reply.text, /1 голосовое/);
  assert.match(reply.text, /1 картинка/);
  assert.ok(reply.reply_markup.inline_keyboard[0][0].callback_data.startsWith('undo:'));
});

test('collect mode: cancel creates nothing, «Готово» without collecting is explained', async () => {
  const before = listRecords('tasks').length;
  await handleUpdate(msg({ text: '/collect' }));
  await handleUpdate(fwd({ text: 'что-то' }));
  await handleUpdate(msg({ text: '✖️ Отмена' }));
  assert.equal(listRecords('tasks').length, before);
  assert.match(lastText().text, /отменён/);
  await handleUpdate(msg({ text: '✅ Готово' }));
  assert.match(lastText().text, /ничего не собирается/);
});

test('normal mode: own voice is transcribed and processed as usual', async () => {
  setMediaImpl({ stt: async () => 'купил курицу и яйца' });
  const before = listRecords('fridge').length;
  await handleUpdate(msg({ voice: { file_id: 'v2', duration: 4, mime_type: 'audio/ogg' } }));
  assert.equal(listRecords('fridge').length, before + 1);
});

test('normal mode: photo album parts are handled together', async () => {
  setMediaImpl({ ocr: async () => 'идея: сайт-портфолио' });
  const before = listRecords('notes').length;
  const p1 = handleUpdate(msg({ media_group_id: 'g1', photo: [{ file_id: 'a1', width: 800 }], caption: 'идея' }));
  const p2 = handleUpdate(msg({ media_group_id: 'g1', photo: [{ file_id: 'a2', width: 800 }] }));
  await Promise.all([p1, p2]);
  const notes = listRecords('notes');
  assert.equal(notes.length, before + 1, 'one note for the whole album');
  assert.equal(notes.at(-1).attachments.filter((a) => a.kind === 'image').length, 2);
});

test('VK: several forwarded messages with photo and voice become one task', async () => {
  const { setVkTransport, setVkFileFetcher } = await import('../src/vkapi.js');
  const { handleVkUpdate, vkPairCode } = await import('../src/vk.js');
  setVkTransport(async (url) => {
    const method = url.split('/method/')[1];
    if (method === 'users.get') return { response: [{ id: 777, first_name: 'Анна', last_name: 'Петровна' }, { id: 555, first_name: 'Тест', last_name: '' }] };
    return { response: 1 };
  });
  setVkFileFetcher(async (u) => ({ buf: Buffer.from(`vk-${u}`), mime: u.includes('ogg') ? 'audio/ogg' : 'image/jpeg' }));
  setMediaImpl({ stt: async () => 'расшифровка из вк', ocr: async () => 'текст со скрина' });
  const vkMsg = (extra) => ({ type: 'message_new', object: { message: { id: 1, from_id: 555, peer_id: 555, date: 1793800000, text: '', fwd_messages: [], ...extra } } });
  await handleVkUpdate(vkMsg({ text: vkPairCode() }));
  const before = listRecords('tasks').length;
  await handleVkUpdate(
    vkMsg({
      fwd_messages: [
        { from_id: 777, date: 1793790000, text: 'Сделай доклад к среде' },
        { from_id: 777, date: 1793790060, text: '', attachments: [{ type: 'photo', photo: { sizes: [{ url: 'https://vk/s.jpg', width: 100, height: 100 }, { url: 'https://vk/x.jpg', width: 1280, height: 960 }] } }] },
        { from_id: 777, date: 1793790120, text: '', attachments: [{ type: 'audio_message', audio_message: { duration: 8, link_ogg: 'https://vk/a.ogg' } }] },
      ],
    }),
  );
  const tasks = listRecords('tasks');
  assert.equal(tasks.length, before + 1);
  const t = tasks.at(-1);
  assert.match(t.context, /расшифровка из вк/);
  assert.match(t.context, /текст со скрина/);
  assert.equal(fs.readFileSync(filePath(t.attachments.find((a) => a.kind === 'image').id)).toString(), 'vk-https://vk/x.jpg');
});
