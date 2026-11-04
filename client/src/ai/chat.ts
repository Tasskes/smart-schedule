import { all, patch, put } from '../db/store';
import { fmtShort } from '../lib/dates';
import type { Action, ChatMode, ChatRec } from '../types';
import { normalizeActions } from './actions';
import { aiRequest, dataBlock, parseJsonLoose, type AiMessage } from './client';
import { buildContext } from './context';
import { CHAT_SYSTEM, modeInstruction } from './prompts';
import { RefMap } from './refs';

export function chatMessages() {
  return [...all('chat')].sort((a, b) => a.ts - b.ts);
}

function actionsBrief(actions?: Action[]) {
  if (!actions?.length) return '';
  const parts = actions.map((a) => {
    switch (a.type) {
      case 'plan':
        return `план на ${a.days.map((d) => fmtShort(d.date)).join(', ')}`;
      case 'add_task':
        return `задача «${a.title}»`;
      case 'add_goal':
        return `цель «${a.title}»`;
      case 'set_variable':
        return `{${a.name}} = ${a.expr}`;
      case 'add_event':
        return `событие «${a.title}» ${a.date} ${a.start}`;
      default:
        return a.type;
    }
  });
  return ` [предложено: ${parts.join('; ')}]`;
}

function history(excludeId: string): AiMessage[] {
  const msgs = chatMessages().filter((m) => m.id !== excludeId && m.status !== 'error' && m.status !== 'sending' && m.text);
  return msgs.slice(-8).map((m) => ({
    role: m.role,
    content: m.role === 'assistant' ? m.text + actionsBrief(m.actions) : m.text,
  }));
}

export function userTextFor(mode: ChatMode, text: string, targetDays?: string[]) {
  const t = text.trim();
  if (mode === 'plan') {
    const range = targetDays?.length ? (targetDays.length === 1 ? fmtShort(targetDays[0]) : `${fmtShort(targetDays[0])} – ${fmtShort(targetDays[targetDays.length - 1])}`) : '';
    return `📅 Составь план: ${range}${t ? `\nПожелания: ${t}` : ''}`;
  }
  if (mode === 'review') return `🏁 Подведи итоги дня${t ? `\n${t}` : ''}`;
  if (mode === 'tutor') return `👩‍🏫 Сообщение от репетитора:\n«${t}»`;
  return t;
}

export async function sendChat(text: string, mode: ChatMode = 'chat', targetDays?: string[], goalId?: string | null) {
  const user = put('chat', {
    ts: Date.now(),
    role: 'user',
    text: userTextFor(mode, text, targetDays),
    mode,
    targetDays,
    goalId: goalId ?? null,
    status: navigator.onLine ? 'ok' : 'pending',
  });
  if (!navigator.onLine) return;
  await runAssistant(user);
}

export async function runAssistant(user: ChatRec) {
  const mode = user.mode || 'chat';
  const placeholder = put('chat', { ts: Date.now() + 1, role: 'assistant', text: '', status: 'sending', replyTo: user.id });
  if (user.status === 'pending') patch('chat', user.id, { status: 'ok' });
  try {
    const refs = new RefMap();
    const ctx = buildContext({ mode, targetDays: user.targetDays, goalId: user.goalId, refs });
    const content = user.text + modeInstruction(mode, user.targetDays) + dataBlock(ctx);
    const raw = await aiRequest({
      system: CHAT_SYSTEM,
      messages: [...history(user.id).filter((m) => m.content !== user.text), { role: 'user', content }],
      json: true,
      tier: 'smart',
      temperature: mode === 'plan' ? 0.35 : 0.5,
      maxTokens: mode === 'plan' ? 7000 : 3000,
    });
    const parsed = parseJsonLoose<{ reply?: unknown; actions?: unknown }>(raw);
    if (!parsed || typeof parsed !== 'object') {
      patch('chat', placeholder.id, { text: raw.trim() || 'Пустой ответ', status: 'ok', actions: [] });
      return;
    }
    const actions = normalizeActions(parsed.actions, refs, { mode, targetDays: user.targetDays });
    const reply = typeof parsed.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim() : actions.length ? 'Вот что предлагаю:' : 'Готово.';
    patch('chat', placeholder.id, { text: reply, status: 'ok', actions, ts: Date.now() });
  } catch (e) {
    patch('chat', placeholder.id, { status: 'error', error: (e as Error).message, text: '' });
  }
}

export async function retryAssistant(failed: ChatRec) {
  const user = all('chat').find((m) => m.id === failed.replyTo);
  patch('chat', failed.id, { deleted: true });
  if (user) await runAssistant(user);
}

/** Отправить сообщения, набранные без интернета */
export async function flushPendingChat() {
  if (!navigator.onLine) return;
  const pending = chatMessages().filter((m) => m.role === 'user' && m.status === 'pending');
  for (const m of pending) await runAssistant(m);
}
