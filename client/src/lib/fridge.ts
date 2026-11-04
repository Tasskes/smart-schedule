import { BUILTIN_PRODUCTS, normalizeText, searchProducts } from '../data/products';
import type { FridgeRec } from '../types';
import { addDays, daysBetween } from './dates';

// ---------- Сроки хранения (в холодильнике после покупки), дни ----------

const SHELF: [RegExp, number][] = [
  [/фарш/, 2],
  [/рыб|минтай|треск|лосос|семг|горбуш|скумбри|креветк|кальмар/, 2],
  [/ягод|клубник|малин|черник|голубик/, 3],
  [/суп|борщ|щи|плов|котлет|оливье|готов/, 3],
  [/кур|индейк|цыпл|филе|грудк|бедр|окороч|крыл/, 3],
  [/говяд|свин|мясо|баран|печен/, 3],
  [/творог|творож/, 4],
  [/хлеб|батон|лаваш|булк|багет/, 4],
  [/салат|зелен|укроп|петрушк|шпинат|руккол|кинз/, 4],
  [/молок|сливк/, 5],
  [/кефир|ряженк|простокваш|айран/, 5],
  [/банан/, 5],
  [/сосиск|сардельк/, 5],
  [/сметан/, 7],
  [/колбас|ветчин/, 7],
  [/огур|помидор|томат|перец|кабач|баклаж|гриб|шампиньон/, 7],
  [/виноград/, 7],
  [/йогурт/, 10],
  [/сыр/, 14],
  [/апельсин|мандарин|лимон|грейпфрут/, 14],
  [/яблок|груш/, 21],
  [/капуст|морков|свекл|редис/, 21],
  [/яйц|яйко/, 25],
  [/масло слив|сливочн/, 30],
  [/картоф|картошк|лук|чеснок/, 30],
  [/соус|кетчуп|майонез|горчиц/, 60],
  [/заморож|пельмен|вареник/, 90],
  [/шоколад|печень|конфет|вафл/, 90],
  [/консерв|тушенк|горош|кукуруз|тунец/, 365],
  [/круп|греч|рис|овсян|пшен|булгур|киноа|макарон|спагетти|мук|сахар|соль|чай|кофе|орех|семечк|масло раст|подсолн/, 365],
];

export function shelfLifeDays(name: string) {
  const n = normalizeText(name);
  for (const [re, d] of SHELF) if (re.test(n)) return d;
  return 7;
}

export function estimateExpiry(name: string, today: string) {
  return addDays(today, shelfLifeDays(name));
}

// ---------- Количество ----------

const UNIT_G: Record<string, number> = { г: 1, кг: 1000, мл: 1, л: 1000 };

export function pieceWeight(name: string): number | null {
  const n = normalizeText(name);
  if (/яйц|яйко/.test(n)) return 55;
  const p = searchProducts(BUILTIN_PRODUCTS, name, 1)[0];
  return p?.portion && p.portionLabel === 'шт' ? p.portion : null;
}

export function toGrams(item: Pick<FridgeRec, 'amount' | 'unit' | 'name'>): number | null {
  if (item.amount == null || !Number.isFinite(item.amount)) return null;
  const u = (item.unit || '').trim();
  if (u in UNIT_G) return item.amount * UNIT_G[u];
  if (u === 'шт') {
    const pw = pieceWeight(item.name);
    return pw ? item.amount * pw : null;
  }
  return null;
}

function fromGrams(item: Pick<FridgeRec, 'unit' | 'name'>, grams: number) {
  const u = (item.unit || '').trim();
  if (u in UNIT_G) return grams / UNIT_G[u];
  if (u === 'шт') {
    const pw = pieceWeight(item.name);
    return pw ? grams / pw : null;
  }
  return null;
}

const round = (n: number, unit?: string) => (unit === 'шт' ? Math.max(0, Math.round(n * 2) / 2) : unit === 'кг' || unit === 'л' ? Math.round(n * 100) / 100 : Math.round(n));

// ---------- Поиск продукта в холодильнике по названию еды ----------

const stems = (s: string) =>
  normalizeText(s)
    .split(' ')
    .filter((w) => w.length >= 3 && !/^\d/.test(w))
    .map((w) => (w.length >= 6 ? w.slice(0, 5) : w.length >= 4 ? w.slice(0, w.length - 1) : w));

export function isActive(f: FridgeRec) {
  return !f.status || f.status === 'ok';
}

export function matchFridge(name: string, fridge: FridgeRec[]): FridgeRec | null {
  const want = stems(name);
  if (!want.length) return null;
  let best: { f: FridgeRec; score: number } | null = null;
  for (const f of fridge.filter(isActive)) {
    const have = stems(f.name);
    const score = want.filter((w) => have.some((h) => h.startsWith(w) || w.startsWith(h))).length;
    if (!score) continue;
    const better =
      !best ||
      score > best.score ||
      (score === best.score && (f.expires || '9999') < (best.f.expires || '9999'));
    if (better) best = { f, score };
  }
  return best ? best.f : null;
}

/** Списать граммы из продукта. null — количество неизвестно или единицы не переводятся в граммы */
export function consumeGrams(item: FridgeRec, grams: number): { amount: number; used: boolean } | null {
  const g = toGrams(item);
  if (g == null) return null;
  const left = g - Math.max(0, grams);
  if (left <= Math.max(5, g * 0.03)) return { amount: 0, used: true };
  const amount = fromGrams(item, left);
  if (amount == null) return null;
  return { amount: round(amount, item.unit), used: false };
}

/** «150 г», «2 шт», «0,5 л», «1 кг» → граммы (ложки и «по вкусу» — null) */
export function parseAmountToGrams(text: string, name: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(кг|гр|г|мл|л|шт)(?![а-яё])/i.exec(text || '');
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  const u = m[2].toLowerCase() === 'гр' ? 'г' : m[2].toLowerCase();
  return toGrams({ amount: n, unit: u, name });
}

// ---------- Сроки ----------

export function daysToExpiry(item: FridgeRec, today: string) {
  return item.expires ? daysBetween(today, item.expires) : null;
}

/** Через сколько дней после окончания срока продукт считаем испорченным автоматически */
export const SPOIL_GRACE_DAYS = 2;
