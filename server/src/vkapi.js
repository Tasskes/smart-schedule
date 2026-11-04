import crypto from 'node:crypto';
import { config } from './config.js';
import { kv } from './db.js';
import { netErrorText } from './tgapi.js';

// Вызовы VK API от имени сообщества. Транспорт можно подменить в тестах.
let transport = async (url, init, timeoutMs) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  let text;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal });
    text = await res.text();
  } catch (e) {
    throw new Error(`Нет связи с ВКонтакте: ${netErrorText(e)}`);
  } finally {
    clearTimeout(timer);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`ВКонтакте ответил не JSON (HTTP ${res.status}): ${String(text).slice(0, 120)}`);
  }
};

export function setVkTransport(fn) {
  transport = fn;
}

export const vkEnabled = () => !!(config.vk.token && config.vk.groupId);

const VK_HINTS = {
  5: 'ключ доступа сообщества неверный или отозван — создай новый (Управление → Работа с API)',
  15: 'нет доступа — проверь права ключа: «Управление сообществом» и «Сообщения сообщества»',
  27: 'нужен ключ доступа именно сообщества, а не пользователя',
  100: 'неверный параметр — проверь VK_GROUP_ID',
  901: 'пользователь не разрешил сообщения от сообщества — напиши сообществу первым',
};

export async function vk(method, params = {}, timeoutMs = 20000) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    body.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  body.set('access_token', config.vk.token);
  body.set('v', config.vk.version);
  const data = await transport(
    `${config.vk.apiBase}/method/${method}`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() },
    timeoutMs,
  );
  if (data?.error) {
    const code = data.error.error_code;
    throw Object.assign(new Error(`ВКонтакте ${method}: ${VK_HINTS[code] || data.error.error_msg} (код ${code})`), { vkCode: code });
  }
  if (!data || !('response' in data)) throw new Error(`ВКонтакте ${method}: неожиданный ответ`);
  return data.response;
}

export function vkLongPoll(server, key, ts, wait = 25) {
  const url = `${server}?act=a_check&key=${encodeURIComponent(key)}&ts=${encodeURIComponent(ts)}&wait=${wait}`;
  return transport(url, { method: 'GET' }, (wait + 10) * 1000);
}

export function vkOwner() {
  return kv.get('vkOwner', null);
}

export function vkNotifyEnabled() {
  return vkEnabled() && !!vkOwner() && kv.get('vkNotify', false) === true;
}

export function vkSend(peerId, message, extra = {}) {
  return vk('messages.send', {
    peer_id: peerId,
    random_id: crypto.randomInt(1, 2 ** 31 - 1),
    message: String(message).slice(0, 4000),
    dont_parse_links: 1,
    disable_mentions: 1,
    ...extra,
  });
}

export async function sendVkToOwner(text) {
  const o = vkOwner();
  if (!o || !vkEnabled()) return false;
  await vkSend(o.userId, text);
  return true;
}
