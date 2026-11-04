import { BUILTIN_PRODUCTS, normalizeText, searchProducts } from '../data/products';
import { all, get } from '../db/store';
import { adjustedEstimate, factorFor, personalFactors, taskSpent } from '../lib/estimate';
import { isMeal } from '../lib/meta';
import { calcNorms, fixMacros, latestWeight, sumMacros, type Macros } from '../lib/nutrition';
import { isDateStr, todayStr } from '../lib/dates';
import type { Category, Meal, TaskRec } from '../types';
import { aiRequest, dataBlock, parseJsonLoose } from './client';
import { ESTIMATE_SYSTEM, FOOD_SYSTEM, FRIDGE_SYSTEM, RECIPES_SYSTEM } from './prompts';

type Raw = Record<string, unknown>;
const num = (v: unknown, d = 0) => {
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : d;
};

// ---------- Оценка задачи ----------

export interface Estimate {
  estimateMin: number;
  adjustedMin: number;
  factor: number;
  complexity: number;
  reward: number;
  splitInto: number;
  steps: string[];
  explanation: string;
}

export async function estimateTask(t: Pick<TaskRec, 'title' | 'context' | 'category' | 'deadline' | 'goalId'>): Promise<Estimate> {
  const tasks = all('tasks');
  const events = all('events');
  const factors = personalFactors(tasks, events);
  const goal = t.goalId ? get('goals', t.goalId) : undefined;
  const similar = tasks
    .filter((x) => x.status === 'done' && x.category === t.category && x.estimateMin)
    .slice(-8)
    .map((x) => ({ title: x.title, est: x.estimateMin, actual: taskSpent(x, events) }));
  const data = {
    mode: 'estimate',
    task: { title: t.title, context: t.context || '', category: t.category, deadline: t.deadline || null },
    goal: goal ? { title: goal.title, context: goal.context || '' } : null,
    similar,
    personalFactor: factorFor(t.category as Category, factors),
    today: todayStr(),
  };
  const raw = await aiRequest({
    system: ESTIMATE_SYSTEM,
    messages: [{ role: 'user', content: `Оцени задачу: ${t.title}${dataBlock(data)}` }],
    json: true,
    tier: 'fast',
    temperature: 0.2,
    maxTokens: 900,
  });
  const j = parseJsonLoose<Raw>(raw);
  if (!j) throw new Error('Нейросеть ответила непонятно, попробуй ещё раз');
  const estimateMin = Math.max(5, Math.round(num(j.estimateMin, 60)));
  const factor = factorFor(t.category as Category, factors);
  const adjusted = adjustedEstimate({ estimateMin, category: t.category } as TaskRec, factors) ?? estimateMin;
  return {
    estimateMin,
    adjustedMin: adjusted,
    factor,
    complexity: Math.min(5, Math.max(1, Math.round(num(j.complexity, 3)))),
    reward: Math.min(150, Math.max(1, Math.round(num(j.reward, estimateMin / 5)))),
    splitInto: Math.max(1, Math.round(num(j.splitInto, 1))),
    steps: Array.isArray(j.steps) ? (j.steps as unknown[]).map(String).slice(0, 10) : [],
    explanation: String(j.explanation || ''),
  };
}

// ---------- Разбор еды ----------

export interface FoodDraft extends Macros {
  name: string;
  grams: number | null;
}

function referenceFor(text: string) {
  const words = normalizeText(text).split(' ').filter((w) => w.length >= 3);
  const products = [
    ...all('products').map((p) => ({ name: p.name, kcal: p.kcal, p: p.p, f: p.f, c: p.c })),
    ...BUILTIN_PRODUCTS,
  ];
  const found = new Map<string, (typeof products)[number]>();
  for (const w of words) for (const p of searchProducts(products, w, 3)) found.set(p.name, p);
  return [...found.values()].slice(0, 20).map((p) => `${p.name}: ${p.kcal} ккал, Б ${p.p}, Ж ${p.f}, У ${p.c}`);
}

