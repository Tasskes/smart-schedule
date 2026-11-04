import { useEffect, useRef, useState } from 'react';
import { authStore, netStore } from './api';
import { Icon } from './components/Icon';
import { afterDone } from './components/ItemRow';
import { Toasts } from './components/ui';
import { cancelTimer, runningTimer, stopTimer } from './db/ops';
import { useRecord, useTable, useVersion } from './db/store';
import { NotesScreen } from './screens/NotesScreen';
import { applyAppearance } from './theme';
import { balance } from './lib/game';
import { go, navStore, openSub, type Sub, type Tab } from './nav';
import { BasketScreen } from './screens/BasketScreen';
import { ChatScreen } from './screens/ChatScreen';
import { FoodScreen } from './screens/FoodScreen';
import { FridgeScreen } from './screens/FridgeScreen';
import { GoalsScreen } from './screens/GoalsScreen';
import { LoginScreen } from './screens/LoginScreen';
import { MoreScreen } from './screens/MoreScreen';
import { RewardsScreen } from './screens/RewardsScreen';
import { RoutinesScreen } from './screens/RoutinesScreen';
import { SolveScreen } from './screens/SolveScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { TasksScreen } from './screens/TasksScreen';
import { TodayScreen } from './screens/TodayScreen';
import { VariablesScreen } from './screens/VariablesScreen';
import { WeekScreen } from './screens/WeekScreen';
import { syncStore } from './sync';

// «План» — это и день, и неделя (переключатель вверху экрана)
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'План', icon: 'week' },
  { id: 'chat', label: 'Чат', icon: 'chat' },
  { id: 'solve', label: 'Решить', icon: 'camera' },
  { id: 'food', label: 'Еда', icon: 'food' },
  { id: 'more', label: 'Ещё', icon: 'more' },
];
const isPlan = (t: Tab) => t === 'today' || t === 'week';
let lastPlanTab: Tab = 'today';

const TITLES: Record<Tab, string> = { today: 'Сегодня', week: 'Неделя', chat: 'ИИ-планировщик', solve: 'Решить', food: 'Питание', more: 'Ещё' };
const SUB_TITLES: Record<Exclude<Sub, null>, string> = {
  goals: 'Цели',
  tasks: 'Задачи',
  variables: 'Переменные',
  routines: 'Распорядок',
  rewards: 'Награды',
  fridge: 'Холодильник',
  basket: 'Корзина',
  settings: 'Настройки',
  notes: 'Заметки',
};

function TimerChip() {
  useVersion(['events', 'marks']);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const item = runningTimer();
  if (!item || !item.startedAt) return null;
  const sec = Math.max(0, Math.floor((Date.now() - item.startedAt) / 1000));
  const hh = Math.floor(sec / 3600);
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return (
    <div className="timer-chip">
      <span className="ellipsis">⏱ {item.title}</span>
      <b>{hh ? `${hh}:` : ''}{mm}:{ss}</b>
      <button
        onClick={() => {
          const r = stopTimer(item);
          afterDone(item, r.coins, r.minutes);
        }}
      >
        Готово
      </button>
      <button style={{ background: 'transparent', color: 'inherit', padding: '6px 4px' }} onClick={() => cancelTimer(item)} aria-label="Отменить таймер">
        ✕
      </button>
    </div>
  );
}

function SyncDot() {
  const s = syncStore.use();
  const net = netStore.use();
  const cls = !net.online || s.status === 'offline' ? 'off' : s.status === 'error' ? 'err' : s.status === 'syncing' ? 'busy' : s.status === 'local' ? 'off' : 'ok';
  const title = !net.online ? 'Нет интернета — всё сохраняется в телефоне' : s.status === 'error' ? s.error || 'Ошибка' : s.status === 'local' ? 'Без сервера' : 'Синхронизировано';
  // когда всё хорошо, точку не показываем — меньше шума
  if (cls === 'ok' || cls === 'busy') return null;
  return (
    <button className="icon-btn plain" style={{ width: 28 }} onClick={() => openSub('settings')} title={title} aria-label={title}>
      <span className={`status-dot ${cls}`} />
    </button>
  );
}

