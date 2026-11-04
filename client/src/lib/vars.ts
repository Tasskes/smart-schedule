/**
 * Переменные «как в программировании».
 *
 * Значения: число (`3`), длительность (`40 мин`, `1ч 30м`, `1.5ч`), время (`07:30`), текст.
 * Выражения: `{первая_пара} - {дорога_до_вуза} - 10`, `min(08:00, {первая_пара} - 1ч)`,
 * ссылки на завтрашний день: `{завтра:подъём} - {сон}`.
 * Встроенные (зависят от дня): первая_пара, конец_пар, пар, день_недели, чётная_неделя, выходной.
 * Если встроенной нет значения (например, в день без пар), выражение даёт «нет значения»,
 * а min/max просто его пропускают.
 */
import { addDays, fmtDur, minToTime } from './dates';

export type Val =
  | { t: 'num'; v: number }
  | { t: 'dur'; v: number }
  | { t: 'time'; v: number }
  | { t: 'text'; v: string }
  | { t: 'null' };

export const NULL: Val = { t: 'null' };

export class ExprError extends Error {}

type Tok =
  | { k: 'num'; v: number }
  | { k: 'unit'; v: 'min' | 'h' }
  | { k: 'time'; v: number }
  | { k: 'ref'; v: string }
  | { k: 'op'; v: string }
  | { k: 'fn'; v: 'min' | 'max' }
  | { k: 'comma' };

const UNIT_RE = /^(минут[аы]?|мин|м|min|m|часа|часов|час|ч|h)(?![a-zа-яё_0-9])/i;
const FN_RE = /^(min|max|мин|макс)\s*(?=\()/i;

export function tokenize(src: string): Tok[] | null {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    const rest = src.slice(i);
    let m = /^(\d{1,2}):(\d{2})(?!\d)/.exec(rest);
    if (m) {
      toks.push({ k: 'time', v: Number(m[1]) * 60 + Number(m[2]) });
      i += m[0].length;
      continue;
    }
    m = /^\d+(?:[.,]\d+)?/.exec(rest);
    if (m) {
      toks.push({ k: 'num', v: parseFloat(m[0].replace(',', '.')) });
      i += m[0].length;
      const after = src.slice(i);
      const ws = /^\s*/.exec(after)![0];
      const u = UNIT_RE.exec(after.slice(ws.length));
      if (u) {
        const w = u[1].toLowerCase();
        toks.push({ k: 'unit', v: /^(ч|h|час)/.test(w) ? 'h' : 'min' });
        i += ws.length + u[0].length;
      }
      continue;
    }
    if (ch === '{') {
      const end = src.indexOf('}', i);
      if (end < 0) return null;
      const name = src.slice(i + 1, end).trim();
      if (!name) return null;
      toks.push({ k: 'ref', v: name });
      i = end + 1;
      continue;
    }
    m = FN_RE.exec(rest);
    if (m) {
      toks.push({ k: 'fn', v: /^(min|мин)$/i.test(m[1]) ? 'min' : 'max' });
      i += m[0].length;
      continue;
    }
    if ('+-*/()'.includes(ch)) {
      toks.push({ k: 'op', v: ch });
      i += 1;
      continue;
    }
    if (ch === ',' || ch === ';') {
      toks.push({ k: 'comma' });
      i += 1;
      continue;
    }
    return null; // встретили буквы — это обычный текст
  }
  return toks;
}

function isNull(v: Val) {
  return v.t === 'null';
}

function num(v: Val): number {
  if (v.t === 'text') throw new ExprError('С текстом нельзя считать');
  if (v.t === 'null') return 0;
  return v.v;
}

function add(a: Val, b: Val): Val {
  if (isNull(a) || isNull(b)) return NULL;
  if (a.t === 'text' || b.t === 'text') throw new ExprError('С текстом нельзя считать');
  if (a.t === 'time' && b.t === 'time') throw new ExprError('Нельзя сложить два времени');
  if (a.t === 'time') return { t: 'time', v: a.v + num(b) };
  if (b.t === 'time') return { t: 'time', v: b.v + num(a) };
  if (a.t === 'dur' || b.t === 'dur') return { t: 'dur', v: num(a) + num(b) };
  return { t: 'num', v: num(a) + num(b) };
}

function sub(a: Val, b: Val): Val {
  if (isNull(a) || isNull(b)) return NULL;
  if (a.t === 'text' || b.t === 'text') throw new ExprError('С текстом нельзя считать');
  if (a.t === 'time' && b.t === 'time') return { t: 'dur', v: a.v - b.v };
  if (a.t === 'time') return { t: 'time', v: a.v - num(b) };
  if (b.t === 'time') throw new ExprError('Нельзя вычесть время из длительности');
  if (a.t === 'dur' || b.t === 'dur') return { t: 'dur', v: num(a) - num(b) };
  return { t: 'num', v: num(a) - num(b) };
}