export async function parseFood(text: string): Promise<{ items: FoodDraft[]; meal: Meal | null; comment: string }> {
  const data = { mode: 'food', reference: referenceFor(text) };
  const raw = await aiRequest({
    system: FOOD_SYSTEM,
    messages: [{ role: 'user', content: `${text}${dataBlock(data)}` }],
    json: true,
    tier: 'fast',
    temperature: 0.1,
    maxTokens: 1500,
  });
  const j = parseJsonLoose<Raw>(raw);
  const list = Array.isArray(j?.items) ? (j!.items as Raw[]) : [];
  const items = list
    .map((it) => ({ name: String(it.name || '').slice(0, 120), grams: it.grams != null ? Math.round(num(it.grams)) : null, ...fixMacros({ kcal: num(it.kcal), p: num(it.p), f: num(it.f), c: num(it.c) }) }))
    .filter((it) => it.name);
  if (!items.length) throw new Error('Не удалось разобрать еду. Напиши, например: «гречка 200 г, куриная грудка 150 г»');
  const meal = isMeal(j?.meal) ? (j!.meal as Meal) : null;
  return { items, meal, comment: String(j?.comment || '') };
}

// ---------- Холодильник ----------

export async function parseFridge(text: string) {
  const raw = await aiRequest({
    system: FRIDGE_SYSTEM,
    messages: [{ role: 'user', content: `${text}${dataBlock({ mode: 'fridge', today: todayStr() })}` }],
    json: true,
    tier: 'fast',
    temperature: 0.1,
    maxTokens: 1500,
  });
  const j = parseJsonLoose<Raw>(raw);
  return (Array.isArray(j?.items) ? (j!.items as Raw[]) : [])
    .map((it) => ({
      name: String(it.name || '').trim().slice(0, 80),
      amount: it.amount != null && it.amount !== '' ? num(it.amount, 0) || null : null,
      unit: String(it.unit || '').slice(0, 10),
      expires: isDateStr(it.expires) ? (it.expires as string) : null,
    }))
    .filter((it) => it.name);
}

// ---------- Рецепты ----------

export interface Recipe {
  title: string;
  timeMin: number;
  servings: number;
  ingredients: { name: string; amount: string; have: boolean }[];
  steps: string[];
  perServing: Macros;
  why: string;
}

export async function suggestRecipes(wish: string): Promise<Recipe[]> {
  const today = todayStr();
  const settings = get('settings', 'main');
  const w = latestWeight(all('weights'));
  const norms = calcNorms(settings?.nutrition, w?.kg ?? null, today);
  const eaten = sumMacros(all('food').filter((f) => f.date === today));
  const fridge = all('fridge').map((f) => ({ name: f.name, amount: f.amount ? `${f.amount} ${f.unit || ''}`.trim() : null, expires: f.expires || null }));
  if (!fridge.length) throw new Error('Холодильник пуст — добавь продукты, и я подберу рецепты');
  const data = {
    mode: 'recipes',
    fridge,
    left: { kcal: Math.round(norms.kcal - eaten.kcal), p: Math.round(norms.p - eaten.p), f: Math.round(norms.f - eaten.f), c: Math.round(norms.c - eaten.c) },
    goal: settings?.nutrition?.targetKg ? 'похудение' : 'поддержание',
    prefs: settings?.foodPrefs || '',
  };
  const raw = await aiRequest({
    system: RECIPES_SYSTEM,
    messages: [{ role: 'user', content: `${wish || 'Что приготовить из того, что есть?'}${dataBlock(data)}` }],
    json: true,
    tier: 'smart',
    temperature: 0.7,
    maxTokens: 3000,
  });
  const j = parseJsonLoose<Raw>(raw);
  const list = Array.isArray(j?.recipes) ? (j!.recipes as Raw[]) : [];
  const recipes = list
    .map((r) => ({
      title: String(r.title || 'Рецепт'),
      timeMin: Math.round(num(r.timeMin, 20)),
      servings: Math.max(1, Math.round(num(r.servings, 1))),
      ingredients: (Array.isArray(r.ingredients) ? (r.ingredients as Raw[]) : []).map((i) => ({
        name: String(i.name || ''),
        amount: String(i.amount || ''),
        have: i.have !== false,
      })),
      steps: (Array.isArray(r.steps) ? (r.steps as unknown[]) : []).map(String),
      perServing: fixMacros((r.perServing as Raw) || {}),
      why: String(r.why || ''),
    }))
    .filter((r) => r.ingredients.length || r.steps.length);
  if (!recipes.length) throw new Error('Не получилось подобрать рецепты, попробуй ещё раз');
  return recipes;
}
