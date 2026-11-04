import { config } from './config.js';
import { kv } from './db.js';

// Низкоуровневые вызовы Telegram Bot API. Транспорт можно подменить в тестах.
let transport = async (method, params, timeoutMs) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.telegram.apiBase}/bot${config.telegram.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || res.status}`);
    return data.result;
  } finally {
    clearTimeout(timer);
  }
};

export function setTransport(fn) {
  transport = fn;
}

export function tg(method, params = {}, timeoutMs = 20000) {
  return transport(method, params, timeoutMs);
}

export const tgEnabled = () => !!config.telegram.token;

export function owner() {
  return kv.get('tgOwner', null);
}

export function tgNotifyEnabled() {
  return tgEnabled() && !!owner() && kv.get('tgNotify', false) === true;
}

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function sendToOwner(text, extra = {}) {
  const o = owner();
  if (!o || !tgEnabled()) return false;
  await tg('sendMessage', { chat_id: o.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
  return true;
}