function mul(a: Val, b: Val): Val {
  if (isNull(a) || isNull(b)) return NULL;
  if (a.t === 'time' || b.t === 'time') throw new ExprError('Время нельзя умножать');
  if (a.t === 'text' || b.t === 'text') throw new ExprError('С текстом нельзя считать');
  if (a.t === 'dur' && b.t === 'dur') throw new ExprError('Нельзя умножить длительность на длительность');
  if (a.t === 'dur' || b.t === 'dur') return { t: 'dur', v: num(a) * num(b) };
  return { t: 'num', v: num(a) * num(b) };
}

function div(a: Val, b: Val): Val {
  if (isNull(a) || isNull(b)) return NULL;
  if (a.t === 'time' || b.t === 'time') throw new ExprError('Время нельзя делить');
  if (a.t === 'text' || b.t === 'text') throw new ExprError('С текстом нельзя считать');
  if (num(b) === 0) throw new ExprError('Деление на ноль');
  if (a.t === 'dur' && b.t === 'dur') return { t: 'num', v: a.v / b.v };
  if (a.t === 'dur') return { t: 'dur', v: a.v / num(b) };
  if (b.t === 'dur') throw new ExprError('Нельзя делить число на длительность');
  return { t: 'num', v: num(a) / num(b) };
}

function pick(args: Val[], which: 'min' | 'max'): Val {
  const xs = args.filter((a) => !isNull(a));
  if (!xs.length) return NULL;
  if (xs.some((x) => x.t === 'text')) throw new ExprError('min/max не работают с текстом');
  const hasTime = xs.some((x) => x.t === 'time');
  if (hasTime && xs.some((x) => x.t !== 'time')) throw new ExprError('min/max: нельзя сравнивать время с длительностью');
  return xs.reduce((best, x) => ((which === 'min' ? num(x) < num(best) : num(x) > num(best)) ? x : best));
}

class Parser {
  pos = 0;
  constructor(private toks: Tok[], private resolve: (name: string) => Val) {}

  private peek() {
    return this.toks[this.pos];
  }

  parseAll(): Val {
    const v = this.expr();
    if (this.pos < this.toks.length) throw new ExprError('Лишние символы в выражении');
    return v;
  }

  private expr(): Val {
    let v = this.term();
    for (;;) {
      const t = this.peek();
      if (t?.k === 'op' && (t.v === '+' || t.v === '-')) {
        this.pos += 1;
        const r = this.term();
        v = t.v === '+' ? add(v, r) : sub(v, r);
      } else return v;
    }
  }

  private term(): Val {
    let v = this.unary();
    for (;;) {
      const t = this.peek();
      if (t?.k === 'op' && (t.v === '*' || t.v === '/')) {
        this.pos += 1;
        const r = this.unary();
        v = t.v === '*' ? mul(v, r) : div(v, r);
      } else return v;
    }
  }

  private unary(): Val {
    const t = this.peek();
    if (t?.k === 'op' && t.v === '-') {
      this.pos += 1;
      const v = this.unary();
      if (v.t === 'null') return v;
      if (v.t === 'time' || v.t === 'text') throw new ExprError('Нельзя поставить минус перед временем');
      return { ...v, v: -v.v };
    }
    if (t?.k === 'op' && t.v === '+') {
      this.pos += 1;
      return this.unary();
    }
    return this.primary();
  }

  private expect(op: string) {
    const t = this.toks[this.pos++];
    if (!t || t.k !== 'op' || t.v !== op) throw new ExprError(`Ожидалась «${op}»`);
  }

  private primary(): Val {
    const t = this.toks[this.pos++];
    if (!t) throw new ExprError('Выражение оборвалось');
    if (t.k === 'time') return { t: 'time', v: t.v };
    if (t.k === 'num') {
      const u = this.peek();
      if (u?.k === 'unit') {
        this.pos += 1;
        let total = u.v === 'h' ? t.v * 60 : t.v;
        // «1ч 30м» — несколько частей подряд
        while (this.peek()?.k === 'num' && this.toks[this.pos + 1]?.k === 'unit') {
          const n2 = this.toks[this.pos] as { k: 'num'; v: number };
          const u2 = this.toks[this.pos + 1] as { k: 'unit'; v: 'min' | 'h' };
          total += u2.v === 'h' ? n2.v * 60 : n2.v;
          this.pos += 2;
        }
        return { t: 'dur', v: total };
      }
      return { t: 'num', v: t.v };
    }
    if (t.k === 'ref') return this.resolve(t.v);
    if (t.k === 'op' && t.v === '(') {
      const v = this.expr();
      this.expect(')');
      return v;
    }
    if (t.k === 'fn') {
      this.expect('(');
      const args = [this.expr()];
      while (this.peek()?.k === 'comma') {
        this.pos += 1;
        args.push(this.expr());
      }
      this.expect(')');
      return pick(args, t.v);
    }
    throw new ExprError('Ошибка в выражении');
  }
}

