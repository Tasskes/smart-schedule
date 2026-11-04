import { usePlanner } from '../db/planState';
import { addDays, DOW_SHORT, fmtDayMonth, parseDate, todayStr, weekDays, weekStart } from '../lib/dates';
import { Icon } from './Icon';

export function DayStrip({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  const planner = usePlanner();
  const days = weekDays(date);
  const today = todayStr();
  const monday = weekStart(date);
  return (
    <>
      <div className="weeknav">
        <button className="icon-btn plain" onClick={() => onChange(addDays(date, -7))} aria-label="Прошлая неделя">
          <Icon name="left" />
        </button>
        <button className="btn ghost small title" onClick={() => onChange(today)}>
          {fmtDayMonth(monday)} – {fmtDayMonth(addDays(monday, 6))}
          {weekStart(today) !== monday ? ' · к сегодня' : ''}
        </button>
        <button className="icon-btn plain" onClick={() => onChange(addDays(date, 7))} aria-label="Следующая неделя">
          <Icon name="right" />
        </button>
      </div>
      <div className="daystrip">
        {days.map((d, i) => {
          const classes = planner.visibleClasses(d).length;
          const items = planner.dayItems(d);
          const ai = items.filter((it) => it.src === 'event').length;
          return (
            <button key={d} className={`${d === today ? 'today' : ''} ${d === date ? 'sel' : ''}`} onClick={() => onChange(d)}>
              <span className="dw">{DOW_SHORT[i]}</span>
              <span className="dn">{parseDate(d).getDate()}</span>
              <span className="dots">
                {Array.from({ length: Math.min(classes, 4) }, (_, k) => (
                  <i key={k} />
                ))}
                {ai ? <i className="ai" /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
