import { useMemo, useState } from 'react';
import { estimateTask, type Estimate } from '../ai/tools';
import { Icon } from '../components/Icon';
import { Empty, Field, NumInput, Seg, Sheet, toast } from '../components/ui';
import { completeTask } from '../db/ops';
import { patch, put, remove, useTable } from '../db/store';
import { daysBetween, fmtDur, fmtShort, todayStr } from '../lib/dates';
import { adjustedEstimate, personalFactors, taskSpent } from '../lib/estimate';
import { defaultReward } from '../lib/game';
import { CATEGORIES, horizonLabel } from '../lib/meta';
import { openChat } from '../nav';
import type { Category, TaskRec } from '../types';

function TaskSheet({ initial, onClose }: { initial?: Partial<TaskRec>; onClose: () => void }) {
  const goals = useTable('goals');
  const events = useTable('events');
  const [title, setTitle] = useState(initial?.title || '');
  const [category, setCategory] = useState<Category>(initial?.category || 'study');
  const [context, setContext] = useState(initial?.context || '');
  const [deadline, setDeadline] = useState(initial?.deadline || '');
  const [priority, setPriority] = useState<1 | 2 | 3>(initial?.priority || 2);
  const [goalId, setGoalId] = useState(initial?.goalId || '');
  const [estimate, setEstimate] = useState<number | null>(initial?.estimateMin ?? null);
  const [reward, setReward] = useState<number | null>(initial?.reward ?? null);
  const [actual, setActual] = useState<number | null>(initial?.actualMin ?? null);
  const [est, setEst] = useState<Estimate | null>(null);
  const [busy, setBusy] = useState(false);
  const isNew = !initial?.id;
  const spent = initial?.id ? taskSpent({ ...(initial as TaskRec), actualMin: null }, events) : 0;

  const fields = () => ({
    title: title.trim(),
    category,
    context,
    deadline: deadline || null,
    priority,
    goalId: goalId || null,
    estimateMin: estimate,
    reward: reward ?? (estimate ? defaultReward('task', estimate) : null),
    actualMin: actual,
    complexity: est?.complexity ?? initial?.complexity ?? null,
    steps: est?.steps ?? initial?.steps,
    estimateNote: est?.explanation ?? initial?.estimateNote,
  });

  const save = (close = true) => {
    if (!title.trim()) {
      toast('Напиши задачу');
      return null;
    }
    let id = initial?.id;
    if (isNew) id = put('tasks', { ...fields(), status: 'todo', createdAt: Date.now() }).id;
    else patch('tasks', id!, fields());
    if (close) onClose();
    return id!;
  };

  const runEstimate = async () => {
    if (!title.trim()) return toast('Сначала напиши задачу');
    setBusy(true);
    try {
      const r = await estimateTask({ title, context, category, deadline: deadline || null, goalId: goalId || null });
      setEst(r);
      setEstimate(r.estimateMin);
      setReward(r.reward);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={isNew ? 'Новая задача' : 'Задача'} onClose={onClose}>
      <Field label="Задача">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Курсовая по институциональной экономике" />
      </Field>
      <div className="grid-2">
        <Field label="Категория">
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {(Object.keys(CATEGORIES) as Category[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORIES[c].emoji} {CATEGORIES[c].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Дедлайн">
          <input className="input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </Field>
      </div>
      <Field label="Приоритет">
        <Seg<'1' | '2' | '3'>
          value={String(priority) as '1' | '2' | '3'}
          onChange={(v) => setPriority(Number(v) as 1 | 2 | 3)}
          options={[
            { v: '1', label: 'Высокий' },
            { v: '2', label: 'Обычный' },
            { v: '3', label: 'Низкий' },
          ]}
        />
      </Field>
      <Field label="Цель">
        <select className="select" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
          <option value="">— без цели —</option>
          {goals
            .filter((g) => g.status === 'active')
            .map((g) => (
              <option key={g.id} value={g.id}>
                {horizonLabel(g.horizon)}: {g.title}
              </option>
            ))}
        </select>
      </Field>
      <Field label="Контекст" hint="Объём, требования, что уже сделано — влияет на оценку и план">
        <textarea className="textarea" value={context} onChange={(e) => setContext(e.target.value)} placeholder="25 страниц, 3 главы, нужен список литературы…" />
      </Field>

      <div className="card flat" style={{ background: 'var(--card-2)' }}>
        <div className="row between">
          <b>⏱ Объём и время</b>
          <button className="btn small secondary" onClick={runEstimate} disabled={busy}>
            <Icon name="sparkles" /> {busy ? 'Оцениваю…' : 'Оценить ИИ'}
          </button>
        </div>
        {est ? (
          <div className="small" style={{ marginTop: 8 }}>
            <div>
              ИИ: <b>{fmtDur(est.estimateMin)}</b>, сложность {est.complexity}/5, {est.splitInto > 1 ? `${est.splitInto} подхода(ов)` : 'за один подход'}
            </div>
            {est.factor !== 1 ? (
              <div>
                С учётом твоей статистики (×{est.factor.toFixed(2)}): <b>{fmtDur(est.adjustedMin)}</b>
              </div>
            ) : null}
            {est.explanation ? <div className="muted" style={{ marginTop: 4 }}>{est.explanation}</div> : null}
            {est.steps.length ? (
              <ol style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {est.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : initial?.estimateNote ? (
          <div className="small muted" style={{ marginTop: 8 }}>{initial.estimateNote}</div>
        ) : null}
        <div className="grid-3" style={{ marginTop: 10 }}>
          <Field label="Оценка, мин">
            <NumInput value={estimate} onChange={setEstimate} />
          </Field>
          <Field label="Награда 🪙">
            <NumInput value={reward} onChange={setReward} placeholder={estimate ? String(defaultReward('task', estimate)) : ''} />
          </Field>
          <Field label="Факт, мин" hint={spent ? `по таймерам: ${spent}` : undefined}>
            <NumInput value={actual} onChange={setActual} placeholder={spent ? String(spent) : ''} />
          </Field>
        </div>
      </div>

      <button className="btn block" style={{ marginTop: 8 }} onClick={() => save()}>
        Сохранить
      </button>
      <button
        className="btn secondary block"
        style={{ marginTop: 8 }}
        onClick={() => {
          const id = save(false);
          if (!id) return;
          onClose();
          openChat({ mode: 'chat', prefill: `Запланируй задачу «${title.trim()}» в ближайшие дни` });
        }}
      >
        📅 Запланировать с ИИ
      </button>
      {!isNew ? (
        <div className="grid-2" style={{ marginTop: 8 }}>
          <button
            className="btn ok"
            onClick={() => {
              save(false);
              const done = initial?.status !== 'done';
              const b = completeTask(initial!.id!, done);
              toast(done ? (b ? `Задача закрыта, +${b} 🪙` : 'Задача закрыта') : 'Вернул в работу');
              onClose();
            }}
          >
            {initial?.status === 'done' ? 'Вернуть в работу' : '✓ Выполнена'}
          </button>
          <button
            className="btn danger"
            onClick={() => {
              if (!confirm('Удалить задачу?')) return;
              remove('tasks', initial!.id!);
              onClose();
            }}
          >
            Удалить
          </button>
        </div>
      ) : null}
    </Sheet>
  );
}

export function TasksScreen() {
  const tasks = useTable('tasks');
  const events = useTable('events');
  const goals = useTable('goals');
  const [filter, setFilter] = useState<'todo' | 'done'>('todo');
  const [edit, setEdit] = useState<Partial<TaskRec> | null>(null);
  const factors = useMemo(() => personalFactors(tasks, events), [tasks, events]);
  const today = todayStr();
  const list = useMemo(
    () =>
      tasks
        .filter((t) => (filter === 'todo' ? t.status === 'todo' : t.status === 'done'))
        .sort((a, b) =>
          filter === 'done'
            ? (b.doneAt || 0) - (a.doneAt || 0)
            : (a.deadline || '9999').localeCompare(b.deadline || '9999') || (a.priority ?? 2) - (b.priority ?? 2),
        ),
    [tasks, filter],
  );

  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn grow" onClick={() => setEdit({ category: 'study' })}>
          <Icon name="plus" /> Новая задача
        </button>
      </div>
      <Seg<'todo' | 'done'> value={filter} onChange={setFilter} options={[{ v: 'todo', label: 'Активные' }, { v: 'done', label: 'Выполненные' }]} />
      <div style={{ height: 10 }} />
      {!list.length ? <Empty emoji="✅" title={filter === 'todo' ? 'Задач нет' : 'Пока ничего не выполнено'}>Добавь задачу — ИИ оценит объём и время и поставит её в распорядок.</Empty> : null}
      <div className="list">
        {list.map((t) => {
          const adj = adjustedEstimate(t, factors);
          const spent = taskSpent(t, events);
          const left = t.deadline ? daysBetween(today, t.deadline) : null;
          const goal = t.goalId ? goals.find((g) => g.id === t.goalId) : null;
          return (
            <button key={t.id} className="list-item" onClick={() => setEdit(t)}>
              <span className="emoji">{CATEGORIES[t.category]?.emoji}</span>
              <div className="grow">
                <div className="small" style={{ fontWeight: 600 }}>
                  {t.priority === 1 ? '❗ ' : ''}
                  {t.title}
                </div>
                <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
                  {adj ? <span className="badge">⏱ {fmtDur(adj)}</span> : <span className="badge warn">без оценки</span>}
                  {spent ? <span className="badge ok">сделано {fmtDur(spent)}</span> : null}
                  {t.reward ? <span className="badge coin">🪙 {t.reward}</span> : null}
                  {t.deadline ? (
                    <span className={`badge ${left! < 0 ? 'danger' : left! <= 2 ? 'warn' : ''}`}>
                      {left! < 0 ? 'просрочено' : left === 0 ? 'сегодня' : `до ${fmtShort(t.deadline)}`}
                    </span>
                  ) : null}
                  {goal ? <span className="badge accent">🎯 {goal.title.slice(0, 24)}</span> : null}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="section-title">Точность оценок</div>
      <div className="card small">
        {Object.keys(factors).length ? (
          Object.entries(factors).map(([k, f]) => (
            <div key={k} className="row between" style={{ padding: '3px 0' }}>
              <span>{k === 'all' ? 'В среднем' : CATEGORIES[k as Category]?.label}</span>
              <span>
                ×{f!.factor.toFixed(2)} <span className="muted">({f!.n} задач)</span>
              </span>
            </div>
          ))
        ) : (
          <span className="muted">
            Когда выполнишь хотя бы 3 задачи с оценкой (засекай время таймером ▶), приложение поймёт, во сколько раз ты обычно выходишь за оценку, и будет поправлять оценки ИИ под тебя.
          </span>
        )}
      </div>
      {edit ? <TaskSheet initial={edit} onClose={() => setEdit(null)} /> : null}
    </>
  );
}
