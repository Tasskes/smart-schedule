import { config } from './config.js';
import { kv } from './db.js';

// Работаем в «локальном» времени пользователя через фиксированное смещение,
// чтобы не зависеть от tzdata в контейнере. Клиент присылает своё смещение.
export function tzOffsetMin() {
  const v = kv.get('tzOffsetMin', null);
  return Number.isFinite(v) ? v : config.tzOffsetMin;
}

export function localDateStr(ts = Date.now()) {
  return new Date(ts + tzOffsetMin() * 60000).toISOString().slice(0, 10);
}

export function localTimeStr(ts = Date.now()) {
  return new Date(ts + tzOffsetMin() * 60000).toISOString().slice(11, 16);
}

export function localTs(date, time = '00:00') {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh || 0, mm || 0) - tzOffsetMin() * 60000;
}

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const DOW = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

export function fmtDay(date) {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DOW[dow]} ${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}`;
}
