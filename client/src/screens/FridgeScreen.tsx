import { useMemo, useState } from 'react';
import { hasServer } from '../api';
import { parseFridge, planShopping, suggestRecipes, type Recipe } from '../ai/tools';
import { Icon } from '../components/Icon';
import { Empty, Field, NumInput, Sheet, toast } from '../components/ui';
import { getPlanner } from '../db/planState';
import { all, get, patch, put, remove, useRecord, useTable } from '../db/store';
import { addDays, daysBetween, fmtShort, minToTime, nowMin, nowTime, timeToMin, todayStr } from '../lib/dates';
import { consumeGrams, estimateExpiry, isActive, matchFridge, parseAmountToGrams, SPOIL_GRACE_DAYS } from '../lib/fridge';
import { mealByTime } from '../lib/meta';
import { calcNorms, latestWeight } from '../lib/nutrition';
import { shoppingStatus } from '../lib/shopping';
import { openSub } from '../nav';
import type { FridgeRec, ShoppingPlan } from '../types';

const UNITS = ['шт', 'г', 'кг', 'мл', 'л', 'уп'];

export function addToFridge(it: { name: string; amount?: number | null; unit?: string; expires?: string | null; price?: number | null; expiresEstimated?: boolean }) {
  const today = todayStr();
  return put('fridge', {
    name: it.name.trim(),
    amount: it.amount ?? null,
    unit: it.unit || (it.amount ? 'шт' : ''),
    expires: it.expires || estimateExpiry(it.name, today),
    expiresEstimated: it.expiresEstimated ?? !it.expires,
    addedAt: Date.now(),
    initialAmount: it.amount ?? null,
    price: it.price ?? null,
    status: 'ok',
  });
}

// ---------- Магазин ----------

