import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Field, NumInput, Seg, Sheet, toast, Toggle } from '../components/ui';
import { usePlanner } from '../db/planState';
import { patch, put, remove, useTable } from '../db/store';
import { DOW_SHORT, minToTime, todayStr } from '../lib/dates';
import { EDITABLE_KINDS, KINDS } from '../lib/meta';
import type { Kind, RoutineRec } from '../types';

const WHEN: { v: RoutineRec['when']; label: string }[] = [
  { v: 'always', label: 'Всегда' },
  { v: 'study', label: 'Дни с парами' },
  { v: 'free', label: 'Дни без пар' },
];

function RoutineSheet({ initial, onClose }: { initial?: RoutineRec; onClose: () => void }) {
  const planner = usePlanner();
  const [title, setTitle] = useState(initial?.title || '');
  const [kind, setKind] = useState<Kind>(initial?.kind || 'routine');
  const [days, setDays] = useState<number[]>(initial?.days || [1, 2, 3, 4, 5, 6, 7]);
  const [when, setWhen] = useState<RoutineRec['when']>(initial?.when || 'always');
  const [startExpr, setStartExpr] = useState(initial?.startExpr || '');
  const [durationExpr, setDurationExpr] = useState(initial?.durationExpr || '30 мин');
  const [fixed, setFixed] = useState(initial?.fixed ?? true);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [remind, setRemind] = useState<number | null>(initial?.remindMin ?? null);
  const today = todayStr();
  const draft: RoutineRec = { id: initial?.id || 'draft', updatedAt: 0, title, kind, days, when, startExpr, durationExpr, fixed, enabled: true };
  const span = startExpr.trim() ? planner.routineSpan(draft, today) : null;

  const save = () => {
    if (!title.trim() || !startExpr.trim()) return toast('Нужны название и время начала');
    const rec = { title: title.trim(), kind, days: [...days].sort(), when, startExpr: startExpr.trim(), durationExpr: durationExpr.trim(), fixed, enabled, remindMin: remind };
    if (initial) patch('routines', initial.id, rec);
    else put('routines', { ...rec, order: 5 });
    onClose();
  };

  return (
    <Sheet title={initial ? 'Распорядок' : 'Новое действие распорядка'} onClose={onClose}>
      <Field label="Название">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Зарядка" />
      </Field>
      <Field label="Тип">
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          {EDITABLE_KINDS.map((k) => (
            <option key={k} value={k}>
              {KINDS[k].emoji} {KINDS[k].label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Дни недели">
        <div className="daychips">
          {DOW_SHORT.map((d, i) => (
            <button key={d} className={days.includes(i + 1) ? 'active' : ''} onClick={() => setDays(days.includes(i + 1) ? days.filter((x) => x !== i + 1) : [...days, i + 1])}>
              {d}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Когда">
        <Seg value={when} onChange={setWhen} options={WHEN} />
      </Field>
      <div className="grid-2">
        <Field label="Начало" hint="время или выражение">
          <input className="input mono" value={startExpr} onChange={(e) => setStartExpr(e.target.value)} placeholder="{подъём} + 10" autoCapitalize="none" />
        </Field>
        <Field label="Длительность">
          <input className="input mono" value={durationExpr} onChange={(e) => setDurationExpr(e.target.value)} placeholder="{завтрак}" autoCapitalize="none" />
        </Field>
      </div>
      {span ? (
        'error' in span ? (
          <div className="err-text" style={{ marginBottom: 10 }}>⚠️ {span.error}</div>
        ) : (
          <div className="banner ok small">
            <span>📅</span>
            <div className="grow">
              Сегодня: <b>{minToTime(span.start)}–{minToTime(span.end)}</b>
            </div>
          </div>
        )
      ) : startExpr.trim() ? (
        <div className="small muted" style={{ marginBottom: 10 }}>Сегодня не выполняется (не тот день или нет пар/значения).</div>
      ) : null}
      <Toggle label="Жёсткое время" hint="ИИ ставит дела в обход" checked={fixed} onChange={setFixed} />
      <Toggle label="Включено" checked={enabled} onChange={setEnabled} />
      <Field label="Напомнить за, мин" hint="пусто — без напоминания">
        <NumInput value={remind} onChange={setRemind} />
      </Field>
      <button className="btn block" onClick={save}>
        Сохранить
      </button>
      {initial ? (
        <button
          className="btn danger block"
          style={{ marginTop: 8 }}
          onClick={() => {
            remove('routines', initial.id);
            onClose();
          }}
        >
          Удалить
        </button>
      ) : null}
    </Sheet>
  );
}

export function RoutinesScreen() {
  const routines = useTable('routines');
  const planner = usePlanner();
  const [edit, setEdit] = useState<RoutineRec | null | 'new'>(null);
  const today = todayStr();
  const sorted = useMemo(() => [...routines].sort((a, b) => (a.order ?? 5) - (b.order ?? 5) || a.title.localeCompare(b.title)), [routines]);

  return (
    <>
      <div className="banner info small">
        <span>🔁</span>
        <div className="grow">
          Распорядок — то, что повторяется: подъём, дорога, отбой, зарядка. Время можно задавать через переменные — например,
          <span className="kbd">{'{первая_пара} - {дорога_до_вуза}'}</span>. ИИ планирует остальное вокруг этого.
        </div>
      </div>
      <button className="btn block" style={{ marginBottom: 10 }} onClick={() => setEdit('new')}>
        <Icon name="plus" /> Добавить действие
      </button>
      <div className="list">
        {sorted.map((r) => {
          const span = planner.routineSpan({ ...r, enabled: true }, today);
          return (
            <button key={r.id} className="list-item" onClick={() => setEdit(r)} style={{ opacity: r.enabled ? 1 : 0.5 }}>
              <span className="emoji">{KINDS[r.kind]?.emoji}</span>
              <div className="grow">
                <div className="small" style={{ fontWeight: 600 }}>
                  {r.title}
                </div>
                <div className="var-expr">
                  {r.startExpr} · {r.durationExpr || '0'}
                </div>
                <div className="tiny muted">
                  {WHEN.find((w) => w.v === r.when)?.label} · {r.days.length === 7 ? 'каждый день' : r.days.map((d) => DOW_SHORT[d - 1]).join(', ')}
                </div>
              </div>
              <span className="var-val small">
                {!span ? <span className="muted">не сегодня</span> : 'error' in span ? <span className="err-text">ошибка</span> : `${minToTime(span.start)}`}
              </span>
            </button>
          );
        })}
      </div>
      {edit ? <RoutineSheet initial={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} /> : null}
    </>
  );
}
