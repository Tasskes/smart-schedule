import { useEffect, useMemo, useState } from 'react';
import { DayStrip } from '../components/DayStrip';
import { Icon } from '../components/Icon';
import { EventForm, ItemSheet } from '../components/ItemSheet';
import { ItemRow } from '../components/ItemRow';
import { Empty, Progress } from '../components/ui';
import { metaGet, metaSet } from '../db/idb';
import { usePlanner } from '../db/planState';
import { refreshSchedule, semesterStart, useSchedule } from '../db/schedule';
import { get, useTable } from '../db/store';
import { academicWeek, addDays, fmtDayMonth, fmtDur, fmtLong, nowMin, timeToMin, todayStr } from '../lib/dates';
import { calcNorms, latestWeight, sumMacros } from '../lib/nutrition';
import { totalFree } from '../lib/planner';
import { go, navStore, openChat, setDate } from '../nav';
import type { DayItem } from '../types';

function useNow() {
  const [now, setNow] = useState(nowMin());
  useEffect(() => {
    const t = setInterval(() => setNow(nowMin()), 30000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function ChangesBanner() {
  const sched = useSchedule();
  const [seen, setSeen] = useState<number | null>(null);
  useEffect(() => {
    metaGet<number>('seenChange').then((v) => setSeen(v ?? 0));
  }, []);
  const changes = (sched.data?.changes || []).filter((c) => seen != null && c.id > seen);
  if (!changes.length) return null;
  return (
    <div className="banner warn">
      <span>⚠️</span>
      <div className="grow">
        <b>Изменения в расписании</b>
        {changes.slice(0, 5).map((c) => (
          <div className="small" key={c.id}>
            {c.text}
          </div>
        ))}
        {changes.length > 5 ? <div className="small muted">и ещё {changes.length - 5}</div> : null}
      </div>
      <button
        className="icon-btn plain"
        onClick={() => {
          const max = Math.max(...changes.map((c) => c.id));
          setSeen(max);
          void metaSet('seenChange', max);
        }}
        aria-label="Скрыть"
      >
        <Icon name="close" />
      </button>
    </div>
  );
}

function FoodMini({ date }: { date: string }) {
  const food = useTable('food');
  const weights = useTable('weights');
  const settings = get('settings', 'main');
  const eaten = useMemo(() => sumMacros(food.filter((f) => f.date === date)), [food, date]);
  const norms = calcNorms(settings?.nutrition, latestWeight(weights)?.kg ?? null, date);
  const ratio = eaten.kcal / norms.kcal;
  return (
    <button className="card" style={{ width: '100%', textAlign: 'left', border: 0 }} onClick={() => go('food')}>
      <div className="row between">
        <span style={{ fontWeight: 600 }}>🍽️ Питание</span>
        <span className="small muted">
          {Math.round(eaten.kcal)} / {norms.kcal} ккал · Б {Math.round(eaten.p)}/{norms.p}
        </span>
      </div>
      <div style={{ marginTop: 8 }}>
        <Progress value={ratio} tone={ratio > 1.05 ? 'danger' : ratio > 0.85 ? 'ok' : undefined} />
      </div>
    </button>
  );
}

export function TodayScreen() {
  const { date } = navStore.use();
  const planner = usePlanner();
  const sched = useSchedule();
  const now = useNow();
  const today = todayStr();
  const [open, setOpen] = useState<DayItem | null>(null);
  const [adding, setAdding] = useState(false);
  const items = useMemo(() => planner.dayItems(date), [planner, date]);
  const sk = useMemo(() => planner.skeleton(date), [planner, date]);
  const week = academicWeek(date, semesterStart(sched.data));
  const hasAi = items.some((i) => i.src === 'event' && i.source === 'ai');
  const isToday = date === today;
  const isPast = date < today;
  const doneCount = items.filter((i) => i.status === 'done').length;
  const weekday = fmtLong(date).split(',')[0];
  const relative = isToday ? 'Сегодня' : date === addDays(today, 1) ? 'Завтра' : date === addDays(today, -1) ? 'Вчера' : null;
  const meta = [
    relative ? `${weekday.toLowerCase()}, ${fmtDayMonth(date)}` : fmtDayMonth(date),
    week ? `${week.num}-я неделя, ${week.even ? 'чётная' : 'нечётная'}` : null,
    items.length ? `сделано ${doneCount}/${items.length}` : null,
  ].filter(Boolean).join(' · ');

  const rows: React.ReactNode[] = [];
  let nowShown = !isToday;
  let prevEnd: number | null = null;
  for (const it of items) {
    const s = timeToMin(it.start) ?? 0;
    if (!nowShown && s > now) {
      rows.push(
        <div className="nowline" key="now">
          сейчас
        </div>,
      );
      nowShown = true;
    }
    if (prevEnd != null && s - prevEnd >= 60 && !it.overnight) {
      rows.push(
        <div className="free-gap" key={`gap-${it.key}`}>
          свободно {fmtDur(s - prevEnd)}
        </div>,
      );
    }
    rows.push(<ItemRow key={it.key} item={it} now={isToday ? now : null} onOpen={setOpen} />);
    if (!it.overnight) prevEnd = Math.max(prevEnd ?? 0, timeToMin(it.end) ?? s);
  }
  if (!nowShown && items.length) rows.push(<div className="nowline" key="now">сейчас</div>);

  return (
    <>
      <DayStrip date={date} onChange={setDate} />
      <div className="day-head">
        <h1 className="large-title grow">{relative || weekday}</h1>
        {!isPast ? (
          <>
            <button className="btn small" onClick={() => openChat({ mode: 'plan', targetDays: [date] })} aria-label={hasAi ? 'Перегенерировать день' : 'Спланировать день с ИИ'}>
              <Icon name={hasAi ? 'refresh' : 'sparkles'} /> ИИ-план
            </button>
            <button className="round-btn" onClick={() => setAdding(true)} aria-label="Добавить дело">
              <Icon name="plus" />
            </button>
          </>
        ) : null}
      </div>
      <div className="day-meta">
        {meta}
        {sched.loading ? ' · обновляю…' : ''}
      </div>

      {isToday ? <ChangesBanner /> : null}
      {sched.error && !sched.data?.classes?.length ? (
        <div className="banner err">
          <span>⚠️</span>
          <div className="grow small">
            Не удалось загрузить пары: {sched.error}
            <div>
              <button className="btn small secondary" style={{ marginTop: 6 }} onClick={() => refreshSchedule(true)}>
                Повторить
              </button>
            </div>
          </div>
        </div>
      ) : null}


      {items.length ? (
        <div className="timeline">{rows}</div>
      ) : (
        <Empty emoji="🌤️" title="На этот день пока пусто">
          Пар нет. Нажми «ИИ-план» — нейросеть разложит дела, или добавь дело вручную «+».
        </Empty>
      )}

      {!isPast && sk.free.length ? (
        <div className="small muted center" style={{ margin: '12px 0' }}>
          Свободного времени: {fmtDur(totalFree(sk.free))}
        </div>
      ) : null}

      <div style={{ marginTop: 14 }}>
        <FoodMini date={date} />
      </div>

      {open ? <ItemSheet item={open} onClose={() => setOpen(null)} /> : null}
      {adding ? <EventForm date={date} onClose={() => setAdding(false)} /> : null}
    </>
  );
}
