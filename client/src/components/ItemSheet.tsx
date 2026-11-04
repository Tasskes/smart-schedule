import { useMemo, useState } from 'react';
import { overrideTime, resetOverride, setHidden, setItemStatus } from '../db/ops';
import { get, patch, put, useTable } from '../db/store';
import { fmtDur, fmtShort, minToTime, normTime, nowMin, roundUp5, timeToMin, todayStr } from '../lib/dates';
import { defaultReward } from '../lib/game';
import { EDITABLE_KINDS, KINDS } from '../lib/meta';
import { openSub } from '../nav';
import type { DayItem, EventRec, Kind } from '../types';
import { afterDone } from './ItemRow';
import { Field, NumInput, Sheet, toast, Toggle } from './ui';

export function ItemSheet({ item, onClose }: { item: DayItem; onClose: () => void }) {
  if (item.src === 'event') {
    const ev = get('events', item.srcId);
    if (!ev) return null;
    return <EventForm initial={ev} date={ev.date} onClose={onClose} item={item} />;
  }
  return <VirtualSheet item={item} onClose={onClose} />;
}

function StatusButtons({ item, onClose }: { item: DayItem; onClose: () => void }) {
  return (
    <div className="grid-2" style={{ marginBottom: 12 }}>
      <button
        className={`btn ${item.status === 'done' ? 'secondary' : 'ok'}`}
        onClick={() => {
          if (item.status === 'done') setItemStatus(item, null);
          else afterDone(item, setItemStatus(item, 'done'));
          onClose();
        }}
      >
        {item.status === 'done' ? 'Снять отметку' : '✓ Сделано'}
      </button>
      <button
        className="btn secondary"
        onClick={() => {
          setItemStatus(item, item.status === 'skipped' ? null : 'skipped');
          onClose();
        }}
      >
        {item.status === 'skipped' ? 'Вернуть' : 'Пропустить'}
      </button>
    </div>
  );
}

function VirtualSheet({ item, onClose }: { item: DayItem; onClose: () => void }) {
  const [start, setStart] = useState(item.start);
  const [end, setEnd] = useState(item.end);
  const isClass = item.src === 'class';
  const routine = !isClass ? get('routines', item.srcId) : undefined;
  return (
    <Sheet title={isClass ? 'Пара' : 'Распорядок'} onClose={onClose}>
      <div className="card flat">
        <div style={{ fontWeight: 700, fontSize: 17 }}>{item.title}</div>
        <div className="muted small" style={{ marginTop: 4 }}>
          {fmtShort(item.date)}, {item.start}–{item.end}
          {item.subtitle ? ` · ${item.subtitle}` : ''}
        </div>
        {item.location ? <div className="small" style={{ marginTop: 6 }}>📍 {item.location}</div> : null}
        {item.notes ? <div className="small muted" style={{ marginTop: 4 }}>👤 {item.notes}</div> : null}
        {routine ? (
          <div className="small muted" style={{ marginTop: 6 }}>
            Начало: <span className="kbd">{routine.startExpr}</span> · длительность: <span className="kbd">{routine.durationExpr || '0'}</span>
          </div>
        ) : null}
      </div>
      <StatusButtons item={item} onClose={onClose} />
      {!isClass ? (
        <>
          <div className="section-title">Только на этот день</div>
          <div className="grid-2">
            <Field label="Начало">
              <input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="Конец">
              <input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>
          <div className="grid-2">
            <button
              className="btn secondary"
              onClick={() => {
                const s = normTime(start);
                const e = normTime(end) || s;
                if (!s || !e) return toast('Проверь время');
                overrideTime(item, s, e);
                toast('Время изменено на этот день');
                onClose();
              }}
            >
              Сохранить время
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                resetOverride(item);
                onClose();
              }}
            >
              Как в шаблоне
            </button>
          </div>
        </>
      ) : null}
      <div className="hr" />
      <button
        className="btn danger block"
        onClick={() => {
          setHidden(item, !item.hidden);
          toast(item.hidden ? 'Снова показывается' : isClass ? 'Пара скрыта на этот день — время освободится для плана' : 'Скрыто на этот день');
          onClose();
        }}
      >
        {item.hidden ? 'Показать снова' : isClass ? 'Не пойду / скрыть пару в этот день' : 'Скрыть на этот день'}
      </button>
      {routine ? (
        <button
          className="btn ghost block"
          style={{ marginTop: 8 }}
          onClick={() => {
            onClose();
            openSub('routines');
          }}
        >
          Изменить шаблон распорядка
        </button>
      ) : null}
    </Sheet>
  );
}

