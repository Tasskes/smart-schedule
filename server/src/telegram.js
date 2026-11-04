import crypto from 'node:crypto';
import { safeEqual } from './auth.js';
import { config } from './config.js';
import { buildConversation, hasMedia, plainText } from './convo.js';
import { kv } from './db.js';
import { helpText, planText, processConversation, processInbox, tasksText } from './inbox.js';
import { addDays, localDateStr, localTimeStr } from './time.js';
import { undoBatch } from './tgactions.js';
import { esc, owner, tg, tgDownload, tgEnabled } from './tgapi.js';



const HELP = helpText('tg');

let me = null;
let lastError = null;
let running = false;

export function pairCode() {
  let c = kv.get('tgCode', null);
  if (!c) {
    c = crypto.randomBytes(6).toString('hex');
    kv.set('tgCode', c);
  }
  return c;
}

export function tgStatus() {
  const o = owner();
  return {
    configured: tgEnabled(),
    username: me?.username || null,
    linked: !!o,
    ownerName: o?.name || null,
    startLink: me?.username && !o ? `https://t.me/${me.username}?start=${pairCode()}` : null,
    notify: kv.get('tgNotify', false) === true,
    error: lastError,
  };
}

export function unlinkTelegram() {
  kv.set('tgOwner', null);
  kv.set('tgCode', null);
}

export function setTgNotify(on) {
  kv.set('tgNotify', !!on);
}

const send = (chatId, text, extra = {}) =>
  tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });

// ---------- Обработка входящих ----------

function describeForward(m) {
  const o = m.forward_origin;
  if (o) {
    if (o.type === 'user') return [o.sender_user?.first_name, o.sender_user?.last_name].filter(Boolean).join(' ') || 'пользователь';
    if (o.type === 'hidden_user') return o.sender_user_name || 'пользователь';
    if (o.type === 'chat') return o.sender_chat?.title || 'чат';
    if (o.type === 'channel') return o.chat?.title || 'канал';
  }
  if (m.forward_from) return [m.forward_from.first_name, m.forward_from.last_name].filter(Boolean).join(' ');
  if (m.forward_sender_name) return m.forward_sender_name;
  return '';
}

async function handleCommand(chatId, text) {
  const cmd = text.split(/\s+/)[0].split('@')[0].toLowerCase();
  if (cmd === '/today') return send(chatId, planText(localDateStr()));
  if (cmd === '/tomorrow') return send(chatId, planText(addDays(localDateStr(), 1)));
  if (cmd === '/tasks') return send(chatId, tasksText());
  return send(chatId, HELP, { reply_markup: MAIN_KB });
}

export async function handleUpdate(u) {
  if (u.callback_query) return handleCallback(u.callback_query);
  const m = u.message;
  if (!m || !m.chat) return;
  const chatId = m.chat.id;
  const text = String(m.text || m.caption || '').trim();
  const o = owner();

  if (!o) {
    const start = /^\/start(?:\s+(\S+))?/.exec(text);
    if (start && start[1] && safeEqual(start[1], pairCode()) && m.chat.type === 'private') {
      const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || m.from?.username || 'владелец';
      kv.set('tgOwner', { chatId, userId: m.from?.id ?? null, name, linkedAt: Date.now() });
      kv.set('tgCode', null);
      return send(chatId, `Привет, ${esc(name)}! Бот подключён к твоему «Распорядку» 🎉\n\n${HELP}`, { reply_markup: MAIN_KB });
    }
    return send(chatId, 'Это личный бот «Умного распорядка». Подключить его можно из приложения: Ещё → Настройки → Telegram.');
  }
  if (chatId !== o.chatId) return; // чужие чаты игнорируем

  return routeOwnerMessage(m);
}

// ---------- Кнопки ----------

const BTN_COLLECT = '📥 Собрать задачу';
const BTN_TODAY = '📅 Сегодня';
const BTN_DONE = '✅ Готово';
const BTN_CANCEL = '✖️ Отмена';
export const MAIN_KB = { keyboard: [[{ text: BTN_COLLECT }, { text: BTN_TODAY }]], resize_keyboard: true, is_persistent: true };
const COLLECT_KB = { keyboard: [[{ text: BTN_DONE }, { text: BTN_CANCEL }]], resize_keyboard: true, is_persistent: true };

