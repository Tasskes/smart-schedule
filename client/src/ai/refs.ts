// Короткие стабильные ссылки на записи для нейросети (вместо длинных UUID): t3k9a, g1x0b, e7pq2

function fnv1a(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export class RefMap {
  private toId = new Map<string, string>();
  private toRefMap = new Map<string, string>();

  ref(prefix: 't' | 'g' | 'e', id: string) {
    const known = this.toRefMap.get(id);
    if (known) return known;
    const h = fnv1a(id).padStart(7, '0');
    let len = 4;
    let r = prefix + h.slice(0, len);
    while (this.toId.has(r) && this.toId.get(r) !== id && len < h.length) {
      len += 1;
      r = prefix + h.slice(0, len);
    }
    if (this.toId.has(r) && this.toId.get(r) !== id) r = `${prefix}${h}${this.toId.size}`;
    this.toId.set(r, id);
    this.toRefMap.set(id, r);
    return r;
  }

  resolve(r: unknown): string | undefined {
    if (typeof r !== 'string') return undefined;
    const key = r.trim();
    return this.toId.get(key) ?? (this.toRefMap.has(key) ? key : undefined);
  }
}
