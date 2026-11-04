import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { ItemSheet } from '../components/ItemSheet';
import { ItemRow } from '../components/ItemRow';
import { remainingWeekDays } from '../ai/context';
import { usePlanner } from '../db/planState';
import { addDays, fmtDayMonth, fmtShort, todayStr, weekDays, weekStart } from '../lib/dates';
import { navStore, openChat, setDate, go } from '../nav';
import type { DayItem } from '../types';

export function WeekScreen() {
  const { date } = navStore.use();
  const planner = usePlanner();
  const today = todayStr();
  const days = weekDays(date);
  const monday = weekStart(date);
  const [open, setOpen] = useState<DayItem | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const isCurrent = weekStart(today) === monday;
  const isFuture = monday > today;
  const futureDays = days.filter((d) => d >= today);

  const stats = useMemo(() => {
    let ai = 0;
    let done = 0;
    let total = 0;
    let coins = 0;
    for (const d of days) {
      for (const it of planner.dayItems(d)) {
        total += 1;
        if (it.src === 'event' && it.source === 'ai') ai += 1;
        if (it.status === 'done') {
          done += 1;
          coins += it.reward;
        }
      }
    }
    return { ai, done, total, coins };
  }, [planner, days]);

  const target = isCurrent ? remainingWeekDays().filter((d) => days.includes(d)) : futureDays;

  return (
    <>
      <div className="weeknav" style={{ marginBottom: 10 }}>
        <button className="icon-btn plain" onClick={() => setDate(addDays(date, -7))} aria-label="Прошлая неделя">
          <Icon name="left" />
        </button>
        <button className="btn ghost small title" onClick={() => setDate(today)}>
          {fmtDayMonth(monday)} – {fmtDayMonth(addDays(monday, 6))}
          {isCurrent ? ' · эта неделя' : ''}
        </button>
        <button className="icon-btn plain" onClick={() => setDate(addDays(date, 7))} aria-label="Следующая неделя">
          <Icon name="right" />
        </button>
      </div>

      {target.length ? (
        <div className="card row" style={{ gap: 8 }}>
          <div className="grow">
            <div style={{ fontWeight: 600 }}>✨ ИИ-план</div>
            <div className="small muted">
              сделано {stats.done} из {stats.total}
              {stats.coins ? ` · 🪙 ${stats.coins}` : ''}
            </div>
          </div>
          <button
            className="btn small"
            onClick={() => openChat({ mode: 'plan', targetDays: target })}
            aria-label={
              stats.ai
                ? isCurrent ? 'Перегенерировать оставшиеся дни' : 'Перегенерировать неделю'
                : isCurrent ? 'Сгенерировать на оставшиеся дни' : 'Сгенерировать неделю'
            }
          >
            <Icon name={stats.ai ? 'refresh' : 'sparkles'} /> {isCurrent ? 'Остаток' : 'Неделя'}
          </button>
          {isCurrent ? (
            <button className="btn small secondary" onClick={() => openChat({ mode: 'plan', targetDays: weekDays(addDays(today, 7)) })} aria-label="Спланировать следующую неделю">
              След.
            </button>
          ) : null}
        </div>
      ) : null}

      {days.map((d) => {
        const items = planner.dayItems(d).filter((it) => it.kind !== 'sleep');
        const past = d < today;
        const collapsed = past && !expanded.has(d);
        if (collapsed) {
          const done = items.filter((i) => i.status === 'done').length;
          const classes = items.filter((i) => i.kind === 'class').length;
          return (
            <div key={d} style={{ marginBottom: 6 }}>
              <button className="day-summary" onClick={() => setExpanded(new Set([...expanded, d]))}>
                <span style={{ fontWeight: 600 }}>{fmtShort(d)}</span>
                <span className="muted grow">
                  {classes ? `пар: ${classes} · ` : ''}сделано {done}/{items.length}
                </span>
                <Icon name="right" size={16} />
              </button>
            </div>
          );
        }
        return (
          <div key={d} style={{ marginBottom: 6, opacity: past ? 0.7 : 1 }}>
            <div className="section-title">
              <button
                className="btn ghost small"
                style={{ padding: 0, minHeight: 0, color: d === today ? 'var(--accent)' : 'var(--text)', textTransform: 'none', fontSize: 15 }}
                onClick={() => {
                  setDate(d);
                  go('today');
                }}
              >
                {fmtShort(d)}
                {d === today ? ' · сегодня' : ''}
              </button>
              <span className="spacer" />
              {!past ? (
                <button className="btn ghost small" style={{ minHeight: 0, padding: '2px 4px' }} onClick={() => openChat({ mode: 'plan', targetDays: [d] })}>
                  <Icon name="refresh" /> день
                </button>
              ) : null}
            </div>
            {items.length ? (
              <div className="timeline">
                {items.map((it) => (
                  <ItemRow key={it.key} item={it} compact onOpen={setOpen} />
                ))}
              </div>
            ) : (
              <div className="small muted" style={{ padding: '4px 6px' }}>
                Пусто
              </div>
            )}
          </div>
        );
      })}
      {isFuture ? null : <div style={{ height: 8 }} />}
      {open ? <ItemSheet item={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