const isForward = (m) => !!(m.forward_origin || m.forward_date || m.forward_from || m.forward_sender_name);
const undoMarkup = (batchId) => (batchId ? { reply_markup: { inline_keyboard: [[{ text: '↩️ Отменить', callback_data: `undo:${batchId}` }]] } } : {});

// ---------- Вложения ----------

function pickPhoto(sizes) {
  const ok = sizes.filter((p) => !p.file_size || p.file_size <= 5 * 1024 * 1024);
  return (ok.length ? ok : sizes).reduce((a, b) => ((b.width || 0) > (a.width || 0) ? b : a));
}

const download = (fileId, mime) => async () => ({ buf: await tgDownload(fileId), mime });

/** Сообщение Telegram → элемент переписки (автор, время, текст, вложения) */
function tgItem(m) {
  const author = describeForward(m) || 'Я';
  const ts = m.forward_origin?.date || m.forward_date || m.date;
  const media = [];
  if (m.photo?.length) media.push({ kind: 'image', fetch: download(pickPhoto(m.photo).file_id, 'image/jpeg') });
  if (m.document) {
    const mime = m.document.mime_type || '';
    if (/^image\//.test(mime)) media.push({ kind: 'image', fetch: download(m.document.file_id, mime) });
    else if (/^audio\//.test(mime)) media.push({ kind: 'audio', fetch: download(m.document.file_id, mime) });
    else media.push({ kind: 'doc', name: m.document.file_name || '' });
  }
  if (m.voice) media.push({ kind: 'voice', duration: m.voice.duration, fetch: download(m.voice.file_id, m.voice.mime_type || 'audio/ogg') });
  if (m.audio) media.push({ kind: 'audio', duration: m.audio.duration, fetch: download(m.audio.file_id, m.audio.mime_type || 'audio/mpeg') });
  if (m.video_note) media.push({ kind: 'video_note', duration: m.video_note.duration, fetch: download(m.video_note.file_id, 'video/mp4') });
  if (m.video) media.push({ kind: 'video_note', duration: m.video.duration, fetch: download(m.video.file_id, m.video.mime_type || 'video/mp4') });
  return { author, time: ts ? localTimeStr(ts * 1000) : null, text: String(m.text || m.caption || '').trim(), media };
}

// ---------- Обычный режим: каждое сообщение отдельно ----------
// Альбом (несколько фото разом) Telegram присылает разными сообщениями с одним media_group_id —
// их ждём ~1,5 с и разбираем вместе, как одно сообщение.

const albums = new Map();

function handleSingle(m) {
  if (!m.media_group_id) return processMessages([m]);
  let a = albums.get(m.media_group_id);
  if (!a) {
    a = { msgs: [], waiters: [], timer: null };
    albums.set(m.media_group_id, a);
  }
  a.msgs.push(m);
  clearTimeout(a.timer);
  a.timer = setTimeout(() => {
    albums.delete(m.media_group_id);
    processMessages(a.msgs)
      .catch((e) => console.warn('[tg] ошибка обработки:', e.message))
      .finally(() => a.waiters.forEach((w) => w()));
  }, Math.min(config.media.debounceMs, 1500));
  return new Promise((resolve) => a.waiters.push(resolve));
}

async function processMessages(msgs) {
  const o = owner();
  if (!o) return;
  const chatId = o.chatId;
  const last = msgs[msgs.length - 1];
  const items = msgs.map(tgItem);
  const from = msgs.map(describeForward).find(Boolean) || '';
  tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => undefined);

  if (!hasMedia(items)) {
    const text = items.map((it) => it.text).filter(Boolean).join('\n');
    if (!text) return send(chatId, 'Пока не понимаю такое сообщение 🙂', { reply_to_message_id: last.message_id });
    const res = await processInbox(text, from);
    return send(chatId, res.text || 'Готово', { reply_to_message_id: last.message_id, ...undoMarkup(res.batchId) });
  }

  // Голосовое или картинка: расшифровываем и разбираем как обычный текст (задача, событие, еда…)
  const convo = await buildConversation(items);
  const text = from ? convo.transcript : plainText(items, convo);
  const problems = convo.problems.map((p) => `⚠️ ${esc(p)}`);
  if (!text.trim()) return send(chatId, ['Не получилось ничего разобрать.', ...problems].join('\n'), { reply_to_message_id: last.message_id });
  const res = await processInbox(text, from, { attachments: convo.attachments });
  return send(chatId, [res.text || 'Готово', ...problems].join('\n'), { reply_to_message_id: last.message_id, ...undoMarkup(res.batchId) });
}

// ---------- Режим «Собрать задачу»: всё пересланное → одна задача ----------

const MAX_COLLECT = 100;
const IDLE_FINISH_MS = 15 * 60000;
const collecting = new Map();

function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
}

