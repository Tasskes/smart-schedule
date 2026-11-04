import { describe, expect, it } from 'vitest';
import type { PriceRec } from '../types';
import { buildBasket } from './basket';

const item = (name: string, price: number, packGrams: number, kcal: number, p: number, f: number, c: number): PriceRec => ({
  id: name, updatedAt: 1, name, store: 'Магазин', price, packGrams, kcal, p, f, c,
});

describe('basket optimizer', () => {
  it('builds a cheap basket that meets macros', () => {
    const items = [
      item('Гречка', 90, 900, 313, 12.6, 3.3, 57.1),
      item('Рис', 110, 900, 344, 6.7, 0.7, 78.9),
      item('Куриная грудка', 450, 1000, 113, 23.6, 1.9, 0.4),
      item('Творог 5%', 120, 300, 121, 17.2, 5, 1.8),
      item('Яйца', 110, 600, 157, 12.7, 10.9, 0.7),
      item('Масло подсолнечное', 150, 900, 899, 0, 99.9, 0),
      item('Овсянка', 80, 500, 352, 12.3, 6.2, 61.8),
      item('Бананы', 130, 1000, 96, 1.5, 0.5, 21),
      item('Капуста', 40, 1000, 27, 1.8, 0.1, 4.7),
    ];
    const norms = { kcal: 2200, p: 140, f: 70, c: 250 };
    const r = buildBasket(items, norms, 7);
    expect(r.feasible).toBe(true);
    expect(r.perDay.kcal).toBeGreaterThan(2200 * 0.9);
    expect(r.perDay.kcal).toBeLessThan(2200 * 1.1);
    expect(r.perDay.p).toBeGreaterThan(140 * 0.95);
    expect(r.total).toBeGreaterThan(0);
    // не больше 350 г в день одного продукта
    for (const l of r.lines) expect(l.perDayG).toBeLessThanOrEqual(351);
  });

  it('reports when there is too little data', () => {
    const r = buildBasket([item('Гречка', 90, 900, 313, 12.6, 3.3, 57.1)], { kcal: 2000, p: 100, f: 60, c: 250 });
    expect(r.feasible).toBe(false);
  });
});
