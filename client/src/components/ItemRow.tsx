import { completeTask, setItemStatus, startTimer, stopTimer } from '../db/ops';
import { get } from '../db/store';
import { fmtDur, timeToMin } from '../lib/dates';
import { KINDS } from '../lib/meta';
import type { DayItem } from '../types';
import { Icon } from './Icon';
import { toast } from './ui';

export function kindColor(kind: string) {
  return `var(--k-${kind in KINDS ? kind : 'other'})`;
}

export function afterDone(item: DayItem, coins: number, minutes?: number | null) {
  const parts = [coins > 0 ? `+${coins} 🪙` : 'Готово'];
  if (minutes) parts.push(`${fmtDur(minutes)}`);
  const task = item.taskId ? get('tasks', item.taskId) : undefined;
  if (task && task.status === 'todo') {
    toast(`${parts.join(' · ')} — «${task.title}»`, {
      label: 'Задача готова целиком',
      run: () => {
        const b = completeTask(task.id, true);
        toast(b ? `Задача закрыта, бонус +${b} 🪙` : 'Задача закрыта');
      },
    });
  } else toast(parts.join(' · '));
}

export function ItemRow({ item, now, onOpen, compact }: { item: DayItem; now?: number | null; onOpen?: (it: DayItem) => void; compact?: boolean }) {
  const s = timeToMin(item.start) ?? 0;
  const e = timeToMin(item.end) ?? s;
  const isNow = now != null && now >= s && now < e && item.status !== 'done' && item.status !== 'skipped';
  const thin = (item.kind === 'commute' || item.kind === 'sleep') && !compact;
  const running = !!item.startedAt && item.status !== 'done';
  const done = item.status === 'done';
  const cls = ['item', done ? 'done' : '', item.status === 'skipped' ? 'skipped' : '', isNow ? 'now' : '', compact ? 'compact' : '', thin ? 'thin' : ''].join(' ');
  const duration = e - s;

  const toggleDone = (ev: React.MouseEvent) => {
    ev.stopPropagation();
    if (done) {
      setItemStatus(item, null);
      toast('Отметка снята');
      return;
    }
    if (running) {
      const r = stopTimer(item);
      afterDone(item, r.coins, r.minutes);
      return;
    }
    const coins = setItemStatus(item, 'done');
    afterDone(item, coins);
  };

  const timer = (ev: React.MouseEvent) => {
    ev.stopPropagation();
    if (running) {
      const r = stopTimer(item);
      afterDone(item, r.coins, r.minutes);
    } else {
      startTimer(item);
      toast(`Таймер запущен: ${item.title}`);
    }
  };

  return (
    <div className={cls} onClick={() => onOpen?.(item)} role="button" tabIndex={0}>
      <div className="bar" style={{ background: kindColor(item.kind) }} />
      <div className="time">
        <b>{item.start}</b>
        {duration > 0 && !thin ? <span>{item.end}</span> : null}
      </div>
      <div className="body">
        <div className="title">
          {thin ? `${KINDS[item.kind]?.emoji || ''} ` : ''}
          {item.title}
          {thin && duration > 0 ? <span className="muted"> · {fmtDur(duration)}</span> : null}
        </div>
        {!thin && (item.subtitle || item.location) ? (
          <div className="sub ellipsis">{[item.subtitle, item.location].filter(Boolean).join(' · ')}</div>
        ) : null}
        {!thin && !compact ? (
          <div className="meta">
            <span className="badge">
              {KINDS[item.kind]?.emoji} {KINDS[item.kind]?.label}
            </span>
            {item.reward > 0 ? <span className="badge coin">🪙 {item.reward}</span> : null}
            {item.fixed && item.kind !== 'class' ? <span className="badge">📌 жёстко</span> : null}
            {running ? <span className="badge danger">⏱ идёт</span> : null}
            {item.actualMin ? <span className="badge ok">{fmtDur(item.actualMin)}</span> : null}
            {item.status === 'skipped' ? <span className="badge">пропущено</span> : null}
          </div>
        ) : null}
      </div>
      {!thin ? (
        <div className="acts">
          <button className={`icon-btn ${done ? 'ok' : ''}`} onClick={toggleDone} aria-label="Готово">
            <Icon name="check" />
          </button>
          {!compact && !done && item.kind !== 'class' && duration >= 10 ? (
            <button className={`icon-btn ${running ? 'accent' : 'plain'}`} onClick={timer} aria-label="Таймер">
              <Icon name={running ? 'stop' : 'play'} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