function countText(msgs) {
  const items = msgs.map(tgItem);
  const voices = items.reduce((s, it) => s + it.media.filter((x) => x.kind !== 'image' && x.kind !== 'doc').length, 0);
  const images = items.reduce((s, it) => s + it.media.filter((x) => x.kind === 'image').length, 0);
  const parts = [`${msgs.length} ${plural(msgs.length, 'сообщение', 'сообщения', 'сообщений')}`];
  if (voices) parts.push(`🎤 ${voices}`);
  if (images) parts.push(`🖼 ${images}`);
  return parts.join(', ');
}

function stopTimers(st) {
  clearTimeout(st.idleTimer);
  clearTimeout(st.editTimer);
}

function armIdle(chatId, st) {
  clearTimeout(st.idleTimer);
  st.idleTimer = setTimeout(() => {
    finishCollect(chatId, { auto: true }).catch((e) => console.warn('[tg] автозавершение сбора:', e.message));
  }, IDLE_FINISH_MS);
  st.idleTimer.unref?.();
}

export function isCollecting(chatId) {
  return collecting.has(chatId);
}

async function startCollect(chatId) {
  const prev = collecting.get(chatId);
  if (prev) stopTimers(prev);
  const st = { msgs: [], statusId: null, statusPending: null, editTimer: null, idleTimer: null };
  collecting.set(chatId, st);
  armIdle(chatId, st);
  return send(
    chatId,
    '📥 <b>Собираю задачу.</b> Пересылай сообщения — тексты, картинки, голосовые. Когда закончишь, нажми «✅ Готово»: соберу всё в одну задачу.',
    { reply_markup: COLLECT_KB },
  );
}

function addToCollect(chatId, st, m) {
  if (st.msgs.length >= MAX_COLLECT) return send(chatId, `Уже ${MAX_COLLECT} сообщений — это максимум. Нажми «✅ Готово».`);
  st.msgs.push(m);
  armIdle(chatId, st);
  // счётчик: одно сообщение-статус, которое редактируем не чаще раза в 1,5 с
  if (!st.statusId && !st.statusPending) {
    st.statusPending = send(chatId, `📥 Собрано: ${countText(st.msgs)}`)
      .then((r) => {
        st.statusId = r?.message_id || null;
      })
      .catch(() => undefined);
    return st.statusPending;
  }
  if (!st.editTimer) {
    st.editTimer = setTimeout(async () => {
      st.editTimer = null;
      await st.statusPending;
      if (!st.statusId || !collecting.has(chatId)) return;
      await tg('editMessageText', { chat_id: chatId, message_id: st.statusId, text: `📥 Собрано: ${countText(st.msgs)}` }).catch(() => undefined);
    }, 1500);
    st.editTimer.unref?.();
  }
  return undefined;
}

async function cancelCollect(chatId) {
  const st = collecting.get(chatId);
  if (st) stopTimers(st);
  collecting.delete(chatId);
  return send(chatId, st ? 'Сбор отменён, ничего не создал.' : 'Сейчас ничего не собирается.', { reply_markup: MAIN_KB });
}

