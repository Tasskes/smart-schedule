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
import { quietScroll, setBarHidden, setupTabbarAutoHide } from './tabbar';
import './styles.css';

/**
 * iPhone: при открытой клавиатуре видимая часть экрана меньше окна. Подгоняем высоту оболочки
 * под visualViewport, чтобы поле ввода оставалось над клавиатурой, а нижняя панель пряталась.
 */
// Поля, для которых iPhone открывает клавиатуру (флажки, выбор даты и времени — не в счёт)
const NO_KEYBOARD = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image', 'hidden', 'date', 'time', 'datetime-local', 'month', 'week']);
function isTextEntry(el: Element | null) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
  return el instanceof HTMLInputElement && !NO_KEYBOARD.has(el.type);
}

function setupViewport() {
  const root = document.documentElement;
  const vv = window.visualViewport;
  // на телефоне фокус в поле ввода = открыта клавиатура; на компьютере панель не прячем
  const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  let baseW = 0;
  let baseH = 0; // высота экрана без клавиатуры (максимум при текущей ширине)
  let keyboard = false;
  const apply = () => {
    const h = vv ? vv.height : window.innerHeight;
    root.style.setProperty('--vv-h', `${Math.round(h)}px`);
    root.style.setProperty('--vv-top', `${Math.round(vv ? vv.offsetTop : 0)}px`);
    if (window.innerWidth !== baseW) {
      baseW = window.innerWidth; // повернули экран — меряем заново
      baseH = 0;
    }
    const scale = vv?.scale || 1;
    if (scale < 1.05) baseH = Math.max(baseH, h, window.innerHeight);
    const shrunk = touch && scale < 1.05 && baseH - h > 120;
    const next = shrunk || (touch && isTextEntry(document.activeElement));
    if (next === keyboard) return;
    keyboard = next;
    root.classList.toggle('kb-open', next);
    quietScroll(600); // экран меняет высоту — это не жест
    if (!next) setBarHidden(false); // закрыл клавиатуру — панель возвращается
  };
  vv?.addEventListener('resize', apply);
  vv?.addEventListener('scroll', apply);
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', () => setTimeout(apply, 300));
  document.addEventListener('focusin', () => setTimeout(apply, 0));
  // при переходе между полями фокус на миг пропадает — не мигаем панелью
  document.addEventListener('focusout', () => setTimeout(apply, 150));
  // поле могло исчезнуть вместе с окном, не потеряв фокус «официально», — перепроверяем при касании
  document.addEventListener('touchstart', () => setTimeout(apply, 0), { capture: true, passive: true });
  document.addEventListener('visibilitychange', apply);
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
setupTabbarAutoHide();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

void start();