export function EventForm({ initial, date, onClose, item }: { initial?: Partial<EventRec>; date: string; onClose: () => void; item?: DayItem }) {
  const tasks = useTable('tasks');
  const isNew = !initial?.id;
  const defStart = date === todayStr() ? minToTime(Math.min(23 * 60, roundUp5(nowMin() + 15))) : '18:00';
  const [title, setTitle] = useState(initial?.title || '');
  const [kind, setKind] = useState<Kind>((initial?.kind as Kind) || 'task');
  const [d, setD] = useState(initial?.date || date);
  const [start, setStart] = useState(initial?.start || defStart);
  const [end, setEnd] = useState(initial?.end || minToTime(Math.min(1440, (timeToMin(defStart) ?? 1080) + 60)));
  const [fixed, setFixed] = useState(!!initial?.fixed || kind === 'tutor');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [reward, setReward] = useState<number | null>(initial?.reward ?? null);
  const [remind, setRemind] = useState<number | null>(initial?.remindMin ?? null);
  const [taskId, setTaskId] = useState<string>(initial?.taskId || '');
  const minutes = Math.max(0, (timeToMin(end) ?? 0) - (timeToMin(start) ?? 0));
  const openTasks = useMemo(() => tasks.filter((t) => t.status === 'todo' || t.id === initial?.taskId), [tasks, initial?.taskId]);

  const save = () => {
    const s = normTime(start);
    const e = normTime(end);
    if (!title.trim()) return toast('Напиши название');
    if (!s || !e || (timeToMin(e) ?? 0) <= (timeToMin(s) ?? 0)) return toast('Конец должен быть позже начала');
    const task = taskId ? get('tasks', taskId) : undefined;
    const fields = {
      title: title.trim(),
      kind,
      date: d,
      start: s,
      end: e,
      fixed: fixed || kind === 'tutor',
      notes,
      reward: reward ?? null,
      remindMin: remind,
      taskId: taskId || null,
      goalId: task?.goalId ?? initial?.goalId ?? null,
    };
    if (isNew) {
      put('events', { ...fields, source: kind === 'tutor' ? 'tutor' : 'manual', status: 'planned' });
      toast('Добавлено');
    } else {
      // ручная правка дела ИИ — теперь оно «твоё» и не исчезнет при перегенерации
      patch('events', initial!.id!, { ...fields, source: initial?.source === 'ai' ? 'manual' : initial?.source });
      toast('Сохранено');
    }
    onClose();
  };

  return (
    <Sheet title={isNew ? 'Новое дело' : 'Дело'} onClose={onClose}>
      {item ? <StatusButtons item={item} onClose={onClose} /> : null}
      <Field label="Название">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например: Курсовая — глава 1" autoFocus={isNew} />
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
      <div className="grid-3">
        <Field label="Дата">
          <input className="input" type="date" value={d} onChange={(e) => setD(e.target.value)} />
        </Field>
        <Field label="Начало">
          <input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Конец">
          <input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      <div className="tiny muted" style={{ marginTop: -6, marginBottom: 10 }}>Длительность: {fmtDur(minutes)}</div>
      <Field label="Задача (необязательно)">
        <select className="select" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
          <option value="">— без задачи —</option>
          {openTasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid-2">
        <Field label="Награда, 🪙" hint={`по умолчанию ${defaultReward(kind, minutes)}`}>
          <NumInput value={reward} onChange={setReward} placeholder={String(defaultReward(kind, minutes))} />
        </Field>
        <Field label="Напомнить за, мин" hint="пусто — как в {напоминание}">
          <NumInput value={remind} onChange={setRemind} placeholder="10" />
        </Field>
      </div>
      <Toggle label="Жёсткое время" hint="ИИ не будет его двигать и ставить дела поверх" checked={fixed || kind === 'tutor'} onChange={setFixed} />
      <Field label="Заметка">
        <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Что именно сделать, ссылки, контекст" />
      </Field>
      <button className="btn block" onClick={save}>
        {isNew ? 'Добавить' : 'Сохранить'}
      </button>
      {!isNew ? (
        <button
          className="btn danger block"
          style={{ marginTop: 8 }}
          onClick={() => {
            patch('events', initial!.id!, { deleted: true });
            toast('Удалено');
            onClose();
          }}
        >
          Удалить
        </button>
      ) : null}
    </Sheet>
  );
}