export interface DayCtx {
  date: string;
  builtins: Record<string, Val>;
}

export interface VarLike {
  name: string;
  expr: string;
}

export interface EvalResult {
  val?: Val;
  error?: string;
}

export const BUILTIN_VARS: { name: string; description: string }[] = [
  { name: 'первая_пара', description: 'Начало первой пары в этот день (пусто, если пар нет)' },
  { name: 'конец_пар', description: 'Конец последней пары в этот день' },
  { name: 'пар', description: 'Сколько пар в этот день' },
  { name: 'день_недели', description: '1 — понедельник … 7 — воскресенье' },
  { name: 'чётная_неделя', description: '1 — чётная учебная неделя, 0 — нечётная' },
  { name: 'выходной', description: '1 — суббота или воскресенье' },
];

export const VAR_NAME_RE = /^[a-zA-Zа-яА-ЯёЁ_][a-zA-Zа-яА-ЯёЁ_0-9]*$/;

export function normalizeVarName(raw: string) {
  return raw.trim().replace(/^\{|\}$/g, '').trim().replace(/\s+/g, '_').toLowerCase();
}

export class VarEngine {
  private byName = new Map<string, VarLike>();
  private cache = new Map<string, Val>();

  constructor(vars: VarLike[], private ctxFor: (date: string) => DayCtx) {
    for (const v of vars) this.byName.set(v.name.trim().toLowerCase(), v);
  }

  has(name: string) {
    return this.byName.has(name.toLowerCase());
  }

  evalVar(name: string, date: string, stack: string[] = []): Val {
    let n = name.trim().toLowerCase();
    let d = date;
    const pref = /^(завтра|вчера)\s*:\s*(.+)$/.exec(n);
    if (pref) {
      d = addDays(date, pref[1] === 'завтра' ? 1 : -1);
      n = pref[2].trim();
    }
    const key = `${d}|${n}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    if (stack.includes(key)) throw new ExprError(`Переменная {${n}} ссылается сама на себя`);
    if (stack.length > 40) throw new ExprError('Слишком глубокая цепочка ссылок');

    let val: Val;
    const ctx = this.ctxFor(d);
    if (n in ctx.builtins) {
      val = ctx.builtins[n];
    } else {
      const v = this.byName.get(n);
      if (!v) throw new ExprError(`Нет переменной {${n}}`);
      val = this.evalSource(v.expr, d, [...stack, key]);
    }
    this.cache.set(key, val);
    return val;
  }

  private evalSource(expr: string, date: string, stack: string[]): Val {
    const src = String(expr ?? '').trim();
    if (!src) return { t: 'text', v: '' };
    const toks = tokenize(src);
    if (!toks) return { t: 'text', v: src };
    const hasRef = toks.some((t) => t.k === 'ref');
    try {
      return new Parser(toks, (name) => this.evalVar(name, date, stack)).parseAll();
    } catch (e) {
      if (!hasRef && e instanceof ExprError && !/себя|ссыл/.test(e.message)) return { t: 'text', v: src };
      throw e;
    }
  }

  evalExpr(expr: string, date: string): EvalResult {
    try {
      return { val: this.evalSource(expr, date, []) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  evalName(name: string, date: string): EvalResult {
    try {
      return { val: this.evalVar(name, date) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Значение в минутах (время → минуты от полуночи, длительность/число → минуты) */
  minutes(expr: string, date: string): number | null {
    const r = this.evalExpr(expr, date);
    if (!r.val || r.val.t === 'null' || r.val.t === 'text') return null;
    return r.val.t === 'time' ? normTimeMin(r.val.v) : r.val.v;
  }

  timeOf(name: string, date: string): number | null {
    const r = this.evalName(name, date);
    if (!r.val || r.val.t !== 'time') return null;
    return normTimeMin(r.val.v);
  }
}

export function normTimeMin(v: number) {
  return ((Math.round(v) % 1440) + 1440) % 1440;
}

export function formatVal(v?: Val | null): string {
  if (!v) return '—';
  switch (v.t) {
    case 'num':
      return String(Math.round(v.v * 100) / 100).replace('.', ',');
    case 'dur':
      return fmtDur(v.v);
    case 'time':
      return minToTime(normTimeMin(v.v));
    case 'text':
      return v.v;
    default:
      return 'нет значения';
  }
}

export function valType(v?: Val | null) {
  if (!v) return '';
  return { num: 'число', dur: 'длительность', time: 'время', text: 'текст', null: '—' }[v.t];
}
