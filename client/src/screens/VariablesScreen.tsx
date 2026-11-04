import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Field, Seg, Sheet, toast } from '../components/ui';
import { usePlanner } from '../db/planState';
import { all, patch, put, remove, useTable } from '../db/store';
import { addDays, fmtShort, todayStr } from '../lib/dates';
import { BUILTIN_VARS, formatVal, normalizeVarName, valType, VAR_NAME_RE } from '../lib/vars';
import { openChat } from '../nav';
import type { VariableRec } from '../types';

function VarSheet({ initial, date, onClose }: { initial?: VariableRec; date: string; onClose: () => void }) {
  const planner = usePlanner();
  const [name, setName] = useState(initial?.name || '');
  const [expr, setExpr] = useState(initial?.expr || '');
  const [desc, setDesc] = useState(initial?.description || '');
  const norm = normalizeVarName(name);
  const preview = expr.trim() ? planner.engine.evalExpr(expr, date) : null;

  const save = () => {
    if (!VAR_NAME_RE.test(norm)) return toast('Имя: буквы, цифры и _, без пробелов');
    if (!expr.trim()) return toast('Укажи значение');
    const clash = all('variables').find((v) => v.name.toLowerCase() === norm && v.id !== initial?.id);
    if (clash || BUILTIN_VARS.some((b) => b.name === norm)) return toast('Такое имя уже занято');
    if (initial) patch('variables', initial.id, { name: norm, expr: expr.trim(), description: desc });
    else put('variables', { name: norm, expr: expr.trim(), description: desc });
    onClose();
  };

  return (
    <Sheet title={initial ? 'Переменная' : 'Новая переменная'} onClose={onClose}>
      <Field label="Имя">
        <input className="input mono" value={name} onChange={(e) => setName(e.target.value)} placeholder="дорога_до_вуза" autoCapitalize="none" autoCorrect="off" />
      </Field>
      <Field label="Значение или выражение" hint="Например: 40 мин · 1ч 30м · 07:30 · {первая_пара} - {дорога_до_вуза} · min(08:00, {первая_пара} - 1ч)">
        <input className="input mono" value={expr} onChange={(e) => setExpr(e.target.value)} placeholder="40 мин" autoCapitalize="none" autoCorrect="off" />
      </Field>
      {preview ? (
        preview.error ? (
          <div className="err-text" style={{ marginBottom: 10 }}>⚠️ {preview.error}</div>
        ) : (
          <div className="banner ok small">
            <span>=</span>
            <div className="grow">
              <b>{formatVal(preview.val)}</b> <span className="muted">({valType(preview.val)}, на {fmtShort(date)})</span>
            </div>
          </div>
        )
      ) : null}
      <Field label="Описание (для тебя и ИИ)">
        <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Сколько добираться до ТулГУ" />
      </Field>
      <button className="btn block" onClick={save}>
        Сохранить
      </button>
      {initial ? (
        <button
          className="btn danger block"
          style={{ marginTop: 8 }}
          onClick={() => {
            if (!confirm(`Удалить {${initial.name}}? Выражения, которые на неё ссылаются, перестанут считаться.`)) return;
            remove('variables', initial.id);
            onClose();
          }}
        >
          Удалить
        </button>
      ) : null}
    </Sheet>
  );
}

export function VariablesScreen() {
  const vars = useTable('variables');
  const planner = usePlanner();
  const [day, setDay] = useState<'today' | 'tomorrow'>('today');
  const [edit, setEdit] = useState<VariableRec | null | 'new'>(null);
  const date = day === 'today' ? todayStr() : addDays(todayStr(), 1);
  const sorted = useMemo(() => [...vars].sort((a, b) => a.name.localeCompare(b.name, 'ru')), [vars]);

  return (
    <>
      <div className="banner info small">
        <span>🧮</span>
        <div className="grow">
          Переменные работают как в программировании: задаёшь один раз и используешь в распорядке, а ИИ учитывает их при планировании. Значение может
          ссылаться на другие переменные через <span className="kbd">{'{имя}'}</span>, а <span className="kbd">{'{завтра:имя}'}</span> берёт значение на
          следующий день.
        </div>
      </div>
      <div className="row" style={{ marginBottom: 10 }}>
        <div className="grow">
          <Seg<'today' | 'tomorrow'> value={day} onChange={setDay} options={[{ v: 'today', label: 'Сегодня' }, { v: 'tomorrow', label: 'Завтра' }]} />
        </div>
        <button className="btn small" onClick={() => setEdit('new')}>
          <Icon name="plus" /> Новая
        </button>
      </div>
      <div className="list">
        {sorted.map((v) => {
          const r = planner.engine.evalName(v.name, date);
          const isExpr = /[{}]|min\(|max\(/i.test(v.expr);
          return (
            <button className="var-row" key={v.id} onClick={() => setEdit(v)}>
              <div className="grow">
                <div className="var-name">{`{${v.name}}`}</div>
                {isExpr ? <div className="var-expr">{v.expr}</div> : null}
                {v.description ? <div className="tiny muted">{v.description}</div> : null}
              </div>
              {r.error ? <span className="err-text">ошибка</span> : <span className="var-val">{formatVal(r.val)}</span>}
            </button>
          );
        })}
      </div>
      <button className="btn secondary block" onClick={() => openChat({ mode: 'chat', prefill: 'Добавь переменную: ' })}>
        ✨ Создать в чате с ИИ
      </button>

      <div className="section-title">Встроенные (считаются сами, {fmtShort(date)})</div>
      <div className="list">
        {BUILTIN_VARS.map((b) => {
          const r = planner.engine.evalName(b.name, date);
          return (
            <div className="var-row" key={b.name}>
              <div className="grow">
                <div className="var-name">{`{${b.name}}`}</div>
                <div className="tiny muted">{b.description}</div>
              </div>
              <span className="var-val">{r.error ? '—' : formatVal(r.val)}</span>
            </div>
          );
        })}
      </div>
      {edit ? <VarSheet initial={edit === 'new' ? undefined : edit} date={date} onClose={() => setEdit(null)} /> : null}
    </>
  );
}
