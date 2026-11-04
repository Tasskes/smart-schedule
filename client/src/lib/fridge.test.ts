import { describe, expect, it } from 'vitest';
import type { FridgeRec } from '../types';
import { consumeGrams, estimateExpiry, matchFridge, parseAmountToGrams, shelfLifeDays, toGrams } from './fridge';
import { shoppingStatus } from './shopping';

const item = (name: string, amount: number | null, unit: string, extra: Partial<FridgeRec> = {}): FridgeRec => ({
  id: name, name, amount, unit, updatedAt: 1, status: 'ok', ...extra,
});

describe('fridge', () => {
  it('shelf life by product type', () => {
    expect(shelfLifeDays('Куриное филе охлаждённое')).toBe(3);
    expect(shelfLifeDays('Молоко 2,5%')).toBe(5);
    expect(shelfLifeDays('Гречка ядрица')).toBe(365);
    expect(shelfLifeDays('Что-то непонятное')).toBe(7);
    expect(estimateExpiry('фарш', '2026-11-09')).toBe('2026-11-11');
  });

  it('matches eaten food to fridge items and deducts grams', () => {
    const fridge = [item('Гречка ядрица', 900, 'г'), item('Куриная грудка', 1, 'кг'), item('Яйца', 10, 'шт')];
    expect(matchFridge('гречка варёная', fridge)!.name).toBe('Гречка ядрица');
    expect(matchFridge('грудка куриная запечённая', fridge)!.name).toBe('Куриная грудка');
    expect(matchFridge('яйцо', fridge)!.name).toBe('Яйца');
    expect(matchFridge('банан', fridge)).toBeNull();
    expect(consumeGrams(fridge[0], 200)).toEqual({ amount: 700, used: false });
    expect(consumeGrams(fridge[1], 250)).toEqual({ amount: 0.75, used: false });
    expect(consumeGrams(fridge[2], 110)).toEqual({ amount: 8, used: false }); // 2 яйца по 55 г
    expect(consumeGrams(item('Молоко', 1, 'л'), 990)).toEqual({ amount: 0, used: true });
    expect(consumeGrams(item('Соус', 1, 'уп'), 50)).toBeNull();
  });

  it('prefers the item that expires sooner and skips spoiled ones', () => {
    const fridge = [
      item('Молоко', 1, 'л', { id: 'new', expires: '2026-11-15' }),
      item('Молоко', 1, 'л', { id: 'old', expires: '2026-11-10' }),
      item('Молоко', 1, 'л', { id: 'bad', expires: '2026-11-01', status: 'spoiled' }),
    ];
    expect(matchFridge('молоко', fridge)!.id).toBe('old');
  });

  it('parses recipe amounts', () => {
    expect(parseAmountToGrams('150 г', 'курица')).toBe(150);
    expect(parseAmountToGrams('0,5 кг', 'гречка')).toBe(500);
    expect(parseAmountToGrams('2 шт', 'яйца')).toBe(110);
    expect(parseAmountToGrams('по вкусу', 'соль')).toBeNull();
    expect(toGrams(item('Кефир', 0.5, 'л'))).toBe(500);
  });

  it('decides when shopping is needed', () => {
    const empty = shoppingStatus([], [], 2000, '2026-11-09');
    expect(empty.urgency).toBe('now');
    const full = shoppingStatus(
      [
        item('Гречка', 2, 'кг'),
        item('Куриная грудка', 2, 'кг'),
        item('Яйца', 20, 'шт'),
        item('Молоко', 2, 'л'),
        item('Хлеб', 1, 'шт'),
        item('Огурцы', 1, 'кг'),
        item('Яблоки', 1, 'кг'),
      ],
      [],
      2000,
      '2026-11-09',
    );
    expect(full.needed).toBe(false);
    expect(full.daysLeft!).toBeGreaterThan(3);
    const low = shoppingStatus([item('Гречка', 200, 'г'), item('Яйца', 2, 'шт')], [], 2000, '2026-11-09');
    expect(low.needed).toBe(true);
    expect(low.missing).toContain('овощи');
  });
});
