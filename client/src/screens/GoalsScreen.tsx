import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Empty, Field, Progress, Sheet, toast, Toggle } from '../components/ui';
import { patch, put, remove, useTable } from '../db/store';
import { daysBetween, fmtShort, todayStr } from '../lib/dates';
import { HORIZONS, horizonLabel } from '../lib/meta';
import { openChat } from '../nav';
import type { GoalRec, Horizon } from '../types';

function GoalSheet({ initial, onClose }: { initial?: Partial<GoalRec>; onClose: () => void }) {
  const goals = useTable('goals');
  const [title, setTitle] = useState(initial?.title || '');
  const [horizon, setHorizon] = useState<Horizon>(initial?.horizon || '1m');
  const [parentId, setParentId] = useState(initial?.parentId || '');
  const [target, setTarget] = useState(initial?.targetDate || '');
  const [context, setContext] = useState(initial?.context || '');
  const [progress, setProgress] = useState(initial?.progress ?? 0);
  const [linkWeight, setLinkWeight] = useState(!!initial?.linkWeight);
  const isNew = !initial?.id;
  const hIndex = HORIZONS.findIndex((h) => h.id === horizon);
  const parents = goals.filter((g) => g.id !== initial?.id && HORIZONS.findIndex((h) => h.id === g.horizon) < hIndex);

  const save = () => {
    if (!title.trim()) return toast('Напиши цель');
    const rec = { title: title.trim(), horizon, parentId: parentId || null, targetDate: target || null, context, progress, linkWeight };
    if (isNew) put('goals', { ...rec, status: 'active', createdAt: Date.now() });
    else patch('goals', initial!.id!, rec);
    onClose();
  };

  return (
    <Sheet title={isNew ? 'Новая цель' : 'Цель'} onClose={onClose}>
      <Field label="Цель">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Сдать TOEFL на 100+" />
      </Field>
      <div className="grid-2">
        <Field label="Горизонт">
          <select className="select" value={horizon} onChange={(e) => setHorizon(e.target.value as Horizon)}>
            {HORIZONS.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Срок">
          <input className="input" type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
        </Field>
      </div>
      <Field label="Часть более крупной цели">
        <select className="select" value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">— самостоятельная —</option>
          {parents.map((g) => (
            <option key={g.id} value={g.id}>
              {horizonLabel(g.horizon)}: {g.title}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Контекст для ИИ" hint="Текущий уровень, ограничения, что уже пробовал, что важно. ИИ учитывает это при разбиении и планировании.">
        <textarea className="textarea" value={context} onChange={(e) => setContext(e.target.value)} />
      </Field>
      <Field label={`Прогресс: ${progress}%`}>
        <input type="range" min={0} max={100} step={5} value={progress} onChange={(e) => setProgress(Number(e.target.value))} />
      </Field>
      <Toggle label="Считать прогресс по весу" hint="Для цели похудения: прогресс обновится, когда внесёшь вес" checked={linkWeight} onChange={setLinkWeight} />
      <button className="btn block" onClick={save}>
        Сохранить
      </button>
      {!isNew ? (
        <>
          <button
            className="btn secondary block"
            style={{ marginTop: 8 }}
            onClick={() => {
              save();
              openChat({ mode: 'decompose', goalId: initial!.id!, autoSend: true });
            }}
          >
            <Icon name="sparkles" /> Разбить на шаги с ИИ
          </button>
          <div className="grid-2" style={{ marginTop: 8 }}>
            <button
              className="btn ok"
              onClick={() => {
                patch('goals', initial!.id!, { status: initial?.status === 'done' ? 'active' : 'done', progress: 100 });
                onClose();
              }}
            >
              {initial?.status === 'done' ? 'Вернуть в работу' : '🎉 Достигнута'}
            </button>
            <button
              className="btn danger"
              onClick={() => {
                if (!confirm('Удалить цель?')) return;
                remove('goals', initial!.id!);
                onClose();
              }}
            >
              Удалить
            </button>
          </div>
        </>
      ) : null}
    </Sheet>
  );
}

export function GoalsScreen() {
  const goals = useTable('goals');
  const tasks = useTable('tasks');
  const [edit, setEdit] = useState<Partial<GoalRec> | null>(null);
  const [showDone, setShowDone] = useState(false);
  const today = todayStr();
  const visible = useMemo(() => goals.filter((g) => (showDone ? g.status === 'done' : g.status === 'active')), [goals, showDone]);

  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn grow" onClick={() => setEdit({ horizon: '1m' })}>
          <Icon name="plus" /> Новая цель
        </button>
        <button className={`chip ${showDone ? 'active' : ''}`} onClick={() => setShowDone(!showDone)}>
          Достигнутые
        </button>
      </div>
      {!visible.length ? <Empty emoji="🎯" title={showDone ? 'Пока нет достигнутых' : 'Целей нет'}>Добавь цель — ИИ разобьёт её на шаги и встроит в распорядок.</Empty> : null}
      {HORIZONS.map((h) => {
        const list = visible.filter((g) => g.horizon === h.id);
        if (!list.length) return null;
        return (
          <div key={h.id}>
            <div className="section-title">{h.label}</div>
            {list.map((g) => {
              const parent = g.parentId ? goals.find((x) => x.id === g.parentId) : null;
              const children = goals.filter((x) => x.parentId === g.id).length;
              const openTasks = tasks.filter((t) => t.goalId === g.id && t.status === 'todo').length;
              const left = g.targetDate ? daysBetween(today, g.targetDate) : null;
              return (
                <button key={g.id} className="card" style={{ width: '100%', textAlign: 'left', border: 0, display: 'block' }} onClick={() => setEdit(g)}>
                  <div className="row between">
                    <span style={{ fontWeight: 600 }} className="grow">
                      {g.title}
                    </span>
                    {g.targetDate ? (
                      <span className={`badge ${left != null && left < 0 ? 'danger' : ''}`}>
                        {left != null && left < 0 ? 'срок прошёл' : `до ${fmtShort(g.targetDate)}`}
                      </span>
                    ) : null}
                  </div>
                  {parent ? <div className="tiny muted">↳ {parent.title}</div> : null}
                  {g.context ? <div className="small muted" style={{ marginTop: 4 }}>{g.context.slice(0, 140)}{g.context.length > 140 ? '…' : ''}</div> : null}
                  <div className="row" style={{ marginTop: 8 }}>
                    <div className="grow">
                      <Progress value={(g.progress || 0) / 100} tone={g.status === 'done' ? 'ok' : undefined} />
                    </div>
                    <span className="tiny muted nowrap">
                      {g.progress || 0}% · подцелей {children} · задач {openTasks}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        );
      })}
      {edit ? <GoalSheet initial={edit} onClose={() => setEdit(null)} /> : null}
    </>
  );
}