function ShoppingCard() {
  const settings = useRecord('settings', 'main');
  const fridge = useTable('fridge');
  const products = useTable('products');
  const weights = useTable('weights');
  const [busy, setBusy] = useState(false);
  const today = todayStr();
  const norms = calcNorms(settings?.nutrition, latestWeight(weights)?.kg ?? null, today);
  const st = shoppingStatus(fridge, products, norms.kcal, today);
  const plan = settings?.shopping || null;
  const stores = settings?.stores?.length ? settings.stores : ['Пятёрочка', 'Чижик', 'Перекрёсток'];

  const savePlan = (p: ShoppingPlan | null) => patch('settings', 'main', { shopping: p });

  const make = async () => {
    setBusy(true);
    try {
      const p = await planShopping();
      toast(p.reply || 'Список готов');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (si: number, ii: number) => {
    if (!plan) return;
    const next = structuredClone(plan);
    next.stores[si].items[ii].checked = !next.stores[si].items[ii].checked;
    savePlan(next);
  };

  const toSchedule = () => {
    if (!plan) return;
    let date = plan.when?.date;
    let start = plan.when?.start;
    if (!date || !start || date < today) {
      const planner = getPlanner();
      for (let i = 0; i < 3 && !date; i += 1) {
        const d = addDays(today, i);
        const w = planner.skeleton(d, { fromMin: i === 0 ? nowMin() + 30 : null }).free.find(([a, b]) => b - a >= 60 && b > 16 * 60);
        if (w) {
          date = d;
          start = minToTime(Math.max(w[0], Math.min(w[1] - 60, 17 * 60)));
        }
      }
    }
    if (!date || !start) return toast('Не нашёл свободного часа в ближайшие дни');
    const s = timeToMin(start) ?? 18 * 60;
    put('events', {
      date, start, end: minToTime(Math.min(1440, s + 45)),
      title: `🛒 Магазин: ${plan.stores.map((x) => x.store).join(', ')}`,
      kind: 'other', source: 'manual', status: 'planned', fixed: false,
      notes: plan.stores.map((x) => `${x.store}: ${x.items.map((i) => `${i.name}${i.qty ? ` (${i.qty})` : ''}`).join(', ')}`).join('\n'),
      reward: 3,
    });
    toast(`Поход в магазин: ${fmtShort(date)} в ${start}`);
  };

  const bought = () => {
    if (!plan) return;
    let n = 0;
    for (const s of plan.stores) {
      for (const it of s.items) {
        if (!it.checked) continue;
        addToFridge({ name: it.name, amount: it.amount ?? null, unit: it.unit || '', price: it.price ?? null });
        n += 1;
      }
    }
    if (!n) return toast('Отметь, что купил');
    const rest = plan.stores.map((s) => ({ ...s, items: s.items.filter((i) => !i.checked) })).filter((s) => s.items.length);
    savePlan(rest.length ? { ...plan, stores: rest } : null);
    toast(`В холодильник: ${n}`);
  };

  return (
    <div className="card">
      <div className="row between">
        <b>🛒 Магазин</b>
        <span className={`badge ${st.urgency === 'now' ? 'danger' : st.urgency === 'soon' ? 'warn' : 'ok'}`}>
          {st.urgency === 'now' ? 'пора идти' : st.urgency === 'soon' ? 'скоро' : 'пока не нужно'}
        </span>
      </div>
      <div className="small" style={{ marginTop: 6 }}>
        {st.reason}
        {st.daysLeft != null && fridge.length ? <span className="muted"> · еды ≈ на {String(st.daysLeft).replace('.', ',')} дн.</span> : null}
      </div>
      {st.missing.length && fridge.length ? <div className="tiny muted">Нет: {st.missing.join(', ')}</div> : null}

      {plan ? (
        <div style={{ marginTop: 10 }}>
          {plan.when ? (
            <div className="small">
              📅 Лучше сходить: <b>{fmtShort(plan.when.date)} в {plan.when.start}</b>
              {plan.when.reason ? <span className="muted"> — {plan.when.reason}</span> : null}
            </div>
          ) : null}
          {plan.stores.map((s, si) => (
            <div key={s.store} style={{ marginTop: 8 }}>
              <div className="label">{s.store}</div>
              {s.items.map((it, ii) => (
                <label key={ii} className="row small" style={{ padding: '4px 0' }}>
                  <input type="checkbox" checked={!!it.checked} onChange={() => toggle(si, ii)} />
                  <span className="grow" style={{ textDecoration: it.checked ? 'line-through' : undefined }}>
                    {it.name} {it.qty ? <span className="muted">· {it.qty}</span> : null}
                  </span>
                  {it.price ? <span className="nowrap">{it.price} ₽</span> : null}
                </label>
              ))}
            </div>
          ))}
          {plan.total ? <div className="small" style={{ marginTop: 6 }}>Итого ≈ <b>{plan.total} ₽</b></div> : null}
          <div className="grid-2" style={{ marginTop: 10 }}>
            <button className="btn small secondary" onClick={toSchedule}>
              📅 В расписание
            </button>
            <button className="btn small ok" onClick={bought}>
              ✅ Купил отмеченное
            </button>
          </div>
        </div>
      ) : null}
      <button className="btn block" style={{ marginTop: 10 }} disabled={busy || !hasServer()} onClick={make}>
        <Icon name="sparkles" /> {busy ? 'Составляю список…' : plan ? 'Пересоставить список' : 'Что и где купить'}
      </button>
      <details className="hint">
        <summary>Как это работает</summary>
        ИИ смотрит на холодильник, норму КБЖУ, цены и твоё расписание: подскажет, когда сходить и что в каком магазине брать
        ({stores.join(', ')} —{' '}
        <button className="btn ghost small" style={{ minHeight: 0, padding: 0 }} onClick={() => openSub('basket')}>
          изменить
        </button>
        ). Если еды мало, поход в магазин сам появится в расписании.
      </details>
    </div>
  );
}

// ---------- Использовать / выбросить ----------

function UseSheet({ item, onClose }: { item: FridgeRec; onClose: () => void }) {
  const [amount, setAmount] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(item.amount ?? null);
  const [expires, setExpires] = useState(item.expires || '');
  const use = (value: number | null) => {
    const left = item.amount != null && value != null ? Math.max(0, item.amount - value) : 0;
    if (item.amount == null || left <= 0) patch('fridge', item.id, { amount: 0, status: 'used', closedAt: Date.now() });
    else patch('fridge', item.id, { amount: Math.round(left * 100) / 100 });
    toast(left > 0 ? `Осталось ${Math.round(left * 100) / 100} ${item.unit || ''}` : `«${item.name}» закончился`);
    onClose();
  };
  return (
    <Sheet title={item.name} onClose={onClose}>
      {item.amount != null ? (
        <>
          <Field label={`Сколько использовал (${item.unit || 'шт'})`} hint={`Сейчас: ${item.amount} ${item.unit || ''}`}>
            <NumInput value={amount} onChange={setAmount} placeholder="0" />
          </Field>
          <div className="chips">
            {[0.25, 0.5].map((k) => (
              <button key={k} className="chip" onClick={() => setAmount(Math.round(item.amount! * k * 100) / 100)}>
                {k === 0.25 ? 'четверть' : 'половину'}
              </button>
            ))}
            <button className="chip" onClick={() => setAmount(item.amount!)}>
              всё
            </button>
          </div>
          <button className="btn block" style={{ marginTop: 10 }} disabled={!amount} onClick={() => use(amount)}>
            Использовал
          </button>
        </>
      ) : (
        <button className="btn block" onClick={() => use(null)}>
          Закончилось
        </button>
      )}
      <button
        className="btn danger block"
        style={{ marginTop: 8 }}
        onClick={() => {
          patch('fridge', item.id, { status: 'spoiled', closedAt: Date.now() });
          toast('Отметил как испорченное');
          onClose();
        }}
      >
        🗑 Испортилось — выбросил
      </button>
      <div className="section-title">Изменить</div>
      <div className="grid-2">
        <Field label={`Количество, ${item.unit || 'шт'}`}>
          <NumInput value={total} onChange={setTotal} />
        </Field>
        <Field label="Годен до">
          <input className="input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
      </div>
      <button
        className="btn secondary block"
        onClick={() => {
          patch('fridge', item.id, { amount: total, expires: expires || null, expiresEstimated: false });
          onClose();
        }}
      >
        Сохранить
      </button>
    </Sheet>
  );
}

function AddTextSheet({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const items = await parseFridge(text);
      for (const it of items) addToFridge(it);
      toast(`Добавлено: ${items.length}`);
      onClose();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Добавить списком" onClose={onClose}>
      <Field label="Что купил" hint="Можно вставить текст чека или просто перечислить — сроки годности ИИ оценит сам">
        <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="Курица 1 кг, яйца 10 шт, гречка, молоко 1 л, помидоры" />
      </Field>
      <button className="btn block" disabled={busy || !text.trim()} onClick={run}>
        {busy ? 'Разбираю…' : 'Добавить'}
      </button>
    </Sheet>
  );
}

function RecipeCard({ r }: { r: Recipe }) {
  const [open, setOpen] = useState(false);
  const cooked = () => {
    put('food', {
      date: todayStr(), time: nowTime(), meal: mealByTime(nowMin()), name: r.title, grams: null,
      kcal: r.perServing.kcal, p: r.perServing.p, f: r.perServing.f, c: r.perServing.c, source: 'recipe', fridgeChecked: true,
    });
    // списываем ингредиенты из холодильника (на все порции)
    const used: string[] = [];
    if (get('settings', 'main')?.fridgeAuto !== false) {
      for (const ing of r.ingredients.filter((i) => i.have)) {
        const item = matchFridge(ing.name, all('fridge'));
        if (!item) continue;
        const grams = parseAmountToGrams(ing.amount, item.name);
        const res = grams != null ? consumeGrams(item, grams) : null;
        if (!res) continue;
        patch('fridge', item.id, res.used ? { amount: 0, status: 'used', closedAt: Date.now() } : { amount: res.amount });
        used.push(item.name);
      }
    }
    toast(`Записал порцию в дневник${used.length ? ` · списал: ${used.join(', ')}` : ''}`);
  };
  return (
    <div className="card recipe">
      <h4>{r.title}</h4>
      <div className="tiny muted">
        ⏱ {r.timeMin} мин · порций: {r.servings} · на порцию {r.perServing.kcal} ккал · Б {r.perServing.p} · Ж {r.perServing.f} · У {r.perServing.c}
      </div>
      {r.why ? <div className="small" style={{ marginTop: 6 }}>{r.why}</div> : null}
      <ul>
        {r.ingredients.map((i, k) => (
          <li key={k} style={{ color: i.have ? undefined : 'var(--warn)' }}>
            {i.have ? '✓' : '＋'} {i.name} {i.amount ? `— ${i.amount}` : ''}
            {!i.have ? ' (докупить)' : ''}
          </li>
        ))}
      </ul>
      {open ? (
        <ol>
          {r.steps.map((s, k) => (
            <li key={k}>{s}</li>
          ))}
        </ol>
      ) : null}
      <div className="grid-2" style={{ marginTop: 8 }}>
        <button className="btn secondary small" onClick={() => setOpen(!open)}>
          {open ? 'Скрыть шаги' : 'Как готовить'}
        </button>
        <button className="btn ok small" onClick={cooked}>
          Приготовил и съел
        </button>
      </div>
    </div>
  );
}

function FridgeRow({ f, today, onOpen }: { f: FridgeRec; today: string; onOpen: (f: FridgeRec) => void }) {
  const left = f.expires ? daysBetween(today, f.expires) : null;
  const expired = left != null && left < 0;
  return (
    <div className="list-item">
      <button className="grow" style={{ border: 0, background: 'none', textAlign: 'left', padding: 0 }} onClick={() => onOpen(f)}>
        <div className="small" style={{ fontWeight: 600 }}>
          {f.name}
          {f.amount != null ? <span className="muted"> · {f.amount} {f.unit}</span> : null}
        </div>
        {f.expires ? (
          <span className={`badge ${expired ? 'danger' : left! <= 1 ? 'warn' : ''}`}>
            {expired ? `срок вышел ${fmtShort(f.expires)}` : left === 0 ? 'годен сегодня' : `до ${fmtShort(f.expires)}`}
            {f.expiresEstimated ? ' ≈' : ''}
          </span>
        ) : null}
      </button>
      {expired ? (
        <div className="row" style={{ gap: 4 }}>
          <button className="btn small ghost" onClick={() => patch('fridge', f.id, { expires: addDays(today, 2), expiresEstimated: false })}>
            👌 +2 дня
          </button>
          <button className="btn small danger" onClick={() => patch('fridge', f.id, { status: 'spoiled', closedAt: Date.now() })}>
            🗑
          </button>
        </div>
      ) : (
        <button className="icon-btn plain" onClick={() => onOpen(f)} aria-label="Использовать">
          <Icon name="edit" />
        </button>
      )}
    </div>
  );
}

export function FridgeScreen() {
  const fridge = useTable('fridge');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [unit, setUnit] = useState('шт');
  const [expires, setExpires] = useState('');
  const [bulk, setBulk] = useState(false);
  const [adding, setAdding] = useState(false);
  const [use, setUse] = useState<FridgeRec | null>(null);
  const [wish, setWish] = useState('');
  const [busy, setBusy] = useState(false);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const today = todayStr();

  const active = useMemo(() => fridge.filter(isActive).sort((a, b) => (a.expires || '9999').localeCompare(b.expires || '9999') || a.name.localeCompare(b.name)), [fridge]);
  const expired = active.filter((f) => f.expires && f.expires < today);
  const soon = active.filter((f) => f.expires && f.expires >= today && daysBetween(today, f.expires) <= 2);
  const rest = active.filter((f) => !expired.includes(f) && !soon.includes(f));
  const monthAgo = Date.now() - 30 * 86400000;
  const history = fridge.filter((f) => !isActive(f) && (f.closedAt || 0) > monthAgo).sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
  const spoiled = history.filter((f) => f.status === 'spoiled');
  const wasted = spoiled.reduce((s, f) => s + (f.price || 0), 0);

  const add = () => {
    if (!name.trim()) return;
    addToFridge({ name, amount, unit, expires: expires || null });
    toast(`Добавил: ${name.trim()}`);
    setName('');
    setAmount(null);
    setExpires('');
  };

  const cook = async () => {
    setBusy(true);
    try {
      setRecipes(await suggestRecipes(wish));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ShoppingCard />

      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <button className="btn secondary grow nowrap" onClick={() => setAdding(true)}>
          <Icon name="plus" /> Добавить
        </button>
        <button className="btn secondary" onClick={() => setBulk(true)}>
          ✨ Списком / чек
        </button>
      </div>
      {adding ? (
      <Sheet title="Добавить продукт" onClose={() => setAdding(false)}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Продукт" onKeyDown={(e) => e.key === 'Enter' && add()} />
        <div className="grid-3" style={{ marginTop: 8 }}>
          <NumInput value={amount} onChange={setAmount} placeholder="Кол-во" />
          <select className="select" value={unit} onChange={(e) => setUnit(e.target.value)}>
            {UNITS.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
          <input className="input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} title="Годен до (если пусто — оценю сам)" />
        </div>
        {name.trim() && !expires ? <div className="tiny muted" style={{ marginTop: 4 }}>Срок годности ≈ до {fmtShort(estimateExpiry(name, today))} (можно поменять)</div> : null}
        <button className="btn block" style={{ marginTop: 12 }} onClick={add} disabled={!name.trim()}>
          Добавить
        </button>
        <div className="tiny muted center" style={{ marginTop: 8 }}>Можно добавлять подряд — окно не закроется</div>
      </Sheet>
      ) : null}

      {expired.length ? (
        <>
          <div className="section-title">⚠️ Срок вышел — проверь</div>
          <div className="list">
            {expired.map((f) => (
              <FridgeRow key={f.id} f={f} today={today} onOpen={setUse} />
            ))}
          </div>
          <div className="tiny muted" style={{ margin: '-4px 4px 8px' }}>Через {SPOIL_GRACE_DAYS} дня после срока продукт сам уйдёт в «испорченные».</div>
        </>
      ) : null}
      {soon.length ? (
        <>
          <div className="section-title">⏳ Скоро испортится — съешь первым</div>
          <div className="list">
            {soon.map((f) => (
              <FridgeRow key={f.id} f={f} today={today} onOpen={setUse} />
            ))}
          </div>
        </>
      ) : null}
      {rest.length ? (
        <>
          <div className="section-title">🧊 В холодильнике</div>
          <div className="list">
            {rest.map((f) => (
              <FridgeRow key={f.id} f={f} today={today} onOpen={setUse} />
            ))}
          </div>
        </>
      ) : null}
      {!active.length ? <Empty emoji="🧊" title="Холодильник пуст">Добавь продукты — съеденное будет списываться само, а ИИ подскажет, что приготовить и когда идти в магазин.</Empty> : null}

      <div className="section-title">🍳 Что приготовить</div>
      <div className="card">
        <input className="input" value={wish} onChange={(e) => setWish(e.target.value)} placeholder="Пожелание: «быстро», «на ужин», «побольше белка»" />
        <button className="btn block" style={{ marginTop: 10 }} disabled={busy || !active.length} onClick={cook}>
          {busy ? 'Подбираю рецепты…' : 'Подобрать рецепты'}
        </button>
      </div>
      {recipes.map((r, i) => (
        <RecipeCard key={i} r={r} />
      ))}

      {history.length ? (
        <details className="card small" style={{ marginTop: 6 }}>
          <summary>
            История за месяц: съедено {history.length - spoiled.length}, испортилось {spoiled.length}
            {wasted ? ` (≈ ${Math.round(wasted)} ₽)` : ''}
          </summary>
          {history.map((f) => (
            <div key={f.id} className="row between" style={{ padding: '4px 0' }}>
              <span>
                {f.status === 'spoiled' ? '🗑' : '✓'} {f.name}
              </span>
              <span className="row" style={{ gap: 6 }}>
                <span className="muted tiny">{f.closedAt ? new Date(f.closedAt).toLocaleDateString('ru-RU') : ''}</span>
                <button className="btn ghost small" style={{ minHeight: 0, padding: 0 }} onClick={() => patch('fridge', f.id, { status: 'ok', closedAt: null })}>
                  вернуть
                </button>
                <button className="btn ghost small" style={{ minHeight: 0, padding: 0, color: 'var(--danger)' }} onClick={() => remove('fridge', f.id)}>
                  ✕
                </button>
              </span>
            </div>
          ))}
        </details>
      ) : null}
      {bulk ? <AddTextSheet onClose={() => setBulk(false)} /> : null}
      {use ? <UseSheet item={use} onClose={() => setUse(null)} /> : null}
    </>
  );
}
