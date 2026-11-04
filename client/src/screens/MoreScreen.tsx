import { Icon } from '../components/Icon';
import { useTable } from '../db/store';
import { balance } from '../lib/game';
import { openSub, type Sub } from '../nav';

const ITEMS: { sub: Sub; emoji: string; title: string; hint: string }[] = [
  { sub: 'goals', emoji: '🎯', title: 'Цели', hint: '5 лет → год → полгода → квартал → месяц → неделя' },
  { sub: 'tasks', emoji: '✅', title: 'Задачи', hint: 'Оценка объёма и времени ИИ, дедлайны' },
  { sub: 'variables', emoji: '🧮', title: 'Переменные', hint: 'Постоянные значения и формулы для распорядка' },
  { sub: 'routines', emoji: '🔁', title: 'Распорядок', hint: 'Подъём, дорога, отбой — то, что повторяется' },
  { sub: 'rewards', emoji: '🪙', title: 'Монеты и награды', hint: 'Баланс, уровень, магазин наград' },
  { sub: 'fridge', emoji: '🧊', title: 'Холодильник и рецепты', hint: 'Что есть дома и что из этого приготовить' },
  { sub: 'basket', emoji: '🛒', title: 'Продуктовая корзина', hint: 'Самая выгодная корзина под твоё КБЖУ' },
  { sub: 'settings', emoji: '⚙️', title: 'Настройки', hint: 'Сервер, уведомления, календарь, резервная копия' },
];

export function MoreScreen() {
  const ledger = useTable('ledger');
  return (
    <div className="list">
      {ITEMS.map((it) => (
        <button key={it.sub} className="list-item" onClick={() => openSub(it.sub)}>
          <span className="emoji">{it.emoji}</span>
          <div className="grow">
            <div style={{ fontWeight: 600 }}>
              {it.title}
              {it.sub === 'rewards' ? <span className="badge coin" style={{ marginLeft: 6 }}>🪙 {balance(ledger)}</span> : null}
            </div>
            <div className="tiny muted">{it.hint}</div>
          </div>
          <Icon name="right" className="chev" />
        </button>
      ))}
    </div>
  );
}
