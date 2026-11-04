import { useMemo, useState } from 'react';
import { estimateGoalBudgets } from '../ai/tools';
import { hasServer } from '../api';
import { Icon } from '../components/Icon';
import { Empty, Field, NumInput, Progress, Sheet, toast, Toggle } from '../components/ui';
import { patch, put, remove, useTable } from '../db/store';
import { daysBetween, fmtShort, todayStr } from '../lib/dates';
import { personalFactors } from '../lib/estimate';
import { fallbackBudget, fmtWeekly, isOngoing, weeklyMinutes } from '../lib/goalbudget';
import { HORIZONS, horizonLabel } from '../lib/meta';
import { openChat } from '../nav';
import type { GoalRec, Horizon } from '../types';

function GoalSheet({ initial, onClose }: { initial?: Partial<GoalRec>; onClose: () => void }) {
  const goals = useTable('goals');
  const tasks = useTable('tasks');
  const events = useTable('events');
  const [title, setTitle] = useState(initial?.title || '');
  const [horizon, setHorizon] = useState<Horizon>(initial?.horizon || '1m');
  const [parentId, setParentId] = useState(initial?.parentId || '');
  const [target, setTarget] = useState(initial?.targetDate || '');
  const [context, setContext] = useState(initial?.context || '');
  const [progress, setProgress] = useState(initial?.progress ?? 0);
  const [linkWeight, setLinkWeight] = useState(!!initial?.linkWeight);
  const [weeklyH, setWeeklyH] = useState<number | null>(initial?.weeklyManual && initial.weeklyMin != null ? Math.round((initial.weeklyMin / 60) * 10) / 10 : null);
  const isNew = !initial?.id;
  const ongoing = horizon === 'ongoing';
  const hIndex = HORIZONS.findIndex((h) => h.id === horizon);
  const parents = goals.filter((g) => g.id !== initial?.id && !isOngoing(g) && HORIZONS.findIndex((h) => h.id === g.horizon) < hIndex);
  const autoWeekly = useMemo(() => {
    if (!initial?.id || ongoing) return null;
    const g = { ...(initial as GoalRec), horizon, targetDate: target || null, progress };
    return g.weeklyMin != null && !g.weeklyManual ? g.weeklyMin : fallbackBudget(g, tasks, events, personalFactors(tasks, events), todayStr())?.weeklyMin ?? null;
  }, [initial, horizon, target, progress, tasks, events, ongoing]);

  const save = () => {
    if (!title.trim()) return toast('Напиши цель');
    const manual = weeklyH != null && !ongoing;
    const rec = {
      title: title.trim(),
      horizon,
      parentId: ongoing ? null : parentId || null,
      targetDate: ongoing ? null : target || null,
      context,
      progress,
      linkWeight,
      weeklyManual: manual,
      ...(manual ? { weeklyMin: Math.round(weeklyH! * 60) } : initial?.weeklyManual ? { weeklyMin: null } : {}),
    };
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
        {!ongoing ? (
          <Field label="Срок">
            <input className="input" type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
          </Field>
        ) : null}
      </div>
      {ongoing ? (
        <div className="banner info small">
          <span>♾️</span>
          <div className="grow">Постоянная цель — без срока и процента. Время под неё отдельно не резервируется: её задачи планируются по своим срокам и приоритету.</div>
        </div>
      ) : (
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
      )}
      <Field label="Контекст для ИИ" hint="Текущий уровень, ограничения, что уже пробовал, что важно. ИИ учитывает это при разбиении и планировании.">
        <textarea className="textarea" value={context} onChange={(e) => setContext(e.target.value)} />
      </Field>
      {!ongoing ? (
        <>
          <Field label={`Прогресс: ${progress}%`}>
            <input type="range" min={0} max={100} step={5} value={progress} onChange={(e) => setProgress(Number(e.target.value))} />
          </Field>
          <Field
            label="Часов в неделю"
            hint={
              weeklyH != null
                ? 'Задано вручную. Очисти поле, чтобы считалось само.'
                : `Считается само: ${autoWeekly != null ? fmtWeekly(autoWeekly) : 'после расчёта'}${initial?.budgetNote ? ` — ${initial.budgetNote}` : ''}`
            }
          >
            <NumInput value={weeklyH} onChange={setWeeklyH} placeholder={autoWeekly != null ? String(Math.round((autoWeekly / 60) * 10) / 10).replace('.', ',') : 'авто'} />
          </Field>
          <Toggle label="Считать прогресс по весу" hint="Для цели похудения: прогресс обновится, когда внесёшь вес" checked={linkWeight} onChange={setLinkWeight} />
        </>
      ) : null}
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
            {!ongoing ? (
              <button
                className="btn ok"
                onClick={() => {
                  patch('goals', initial!.id!, { status: initial?.status === 'done' ? 'active' : 'done', progress: 100 });
                  onClose();
                }}
              >
                {initial?.status === 'done' ? 'Вернуть в работу' : '🎉 Достигнута'}
              </button>
            ) : (
              <span />
            )}
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
  const events = useTable('events');
  const [edit, setEdit] = useState<Partial<GoalRec> | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const today = todayStr();
  const factors = useMemo(() => personalFactors(tasks, events), [tasks, events]);
  const visible = useMemo(() => goals.filter((g) => (showDone ? g.status === 'done' : g.status === 'active')), [goals, showDone]);
  const totalWeekly = visible.reduce((s, g) => s + weeklyMinutes(g, tasks, events, factors, today), 0);

  const recalc = async () => {
    setBusy(true);
    try {
      toast(await estimateGoalBudgets());
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

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
      {!showDone ? (
        <div className="card small">
          <div className="row between">
            <span>
              ⏱ На цели в неделю: <b>{fmtWeekly(totalWeekly)}</b>
            </span>
            <button className="btn small secondary" disabled={busy || !hasServer()} onClick={recalc}>
              <Icon name="sparkles" /> {busy ? 'Считаю…' : 'Рассчитать'}
            </button>
          </div>
          <div className="tiny muted" style={{ marginTop: 6 }}>
            ИИ смотрит на прогресс, сложность задач и твою загруженность и решает, сколько часов в неделю нужно каждой цели. Это время само ставится в расписание (кроме постоянных целей).
          </div>
        </div>
      ) : null}
      {!visible.length ? <Empty emoji="🎯" title={showDone ? 'Пока нет достигнутых' : 'Целей нет'}>Добавь цель — ИИ разобьёт её на шаги и встроит в распорядок.</Empty> : null}
      {HORIZONS.map((h) => {
        const list = visible.filter((g) => g.horizon === h.id);
        if (!list.length) return null;
        return (
          <div key={h.id}>
            <div className="section-title">{h.id === 'ongoing' ? '♾️ Постоянные' : h.label}</div>
            {list.map((g) => {
              const parent = g.parentId ? goals.find((x) => x.id === g.parentId) : null;
              const children = goals.filter((x) => x.parentId === g.id).length;
              const openTasks = tasks.filter((t) => t.goalId === g.id && t.status === 'todo').length;
              const left = g.targetDate ? daysBetween(today, g.targetDate) : null;
              const weekly = weeklyMinutes(g, tasks, events, factors, today);
              return (
                <button key={g.id} className="card" style={{ width: '100%', textAlign: 'left', border: 0, display: 'block' }} onClick={() => setEdit(g)}>
                  <div className="row between">
                    <span style={{ fontWeight: 600 }} className="grow">
                      {g.title}
                    </span>
                    {g.targetDate ? (
                      <span className={`badge ${left != null && left < 0 ? 'danger' : ''}`}>{left != null && left < 0 ? 'срок прошёл' : `до ${fmtShort(g.targetDate)}`}</span>
                    ) : null}
                  </div>
                  {parent ? <div className="tiny muted">↳ {parent.title}</div> : null}
                  {g.context ? (
                    <div className="small muted" style={{ marginTop: 4 }}>
                      {g.context.slice(0, 140)}
                      {g.context.length > 140 ? '…' : ''}
                    </div>
                  ) : null}
                  {isOngoing(g) ? (
                    <div className="tiny muted" style={{ marginTop: 6 }}>
                      постоянная · задач {openTasks}
                    </div>
                  ) : (
                    <>
                      <div className="row" style={{ marginTop: 8 }}>
                        <div className="grow">
                          <Progress value={(g.progress || 0) / 100} tone={g.status === 'done' ? 'ok' : undefined} />
                        </div>
                        <span className="tiny muted nowrap">
                          {g.progress || 0}% · подцелей {children} · задач {openTasks}
                        </span>
                      </div>
                      {g.status === 'active' ? (
                        <div className="row wrap" style={{ gap: 4, marginTop: 6 }}>
                          <span className="badge accent">⏱ {fmtWeekly(weekly)}</span>
                          {g.weeklyManual ? <span className="badge">✋ вручную</span> : g.budgetAt ? <span className="badge">✨ расчёт ИИ</span> : <span className="badge">примерно</span>}
                        </div>
                      ) : null}
                    </>
                  )}
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
