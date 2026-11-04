import { useMemo, useState } from 'react';
import { parseFridge, suggestRecipes, type Recipe } from '../ai/tools';
import { Icon } from '../components/Icon';
import { Empty, Field, NumInput, Sheet, toast } from '../components/ui';
import { all, put, remove, useTable } from '../db/store';
import { daysBetween, fmtShort, nowMin, nowTime, todayStr } from '../lib/dates';
import { mealByTime } from '../lib/meta';

function AddTextSheet({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const items = await parseFridge(text);
      for (const it of items) put('fridge', it);
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
      <Field label="Что купил" hint="Можно вставить текст чека или просто перечислить">
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
      date: todayStr(),
      time: nowTime(),
      meal: mealByTime(nowMin()),
      name: r.title,
      grams: null,
      kcal: r.perServing.kcal,
      p: r.perServing.p,
      f: r.perServing.f,
      c: r.perServing.c,
      source: 'recipe',
    });
    toast('Записал порцию в дневник питания');
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

export function FridgeScreen() {
  const fridge = useTable('fridge');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [unit, setUnit] = useState('шт');
  const [expires, setExpires] = useState('');
  const [bulk, setBulk] = useState(false);
  const [wish, setWish] = useState('');
  const [busy, setBusy] = useState(false);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const today = todayStr();
  const sorted = useMemo(() => [...fridge].sort((a, b) => (a.expires || '9999').localeCompare(b.expires || '9999') || a.name.localeCompare(b.name)), [fridge]);

  const add = () => {
    if (!name.trim()) return;
    put('fridge', { name: name.trim(), amount, unit, expires: expires || null });
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
      <div className="card">
        <div className="row" style={{ marginBottom: 8 }}>
          <input className="input grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="Продукт" onKeyDown={(e) => e.key === 'Enter' && add()} />
        </div>
        <div className="grid-3">
          <NumInput value={amount} onChange={setAmount} placeholder="Кол-во" />
          <select className="select" value={unit} onChange={(e) => setUnit(e.target.value)}>
            {['шт', 'г', 'кг', 'мл', 'л', 'уп'].map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
          <input className="input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} title="Годен до" />
        </div>
        <div className="grid-2" style={{ marginTop: 10 }}>
          <button className="btn" onClick={add} disabled={!name.trim()}>
            Добавить
          </button>
          <button className="btn secondary" onClick={() => setBulk(true)}>
            ✨ Списком / чек
          </button>
        </div>
      </div>

      {sorted.length ? (
        <div className="list">
          {sorted.map((f) => {
            const left = f.expires ? daysBetween(today, f.expires) : null;
            return (
              <div className="list-item" key={f.id}>
                <div className="grow">
                  <div className="small" style={{ fontWeight: 600 }}>
                    {f.name}
                    {f.amount ? <span className="muted"> · {f.amount} {f.unit}</span> : null}
                  </div>
                  {f.expires ? (
                    <span className={`badge ${left! < 0 ? 'danger' : left! <= 2 ? 'warn' : ''}`}>
                      {left! < 0 ? 'просрочено' : left === 0 ? 'годен сегодня' : `до ${fmtShort(f.expires)}`}
                    </span>
                  ) : null}
                </div>
                <button className="icon-btn plain" onClick={() => remove('fridge', f.id)} aria-label="Убрать">
                  <Icon name="trash" />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty emoji="🧊" title="Холодильник пуст">Добавь продукты — и ИИ подскажет, что из них приготовить под твою норму КБЖУ.</Empty>
      )}

      <div className="section-title">🍳 Что приготовить</div>
      <div className="card">
        <input className="input" value={wish} onChange={(e) => setWish(e.target.value)} placeholder="Пожелание: «быстро», «на ужин», «побольше белка»" />
        <button className="btn block" style={{ marginTop: 10 }} disabled={busy || !all('fridge').length} onClick={cook}>
          {busy ? 'Подбираю рецепты…' : 'Подобрать рецепты'}
        </button>
      </div>
      {recipes.map((r, i) => (
        <RecipeCard key={i} r={r} />
      ))}
      {bulk ? <AddTextSheet onClose={() => setBulk(false)} /> : null}
    </>
  );
}
