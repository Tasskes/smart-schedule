import { useMemo, useState } from 'react';
import { parseFood, type FoodDraft } from '../ai/tools';
import { Icon } from '../components/Icon';
import { Field, NumInput, Progress, Seg, Sheet, toast } from '../components/ui';
import { BUILTIN_PRODUCTS, searchProducts } from '../data/products';
import { all, get, patch, put, remove, useRecord, useTable } from '../db/store';
import { addDays, fmtLong, fmtShort, nowMin, nowTime, todayStr } from '../lib/dates';
import { MEAL_LIST, MEALS, mealByTime } from '../lib/meta';
import { ACTIVITY_LEVELS, calcNorms, latestWeight, r1, scale, sumMacros, type Macros } from '../lib/nutrition';
import { openSub } from '../nav';
import type { FoodRec, Meal, NutritionProfile } from '../types';

function Ring({ value, max }: { value: number; max: number }) {
  const r = 48;
  const c = 2 * Math.PI * r;
  const ratio = max ? value / max : 0;
  const color = ratio > 1.05 ? 'var(--danger)' : ratio > 0.85 ? 'var(--ok)' : 'var(--accent)';
  return (
    <div className="kcal-ring">
      <svg width="112" height="112" viewBox="0 0 112 112">
        <circle cx="56" cy="56" r={r} fill="none" stroke="var(--card-2)" strokeWidth="10" />
        <circle cx="56" cy="56" r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${Math.min(1, ratio) * c} ${c}`} />
      </svg>
      <div className="lbl">
        <b>{Math.round(value)}</b>
        <span className="tiny muted">из {max} ккал</span>
      </div>
    </div>
  );
}

function MacroBar({ label, value, max }: { label: string; value: number; max: number }) {
  const ratio = max ? value / max : 0;
  return (
    <div className="macro">
      <div className="row between">
        <span>{label}</span>
        <span className="muted">
          {Math.round(value)} / {max} г
        </span>
      </div>
      <Progress value={ratio} tone={ratio > 1.15 ? 'warn' : ratio > 0.85 ? 'ok' : undefined} />
    </div>
  );
}

function MacroLine({ m }: { m: Macros }) {
  return (
    <span className="tiny muted">
      {Math.round(m.kcal)} ккал · Б {r1(m.p)} · Ж {r1(m.f)} · У {r1(m.c)}
    </span>
  );
}

// ---------- Добавление еды ----------

type AddTab = 'ai' | 'manual' | 'base' | 'recent';

function addFood(date: string, meal: Meal, entry: Omit<FoodRec, 'id' | 'updatedAt' | 'date' | 'meal' | 'time'>) {
  put('food', { ...entry, date, meal, time: nowTime() });
}

function DraftEditor({ draft, onChange, onRemove }: { draft: FoodDraft; onChange: (d: FoodDraft) => void; onRemove: () => void }) {
  return (
    <div className="card flat" style={{ background: 'var(--card-2)', padding: 10 }}>
      <div className="row">
        <input className="input grow" value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} />
        <button className="icon-btn plain" onClick={onRemove} aria-label="Убрать">
          <Icon name="trash" />
        </button>
      </div>
      <div className="grid-4" style={{ marginTop: 8 }}>
        <div>
          <div className="tiny muted">граммы</div>
          <NumInput
            value={draft.grams}
            onChange={(g) => {
              if (g && draft.grams) {
                const k = g / draft.grams;
                onChange({ ...draft, grams: g, kcal: Math.round(draft.kcal * k), p: r1(draft.p * k), f: r1(draft.f * k), c: r1(draft.c * k) });
              } else onChange({ ...draft, grams: g });
            }}
          />
        </div>
        <div>
          <div className="tiny muted">ккал</div>
          <NumInput value={draft.kcal} onChange={(v) => onChange({ ...draft, kcal: v ?? 0 })} />
        </div>
        <div>
          <div className="tiny muted">Б / Ж / У</div>
          <div className="small" style={{ paddingTop: 10 }}>
            {r1(draft.p)} / {r1(draft.f)} / {r1(draft.c)}
          </div>
        </div>
      </div>
    </div>
  );
}

function AddFoodSheet({ date, onClose }: { date: string; onClose: () => void }) {
  const [tab, setTab] = useState<AddTab>('ai');
  const [meal, setMeal] = useState<Meal>(mealByTime(nowMin()));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<FoodDraft[]>([]);
  const [comment, setComment] = useState('');
  // вручную
  const [name, setName] = useState('');
  const [grams, setGrams] = useState<number | null>(null);
  const [kcal, setKcal] = useState<number | null>(null);
  const [p, setP] = useState<number | null>(null);
  const [f, setF] = useState<number | null>(null);
  const [c, setC] = useState<number | null>(null);
  const [saveProduct, setSaveProduct] = useState(false);
  // база
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<{ id: string; name: string; kcal: number; p: number; f: number; c: number; portion?: number | null; portionLabel?: string; mine?: boolean } | null>(null);
  const [pickGrams, setPickGrams] = useState<number | null>(100);
  const products = useTable('products');
  const food = useTable('food');

  const results = useMemo(() => {
    const mine = products.map((x) => ({ ...x, mine: true }));
    return searchProducts([...mine, ...BUILTIN_PRODUCTS], q, 40);
  }, [products, q]);

  const recent = useMemo(() => {
    const seen = new Set<string>();
    return [...food]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter((x) => {
        const k = x.name.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 25);
  }, [food]);

  const count = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const res = await parseFood(text);
      setDrafts(res.items);
      setComment(res.comment);
      if (res.meal) setMeal(res.meal);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveDrafts = () => {
    for (const d of drafts) addFood(date, meal, { name: d.name, grams: d.grams, kcal: d.kcal, p: d.p, f: d.f, c: d.c, source: 'ai' });
    toast(`Добавлено: ${drafts.length}`);
    onClose();
  };

  const saveManual = () => {
    if (!name.trim() || kcal == null) return toast('Нужны название и калории');
    const entry = { name: name.trim(), grams, kcal: Math.round(kcal), p: p ?? 0, f: f ?? 0, c: c ?? 0, source: 'manual' as const };
    let productId: string | null = null;
    if (saveProduct) {
      const g = grams || 100;
      const k = 100 / g;
      productId = put('products', { name: entry.name, kcal: Math.round(entry.kcal * k), p: r1(entry.p * k), f: r1(entry.f * k), c: r1(entry.c * k), portion: g, uses: 1, lastUsed: Date.now() }).id;
    }
    addFood(date, meal, { ...entry, productId });
    toast('Добавлено');
    onClose();
  };

  const savePicked = () => {
    if (!picked || !pickGrams) return;
    const m = scale(picked, pickGrams);
    addFood(date, meal, { name: picked.name, grams: pickGrams, ...m, productId: picked.mine ? picked.id : null, source: 'product' });
    if (picked.mine) {
      const pr = get('products', picked.id);
      if (pr) patch('products', pr.id, { uses: (pr.uses || 0) + 1, lastUsed: Date.now() });
    }
    toast('Добавлено');
    onClose();
  };

  return (
    <Sheet title="Добавить еду" onClose={onClose}>
      <div className="chips" style={{ marginBottom: 8 }}>
        {MEAL_LIST.map((m) => (
          <button key={m} className={`chip ${meal === m ? 'active' : ''}`} onClick={() => setMeal(m)}>
            {MEALS[m].emoji} {MEALS[m].label}
          </button>
        ))}
      </div>
      <Seg<AddTab>
        value={tab}
        onChange={setTab}
        options={[
          { v: 'ai', label: '✨ Текстом' },
          { v: 'manual', label: 'КБЖУ' },
          { v: 'base', label: 'База' },
          { v: 'recent', label: 'Недавнее' },
        ]}
      />
      <div style={{ height: 12 }} />

      {tab === 'ai' ? (
        <>
          <Field label="Что съел" hint="ИИ оценит вес и посчитает КБЖУ. Можно писать как угодно: «тарелка борща и 2 куска хлеба»">
            <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="Гречка 200 г, куриная грудка 150 г, огурец" />
          </Field>
          <button className="btn block" disabled={busy || !text.trim()} onClick={count}>
            {busy ? 'Считаю…' : 'Посчитать'}
          </button>
          {drafts.length ? (
            <div className="stack" style={{ marginTop: 12 }}>
              {drafts.map((d, i) => (
                <DraftEditor
                  key={i}
                  draft={d}
                  onChange={(nd) => setDrafts(drafts.map((x, j) => (j === i ? nd : x)))}
                  onRemove={() => setDrafts(drafts.filter((_, j) => j !== i))}
                />
              ))}
              {comment ? <div className="tiny muted">{comment}</div> : null}
              <div className="center">
                <MacroLine m={sumMacros(drafts)} />
              </div>
              <button className="btn ok block" onClick={saveDrafts}>
                Добавить в дневник
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {tab === 'manual' ? (
        <>
          <Field label="Название">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Протеиновый батончик" />
          </Field>
          <div className="grid-2">
            <Field label="Вес, г (необязательно)">
              <NumInput value={grams} onChange={setGrams} />
            </Field>
            <Field label="Калории (всего)">
              <NumInput value={kcal} onChange={setKcal} />
            </Field>
          </div>
          <div className="grid-3">
            <Field label="Белки, г">
              <NumInput value={p} onChange={setP} />
            </Field>
            <Field label="Жиры, г">
              <NumInput value={f} onChange={setF} />
            </Field>
            <Field label="Углеводы, г">
              <NumInput value={c} onChange={setC} />
            </Field>
          </div>
          <label className="row small" style={{ marginBottom: 12 }}>
            <input type="checkbox" checked={saveProduct} onChange={(e) => setSaveProduct(e.target.checked)} /> Сохранить в «Мои продукты»
          </label>
          <button className="btn block" onClick={saveManual}>
            Добавить
          </button>
        </>
      ) : null}

      {tab === 'base' ? (
        picked ? (
          <>
            <div className="card flat" style={{ background: 'var(--card-2)' }}>
              <div style={{ fontWeight: 600 }}>{picked.name}</div>
              <div className="tiny muted">
                на 100 г: {picked.kcal} ккал · Б {picked.p} · Ж {picked.f} · У {picked.c}
              </div>
            </div>
            <Field label="Сколько, г">
              <NumInput value={pickGrams} onChange={setPickGrams} />
            </Field>
            <div className="chips">
              {[50, 100, 150, 200, 250, 300].map((g) => (
                <button key={g} className={`chip ${pickGrams === g ? 'active' : ''}`} onClick={() => setPickGrams(g)}>
                  {g} г
                </button>
              ))}
              {picked.portion ? (
                <>
                  <button className="chip" onClick={() => setPickGrams(picked.portion!)}>
                    1 {picked.portionLabel || 'порция'} ({picked.portion} г)
                  </button>
                  <button className="chip" onClick={() => setPickGrams(picked.portion! * 2)}>
                    2 {picked.portionLabel || 'порции'}
                  </button>
                </>
              ) : null}
            </div>
            {pickGrams ? (
              <div className="center" style={{ margin: '8px 0 12px' }}>
                <MacroLine m={scale(picked, pickGrams)} />
              </div>
            ) : null}
            <div className="grid-2">
              <button className="btn secondary" onClick={() => setPicked(null)}>
                Назад
              </button>
              <button className="btn" onClick={savePicked}>
                Добавить
              </button>
            </div>
          </>
        ) : (
          <>
            <input className="input" placeholder="Поиск: гречка, творог, банан…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="list" style={{ marginTop: 10 }}>
              {results.map((r) => (
                <button
                  key={r.id}
                  className="list-item"
                  onClick={() => {
                    setPicked(r as never);
                    setPickGrams((r as { portion?: number | null }).portion || 100);
                  }}
                >
                  <div className="grow">
                    <div className="small" style={{ fontWeight: 600 }}>
                      {(r as { mine?: boolean }).mine ? '⭐ ' : ''}
                      {r.name}
                    </div>
                    <div className="tiny muted">
                      {r.kcal} ккал · Б {r.p} · Ж {r.f} · У {r.c} / 100 г
                    </div>
                  </div>
                </button>
              ))}
              {!results.length ? <div className="list-item muted small">Не нашёл — добавь через «КБЖУ» или «Текстом»</div> : null}
            </div>
          </>
        )
      ) : null}

      {tab === 'recent' ? (
        <div className="list">
          {recent.map((r) => (
            <button
              key={r.id}
              className="list-item"
              onClick={() => {
                addFood(date, meal, { name: r.name, grams: r.grams ?? null, kcal: r.kcal, p: r.p, f: r.f, c: r.c, productId: r.productId ?? null, source: r.source });
                toast(`Добавлено: ${r.name}`);
              }}
            >
              <div className="grow">
                <div className="small" style={{ fontWeight: 600 }}>
                  {r.name}
                  {r.grams ? <span className="muted"> · {r.grams} г</span> : null}
                </div>
                <MacroLine m={r} />
              </div>
              <Icon name="plus" />
            </button>
          ))}
          {!recent.length ? <div className="list-item muted small">Пока пусто</div> : null}
        </div>
      ) : null}
    </Sheet>
  );
}

// ---------- Нормы ----------

function NormsSheet({ onClose }: { onClose: () => void }) {
  const settings = useRecord('settings', 'main');
  const [n, setN] = useState<NutritionProfile>(
    settings?.nutrition || { sex: 'm', activity: 1.375, override: {} },
  );
  const [prefs, setPrefs] = useState(settings?.foodPrefs || '');
  const weights = useTable('weights');
  const norms = calcNorms(n, latestWeight(weights)?.kg ?? null);
  const ov = n.override || {};
  const save = () => {
    if (settings) patch('settings', 'main', { nutrition: n, foodPrefs: prefs });
    toast('Сохранено');
    onClose();
  };
  return (
    <Sheet title="Моя норма КБЖУ" onClose={onClose}>
      <div className="grid-2">
        <Field label="Пол">
          <select className="select" value={n.sex} onChange={(e) => setN({ ...n, sex: e.target.value as 'm' | 'f' })}>
            <option value="m">Мужской</option>
            <option value="f">Женский</option>
          </select>
        </Field>
        <Field label="Год рождения">
          <NumInput value={n.birthYear} onChange={(v) => setN({ ...n, birthYear: v })} placeholder="2006" />
        </Field>
        <Field label="Рост, см">
          <NumInput value={n.heightCm} onChange={(v) => setN({ ...n, heightCm: v })} placeholder="180" />
        </Field>
        <Field label="Цель по весу, кг">
          <NumInput value={n.targetKg} onChange={(v) => setN({ ...n, targetKg: v })} placeholder="75" />
        </Field>
      </div>
      <Field label="К какой дате">
        <input className="input" type="date" value={n.targetDate || ''} onChange={(e) => setN({ ...n, targetDate: e.target.value || null })} />
      </Field>
      <Field label="Активность">
        <select className="select" value={n.activity} onChange={(e) => setN({ ...n, activity: Number(e.target.value) })}>
          {ACTIVITY_LEVELS.map((a) => (
            <option key={a.v} value={a.v}>
              {a.label}
            </option>
          ))}
        </select>
      </Field>
      <div className={`banner ${norms.complete ? 'info' : 'warn'}`}>
        <span>📊</span>
        <div className="grow small">
          <b>
            {norms.kcal} ккал · Б {norms.p} · Ж {norms.f} · У {norms.c}
          </b>
          <div>{norms.note}</div>
          {norms.tdee ? <div className="tiny muted">Обмен веществ ≈ {norms.bmr} ккал, расход ≈ {norms.tdee} ккал в день</div> : null}
          {!latestWeight(weights) ? <div className="tiny">Внеси текущий вес на экране «Еда».</div> : null}
        </div>
      </div>
      <div className="section-title">Свои значения (необязательно)</div>
      <div className="grid-4">
        {(['kcal', 'p', 'f', 'c'] as const).map((k) => (
          <Field key={k} label={{ kcal: 'Ккал', p: 'Б', f: 'Ж', c: 'У' }[k]}>
            <NumInput value={ov[k] ?? null} onChange={(v) => setN({ ...n, override: { ...ov, [k]: v } })} />
          </Field>
        ))}
      </div>
      <Field label="Предпочтения в еде" hint="Учитываются в рецептах и корзине: что не ешь, аллергии, бюджет">
        <textarea className="textarea" value={prefs} onChange={(e) => setPrefs(e.target.value)} placeholder="Не люблю рыбу, без молочки…" />
      </Field>
      <button className="btn block" onClick={save}>
        Сохранить
      </button>
    </Sheet>
  );
}

// ---------- Вес ----------

function WeightCard() {
  const weights = useTable('weights');
  const settings = useRecord('settings', 'main');
  const [val, setVal] = useState<number | null>(null);
  const sorted = useMemo(() => [...weights].sort((a, b) => a.date.localeCompare(b.date)), [weights]);
  const last = sorted[sorted.length - 1];
  const first = sorted[0];
  const target = settings?.nutrition?.targetKg || null;
  const pts = sorted.slice(-60);

  const save = () => {
    if (!val || val < 30 || val > 300) return toast('Проверь вес');
    const date = todayStr();
    put('weights', { id: `w-${date}`, date, kg: val });
    // прогресс цели «похудеть», если она связана с весом
    const start = first?.kg ?? val;
    for (const g of all('goals').filter((x) => x.linkWeight && x.status === 'active')) {
      if (target && start > target) patch('goals', g.id, { progress: Math.max(0, Math.min(100, Math.round(((start - val) / (start - target)) * 100))) });
    }
    setVal(null);
    toast('Вес записан');
  };

  let chart: React.ReactNode = null;
  if (pts.length >= 2) {
    const ys = pts.map((p) => p.kg).concat(target ? [target] : []);
    const min = Math.min(...ys) - 0.5;
    const max = Math.max(...ys) + 0.5;
    const W = 300;
    const H = 110;
    const x = (i: number) => (i / (pts.length - 1)) * (W - 10) + 5;
    const y = (kg: number) => H - 8 - ((kg - min) / (max - min)) * (H - 16);
    chart = (
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {target ? <line x1="0" x2={W} y1={y(target)} y2={y(target)} stroke="var(--ok)" strokeDasharray="4 4" strokeWidth="1.5" /> : null}
        <polyline fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" points={pts.map((p, i) => `${x(i)},${y(p.kg)}`).join(' ')} />
        {pts.map((p, i) => (
          <circle key={p.id} cx={x(i)} cy={y(p.kg)} r="2.5" fill="var(--accent)" />
        ))}
      </svg>
    );
  }

  return (
    <div className="card">
      <div className="row between">
        <h3 style={{ margin: 0 }}>⚖️ Вес</h3>
        {last ? (
          <span className="small">
            <b>{last.kg} кг</b>
            {first && first.id !== last.id ? (
              <span className={last.kg <= first.kg ? 'muted' : 'err-text'}> · {r1(last.kg - first.kg) > 0 ? '+' : ''}{r1(last.kg - first.kg)} кг с {fmtShort(first.date)}</span>
            ) : null}
          </span>
        ) : (
          <span className="small muted">ещё не вносил</span>
        )}
      </div>
      {chart}
      {target && last ? <div className="tiny muted">До цели {target} кг: {r1(last.kg - target)} кг</div> : null}
      <div className="row" style={{ marginTop: 10 }}>
        <NumInput value={val} onChange={setVal} placeholder={last ? String(last.kg) : 'Вес сегодня, кг'} className="grow" />
        <button className="btn" onClick={save}>
          Записать
        </button>
      </div>
    </div>
  );
}

// ---------- Экран ----------

export function FoodScreen() {
  const [date, setDate] = useState(todayStr());
  const [adding, setAdding] = useState(false);
  const [norms, setNorms] = useState(false);
  const food = useTable('food');
  const weights = useTable('weights');
  const settings = useRecord('settings', 'main');
  const dayFood = useMemo(() => food.filter((f) => f.date === date).sort((a, b) => a.time.localeCompare(b.time)), [food, date]);
  const eaten = sumMacros(dayFood);
  const n = calcNorms(settings?.nutrition, latestWeight(weights)?.kg ?? null, date);

  return (
    <>
      <div className="weeknav" style={{ marginBottom: 8 }}>
        <button className="icon-btn plain" onClick={() => setDate(addDays(date, -1))} aria-label="Предыдущий день">
          <Icon name="left" />
        </button>
        <button className="btn ghost small title" onClick={() => setDate(todayStr())}>
          {date === todayStr() ? 'Сегодня' : fmtLong(date)}
        </button>
        <button className="icon-btn plain" onClick={() => setDate(addDays(date, 1))} aria-label="Следующий день">
          <Icon name="right" />
        </button>
      </div>

      <div className="card">
        <div className="row" style={{ gap: 16 }}>
          <Ring value={eaten.kcal} max={n.kcal} />
          <div className="grow stack" style={{ gap: 10 }}>
            <MacroBar label="Белки" value={eaten.p} max={n.p} />
            <MacroBar label="Жиры" value={eaten.f} max={n.f} />
            <MacroBar label="Углеводы" value={eaten.c} max={n.c} />
          </div>
        </div>
        <div className="row between" style={{ marginTop: 10 }}>
          <span className="tiny muted">{n.kcal - Math.round(eaten.kcal) >= 0 ? `Осталось ${n.kcal - Math.round(eaten.kcal)} ккал` : `Перебор ${Math.round(eaten.kcal) - n.kcal} ккал`}</span>
          <button className="btn ghost small" onClick={() => setNorms(true)}>
            Моя норма
          </button>
        </div>
        {!n.complete ? <div className="banner warn small" style={{ marginTop: 8, marginBottom: 0 }}>{n.note}</div> : null}
      </div>

      <button className="btn block" onClick={() => setAdding(true)}>
        <Icon name="plus" /> Добавить еду
      </button>

      <div className="grid-2" style={{ marginTop: 10 }}>
        <button className="btn secondary" onClick={() => openSub('fridge')}>
          🧊 Холодильник и рецепты
        </button>
        <button className="btn secondary" onClick={() => openSub('basket')}>
          🛒 Корзина
        </button>
      </div>

      {MEAL_LIST.map((meal) => {
        const list = dayFood.filter((f) => f.meal === meal);
        if (!list.length) return null;
        const sum = sumMacros(list);
        return (
          <div key={meal}>
            <div className="section-title">
              {MEALS[meal].emoji} {MEALS[meal].label}
              <span className="spacer" />
              <span style={{ textTransform: 'none' }}>{Math.round(sum.kcal)} ккал</span>
            </div>
            <div className="list">
              {list.map((f) => (
                <div key={f.id} className="list-item">
                  <div className="grow">
                    <div className="small" style={{ fontWeight: 600 }}>
                      {f.name}
                      {f.grams ? <span className="muted"> · {f.grams} г</span> : null}
                    </div>
                    <MacroLine m={f} />
                  </div>
                  <button
                    className="icon-btn plain"
                    aria-label="Удалить"
                    onClick={() => {
                      remove('food', f.id);
                      toast('Удалено', { label: 'Вернуть', run: () => patch('food', f.id, { deleted: false }) });
                    }}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {!dayFood.length ? <div className="small muted center" style={{ margin: '18px 0' }}>Записей за этот день нет</div> : null}

      <div style={{ marginTop: 14 }}>
        <WeightCard />
      </div>

      {adding ? <AddFoodSheet date={date} onClose={() => setAdding(false)} /> : null}
      {norms ? <NormsSheet onClose={() => setNorms(false)} /> : null}
    </>
  );
}
