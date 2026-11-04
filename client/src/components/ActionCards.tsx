import { useMemo } from 'react';
import { applyActions, previewPlanDay, undoApplied } from '../ai/actions';
import { get, useVersion } from '../db/store';
import { fmtShort } from '../lib/dates';
import { CATEGORIES, horizonLabel, KINDS } from '../lib/meta';
import { go, setDate } from '../nav';
import type { Action, ChatRec } from '../types';
import { toast } from './ui';

function PlanCard({ action, applied }: { action: Extract<Action, { type: 'plan' }>; applied: boolean }) {
  const v = useVersion(['events', 'routines', 'variables', 'marks']);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const previews = useMemo(() => action.days.map((d) => ({ day: d, p: previewPlanDay(d) })), [action, v]);
  return (
    <div className="act">
      <div className="act-title">📅 План на {action.days.length === 1 ? fmtShort(action.days[0].date) : `${action.days.length} дн.`}</div>
      {previews.map(({ day, p }) => (
        <div key={day.date} style={{ marginTop: 8 }}>
          <button
            className="btn ghost small"
            style={{ padding: 0, minHeight: 0, fontWeight: 700 }}
            onClick={() => {
              setDate(day.date);
              go('today');
            }}
          >
            {fmtShort(day.date)}
          </button>
          {!applied && p.removeCount ? <span className="tiny muted"> · заменит {p.removeCount} старых дел ИИ</span> : null}
          <ul>
            {day.items.length === 0 ? <li className="muted">ничего нового</li> : null}
            {(applied ? day.items : p.ok).map((it, i) => (
              <li key={i}>
                <span className="t">
                  {it.start}–{it.end}
                </span>
                <span>
                  {KINDS[it.kind]?.emoji} {it.title}
                  {it.reward ? <span className="badge coin" style={{ marginLeft: 4 }}>🪙{it.reward}</span> : null}
                </span>
              </li>
            ))}
            {!applied
              ? p.dropped.map((d, i) => (
                  <li key={`d${i}`} className="drop">
                    <span className="t">
                      {d.item.start}–{d.item.end}
                    </span>
                    <span>
                      {d.item.title} — {d.reason}
                    </span>
                  </li>
                ))
              : null}
          </ul>
        </div>
      ))}
    </div>
  );
}

function SimpleCard({ action }: { action: Action }) {
  switch (action.type) {
    case 'add_task':
      return (
        <div className="act">
          <div className="act-title">
            {CATEGORIES[action.category]?.emoji} Задача: {action.title}
          </div>
          <div className="tiny muted" style={{ marginTop: 4 }}>
            {action.estimateMin ? `~${action.estimateMin} мин` : 'без оценки'}
            {action.reward ? ` · 🪙${action.reward}` : ''}
            {action.deadline ? ` · до ${fmtShort(action.deadline)}` : ''}
            {action.goalId ? ` · цель: ${get('goals', action.goalId)?.title || ''}` : action.goalRef ? ' · к новой цели' : ''}
          </div>
        </div>
      );
    case 'add_goal':
      return (
        <div className="act">
          <div className="act-title">🎯 Цель ({horizonLabel(action.horizon)}): {action.title}</div>
          {action.context ? <div className="tiny muted" style={{ marginTop: 4 }}>{action.context}</div> : null}
        </div>
      );
    case 'set_variable':
      return (
        <div className="act">
          <div className="act-title">
            🧮 <span className="var-name">{`{${action.name}}`}</span> = <span className="kbd">{action.expr}</span>
          </div>
          {action.description ? <div className="tiny muted" style={{ marginTop: 4 }}>{action.description}</div> : null}
        </div>
      );
    case 'delete_variable':
      return <div className="act">🗑 Удалить переменную {`{${action.name}}`}</div>;
    case 'add_event':
      return (
        <div className="act">
          <div className="act-title">
            {KINDS[action.kind]?.emoji} {action.title}
          </div>
          <div className="tiny muted" style={{ marginTop: 4 }}>
            {fmtShort(action.date)}, {action.start}–{action.end}
            {action.fixed ? ' · жёстко' : ''}
          </div>
        </div>
      );
    case 'update_event': {
      const e = get('events', action.id);
      return (
        <div className="act">
          ✏️ {e?.title || 'Дело'} → {action.date ? fmtShort(action.date) : ''} {action.start || ''}
          {action.end ? `–${action.end}` : ''} {action.title ? `«${action.title}»` : ''}
        </div>
      );
    }
    case 'remove_event':
      return <div className="act">🗑 Убрать: {get('events', action.id)?.title || 'дело'}</div>;
    case 'update_task':
      return <div className="act">✏️ Задача: {get('tasks', action.id)?.title || ''} {action.fields.status === 'done' ? '— выполнена' : ''}</div>;
    case 'update_goal':
      return <div className="act">✏️ Цель: {get('goals', action.id)?.title || ''} {action.fields.progress != null ? `— ${action.fields.progress}%` : ''}</div>;
    case 'add_routine':
      return (
        <div className="act">
          🔁 Распорядок: {action.title} <span className="kbd">{action.startExpr}</span>
        </div>
      );
    case 'log_food':
      return (
        <div className="act">
          <div className="act-title">🍽️ В дневник питания</div>
          <ul>
            {action.items.map((it, i) => (
              <li key={i}>
                <span className="t">{it.grams ? `${it.grams} г` : ''}</span>
                <span>
                  {it.name} — {it.kcal} ккал · Б{it.p} Ж{it.f} У{it.c}
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
    case 'bonus':
      return <div className="act">🎁 Бонус +{action.amount} 🪙 — {action.reason}</div>;
    default:
      return null;
  }
}

export function ActionCards({ msg }: { msg: ChatRec }) {
  const actions = msg.actions || [];
  if (!actions.length) return null;
  const applied = !!msg.applied && !msg.applied.undone;
  return (
    <div className="actions">
      {actions.map((a, i) => (a.type === 'plan' ? <PlanCard key={i} action={a} applied={applied} /> : <SimpleCard key={i} action={a} />))}
      {applied ? (
        <div className="row">
          <span className="badge ok grow" style={{ justifyContent: 'center', padding: '8px' }}>
            ✓ Применено
          </span>
          <button
            className="btn small secondary"
            onClick={() => {
              undoApplied(msg);
              toast('Отменено');
            }}
          >
            Отменить
          </button>
        </div>
      ) : (
        <button
          className="btn block"
          onClick={() => {
            const info = applyActions(msg);
            toast(info.summary.slice(0, 3).join(' · ') || 'Применено');
          }}
        >
          {msg.applied?.undone ? 'Применить снова' : 'Применить'}
        </button>
      )}
    </div>
  );
}
