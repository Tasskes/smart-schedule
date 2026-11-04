import type { Category, Horizon, Kind, Meal } from '../types';

export const KINDS: Record<Kind, { label: string; emoji: string }> = {
  class: { label: 'Пара', emoji: '🎓' },
  tutor: { label: 'Репетитор', emoji: '👩‍🏫' },
  work: { label: 'Работа', emoji: '💼' },
  study: { label: 'Учёба', emoji: '📚' },
  task: { label: 'Задача', emoji: '✅' },
  sport: { label: 'Спорт', emoji: '🏃' },
  rest: { label: 'Отдых', emoji: '🎮' },
  meal: { label: 'Еда', emoji: '🍽️' },
  routine: { label: 'Рутина', emoji: '🔁' },
  commute: { label: 'Дорога', emoji: '🚌' },
  sleep: { label: 'Сон', emoji: '😴' },
  other: { label: 'Другое', emoji: '📌' },
};

export const KIND_LIST = Object.keys(KINDS) as Kind[];
export const EDITABLE_KINDS: Kind[] = ['study', 'work', 'task', 'tutor', 'sport', 'rest', 'meal', 'routine', 'commute', 'sleep', 'other'];

export function isKind(k: unknown): k is Kind {
  return typeof k === 'string' && k in KINDS;
}

export const CATEGORIES: Record<Category, { label: string; emoji: string; kind: Kind }> = {
  study: { label: 'Учёба', emoji: '📚', kind: 'study' },
  work: { label: 'Работа', emoji: '💼', kind: 'work' },
  english: { label: 'Английский', emoji: '🇬🇧', kind: 'study' },
  sport: { label: 'Спорт и здоровье', emoji: '🏃', kind: 'sport' },
  home: { label: 'Быт', emoji: '🏠', kind: 'task' },
  other: { label: 'Другое', emoji: '📌', kind: 'task' },
};

export function isCategory(c: unknown): c is Category {
  return typeof c === 'string' && c in CATEGORIES;
}

export const HORIZONS: { id: Horizon; label: string; days: number }[] = [
  { id: '5y', label: '5 лет', days: 1826 },
  { id: '1y', label: 'Год', days: 365 },
  { id: '6m', label: 'Полгода', days: 182 },
  { id: '3m', label: 'Квартал', days: 91 },
  { id: '1m', label: 'Месяц', days: 30 },
  { id: '1w', label: 'Неделя', days: 7 },
];

export function horizonLabel(h: Horizon) {
  return HORIZONS.find((x) => x.id === h)?.label || h;
}

export function isHorizon(h: unknown): h is Horizon {
  return typeof h === 'string' && HORIZONS.some((x) => x.id === h);
}

export const MEALS: Record<Meal, { label: string; emoji: string }> = {
  breakfast: { label: 'Завтрак', emoji: '🍳' },
  lunch: { label: 'Обед', emoji: '🍲' },
  dinner: { label: 'Ужин', emoji: '🍝' },
  snack: { label: 'Перекус', emoji: '🍎' },
};

export const MEAL_LIST = Object.keys(MEALS) as Meal[];

export function isMeal(m: unknown): m is Meal {
  return typeof m === 'string' && m in MEALS;
}

export function mealByTime(min: number): Meal {
  if (min < 11 * 60) return 'breakfast';
  if (min < 16 * 60) return 'lunch';
  if (min < 21 * 60) return 'dinner';
  return 'snack';
}
