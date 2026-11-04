export type Kind =
  | 'class' | 'tutor' | 'work' | 'study' | 'task' | 'sport' | 'rest'
  | 'meal' | 'routine' | 'commute' | 'sleep' | 'other';

export type Category = 'study' | 'work' | 'english' | 'sport' | 'home' | 'other';
export type Horizon = '5y' | '1y' | '6m' | '3m' | '1m' | '1w';
export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface Base {
  id: string;
  updatedAt: number;
  deleted?: boolean;
  _dirty?: 0 | 1;
}

export interface EventRec extends Base {
  date: string;
  start: string;
  end: string;
  title: string;
  kind: Kind;
  fixed?: boolean;
  source: 'ai' | 'manual' | 'tutor';
  taskId?: string | null;
  goalId?: string | null;
  notes?: string;
  status?: 'planned' | 'done' | 'skipped';
  reward?: number | null;
  actualMin?: number | null;
  startedAt?: number | null;
  remindMin?: number | null;
  batch?: string | null;
}

export interface TaskRec extends Base {
  title: string;
  context?: string;
  goalId?: string | null;
  category: Category;
  deadline?: string | null;
  priority?: 1 | 2 | 3;
  estimateMin?: number | null;
  complexity?: number | null;
  reward?: number | null;
  estimateNote?: string;
  steps?: string[];
  status: 'todo' | 'done' | 'archived';
  doneAt?: number | null;
  actualMin?: number | null;
  createdAt: number;
}

export interface GoalRec extends Base {
  title: string;
  horizon: Horizon;
  parentId?: string | null;
  context?: string;
  targetDate?: string | null;
  status: 'active' | 'done' | 'archived';
  progress?: number;
  linkWeight?: boolean;
  createdAt: number;
}

export interface VariableRec extends Base {
  name: string;
  expr: string;
  description?: string;
}

export interface RoutineRec extends Base {
  title: string;
  kind: Kind;
  days: number[];
  when: 'always' | 'study' | 'free';
  startExpr: string;
  durationExpr: string;
  fixed: boolean;
  enabled: boolean;
  remindMin?: number | null;
  reward?: number | null;
  order?: number;
}

/** Отметки для «виртуальных» дел (пары и распорядок): id = `${src}:${srcId}:${date}` */
export interface MarkRec extends Base {
  src: 'class' | 'routine';
  srcId: string;
  date: string;
  status?: 'done' | 'skipped' | null;
  hidden?: boolean;
  start?: string | null;
  end?: string | null;
  startedAt?: number | null;
  actualMin?: number | null;
}

export interface FoodRec extends Base {
  date: string;
  time: string;
  meal: Meal;
  name: string;
  grams?: number | null;
  kcal: number;
  p: number;
  f: number;
  c: number;
  productId?: string | null;
  source: 'ai' | 'manual' | 'product' | 'recipe';
}

export interface ProductRec extends Base {
  name: string;
  kcal: number;
  p: number;
  f: number;
  c: number;
  portion?: number | null;
  favorite?: boolean;
  uses?: number;
  lastUsed?: number;
}

export interface WeightRec extends Base {
  date: string;
  kg: number;
}

export interface FridgeRec extends Base {
  name: string;
  amount?: number | null;
  unit?: string;
  expires?: string | null;
}

export interface RewardRec extends Base {
  title: string;
  cost: number;
  emoji?: string;
}

export interface LedgerRec extends Base {
  ts: number;
  amount: number;
  reason: string;
  kind: 'start' | 'earn' | 'spend' | 'bonus' | 'adjust';
  ref?: string;
}

export interface PriceRec extends Base {
  name: string;
  store: string;
  price: number;
  packGrams: number;
  kcal: number;
  p: number;
  f: number;
  c: number;
  maxPerDayG?: number | null;
  category?: string;
  checkedAt?: number;
}

export type ChatMode = 'chat' | 'plan' | 'tutor' | 'review' | 'decompose';

export interface ChatRec extends Base {
  ts: number;
  role: 'user' | 'assistant';
  text: string;
  mode?: ChatMode;
  targetDays?: string[];
  goalId?: string | null;
  actions?: Action[];
  status?: 'ok' | 'pending' | 'sending' | 'error';
  error?: string;
  replyTo?: string;
  applied?: AppliedInfo | null;
}

