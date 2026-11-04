import crypto from 'node:crypto';
import { config } from './config.js';
import { kv } from './db.js';
import { helpText, htmlToPlain, planText, processInbox, tasksText } from './inbox.js';
import { addDays, localDateStr } from './time.js';
import { undoBatch } from './tgactions.js';
import { vk, vkEnabled, vkLongPoll, vkOwner, vkSend } from './vkapi.js';

// Бот сообщества ВКонтакте (Bots Long Poll API): та же «входящая» обработка, что и в Telegram.

const HELP = htmlToPlain(helpText('vk'));
let group = null;
let lastError = null;
let running = false;

export function vkPairCode() {
  let c = kv.get('vkCode', null);
  if (!c) {
    c = String(crypto.randomInt(100000, 999999));
    kv.set('vkCode', c);
  }
  return c;
}

export function vkStatus() {
  const o = vkOwner();
  const screen = group?.screen_name || (config.vk.groupId ? `club${config.vk.groupId}` : null);
  return {
    configured: vkEnabled(),
    groupName: group?.name || null,
    link: screen ? `https://vk.me/${screen}` : null,
    linked: !!o,
    ownerName: o?.name || null,
    code: o ? null : vkEnabled() ? vkPairCode() : null,
    notify: kv.get('vkNotify', false) === true,
    error: lastError,
  };
}

export function unlinkVk() {
  kv.set('vkOwner', null);
  kv.set('vkCode', null);
}

export function setVkNotify(on) {
  kv.set('vkNotify', !!on);
}

const undoKeyboard = (batchId) => ({
  inline: true,
  buttons: [[{ action: { type: 'callback', label: '↩️ Отменить', payload: JSON.stringify({ undo: batchId }) }, color: 'secondary' }]],
});

async function userNames(ids) {
  const uniq = [...new Set(ids.filter((id) => id > 0))];
  if (!uniq.length) return new Map();
  try {
    const users = await vk('users.get', { user_ids: uniq.join(',') });
    return new Map((users || []).map((u) => [u.id, [u.first_name, u.last_name].filter(Boolean).join(' ')]));
  } catch {
    return new Map();
  }
}

/** Собираем текст из сообщения и пересланных: «[Анна Петровна]: давай в чт в 18» */
async function collectText(m) {
  const fwd = [];
  const walk = (list) => {
    for (const f of list || []) {
      fwd.push(f);
      walk(f.fwd_messages);
    }
  };
  walk(m.fwd_messages);
  if (m.reply_message) fwd.push(m.reply_message);
  const voice = (msg) => msg.attachments?.find((a) => a.type === 'audio_message')?.audio_message?.transcript || '';
  const own = String(m.text || '').trim() || voice(m);
  if (!fwd.length) return { text: own, from: '' };
  const names = await userNames(fwd.map((f) => f.from_id));
  const parts = fwd
    .map((f) => {
      const t = String(f.text || '').trim() || voice(f);
      if (!t) return '';
      const who = f.from_id > 0 ? names.get(f.from_id) || 'собеседник' : 'сообщество';
      return `[${who}]: ${t}`;
    })
    .filter(Boolean);
  const first = fwd.find((f) => f.from_id > 0 && f.from_id !== m.from_id);
  return {
    text: [own, ...parts].filter(Boolean).join('\n'),
    from: first ? names.get(first.from_id) || '' : '',
  };
}

