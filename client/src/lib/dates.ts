export const pad = (n: number) => String(n).padStart(2, '0');

export function toDateStr(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayStr() {
  return toDateStr(new Date());
}

export function parseDate(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isDateStr(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseDate(s).getTime());
}

export function addDays(s: string, n: number) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

/** 1 = понедельник … 7 = воскресенье */
export function dow(s: string) {
  const g = parseDate(s).getDay();
  return g === 0 ? 7 : g;
}

export function weekStart(s: string) {
  return addDays(s, 1 - dow(s));
}

export function weekDays(s: string) {
  const monday = weekStart(s);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function daysBetween(a: string, b: string) {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000);
}

export const DOW_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const DOW_LONG = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function fmtShort(s: string) {
  const d = parseDate(s);
  return `${DOW_SHORT[dow(s) - 1]}, ${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
}

export function fmtDM(s: string) {
  const d = parseDate(s);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
}

export function fmtLong(s: string) {
  const d = parseDate(s);
  return `${DOW_LONG[dow(s) - 1]}, ${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
}

export function fmtDayMonth(s: string) {
  const d = parseDate(s);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
}

export function timeToMin(t?: string | null): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 24 || mm > 59 || (h === 24 && mm > 0)) return null;
  return h * 60 + mm;
}

export function minToTime(m: number) {
  const x = Math.max(0, Math.min(1440, Math.round(m)));
  return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`;
}

export function normTime(t?: string | null): string | null {
  const m = timeToMin(t);
  return m == null ? null : minToTime(m);
}

export function nowMin() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function nowTime() {
  return minToTime(nowMin());
}

export function fmtDur(min: number | null | undefined) {
  if (min == null || !Number.isFinite(min)) return '—';
  const m = Math.round(min);
  if (Math.abs(m) < 60) return `${m} мин`;
  const h = Math.trunc(m / 60);
  const r = Math.abs(m % 60);
  return r ? `${h} ч ${r} мин` : `${h} ч`;
}

export function academicWeek(date: string, semesterStart?: string | null) {
  if (!semesterStart || !isDateStr(semesterStart)) return null;
  const n = Math.floor(daysBetween(weekStart(semesterStart), weekStart(date)) / 7) + 1;
  if (n < 1) return null;
  return { num: n, even: n % 2 === 0 };
}

export function roundUp5(m: number) {
  return Math.ceil(m / 5) * 5;
}
