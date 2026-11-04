import { describe, expect, it } from 'vitest';
import { formatVal, NULL, VarEngine, type DayCtx } from './vars';

const t = (h: number, m = 0) => ({ t: 'time' as const, v: h * 60 + m });

function engine(vars: Record<string, string>, firstClass: Record<string, number | null> = {}) {
  const ctxFor = (date: string): DayCtx => ({
    date,
    builtins: {
      первая_пара: firstClass[date] != null ? { t: 'time', v: firstClass[date]! } : NULL,
      пар: { t: 'num', v: firstClass[date] != null ? 3 : 0 },
    },
  });
  return new VarEngine(Object.entries(vars).map(([name, expr]) => ({ name, expr })), ctxFor);
}

describe('VarEngine', () => {
  it('parses literals', () => {
    const e = engine({ a: '40 мин', b: '1ч 30м', c: '07:30', d: '2.5', e: 'ул. Ленина 1', f: '1.5ч' });
    expect(formatVal(e.evalName('a', '2026-11-05').val)).toBe('40 мин');
    expect(e.evalName('b', '2026-11-05').val).toEqual({ t: 'dur', v: 90 });
    expect(e.evalName('c', '2026-11-05').val).toEqual(t(7, 30));
    expect(e.evalName('d', '2026-11-05').val).toEqual({ t: 'num', v: 2.5 });
    expect(e.evalName('e', '2026-11-05').val).toEqual({ t: 'text', v: 'ул. Ленина 1' });
    expect(e.evalName('f', '2026-11-05').val).toEqual({ t: 'dur', v: 90 });
  });

  it('computes wake-up time from first class with min()', () => {
    const vars = {
      дорога_до_вуза: '40 мин',
      сборы: '45 мин',
      обычный_подъём: '08:00',
      подъём: 'min({обычный_подъём}, {первая_пара} - {дорога_до_вуза} - {сборы})',
      сон: '8ч',
      отбой: '{завтра:подъём} - {сон}',
    };
    const e = engine(vars, { '2026-11-03': 7 * 60 + 45, '2026-11-02': 9 * 60 + 40 });
    // вторник: пара в 07:45 → подъём 06:20
    expect(formatVal(e.evalName('подъём', '2026-11-03').val)).toBe('06:20');
    // суббота без пар → обычный подъём
    expect(formatVal(e.evalName('подъём', '2026-11-07').val)).toBe('08:00');
    // отбой в понедельник зависит от подъёма во вторник
    expect(formatVal(e.evalName('отбой', '2026-11-02').val)).toBe('22:20');
    expect(e.timeOf('отбой', '2026-11-02')).toBe(22 * 60 + 20);
  });

  it('reports cycles and missing refs', () => {
    const e = engine({ a: '{b} + 1', b: '{a} + 1' });
    expect(e.evalName('a', '2026-11-05').error).toMatch(/сам/);
    const e2 = engine({ a: '{нет_такой} + 5 мин' });
    expect(e2.evalName('a', '2026-11-05').error).toMatch(/Нет переменной/);
  });

  it('time arithmetic', () => {
    const e = engine({ x: '{первая_пара} - 07:00', y: '10 мин * 3', z: '1ч / 4', w: '{первая_пара} + 30' }, { '2026-11-05': 9 * 60 + 40 });
    expect(formatVal(e.evalName('x', '2026-11-05').val)).toBe('2 ч 40 мин');
    expect(formatVal(e.evalName('y', '2026-11-05').val)).toBe('30 мин');
    expect(formatVal(e.evalName('z', '2026-11-05').val)).toBe('15 мин');
    expect(formatVal(e.evalName('w', '2026-11-05').val)).toBe('10:10');
    // без пар ссылка пустая
    expect(e.evalName('w', '2026-11-07').val).toEqual(NULL);
  });
});