function command(text) {
  const t = text.trim().toLowerCase().replace(/^\//, '');
  if (['сегодня', 'today', 'план'].includes(t)) return 'today';
  if (['завтра', 'tomorrow'].includes(t)) return 'tomorrow';
  if (['задачи', 'tasks'].includes(t)) return 'tasks';
  if (['помощь', 'help', 'начать', 'start', 'старт'].includes(t)) return 'help';
  return null;
}

export async function handleVkUpdate(u) {
  if (u.type === 'message_event') return handleVkEvent(u.object || {});
  if (u.type !== 'message_new') return;
  const m = u.object?.message || u.object || {};
  const userId = m.from_id;
  if (!userId || userId < 0 || m.peer_id !== userId) return; // только личные сообщения от людей
  const o = vkOwner();
  const text = String(m.text || '').trim();

  if (!o) {
    const code = vkPairCode();
    const words = text.split(/\s+/);
    if ((m.ref && m.ref === code) || words.includes(code)) {
      const names = await userNames([userId]);
      const name = names.get(userId) || 'владелец';
      kv.set('vkOwner', { userId, name, linkedAt: Date.now() });
      kv.set('vkCode', null);
      return vkSend(userId, `Привет, ${name}! Бот подключён к твоему «Распорядку» 🎉\n\n${HELP}`);
    }
    return vkSend(userId, 'Это личный бот «Умного распорядка». Чтобы подключить его, открой приложение → Ещё → Настройки → ВКонтакте и отправь сюда код оттуда.');
  }
  if (userId !== o.userId) return; // чужих игнорируем

  const cmd = !m.fwd_messages?.length ? command(text) : null;
  if (cmd === 'today') return vkSend(userId, htmlToPlain(planText(localDateStr())));
  if (cmd === 'tomorrow') return vkSend(userId, htmlToPlain(planText(addDays(localDateStr(), 1))));
  if (cmd === 'tasks') return vkSend(userId, htmlToPlain(tasksText()));
  if (cmd === 'help') return vkSend(userId, HELP);

  const { text: full, from } = await collectText(m);
  if (!full) return vkSend(userId, 'Пока понимаю только текст и пересланные сообщения 🙂');
  vk('messages.setActivity', { peer_id: userId, type: 'typing' }).catch(() => undefined);
  const res = await processInbox(full, from);
  return vkSend(userId, htmlToPlain(res.text || 'Готово'), res.batchId ? { keyboard: undoKeyboard(res.batchId) } : {});
}

async function handleVkEvent(ev) {
  const o = vkOwner();
  let payload = ev.payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = {};
    }
  }
  const answer = (text) =>
    vk('messages.sendMessageEventAnswer', {
      event_id: ev.event_id,
      user_id: ev.user_id,
      peer_id: ev.peer_id,
      ...(text ? { event_data: { type: 'show_snackbar', text } } : {}),
    }).catch(() => undefined);
  if (!o || ev.user_id !== o.userId) return answer();
  if (payload?.undo) {
    const n = undoBatch(String(payload.undo));
    await answer(n ? 'Отменено' : 'Уже отменено');
    if (n) await vkSend(o.userId, '↩️ Отменил — из приложения тоже уберётся при синхронизации.');
    return;
  }
  return answer();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startVkBot() {
  if (!vkEnabled() || running) return;
  running = true;
  try {
    const res = await vk('groups.getById', { group_id: config.vk.groupId });
    group = Array.isArray(res) ? res[0] : res?.groups?.[0] || null;
    console.log(`[vk] бот сообщества «${group?.name || config.vk.groupId}» запущен`);
    lastError = null;
  } catch (e) {
    lastError = e.message;
    console.warn('[vk] не удалось подключиться к ВКонтакте:', e.message);
  }
  let lp = null;
  let backoff = 3000;
  for (;;) {
    try {
      if (!lp) {
        lp = await vk('groups.getLongPollServer', { group_id: config.vk.groupId });
        if (!lp?.server || !lp?.key) {
          lp = null;
          throw new Error('ВКонтакте не выдал Long Poll сервер — проверь, что Long Poll API включён в настройках сообщества');
        }
      }
      const res = await vkLongPoll(lp.server, lp.key, lp.ts, 25);
      if (res?.failed) {
        if (res.failed === 1 && res.ts) lp.ts = res.ts;
        else lp = null; // ключ устарел — получим новый
        continue;
      }
      if (res?.ts) lp.ts = res.ts;
      lastError = null;
      backoff = 3000;
      for (const u of res?.updates || []) {
        try {
          await handleVkUpdate(u);
        } catch (e) {
          console.warn('[vk] ошибка обработки сообщения:', e.message);
        }
      }
    } catch (e) {
      lastError = e.message;
      lp = null;
      await sleep(backoff);
      backoff = Math.min(60000, backoff * 2);
    }
  }
}