async function finishCollect(chatId, { auto = false } = {}) {
  const st = collecting.get(chatId);
  if (!st) return send(chatId, `Сейчас ничего не собирается. Нажми «${BTN_COLLECT}», потом пересылай сообщения.`, { reply_markup: MAIN_KB });
  collecting.delete(chatId);
  stopTimers(st);
  await st.statusPending;
  if (!st.msgs.length) return send(chatId, 'Ничего не переслано — сбор отменён.', { reply_markup: MAIN_KB });
  await send(chatId, `${auto ? '⏰ 15 минут без новых сообщений — собираю, что есть.\n' : ''}⏳ Разбираю ${countText(st.msgs)}…`, { reply_markup: MAIN_KB });
  tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => undefined);
  const convo = await buildConversation(st.msgs.map(tgItem));
  const from = st.msgs.map(describeForward).find(Boolean) || '';
  const res = await processConversation(convo, { from });
  return send(chatId, res.text || 'Готово', undoMarkup(res.batchId));
}

/** Сообщение владельца: команды, режим сбора или обычная обработка */
async function routeOwnerMessage(m) {
  const chatId = m.chat.id;
  const text = String(m.text || '').trim();
  const fwd = isForward(m);
  const cmd = !fwd ? text.split(/\s+/)[0].split('@')[0].toLowerCase() : '';
  if (!fwd && (cmd === '/collect' || text === BTN_COLLECT)) return startCollect(chatId);
  const st = collecting.get(chatId);
  if (st) {
    if (!fwd && (cmd === '/done' || text === BTN_DONE || /^готово$/i.test(text))) return finishCollect(chatId);
    if (!fwd && (cmd === '/cancel' || text === BTN_CANCEL || /^отмена$/i.test(text))) return cancelCollect(chatId);
    if (cmd.startsWith('/')) return handleCommand(chatId, text);
    return addToCollect(chatId, st, m);
  }
  if (!fwd && (cmd === '/done' || cmd === '/cancel' || text === BTN_DONE || text === BTN_CANCEL)) {
    return send(chatId, `Сейчас ничего не собирается. Нажми «${BTN_COLLECT}».`, { reply_markup: MAIN_KB });
  }
  if (!fwd && text === BTN_TODAY) return send(chatId, planText(localDateStr()));
  if (cmd.startsWith('/')) return handleCommand(chatId, text);
  return handleSingle(m);
}

async function handleCallback(q) {
  const o = owner();
  const answer = (text) => tg('answerCallbackQuery', { callback_query_id: q.id, ...(text ? { text } : {}) }).catch(() => undefined);
  if (!o || q.message?.chat?.id !== o.chatId) return answer();
  const [kind, id] = String(q.data || '').split(':');
  if (kind === 'undo' && id) {
    const n = undoBatch(id);
    await answer(n ? 'Отменено' : 'Уже отменено');
    await tg('editMessageReplyMarkup', { chat_id: o.chatId, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
    if (n) await send(o.chatId, '↩️ Отменил — из приложения тоже уберётся при синхронизации.', { reply_to_message_id: q.message.message_id });
    return;
  }
  return answer();
}

// ---------- Опрос Telegram ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startTelegramBot() {
  if (!tgEnabled() || running) return;
  running = true;
  try {
    me = await tg('getMe');
    await tg('setMyCommands', {
      commands: [
        { command: 'collect', description: 'Собрать пересланную переписку в одну задачу' },
        { command: 'today', description: 'План на сегодня' },
        { command: 'tomorrow', description: 'План на завтра' },
        { command: 'tasks', description: 'Открытые задачи' },
        { command: 'help', description: 'Что умеет бот' },
      ],
    }).catch(() => undefined);
    console.log(`[tg] бот @${me.username} запущен`);
  } catch (e) {
    lastError = e.message;
    console.warn('[tg] не удалось подключиться к Telegram:', e.message);
  }
  let backoff = 3000;
  for (;;) {
    try {
      const offset = kv.get('tgOffset', 0);
      const updates = await tg('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] }, 65000);
      backoff = 3000;
      lastError = null;
      if (!me) me = await tg('getMe').catch(() => null);
      for (const u of updates) {
        kv.set('tgOffset', u.update_id + 1);
        // не ждём: части альбома и пересылки должны успеть прийти, а долгие расшифровки — не тормозить приём
        handleUpdate(u).catch((e) => console.warn('[tg] ошибка обработки сообщения:', e.message));
      }
    } catch (e) {
      lastError = e.message;
      await sleep(backoff);
      backoff = Math.min(60000, backoff * 2);
    }
  }
}
