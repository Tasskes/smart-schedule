import { Icon } from '../components/Icon';
import { useTable } from '../db/store';
import { balance } from '../lib/game';
import { openSub, type Sub } from '../nav';

// Как в настройках iPhone: группы, цветной значок, одна строка на пункт, справа — число или баланс
const GROUPS: { title: string; items: { sub: Exclude<Sub, null>; emoji: string; title: string; color: string }[] }[] = [
  {
    title: 'Планирование',
    items: [
      { sub: 'tasks', emoji: '✅', title: 'Задачи', color: '#34c759' },
      { sub: 'goals', emoji: '🎯', title: 'Цели', color: '#ff3b30' },
      { sub: 'routines', emoji: '🔁', title: 'Распорядок', color: '#5856d6' },
      { sub: 'variables', emoji: '🧮', title: 'Переменные', color: '#8e8e93' },
    ],
  },
  {
    title: 'Еда и дом',
    items: [
      { sub: 'fridge', emoji: '🧊', title: 'Холодильник и рецепты', color: '#32ade6' },
      { sub: 'basket', emoji: '🛒', title: 'Продуктовая корзина', color: '#ff9500' },
    ],
  },
  {
    title: 'Прочее',
    items: [
      { sub: 'notes', emoji: '📥', title: 'Заметки и входящие', color: '#007aff' },
      { sub: 'rewards', emoji: '🪙', title: 'Монеты и награды', color: '#ffcc00' },
      { sub: 'settings', emoji: '⚙️', title: 'Настройки', color: '#8e8e93' },
    ],
  },
];

export function MoreScreen() {
  const ledger = useTable('ledger');
  const notes = useTable('notes');
  const tasks = useTable('tasks');
  const value: Partial<Record<Exclude<Sub, null>, string | number>> = {
    tasks: tasks.filter((t) => t.status === 'todo').length || '',
    notes: notes.filter((n) => !n.done).length || '',
    rewards: `🪙 ${balance(ledger)}`,
  };
  return (
    <>
      {GROUPS.map((g) => (
        <div key={g.title}>
          <div className="section-title">{g.title}</div>
          <div className="list">
            {g.items.map((it) => (
              <button key={it.sub} className="list-item" onClick={() => openSub(it.sub)}>
                <span className="menu-ico" style={{ background: `color-mix(in srgb, ${it.color} 20%, var(--card))` }}>
                  {it.emoji}
                </span>
                <span className="grow li-title">{it.title}</span>
                {value[it.sub] ? <span className="value">{value[it.sub]}</span> : null}
                <Icon name="right" className="chev" />
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
