import { createStore } from './db/store';
import { todayStr } from './lib/dates';
import { quietScroll, setBarHidden } from './tabbar';
import type { ChatMode } from './types';

export type Tab = 'today' | 'week' | 'chat' | 'solve' | 'food' | 'more';
export type Sub = null | 'goals' | 'tasks' | 'variables' | 'routines' | 'rewards' | 'fridge' | 'basket' | 'settings' | 'notes';

export interface ChatIntent {
  mode: ChatMode;
  targetDays?: string[];
  goalId?: string | null;
  prefill?: string;
  autoSend?: boolean;
}

export const navStore = createStore<{ tab: Tab; sub: Sub; date: string; chatIntent: ChatIntent | null; solveId: string | null }>({
  tab: 'today',
  sub: null,
  date: todayStr(),
  chatIntent: null,
  solveId: null, // открытое задание на вкладке «Решить»
});

/** Прокрутка средней части экрана (сама страница не прокручивается) */
export function scrollMain(top: number | 'bottom' = 0) {
  const el = document.querySelector('main.content');
  if (!el) return;
  quietScroll();
  el.scrollTo({ top: top === 'bottom' ? el.scrollHeight : top });
}

export function go(tab: Tab, sub: Sub = null) {
  setBarHidden(false);
  navStore.set({ tab, sub });
  requestAnimationFrame(() => scrollMain(0));
}

export function openSub(sub: Sub) {
  setBarHidden(false);
  navStore.set({ tab: 'more', sub });
  requestAnimationFrame(() => scrollMain(0));
}

export function setDate(date: string) {
  navStore.set({ date });
}

export function openChat(intent: ChatIntent) {
  setBarHidden(false);
  navStore.set({ tab: 'chat', sub: null, chatIntent: intent });
}
