import crypto from 'node:crypto';
import { safeEqual } from './auth.js';
import { kv } from './db.js';
import { helpText, planText, processInbox, tasksText } from './inbox.js';
import { addDays, localDateStr } from './time.js';
import { undoBatch } from './tgactions.js';
import { esc, owner, tg, tgEnabled } from './tgapi.js';



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
  return send(chatId, HELP);
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
      return send(chatId, `Привет, ${esc(name)}! Бот подключён к твоему «Распорядку» 🎉\n\n${HELP}`);
    }
    return send(chatId, 'Это личный бот «Умного распорядка». Подключить его можно из приложения: Ещё → Настройки → Telegram.');
  }
  if (chatId !== o.chatId) return; // чужие чаты игнорируем

  if (text.startsWith('/')) return handleCommand(chatId, text);
  if (!text) {
    return send(chatId, 'Пока понимаю только текст и подписи к фото. Голосовые сообщения — в планах 🙂', { reply_to_message_id: m.message_id });
  }
  tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => undefined);
  const res = await processInbox(text, describeForward(m));
  return send(chatId, res.text || 'Готово', {
    reply_to_message_id: m.message_id,
    ...(res.batchId ? { reply_markup: { inline_keyboard: [[{ text: '↩️ Отменить', callback_data: `undo:${res.batchId}` }]] } } : {}),
  });
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
        try {
          await handleUpdate(u);
        } catch (e) {
          console.warn('[tg] ошибка обработки сообщения:', e.message);
        }
      }
    } catch (e) {
      lastError = e.message;
      await sleep(backoff);
      backoff = Math.min(60000, backoff * 2);
    }
  }
}
