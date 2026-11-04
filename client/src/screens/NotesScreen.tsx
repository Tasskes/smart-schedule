import { useEffect, useMemo, useState } from 'react';
import { api, hasServer } from '../api';
import { Empty, Seg, toast } from '../components/ui';
import { patch, put, remove, useTable } from '../db/store';
import { openChat, openSub } from '../nav';
import type { NoteRec } from '../types';

function fmt(ts: number) {
  return new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function NoteCard({ n }: { n: NoteRec }) {
  const [open, setOpen] = useState(false);
  const long = n.text.length > 220 || n.text.split('\n').length > 4;
  const toTask = () => {
    put('tasks', {
      title: (n.title || n.text).split('\n')[0].slice(0, 120),
      context: n.text,
      category: 'other',
      status: 'todo',
      priority: 2,
      createdAt: Date.now(),
      source: n.source === 'telegram' ? 'telegram' : 'app',
    });
    patch('notes', n.id, { done: true });
    toast('Задача создана — оцени её в «Задачах»', { label: 'Открыть', run: () => openSub('tasks') });
  };
  return (
    <div className={`card note-card ${n.done ? 'done' : ''}`}>
      <div className="row between">
        <b className="grow">{n.title || n.text.split('\n')[0].slice(0, 80)}</b>
        <span className="tiny muted nowrap">{fmt(n.createdAt)}</span>
      </div>
      <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
        <span className="badge">{n.source === 'telegram' ? '📨 из Telegram' : '✍️ своя'}</span>
        {n.from ? <span className="badge">от: {n.from}</span> : null}
      </div>
      {n.text && n.text !== n.title ? (
        <div className={`note-text ${long && !open ? 'clamp' : ''}`} onClick={() => setOpen(!open)}>
          {n.text}
        </div>
      ) : null}
      <div className="row wrap" style={{ marginTop: 10, gap: 6 }}>
        <button className="btn small" onClick={toTask}>
          ✅ В задачу
        </button>
        <button
          className="btn small secondary"
          onClick={() => openChat({ mode: 'chat', prefill: `Разбери заметку и предложи, что с ней сделать (задача, событие, цель или переменная):\n«${n.text}»` })}
        >
          💬 Разобрать с ИИ
        </button>
        <button className="btn small ghost" onClick={() => patch('notes', n.id, { done: !n.done })}>
          {n.done ? 'Вернуть' : 'Разобрано'}
        </button>
        <button
          className="btn small ghost"
          style={{ color: 'var(--danger)' }}
          onClick={() => {
            remove('notes', n.id);
            toast('Удалено', { label: 'Вернуть', run: () => patch('notes', n.id, { deleted: false }) });
          }}
        >
          Удалить
        </button>
      </div>
    </div>
  );
}

export function NotesScreen() {
  const notes = useTable('notes');
  const [filter, setFilter] = useState<'new' | 'all'>('new');
  const [text, setText] = useState('');
  const [tgLinked, setTgLinked] = useState<boolean | null>(null);

  useEffect(() => {
    if (!hasServer()) return;
    api<{ linked: boolean }>('/api/telegram')
      .then((s) => setTgLinked(s.linked))
      .catch(() => setTgLinked(null));
  }, []);

  const list = useMemo(
    () => [...notes].filter((n) => filter === 'all' || !n.done).sort((a, b) => b.createdAt - a.createdAt),
    [notes, filter],
  );

  const add = () => {
    if (!text.trim()) return;
    put('notes', { title: text.trim().split('\n')[0].slice(0, 80), text: text.trim(), source: 'app', createdAt: Date.now() });
    setText('');
  };

  return (
    <>
      {tgLinked === false ? (
        <div className="banner info small">
          <span>📨</span>
          <div className="grow">
            Подключи Telegram-бота — пересылай ему заметки, задачи и сообщения репетитора, а ИИ сам разложит их по приложению.{' '}
            <button className="btn ghost small" style={{ padding: 0, minHeight: 0 }} onClick={() => openSub('settings')}>
              Подключить
            </button>
          </div>
        </div>
      ) : null}
      <div className="card">
        <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="Мысль, идея, что-то не забыть…" />
        <button className="btn block" style={{ marginTop: 10 }} disabled={!text.trim()} onClick={add}>
          Сохранить заметку
        </button>
      </div>
      <Seg<'new' | 'all'> value={filter} onChange={setFilter} options={[{ v: 'new', label: 'Неразобранные' }, { v: 'all', label: 'Все' }]} />
      <div style={{ height: 10 }} />
      {list.length ? list.map((n) => <NoteCard key={n.id} n={n} />) : <Empty emoji="📥" title="Заметок нет">Всё, что пришлёшь боту в Telegram и не получится сразу превратить в задачу, окажется здесь.</Empty>}
    </>
  );
}
