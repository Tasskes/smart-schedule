import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { authStore, hasServer, loadStatus, netStore, onUnauthorized } from './api';
import { flushPendingChat } from './ai/chat';
import { App } from './App';
import { metaGet, metaSet, requestPersistentStorage } from './db/idb';
import { scheduleAgendaUpload } from './db/ops';
import { loadScheduleCache, refreshSchedule } from './db/schedule';
import { seedIfNeeded } from './db/seed';
import { loadAll } from './db/store';
import { isDateStr } from './lib/dates';
import { navStore } from './nav';
import { onAfterSync, syncNow } from './sync';
import './styles.css';

async function start() {
  await loadAll();
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

  onAfterSync(() => scheduleAgendaUpload());

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

void start();
