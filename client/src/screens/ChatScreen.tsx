import { useEffect, useMemo, useState } from 'react';
import { nextWeekDays, remainingWeekDays } from '../ai/context';
import { flushPendingChat, retryAssistant, sendChat } from '../ai/chat';
import { ActionCards } from '../components/ActionCards';
import { Icon } from '../components/Icon';
import { AutoTextarea, Empty, toast } from '../components/ui';
import { hasServer, netStore } from '../api';
import { all, get, remove, useTable } from '../db/store';
import { addDays, fmtShort, todayStr, weekDays } from '../lib/dates';
import { navStore, openSub } from '../nav';
import type { ChatMode } from '../types';

interface ModeState {
  mode: ChatMode;
  targetDays?: string[];
  goalId?: string | null;
}

function modeLabel(m: ModeState) {
  switch (m.mode) {
    case 'plan': {
      const d = m.targetDays || [];
      if (!d.length) return 'План';
      return d.length === 1 ? `План на ${fmtShort(d[0])}` : `План: ${fmtShort(d[0])} – ${fmtShort(d[d.length - 1])}`;
    }
    case 'tutor':
      return 'Сообщение от репетитора';
    case 'review':
      return 'Итоги дня';
    case 'decompose':
      return `Разбить цель: ${get('goals', m.goalId)?.title || ''}`;
    default:
      return '';
  }
}

const PLACEHOLDER: Record<ChatMode, string> = {
  chat: 'Спроси или попроси что-нибудь…',
  plan: 'Пожелания (необязательно): «в среду много работы», «в пт хочу отдохнуть»…',
  tutor: 'Вставь сюда сообщение из ВК: «давай в четверг в 18:00»',
  review: 'Как прошёл день? (необязательно)',
  decompose: 'Что важно учесть? (необязательно)',
};

export function ChatScreen() {
  const chat = useTable('chat');
  const nav = navStore.use();
  const net = netStore.use();
  const [text, setText] = useState('');
  const [mode, setMode] = useState<ModeState>({ mode: 'chat' });
  const [pickDay, setPickDay] = useState(false);
  const messages = useMemo(() => [...chat].sort((a, b) => a.ts - b.ts), [chat]);
  const busy = messages.some((m) => m.status === 'sending');
  const today = todayStr();

  useEffect(() => {
    const intent = nav.chatIntent;
    if (!intent) return;
    navStore.set({ chatIntent: null });
    setMode({ mode: intent.mode, targetDays: intent.targetDays, goalId: intent.goalId });
    if (intent.prefill) setText(intent.prefill);
    if (intent.autoSend) void sendChat(intent.prefill || '', intent.mode, intent.targetDays, intent.goalId);
  }, [nav.chatIntent]);

  useEffect(() => {
    // прокручиваем к последнему сообщению (над полем ввода)
    requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
  }, [messages.length, busy]);

  useEffect(() => {
    if (net.online) void flushPendingChat();
  }, [net.online]);

  const canSend = !busy && (text.trim().length > 0 || mode.mode === 'plan' || mode.mode === 'review' || mode.mode === 'decompose');

  const send = () => {
    if (!canSend) return;
    if (mode.mode === 'tutor' && !text.trim()) return toast('Вставь текст сообщения');
    void sendChat(text, mode.mode, mode.targetDays, mode.goalId);
    setText('');
    setMode({ mode: 'chat' });
    setPickDay(false);
  };

  const week = weekDays(today).filter((d) => d >= today).concat(weekDays(addDays(today, 7)));

  return (
    <div className="chat-screen">
      {!hasServer() ? (
        <div className="banner info">
          <span>ℹ️</span>
          <div className="grow small">
            Нейросеть работает через твой сервер. Подключи его в{' '}
            <button className="btn ghost small" style={{ padding: 0, minHeight: 0 }} onClick={() => openSub('settings')}>
              настройках
            </button>
            .
          </div>
        </div>
      ) : null}

      <div className="chat">
        {!messages.length ? (
          <Empty emoji="🤖" title="Чат распорядка">
            Попроси составить план недели, добавить задачу или переменную, разбить цель на шаги. Можно вставить сообщение репетитора — я сам добавлю занятие.
          </Empty>
        ) : null}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role} ${m.status === 'pending' ? 'pending' : ''}`}>
            {m.status === 'sending' ? (
              <span className="typing">
                <i />
                <i />
                <i />
              </span>
            ) : m.status === 'error' ? (
              <div>
                <div className="err-text">⚠️ {m.error}</div>
                <button className="btn small secondary" style={{ marginTop: 8 }} onClick={() => retryAssistant(m)}>
                  Повторить
                </button>
              </div>
            ) : (
              <>
                {m.text}
                {m.status === 'pending' ? <div className="tiny" style={{ opacity: 0.8, marginTop: 4 }}>⏳ отправлю, когда появится интернет</div> : null}
                {m.role === 'assistant' ? <ActionCards msg={m} /> : null}
              </>
            )}
          </div>
        ))}
      </div>

      <div className="composer">
        {mode.mode !== 'chat' ? (
          <div className="mode-pill">
            {modeLabel(mode)}
            <button onClick={() => setMode({ mode: 'chat' })} aria-label="Сбросить режим">
              <Icon name="close" size={14} />
            </button>
          </div>
        ) : null}
        {pickDay ? (
          <div className="daychips" style={{ marginBottom: 8 }}>
            {week.map((d) => (
              <button
                key={d}
                onClick={() => {
                  setMode({ mode: 'plan', targetDays: [d] });
                  setPickDay(false);
                }}
              >
                {fmtShort(d)}
              </button>
            ))}
          </div>
        ) : null}
        <div className="chips">
          <button className="chip" onClick={() => setMode({ mode: 'plan', targetDays: remainingWeekDays() })}>
            📅 Остаток недели
          </button>
          <button className="chip" onClick={() => setMode({ mode: 'plan', targetDays: nextWeekDays() })}>
            ➡️ След. неделя
          </button>
          <button className={`chip ${pickDay ? 'active' : ''}`} onClick={() => setPickDay(!pickDay)}>
            📆 Один день
          </button>
          <button className="chip" onClick={() => setMode({ mode: 'tutor' })}>
            👩‍🏫 Репетитор
          </button>
          <button className="chip" onClick={() => setMode({ mode: 'review' })}>
            🏁 Итоги дня
          </button>
          <button className="chip" onClick={() => setText((t) => t || 'Добавь переменную: ')}>
            🧮 Переменная
          </button>
          {messages.length ? (
            <button
              className="chip"
              onClick={() => {
                if (!confirm('Очистить историю чата? Применённые изменения останутся.')) return;
                for (const m of all('chat')) remove('chat', m.id);
              }}
            >
              🗑 Очистить
            </button>
          ) : null}
        </div>
        <div className="box">
          <AutoTextarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={PLACEHOLDER[mode.mode]}
            maxRows={6}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="send" disabled={!canSend} onClick={send} aria-label="Отправить">
            <Icon name="send" />
          </button>
        </div>
        {!net.online ? <div className="tiny muted" style={{ marginTop: 6 }}>Нет интернета — сообщение уйдёт, когда связь появится.</div> : null}
      </div>
    </div>
  );
}
