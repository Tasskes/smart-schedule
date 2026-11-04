import { BUILTIN_PRODUCTS, normalizeText, searchProducts } from '../data/products';
import type { FridgeRec, ProductRec } from '../types';
import { daysToExpiry, isActive, toGrams } from './fridge';

// Когда пора в магазин: сколько дней ещё хватит еды из холодильника и каких базовых продуктов нет.

const STAPLES: { re: RegExp; label: string }[] = [
  { re: /яйц|яйко/, label: 'яйца' },
  { re: /молок|кефир|йогурт|творог|сметан|ряженк/, label: 'молочное' },
  { re: /хлеб|батон|лаваш|хлебц/, label: 'хлеб' },
  { re: /круп|греч|рис|овсян|макарон|булгур|пшен|киноа|картоф/, label: 'крупы или картошка' },
  { re: /кур|индейк|мясо|говяд|свин|фарш|рыб|минтай|тунец|креветк/, label: 'мясо или рыба' },
  { re: /огур|помидор|капуст|морков|перец|брокколи|кабач|овощ|салат|лук/, label: 'овощи' },
  { re: /яблок|банан|апельсин|мандарин|груш|фрукт|киви|ягод/, label: 'фрукты' },
];

export interface ShoppingStatus {
  daysLeft: number | null;
  kcal: number;
  missing: string[];
  expiringSoon: FridgeRec[];
  needed: boolean;
  urgency: 'now' | 'soon' | 'ok';
  reason: string;
}

function per100(name: string, products: ProductRec[]) {
  const mine = searchProducts(products, name, 1)[0];
  if (mine) return mine.kcal;
  return searchProducts(BUILTIN_PRODUCTS, name, 1)[0]?.kcal ?? null;
}

export function shoppingStatus(fridge: FridgeRec[], products: ProductRec[], normKcal: number, today: string): ShoppingStatus {
  const active = fridge.filter(isActive);
  let kcal = 0;
  for (const f of active) {
    const g = toGrams(f);
    const k = per100(f.name, products);
    if (g != null && k != null) kcal += (g * k) / 100;
  }
  const names = active.map((f) => normalizeText(f.name)).join(' | ');
  const missing = STAPLES.filter((s) => !s.re.test(names)).map((s) => s.label);
  const expiringSoon = active.filter((f) => {
    const d = daysToExpiry(f, today);
    return d != null && d <= 1;
  });
  const daysLeft = normKcal > 0 ? Math.round((kcal / normKcal) * 10) / 10 : null;
  let urgency: ShoppingStatus['urgency'] = 'ok';
  let reason = 'Продуктов пока хватает';
  if (!active.length) {
    urgency = 'now';
    reason = 'Холодильник пуст';
  } else if ((daysLeft != null && daysLeft < 1) || missing.length >= 4) {
    urgency = 'now';
    reason = daysLeft != null && daysLeft < 1 ? `Еды меньше чем на день` : `Нет: ${missing.slice(0, 4).join(', ')}`;
  } else if ((daysLeft != null && daysLeft < 2.5) || missing.length >= 3) {
    urgency = 'soon';
    reason = daysLeft != null && daysLeft < 2.5 ? `Еды примерно на ${String(daysLeft).replace('.', ',')} дн.` : `Нет: ${missing.slice(0, 3).join(', ')}`;
  }
  return { daysLeft, kcal: Math.round(kcal), missing, expiringSoon, needed: urgency !== 'ok', urgency, reason };
}
