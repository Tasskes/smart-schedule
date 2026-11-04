import { createStore } from './db/store';
import { todayStr } from './lib/dates';
import type { ChatMode } from './types';

export type Tab = 'today' | 'week' | 'chat' | 'food' | 'more';
export type Sub = null | 'goals' | 'tasks' | 'variables' | 'routines' | 'rewards' | 'fridge' | 'basket' | 'settings' | 'notes';

export interface ChatIntent {
  mode: ChatMode;
  targetDays?: string[];
  goalId?: string | null;
  prefill?: string;
  autoSend?: boolean;
}

export const navStore = createStore<{ tab: Tab; sub: Sub; date: string; chatIntent: ChatIntent | null }>({
  tab: 'today',
  sub: null,
  date: todayStr(),
  chatIntent: null,
});

export function go(tab: Tab, sub: Sub = null) {
  navStore.set({ tab, sub });
  window.scrollTo({ top: 0 });
}

export function openSub(sub: Sub) {
  navStore.set({ tab: 'more', sub });
  window.scrollTo({ top: 0 });
}

export function setDate(date: string) {
  navStore.set({ date });
}

export function openChat(intent: ChatIntent) {
  navStore.set({ tab: 'chat', sub: null, chatIntent: intent });
}
