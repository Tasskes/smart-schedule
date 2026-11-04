import { config } from './config.js';
import { kv } from './db.js';

const HINTS = {
  ENOTFOUND: 'не находится адрес сервера (DNS)',
  EAI_AGAIN: 'не находится адрес сервера (DNS)',
  ETIMEDOUT: 'соединение не устанавливается — похоже, Telegram недоступен из сети сервера',
  UND_ERR_CONNECT_TIMEOUT: 'соединение не устанавливается — похоже, Telegram недоступен из сети сервера',
  ECONNRESET: 'соединение сбрасывается — похоже на блокировку',
  ECONNREFUSED: 'соединение отклонено',
  ENETUNREACH: 'сеть недоступна',
  EHOSTUNREACH: 'сервер недоступен',
  UND_ERR_SOCKET: 'соединение оборвалось',
};

/** Понятное описание сетевой ошибки fetch (вместо голого «fetch failed») */
export function netErrorText(e) {
  const c = e?.cause;
  const code = c?.code || c?.cause?.code || (e?.name === 'AbortError' ? 'TIMEOUT' : '');
  if (code === 'TIMEOUT') return 'Telegram не ответил вовремя';
  const hint = HINTS[code] || c?.message || e?.message || String(e);
  return code ? `${hint} (${code})` : hint;
}

/** Проверка TELEGRAM_PROXY: подходят http://, https://, socks5:// (MTProto-прокси для приложения Telegram — нет) */
export function proxyProblem(url) {
  if (!url) return null;
  if (/^tg:|t\.me\/proxy|[?&]secret=/i.test(url)) {
    return 'это MTProto-прокси для приложения Telegram, боту он не подходит. Нужен HTTP(S) или SOCKS5 прокси';
  }
  let u;
  try {
    u = new URL(url);
  } catch {
    return 'неверный адрес. Пример: socks5://логин:пароль@1.2.3.4:1080 или http://логин:пароль@1.2.3.4:8080';
  }
  if (!['http:', 'https:', 'socks5:', 'socks:'].includes(u.protocol)) {
    return `тип ${u.protocol.replace(':', '')} не поддерживается — нужен http://, https:// или socks5://`;
  }
  if (!u.port) return 'не указан порт. Пример: socks5://логин:пароль@1.2.3.4:1080';
  return null;
}

let proxy = null;
async function fetcher() {
  const url = config.telegram.proxy;
  if (!url) return { doFetch: fetch, dispatcher: undefined };
  const problem = proxyProblem(url);
  if (problem) throw new Error(`TELEGRAM_PROXY: ${problem}`);
  if (!proxy || proxy.url !== url) {
    const undici = await import('undici');
    proxy = { url, doFetch: undici.fetch, dispatcher: new undici.ProxyAgent(url) };
  }
  return proxy;
}

// Низкоуровневые вызовы Telegram Bot API. Транспорт можно подменить в тестах.
let transport = async (method, params, timeoutMs) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const { doFetch, dispatcher } = await fetcher();
  let res;
  try {
    res = await doFetch(`${config.telegram.apiBase}/bot${config.telegram.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: ctrl.signal,
      ...(dispatcher ? { dispatcher } : {}),
    });
  } catch (e) {
    throw new Error(`Нет связи с Telegram: ${netErrorText(e)}`);
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    if (res.status === 401) throw new Error('Telegram отклонил токен бота — проверь TELEGRAM_BOT_TOKEN в .env');
    throw new Error(`Telegram ${method}: ${data.description || res.status}`);
  }
  return data.result;
};

export function setTransport(fn) {
  transport = fn;
}

// Скачивание файлов (фото, голосовые) из Telegram — через тот же прокси, что и API
let downloader = async (fileId) => {
  const f = await tg('getFile', { file_id: fileId });
  if (!f?.file_path) throw new Error('Telegram не отдал файл');
  const { doFetch, dispatcher } = await fetcher();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await doFetch(`${config.telegram.apiBase}/file/bot${config.telegram.token}/${f.file_path}`, {
      signal: ctrl.signal,
      ...(dispatcher ? { dispatcher } : {}),
    });
    if (!res.ok) throw new Error(`файл не скачался (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    throw new Error(e.message.startsWith('файл') ? e.message : `файл не скачался: ${netErrorText(e)}`);
  } finally {
    clearTimeout(timer);
  }
};

export function setDownloader(fn) {
  downloader = fn;
}

export function tgDownload(fileId) {
  return downloader(fileId);
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
