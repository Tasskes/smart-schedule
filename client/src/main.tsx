import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { authStore, hasServer, loadStatus, netStore, onUnauthorized } from './api';
import { flushPendingChat } from './ai/chat';
import { App } from './App';
import { metaGet, metaSet, requestPersistentStorage } from './db/idb';
import { scheduleAgendaUpload } from './db/ops';
import { loadScheduleCache, refreshSchedule, scheduleStore } from './db/schedule';
import { backgroundAi, processFoodConsumption, processSpoilage, runAutoPlan } from './db/autoplan';
import { seedIfNeeded } from './db/seed';
import { get, loadAll, onTablesChange } from './db/store';
import { applyAppearance } from './theme';
import { isDateStr } from './lib/dates';
import { navStore } from './nav';
import { onAfterSync, syncNow } from './sync';
import './styles.css';

/**
 * iPhone: при открытой клавиатуре видимая часть экрана меньше окна. Подгоняем высоту оболочки
 * под visualViewport, чтобы поле ввода оставалось над клавиатурой, а нижняя панель пряталась.
 */
function setupViewport() {
  const root = document.documentElement;
  const vv = window.visualViewport;
  let focused = false;
  const apply = () => {
    const h = vv ? vv.height : window.innerHeight;
    root.style.setProperty('--vv-h', `${Math.round(h)}px`);
    root.style.setProperty('--vv-top', `${Math.round(vv ? vv.offsetTop : 0)}px`);
    const keyboard = (vv ? window.innerHeight - vv.height > 120 : false) || (focused && !!vv && window.innerHeight - vv.height > 60);
    root.classList.toggle('kb-open', keyboard);
  };
  vv?.addEventListener('resize', apply);
  vv?.addEventListener('scroll', apply);
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', () => setTimeout(apply, 300));
  document.addEventListener('focusin', (e) => {
    const t = e.target as HTMLElement | null;
    focused = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    setTimeout(apply, 50);
  });
  document.addEventListener('focusout', () => {
    focused = false;
    setTimeout(apply, 50);
  });
  // если iOS всё-таки сдвинул страницу к полю ввода — возвращаем, оболочка сама подстроится
  window.addEventListener('scroll', () => {
    if (window.scrollY && !root.classList.contains('kb-open')) window.scrollTo(0, 0);
  });
  apply();
}

async function start() {
  await loadAll();
  applyAppearance(get('settings', 'main')?.appearance);
  await loadScheduleCache();
  seedIfNeeded();
  const token = (await metaGet<string | null>('token')) ?? null;
  authStore.set({ token, ready: true });

  const params = new URLSearchParams(location.search);
  const date = params.get('date');
  if (isDateStr(date)) navStore.set({ date });
  if (params.has('date')) history.replaceState(null, '', '/');

  onUnauthorized(async () => {
    await metaSet('token', null);
    authStore.set({ token: null });
  });

  onAfterSync(() => {
    scheduleAgendaUpload();
    processFoodConsumption();
    void backgroundAi();
  });

  // Автоматика: расписание по приоритетам, порча продуктов, списание съеденного
  const safe = (fn: () => unknown) => () => {
    try {
      fn();
    } catch (e) {
      console.warn(e);
    }
  };
  processSpoilage();
  safe(runAutoPlan)();
  onTablesChange(['tasks', 'goals', 'events', 'variables', 'routines', 'marks', 'fridge', 'settings', 'weights'], safe(runAutoPlan), 1500);
  onTablesChange(['food'], safe(processFoodConsumption), 800);
  let schedVersion = scheduleStore.get().data?.version;
  scheduleStore.subscribe(() => {
    const v = scheduleStore.get().data?.version;
    if (v !== schedVersion) {
      schedVersion = v;
      safe(runAutoPlan)();
    }
  });
  setInterval(() => {
    safe(processSpoilage)();
    safe(runAutoPlan)();
  }, 10 * 60000);

  const online = async () => {
    if (!hasServer()) return;
    await syncNow();
    await refreshSchedule();
    scheduleAgendaUpload(500);
    void loadStatus();
    void flushPendingChat();
  };

  authStore.subscribe(() => {
    if (hasServer()) void online();
  });
  void online();

  window.addEventListener('online', () => void online());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      netStore.set({ online: navigator.onLine });
      void online();
    }
  });
  // фоновая синхронизация, пока приложение открыто
  setInterval(() => {
    if (document.visibilityState === 'visible' && navigator.onLine) void online();
  }, 5 * 60000);

  void requestPersistentStorage();
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  registerSW({ immediate: true });
}

setupViewport();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

void start();
