import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Empty, Field, NumInput, Sheet, toast } from '../components/ui';
import { BUILTIN_PRODUCTS, searchProducts } from '../data/products';
import { patch, put, remove, useRecord, useTable } from '../db/store';
import { buildBasket, defaultDailyCap, type BasketResult } from '../lib/basket';
import { calcNorms, latestWeight } from '../lib/nutrition';
import type { PriceRec } from '../types';

function PriceSheet({ initial, onClose }: { initial?: PriceRec; onClose: () => void }) {
  const [name, setName] = useState(initial?.name || '');
  const [store, setStore] = useState(initial?.store || '');
  const [price, setPrice] = useState<number | null>(initial?.price ?? null);
  const [pack, setPack] = useState<number | null>(initial?.packGrams ?? null);
  const [kcal, setKcal] = useState<number | null>(initial?.kcal ?? null);
  const [p, setP] = useState<number | null>(initial?.p ?? null);
  const [f, setF] = useState<number | null>(initial?.f ?? null);
  const [c, setC] = useState<number | null>(initial?.c ?? null);
  const [cap, setCap] = useState<number | null>(initial?.maxPerDayG ?? null);
  const suggestions = useMemo(() => (name.trim().length >= 3 && !initial ? searchProducts(BUILTIN_PRODUCTS, name, 4) : []), [name, initial]);

  const save = () => {
    if (!name.trim() || !price || !pack || kcal == null) return toast('Нужны название, цена, вес упаковки и калории');
    const rec = { name: name.trim(), store: store.trim(), price, packGrams: pack, kcal, p: p ?? 0, f: f ?? 0, c: c ?? 0, maxPerDayG: cap, checkedAt: Date.now() };
    if (initial) patch('prices', initial.id, rec);
    else put('prices', rec);
    onClose();
  };

  return (
    <Sheet title={initial ? 'Продукт и цена' : 'Добавить цену'} onClose={onClose}>
      <Field label="Продукт">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Гречка (сухая)" />
      </Field>
      {suggestions.length ? (
        <div className="chips" style={{ marginTop: -6, marginBottom: 8 }}>
          {suggestions.map((s) => (
            <button
              key={s.id}
              className="chip"
              onClick={() => {
                setName(s.name);
                setKcal(s.kcal);
                setP(s.p);
                setF(s.f);
                setC(s.c);
              }}
            >
              КБЖУ как «{s.name}»
            </button>
          ))}
        </div>
      ) : null}
      <div className="grid-3">
        <Field label="Магазин">
          <input className="input" value={store} onChange={(e) => setStore(e.target.value)} placeholder="Пятёрочка" />
        </Field>
        <Field label="Цена, ₽">
          <NumInput value={price} onChange={setPrice} />
        </Field>
        <Field label="Упаковка, г">
          <NumInput value={pack} onChange={setPack} placeholder="900" />
        </Field>
      </div>
      <div className="label" style={{ marginBottom: 6 }}>КБЖУ на 100 г (с упаковки)</div>
      <div className="grid-4">
        <NumInput value={kcal} onChange={setKcal} placeholder="ккал" />
        <NumInput value={p} onChange={setP} placeholder="Б" />
        <NumInput value={f} onChange={setF} placeholder="Ж" />
        <NumInput value={c} onChange={setC} placeholder="У" />
      </div>
      <div style={{ height: 12 }} />
      <Field label="Не больше, г в день (необязательно)" hint="Чтобы корзина не состояла из одной гречки">
        <NumInput value={cap} onChange={setCap} placeholder={kcal ? String(defaultDailyCap({ kcal, maxPerDayG: null })) : '350'} />
      </Field>
      <button className="btn block" onClick={save}>
        Сохранить
      </button>
      {initial ? (
        <button
          className="btn danger block"
          style={{ marginTop: 8 }}
          onClick={() => {
            remove('prices', initial.id);
            onClose();
          }}
        >
          Удалить
        </button>
      ) : null}
    </Sheet>
  );
}

