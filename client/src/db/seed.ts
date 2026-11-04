import type { GoalRec, LedgerRec, RewardRec, RoutineRec, SettingsRec, VariableRec } from '../types';
import { getRaw, put } from './store';

// У стартовых записей фиксированные id и updatedAt = 1: любая твоя правка «новее»,
// поэтому на втором устройстве они не перезапишут то, что ты уже поменял.
const OLD = { updatedAt: 1 };

export const DEFAULT_PROFILE =
  'Студент ТулГУ (группа 720043-03). Есть удалённая работа по заказам: бывают с дедлайнами, бывают без. ' +
  'Я довольно ленивый — план должен быть мягким: без перегруза, с отдыхом и буферами между делами.';

const VARS: [string, string, string][] = [
  ['дорога_до_вуза', '40 мин', 'Сколько добираться до ТулГУ — поменяй под себя'],
  ['сборы', '45 мин', 'Утро: умыться, позавтракать, собраться'],
  ['обычный_подъём', '08:00', 'Во сколько вставать, если пары не с утра'],
  ['подъём', 'min({обычный_подъём}, {первая_пара} - {дорога_до_вуза} - {сборы})', 'Считается сам: чтобы успеть к первой паре'],
  ['сон', '8ч', 'Сколько хочешь спать'],
  ['отбой', '{завтра:подъём} - {сон}', 'Во сколько лечь, чтобы выспаться к завтрашнему подъёму'],
  ['завтрак', '20 мин', 'Длительность завтрака'],
  ['обед', '40 мин', 'Длительность обеда'],
  ['ужин', '30 мин', 'Длительность ужина'],
  ['репетитор', '1ч', 'Обычная длительность занятия с репетитором'],
  ['фокус_блок', '50 мин', 'Один подход к задаче, потом перерыв'],
  ['перерыв', '10 мин', 'Перерыв между делами'],
  ['макс_фокус_в_день', '4ч', 'Максимум сосредоточенной работы в день, кроме пар'],
  ['напоминание', '10 мин', 'За сколько напоминать о делах'],
  ['напоминание_пара', '15 мин', 'За сколько напоминать о парах'],
];

const ROUTINES: Omit<RoutineRec, 'updatedAt'>[] = [
  { id: 'seed-r-wake', title: 'Подъём и сборы', kind: 'routine', days: [1, 2, 3, 4, 5, 6, 7], when: 'always', startExpr: '{подъём}', durationExpr: '{сборы}', fixed: true, enabled: true, remindMin: null, order: 1 },
  { id: 'seed-r-road', title: 'Дорога до вуза', kind: 'commute', days: [1, 2, 3, 4, 5, 6], when: 'study', startExpr: '{первая_пара} - {дорога_до_вуза}', durationExpr: '{дорога_до_вуза}', fixed: true, enabled: true, remindMin: 5, order: 2 },
  { id: 'seed-r-home', title: 'Дорога домой', kind: 'commute', days: [1, 2, 3, 4, 5, 6], when: 'study', startExpr: '{конец_пар}', durationExpr: '{дорога_до_вуза}', fixed: true, enabled: true, remindMin: null, order: 3 },
  { id: 'seed-r-sleep', title: 'Отбой', kind: 'sleep', days: [1, 2, 3, 4, 5, 6, 7], when: 'always', startExpr: '{отбой}', durationExpr: '0', fixed: true, enabled: true, remindMin: 20, order: 9 },
];

const REWARDS: Omit<RewardRec, 'updatedAt'>[] = [
  { id: 'seed-w-series', title: 'Серия сериала', cost: 40, emoji: '📺' },
  { id: 'seed-w-snack', title: 'Вкусняшка', cost: 50, emoji: '🍫' },
  { id: 'seed-w-games', title: 'Час игр', cost: 60, emoji: '🎮' },
  { id: 'seed-w-evening', title: 'Свободный вечер без планов', cost: 200, emoji: '🛋️' },
  { id: 'seed-w-out', title: 'Кино или выход куда-нибудь', cost: 300, emoji: '🎬' },
];

const now = Date.now();
const GOALS: Omit<GoalRec, 'updatedAt'>[] = [
  {
    id: 'seed-g-toefl', title: 'Сдать TOEFL', horizon: '5y', targetDate: '2029-06-01', status: 'active', progress: 0, createdAt: now,
    context: 'Срок: через 2–3 года. Допиши: текущий уровень английского, нужный балл и зачем он нужен.',
  },
  {
    id: 'seed-g-weight', title: 'Похудеть на 15 кг к лету', horizon: '1y', targetDate: '2027-06-01', status: 'active', progress: 0, createdAt: now,
    linkWeight: true, context: 'Темп ~0,5 кг в неделю. Питание по КБЖУ из вкладки «Еда», плюс активность.',
  },
  {
    id: 'seed-g-session', title: 'Сдать зимнюю сессию на 5', horizon: '3m', targetDate: '2027-01-25', status: 'active', progress: 0, createdAt: now,
    context: 'Сессия 23.12.2026–25.01.2027. Допиши, какие экзамены и зачёты и что даётся тяжелее.',
  },
];

export function seedIfNeeded() {
  if (!getRaw('settings', 'main')) {
    const settings: Omit<SettingsRec, 'updatedAt'> = {
      id: 'main',
      startBalance: 100,
      profileNote: DEFAULT_PROFILE,
      nutrition: { sex: 'm', birthYear: null, heightCm: null, activity: 1.375, targetKg: null, targetDate: '2027-06-01', override: {} },
      foodPrefs: '',
      budgetWeek: null,
      createdAt: now,
    };
    put('settings', settings, OLD);
  }
  VARS.forEach(([name, expr, description]) => {
    const id = `seed-v-${name}`;
    if (!getRaw('variables', id)) put('variables', { id, name, expr, description } as VariableRec, OLD);
  });
  for (const r of ROUTINES) if (!getRaw('routines', r.id)) put('routines', r, OLD);
  for (const r of REWARDS) if (!getRaw('rewards', r.id)) put('rewards', r, OLD);
  for (const g of GOALS) if (!getRaw('goals', g.id)) put('goals', g, OLD);
  if (!getRaw('ledger', 'start')) {
    const start: Omit<LedgerRec, 'updatedAt'> = { id: 'start', ts: now, amount: 100, reason: 'Стартовый баланс', kind: 'start' };
    put('ledger', start, OLD);
  }
}