export interface AppliedInfo {
  at: number;
  created: { tbl: string; id: string }[];
  removed: { tbl: string; id: string }[];
  varsBefore: { name: string; expr: string | null; id: string | null }[];
  summary: string[];
  undone?: boolean;
}

export interface PlanItemDraft {
  start: string;
  end: string;
  title: string;
  kind: Kind;
  taskId?: string | null;
  taskRef?: string | null;
  goalId?: string | null;
  reward?: number | null;
  notes?: string;
}

export type Action =
  | { type: 'plan'; days: { date: string; replace: boolean; items: PlanItemDraft[] }[] }
  | { type: 'add_event'; date: string; start: string; end: string; title: string; kind: Kind; fixed?: boolean; notes?: string }
  | { type: 'update_event'; id: string; date?: string; start?: string; end?: string; title?: string; notes?: string }
  | { type: 'remove_event'; id: string }
  | { type: 'set_variable'; name: string; expr: string; description?: string }
  | { type: 'delete_variable'; name: string }
  | {
      type: 'add_task'; ref?: string | null; title: string; category: Category; context?: string; deadline?: string | null;
      priority?: 1 | 2 | 3; estimateMin?: number | null; complexity?: number | null; reward?: number | null;
      goalId?: string | null; goalRef?: string | null;
    }
  | { type: 'update_task'; id: string; fields: Partial<TaskRec> }
  | {
      type: 'add_goal'; ref?: string | null; title: string; horizon: Horizon; parentId?: string | null; parentRef?: string | null;
      targetDate?: string | null; context?: string;
    }
  | { type: 'update_goal'; id: string; fields: Partial<GoalRec> }
  | {
      type: 'add_routine'; title: string; kind: Kind; days: number[]; when: RoutineRec['when'];
      startExpr: string; durationExpr: string; fixed: boolean; remindMin?: number | null;
    }
  | { type: 'log_food'; date?: string; items: { name: string; grams?: number | null; kcal: number; p: number; f: number; c: number; meal?: Meal }[] }
  | { type: 'bonus'; amount: number; reason: string };

export interface NutritionProfile {
  sex: 'm' | 'f';
  birthYear?: number | null;
  heightCm?: number | null;
  activity: number;
  targetKg?: number | null;
  targetDate?: string | null;
  override?: { kcal?: number | null; p?: number | null; f?: number | null; c?: number | null };
}

export interface SettingsRec extends Base {
  startBalance: number;
  profileNote: string;
  nutrition: NutritionProfile;
  foodPrefs?: string;
  budgetWeek?: number | null;
  createdAt: number;
}

export interface ClassItem {
  id: string;
  date: string;
  start: string;
  end: string;
  title: string;
  kind: string;
  type: string;
  rooms: string[];
  teachers: string[];
  notes: string[];
}

export interface ScheduleChange {
  id: number;
  ts: number;
  type: 'added' | 'removed' | 'moved' | 'room';
  date: string;
  start: string;
  title: string;
  text: string;
}

export interface ScheduleData {
  group: string;
  fetchedAt: number | null;
  hash?: string;
  version?: string;
  minDate?: string;
  maxDate?: string;
  classes: ClassItem[];
  periods: { begin: string; end: string; title: string }[];
  changes: ScheduleChange[];
  error?: string | null;
}

/** Элемент дня, собранный из пар, распорядка и событий */
export interface DayItem {
  key: string;
  src: 'class' | 'routine' | 'event';
  srcId: string;
  date: string;
  start: string;
  end: string;
  title: string;
  kind: Kind;
  fixed: boolean;
  location?: string;
  subtitle?: string;
  notes?: string;
  status?: 'planned' | 'done' | 'skipped' | null;
  reward: number;
  startedAt?: number | null;
  actualMin?: number | null;
  taskId?: string | null;
  goalId?: string | null;
  remindMin?: number | null;
  hidden?: boolean;
  overnight?: boolean;
  source?: EventRec['source'];
}