function StoresCard() {
  const settings = useRecord('settings', 'main');
  const [name, setName] = useState('');
  const stores = settings?.stores?.length ? settings.stores : ['Пятёрочка', 'Чижик', 'Перекрёсток'];
  const save = (list: string[]) => patch('settings', 'main', { stores: list });
  return (
    <div className="card">
      <div className="label" style={{ marginBottom: 8 }}>
        Мои магазины (ИИ выбирает из них, где что покупать)
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        {stores.map((s) => (
          <span key={s} className="chip" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            {s}
            <button className="btn ghost small" style={{ minHeight: 0, padding: 0 }} aria-label={`Убрать ${s}`} onClick={() => save(stores.filter((x) => x !== s))}>
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <input className="input grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="Добавить: Магнит, Лента…" />
        <button
          className="btn small"
          disabled={!name.trim()}
          onClick={() => {
            if (!stores.includes(name.trim())) save([...stores, name.trim()]);
            setName('');
          }}
        >
          Добавить
        </button>
      </div>
    </div>
  );
}

export function BasketScreen() {
  const prices = useTable('prices');
  const weights = useTable('weights');
  const settings = useRecord('settings', 'main');
  const [edit, setEdit] = useState<PriceRec | null | 'new'>(null);
  const [days, setDays] = useState(7);
  const [result, setResult] = useState<BasketResult | null>(null);
  const norms = calcNorms(settings?.nutrition, latestWeight(weights)?.kg ?? null);

  const run = () => setResult(buildBasket(prices, norms, days));

  const byStore = useMemo(() => {
    const m = new Map<string, BasketResult['lines']>();
    for (const l of result?.lines || []) {
      const k = l.item.store || 'Без магазина';
      m.set(k, [...(m.get(k) || []), l]);
    }
    return [...m.entries()];
  }, [result]);

  return (
    <>
      <StoresCard />
      <div className="banner info">
        <span>🛒</span>
        <div className="grow small">
          Корзина собирается так, чтобы попасть в твою норму <b>{norms.kcal} ккал · Б {norms.p} · Ж {norms.f} · У {norms.c}</b> за минимальные деньги.
          Цены пока вносятся вручную (с ценника или чека). Автоматический сбор цен из магазинов рядом — следующий шаг.
        </div>
      </div>

      <div className="card">
        <div className="row between">
          <span style={{ fontWeight: 600 }}>На сколько дней</span>
          <div className="row">
            {[3, 5, 7].map((d) => (
              <button key={d} className={`chip ${days === d ? 'active' : ''}`} onClick={() => setDays(d)}>
                {d}
              </button>
            ))}
          </div>
        </div>
        <button className="btn block" style={{ marginTop: 10 }} onClick={run} disabled={prices.length < 3}>
          Собрать самую выгодную корзину
        </button>
        {prices.length < 3 ? <div className="tiny muted" style={{ marginTop: 6 }}>Нужно хотя бы 3 продукта с ценами</div> : null}
      </div>

      {result ? (
        result.feasible ? (
          <div className="card">
            <div className="row between">
              <h3 style={{ margin: 0 }}>Итого: {result.total} ₽</h3>
              <span className="small muted">≈ {Math.round(result.total / days)} ₽/день</span>
            </div>
            <div className="tiny muted" style={{ marginTop: 4 }}>
              В день: {result.perDay.kcal} ккал · Б {result.perDay.p} · Ж {result.perDay.f} · У {result.perDay.c}
            </div>
            {result.note ? <div className="banner warn small" style={{ marginTop: 8 }}>{result.note}</div> : null}
            {byStore.map(([store, lines]) => (
              <div key={store} style={{ marginTop: 10 }}>
                <div className="label">{store}</div>
                {lines.map((l) => (
                  <div className="row between small" key={l.item.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                    <span className="grow">
                      {l.item.name} <span className="muted">· {l.packs} уп. по {l.item.packGrams} г (≈{l.perDayG} г/день)</span>
                    </span>
                    <b className="nowrap">{l.cost} ₽</b>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="banner warn">
            <span>⚠️</span>
            <div className="grow small">{result.note}</div>
          </div>
        )
      ) : null}

      <div className="section-title">
        Мои цены
        <span className="spacer" />
        <button className="btn ghost small" style={{ minHeight: 0, padding: 0 }} onClick={() => setEdit('new')}>
          <Icon name="plus" /> Добавить
        </button>
      </div>
      {prices.length ? (
        <div className="list">
          {[...prices]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((p) => (
              <button key={p.id} className="list-item" onClick={() => setEdit(p)}>
                <div className="grow">
                  <div className="small" style={{ fontWeight: 600 }}>
                    {p.name} <span className="muted">· {p.store || '—'}</span>
                  </div>
                  <div className="tiny muted">
                    {p.price} ₽ за {p.packGrams} г ({Math.round((p.price / p.packGrams) * 1000)} ₽/кг) · {p.kcal} ккал, Б {p.p}
                  </div>
                </div>
                <Icon name="right" className="chev" />
              </button>
            ))}
        </div>
      ) : (
        <Empty emoji="🏷️" title="Цен пока нет">Добавь продукты, которые обычно покупаешь: цену, вес упаковки и КБЖУ с этикетки.</Empty>
      )}
      {edit ? <PriceSheet initial={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} /> : null}
    </>
  );
}
