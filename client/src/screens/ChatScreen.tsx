import { useEffect, useMemo, useState } from 'react';
import { nextWeekDays, remainingWeekDays } from '../ai/context';
import { flushPendingChat, retryAssistant, sendChat } from '../ai/chat';
import { ActionCards } from '../components/ActionCards';
import { Icon } from '../components/Icon';
import { AutoTextarea, Empty, Sheet, toast } from '../components/ui';
import { hasServer, netStore } from '../api';
import { all, get, remove, useTable } from '../db/store';
import { addDays, fmtShort, todayStr, weekDays } from '../lib/dates';
import { navStore, openSub, scrollMain } from '../nav';
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
  chat: 'Спроси что-нибудь…',
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
    requestAnimationFrame(() => scrollMain('bottom'));
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
  const [quick, setQuick] = useState(false);
  const pick = (fn: () => void) => {
    fn();
    setQuick(false);
  };
  const QUICK: { emoji: string; title: string; run: () => void }[] = [
    { emoji: '📅', title: 'План на остаток недели', run: () => setMode({ mode: 'plan', targetDays: remainingWeekDays() }) },
    { emoji: '➡️', title: 'План на следующую неделю', run: () => setMode({ mode: 'plan', targetDays: nextWeekDays() }) },
    { emoji: '📆', title: 'План на один день', run: () => setPickDay(true) },
    { emoji: '👩‍🏫', title: 'Сообщение от репетитора', run: () => setMode({ mode: 'tutor' }) },
    { emoji: '🏁', title: 'Итоги дня', run: () => setMode({ mode: 'review' }) },
    { emoji: '🧮', title: 'Новая переменная', run: () => setText((t) => t || 'Добавь переменную: ') },
  ];

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
            Попроси составить план, добавить задачу или переменную. Вставь сообщение репетитора — я сам добавлю занятие.
            <div className="suggest">
              <button className="chip" onClick={() => setMode({ mode: 'plan', targetDays: remainingWeekDays() })}>
                📅 Остаток недели
              </button>
              <button className="chip" onClick={() => setMode({ mode: 'tutor' })}>
                👩‍🏫 Репетитор
              </button>
              <button className="chip" onClick={() => setMode({ mode: 'review' })}>
                🏁 Итоги дня
              </button>
            </div>
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
        <div className="box">
          <button className={`quick ${quick ? 'active' : ''}`} onClick={() => setQuick(true)} aria-label="Быстрые действия">
            <Icon name="sparkles" />
          </button>
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
      {quick ? (
        <Sheet title="Быстрые действия" onClose={() => setQuick(false)}>
          <div className="list action-list">
            {QUICK.map((q) => (
              <button key={q.title} className="list-item" onClick={() => pick(q.run)}>
                <span className="emoji">{q.emoji}</span>
                <span className="grow li-title">{q.title}</span>
              </button>
            ))}
          </div>
          {messages.length ? (
            <button
              className="btn danger block"
              onClick={() =>
                pick(() => {
                  if (!confirm('Очистить историю чата? Применённые изменения останутся.')) return;
                  for (const m of all('chat')) remove('chat', m.id);
                })
              }
            >
              Очистить чат
            </button>
          ) : null}
        </Sheet>
      ) : null}
    </div>
  );
}
