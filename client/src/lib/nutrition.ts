import type { FoodRec, NutritionProfile, WeightRec } from '../types';
import { daysBetween, todayStr } from './dates';

export interface Macros {
  kcal: number;
  p: number;
  f: number;
  c: number;
}

export interface Norms extends Macros {
  bmr: number | null;
  tdee: number | null;
  weeklyLossKg: number | null;
  note: string;
  complete: boolean;
}

export const ACTIVITY_LEVELS = [
  { v: 1.2, label: 'Сидячий образ жизни' },
  { v: 1.375, label: 'Лёгкая активность (1–3 тренировки или много ходьбы)' },
  { v: 1.55, label: 'Средняя (3–5 тренировок в неделю)' },
  { v: 1.725, label: 'Высокая (6–7 тренировок)' },
];

export const r1 = (n: number) => Math.round(n * 10) / 10;

export function latestWeight(weights: WeightRec[]) {
  const sorted = [...weights].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.length ? sorted[sorted.length - 1] : null;
}

/** Нормы КБЖУ: формула Миффлина — Сан-Жеора, безопасный дефицит не больше 25% и ~1% веса в неделю */
export function calcNorms(profile: NutritionProfile | undefined, currentKg: number | null, today = todayStr()): Norms {
  const ov = profile?.override || {};
  const year = Number(today.slice(0, 4));
  const age = profile?.birthYear ? year - profile.birthYear : null;
  const h = profile?.heightCm || null;
  let result: Norms;
  if (!profile || !currentKg || !h || !age) {
    result = { kcal: 2000, p: 100, f: 70, c: 245, bmr: null, tdee: null, weeklyLossKg: null, complete: false, note: 'Заполни рост, год рождения и вес — посчитаю твою норму.' };
  } else {
    const bmr = 10 * currentKg + 6.25 * h - 5 * age + (profile.sex === 'f' ? -161 : 5);
    const tdee = bmr * (profile.activity || 1.375);
    let kcal = tdee;
    let weeklyLossKg: number | null = null;
    let note = 'Поддержание веса.';
    const target = profile.targetKg || null;
    if (target && target < currentKg) {
      const weeks = profile.targetDate ? Math.max(1, daysBetween(today, profile.targetDate) / 7) : 26;
      const needed = (currentKg - target) / weeks;
      const safe = Math.min(needed, currentKg * 0.01);
      let deficit = (safe * 7700) / 7;
      deficit = Math.min(deficit, tdee * 0.25);
      const floor = profile.sex === 'f' ? 1200 : 1500;
      kcal = Math.max(tdee - deficit, floor);
      weeklyLossKg = r1(((tdee - kcal) * 7) / 7700);
      note =
        needed > safe + 0.05
          ? `Чтобы успеть к сроку, нужно −${r1(needed)} кг/нед — это слишком быстро. Ставлю безопасный темп ≈ −${weeklyLossKg} кг/нед.`
          : `Темп ≈ −${weeklyLossKg} кг в неделю — успеваешь к цели.`;
    } else if (target && target > currentKg) {
      kcal = tdee * 1.1;
      note = 'Небольшой профицит для набора массы.';
    }
    const ref = target ? Math.min(currentKg, Math.max(target, currentKg - 20)) : currentKg;
    let p = Math.round(1.8 * ref);
    if (p * 4 > kcal * 0.35) p = Math.round((kcal * 0.35) / 4);
    const f = Math.round(Math.max(0.8 * ref, (kcal * 0.25) / 9));
    const c = Math.max(0, Math.round((kcal - p * 4 - f * 9) / 4));
    result = { kcal: Math.round(kcal), p, f, c, bmr: Math.round(bmr), tdee: Math.round(tdee), weeklyLossKg, note, complete: true };
  }
  if (ov.kcal) result.kcal = ov.kcal;
  if (ov.p) result.p = ov.p;
  if (ov.f) result.f = ov.f;
  if (ov.c) result.c = ov.c;
  return result;
}

export function sumMacros(list: Pick<FoodRec, 'kcal' | 'p' | 'f' | 'c'>[]): Macros {
  return list.reduce(
    (a, x) => ({ kcal: a.kcal + (x.kcal || 0), p: a.p + (x.p || 0), f: a.f + (x.f || 0), c: a.c + (x.c || 0) }),
    { kcal: 0, p: 0, f: 0, c: 0 },
  );
}

export function scale(per100: Macros, grams: number): Macros {
  const k = grams / 100;
  return { kcal: Math.round(per100.kcal * k), p: r1(per100.p * k), f: r1(per100.f * k), c: r1(per100.c * k) };
}

/** Проверка правдоподобности: ккал ≈ 4Б + 9Ж + 4У */
export function fixMacros(m: Partial<Macros>): Macros {
  const p = Math.max(0, Number(m.p) || 0);
  const f = Math.max(0, Number(m.f) || 0);
  const c = Math.max(0, Number(m.c) || 0);
  let kcal = Math.max(0, Number(m.kcal) || 0);
  const fromMacros = p * 4 + f * 9 + c * 4;
  if (!kcal && fromMacros) kcal = fromMacros;
  return { kcal: Math.round(kcal), p: r1(p), f: r1(f), c: r1(c) };
}
