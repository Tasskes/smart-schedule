import solver from 'javascript-lp-solver';
import type { PriceRec } from '../types';
import { r1, type Macros } from './nutrition';

export interface BasketLine {
  item: PriceRec;
  grams: number;
  packs: number;
  cost: number;
  perDayG: number;
}

export interface BasketResult {
  feasible: boolean;
  lines: BasketLine[];
  total: number;
  perDay: Macros;
  note: string;
}

/** Сколько граммов продукта в день разумно максимум (чтобы корзина была разнообразной) */
export function defaultDailyCap(p: Pick<PriceRec, 'kcal' | 'maxPerDayG'>) {
  if (p.maxPerDayG) return p.maxPerDayG;
  if (p.kcal >= 700) return 30; // масла
  if (p.kcal >= 400) return 70; // орехи, сладкое, сухие крупы — отдельно ниже
  return 350;
}

/**
 * «Задача о диете»: минимальная стоимость при условии, что КБЖУ на N дней попадает в норму.
 * Решается линейным программированием, потом округляется до целых упаковок.
 */
export function buildBasket(items: PriceRec[], norms: Macros, days = 7): BasketResult {
  const usable = items.filter((i) => i.price > 0 && i.packGrams > 0 && i.kcal > 0);
  if (usable.length < 3) {
    return { feasible: false, lines: [], total: 0, perDay: { kcal: 0, p: 0, f: 0, c: 0 }, note: 'Добавь хотя бы 3–5 продуктов с ценами — тогда соберу корзину.' };
  }
  const attempts: { kcal: [number, number]; p: number; f: [number, number]; c: [number, number]; label: string }[] = [
    { kcal: [0.95, 1.05], p: 1, f: [0.8, 1.2], c: [0.75, 1.15], label: '' },
    { kcal: [0.93, 1.07], p: 0.9, f: [0.7, 1.35], c: [0.6, 1.3], label: 'Пришлось немного ослабить ограничения по жирам и углеводам.' },
    { kcal: [0.9, 1.1], p: 0.75, f: [0.5, 1.6], c: [0.4, 1.6], label: 'Из этих продуктов точное КБЖУ не собрать — корзина приблизительная. Добавь больше белковых продуктов.' },
  ];

  for (const a of attempts) {
    const model = {
      optimize: 'cost',
      opType: 'min' as const,
      constraints: {
        kcal: { min: norms.kcal * days * a.kcal[0], max: norms.kcal * days * a.kcal[1] },
        p: { min: norms.p * days * a.p },
        f: { min: norms.f * days * a.f[0], max: norms.f * days * a.f[1] },
        c: { min: norms.c * days * a.c[0], max: norms.c * days * a.c[1] },
      } as Record<string, { min?: number; max?: number }>,
      variables: {} as Record<string, Record<string, number>>,
    };
    usable.forEach((it, i) => {
      const key = `x${i}`;
      model.variables[key] = { cost: (it.price / it.packGrams) * 100, kcal: it.kcal, p: it.p, f: it.f, c: it.c, [`cap${i}`]: 1 };
      model.constraints[`cap${i}`] = { max: (defaultDailyCap(it) * days) / 100 };
    });
    const res = solver.Solve(model) as Record<string, number | boolean | undefined> & { feasible: boolean };
    if (!res.feasible) continue;
    const lines: BasketLine[] = [];
    usable.forEach((it, i) => {
      const units = Number(res[`x${i}`] || 0);
      const grams = Math.round(units * 100);
      if (grams < 30) return;
      const packs = Math.max(1, Math.ceil(grams / it.packGrams - 0.15));
      lines.push({ item: it, grams, packs, cost: Math.round(packs * it.price), perDayG: Math.round(grams / days) });
    });
    const perDay = lines.reduce(
      (s, l) => ({
        kcal: s.kcal + (l.item.kcal * l.grams) / 100 / days,
        p: s.p + (l.item.p * l.grams) / 100 / days,
        f: s.f + (l.item.f * l.grams) / 100 / days,
        c: s.c + (l.item.c * l.grams) / 100 / days,
      }),
      { kcal: 0, p: 0, f: 0, c: 0 },
    );
    return {
      feasible: true,
      lines: lines.sort((x, y) => (x.item.store || '').localeCompare(y.item.store || '') || y.cost - x.cost),
      total: lines.reduce((s, l) => s + l.cost, 0),
      perDay: { kcal: Math.round(perDay.kcal), p: r1(perDay.p), f: r1(perDay.f), c: r1(perDay.c) },
      note: a.label,
    };
  }
  return { feasible: false, lines: [], total: 0, perDay: { kcal: 0, p: 0, f: 0, c: 0 }, note: 'Из этих продуктов норму не собрать. Добавь белковые продукты (курица, творог, яйца) и крупы.' };
}
