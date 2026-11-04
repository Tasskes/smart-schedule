// Общие помощники для разбора ответов нейросети

export function parseJsonLoose(text) {
  if (!text) return null;
  let s = String(text).trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    /* вырежем объект */
  }
  const start = s.search(/[{[]/);
  if (start < 0) return null;
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Короткие ссылки на записи для нейросети вместо длинных id */
export class RefMap {
  constructor() {
    this.toId = new Map();
    this.toRef = new Map();
  }

  ref(prefix, id) {
    if (this.toRef.has(id)) return this.toRef.get(id);
    const h = fnv1a(id).padStart(7, '0');
    let len = 4;
    let r = prefix + h.slice(0, len);
    while (this.toId.has(r) && this.toId.get(r) !== id && len < h.length) {
      len += 1;
      r = prefix + h.slice(0, len);
    }
    if (this.toId.has(r) && this.toId.get(r) !== id) r = `${prefix}${h}${this.toId.size}`;
    this.toId.set(r, id);
    this.toRef.set(id, r);
    return r;
  }

  resolve(r) {
    if (typeof r !== 'string') return undefined;
    return this.toId.get(r.trim());
  }
}

export const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

export function numOr(v, d = null) {
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : d;
}

export function normTime(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(str(t));
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export const toMin = (t) => {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
};

export const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