function CoinPill() {
  const ledger = useTable('ledger');
  const bal = balance(ledger);
  const prev = useRef(bal);
  const [pop, setPop] = useState(false);
  useEffect(() => {
    if (bal > prev.current) {
      setPop(true);
      const t = setTimeout(() => setPop(false), 650);
      prev.current = bal;
      return () => clearTimeout(t);
    }
    prev.current = bal;
  }, [bal]);
  return (
    <button className={`coin-pill ${pop ? 'pop' : ''}`} onClick={() => openSub('rewards')} aria-label="Монеты">
      🪙 {bal}
    </button>
  );
}

export function App() {
  const { token, ready } = authStore.use();
  const nav = navStore.use();
  const net = netStore.use();
  const settings = useRecord('settings', 'main');
  const appearanceKey = JSON.stringify(settings?.appearance || null);
  useEffect(() => {
    applyAppearance(settings?.appearance);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appearanceKey]);

  if (!ready) return null;
  if (!token) return <LoginScreen />;

  const solveOpen = nav.tab === 'solve' && !nav.sub && !!nav.solveId;
  const title = nav.sub ? SUB_TITLES[nav.sub] : solveOpen ? 'Задание' : TITLES[nav.tab];
  if (isPlan(nav.tab)) lastPlanTab = nav.tab;
  // крупный заголовок в начале экрана (как в iOS); у плана, чата и открытого задания — только маленький сверху
  const plan = isPlan(nav.tab) && !nav.sub;
  const compactTitle = !nav.sub && (nav.tab === 'chat' || solveOpen);
  const largeTitle = !plan && !compactTitle;
  const back = nav.sub
    ? { label: nav.tab === 'more' ? 'Ещё' : 'Назад', run: () => go(nav.tab) }
    : solveOpen
      ? { label: 'Задания', run: () => navStore.set({ solveId: null }) }
      : null;
  let screen: React.ReactNode;
  if (nav.sub) {
    screen = {
      goals: <GoalsScreen />,
      tasks: <TasksScreen />,
      variables: <VariablesScreen />,
      routines: <RoutinesScreen />,
      rewards: <RewardsScreen />,
      fridge: <FridgeScreen />,
      basket: <BasketScreen />,
      settings: <SettingsScreen />,
      notes: <NotesScreen />,
    }[nav.sub];
  } else {
    screen = {
      today: <TodayScreen />,
      week: <WeekScreen />,
      chat: <ChatScreen />,
      solve: <SolveScreen />,
      food: <FoodScreen />,
      more: <MoreScreen />,
    }[nav.tab];
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="tb-left">
          {back ? (
            <button className="back" onClick={back.run} aria-label="Назад">
              <Icon name="left" size={24} />
              {back.label}
            </button>
          ) : null}
        </div>
        {plan ? (
          <div className="seg nav-seg" role="tablist">
            <button className={nav.tab === 'today' ? 'active' : ''} onClick={() => go('today')}>
              День
            </button>
            <button className={nav.tab === 'week' ? 'active' : ''} onClick={() => go('week')}>
              Неделя
            </button>
          </div>
        ) : (
          <div className={`nav-title ${compactTitle ? 'always' : ''}`}>{title}</div>
        )}
        <div className="tb-right">
          {!net.online ? <span className="badge">офлайн</span> : null}
          <SyncDot />
          <CoinPill />
        </div>
      </header>
      <main className={`content ${(nav.tab === 'chat' && !nav.sub) || solveOpen ? 'chat-main' : ''}`}>
        <div className="content-inner">
          {largeTitle ? <h1 className="large-title">{title}</h1> : null}
          {screen}
        </div>
      </main>
      <TimerChip />
      <nav className="tabbar">
        {TABS.map((t) => {
          const active = t.id === 'today' ? isPlan(nav.tab) : nav.tab === t.id;
          return (
            <button
              key={t.id}
              className={active ? 'active' : ''}
              onClick={() => {
                if (t.id === 'today') return go(active && !nav.sub ? nav.tab : lastPlanTab);
                if (t.id === 'solve' && active) navStore.set({ solveId: null }); // повторное нажатие — к списку заданий
                go(t.id);
              }}
            >
              <Icon name={t.icon} />
              {t.label}
            </button>
          );
        })}
      </nav>
      <Toasts />
    </div>
  );
}
