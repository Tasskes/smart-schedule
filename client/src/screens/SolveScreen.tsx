import { useEffect, useRef, useState, type ReactNode } from 'react';
import { hasServer, netStore } from '../api';
import { SOLVE_MODES } from '../ai/solve';
import { Attachments } from '../components/Attachments';
import { Icon } from '../components/Icon';
import { Empty, toast } from '../components/ui';
import { addPhotos, newSolution, solutionToNote, solutionToTask, solveNow, solveUi } from '../db/solve';
import { patch, remove, useRecord, useTable } from '../db/store';
import { fmtShort } from '../lib/dates';
import { navStore, openSub, scrollMain } from '../nav';
import type { SolutionRec } from '../types';

/** Кнопка выбора фото: на iPhone предлагает «Снять фото» или «Медиатека» */
function PhotoPicker({ onFiles, className, children, label }: { onFiles: (f: File[]) => void; className?: string; children: ReactNode; label: string }) {
  return (
    <label className={className} aria-label={label}>
      <input
        type="file"
        accept="image/*"
        multiple
        className="visually-hidden"
        onChange={(e) => {
          const files = [...(e.target.files || [])];
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
      {children}
    </label>
  );
}

const dateOf = (ts: number) => fmtShort(new Date(ts - new Date(ts).getTimezoneOffset() * 60000).toISOString().slice(0, 10));

function statusLine(s: SolutionRec, busy: boolean) {
  if (busy) return 'решаю…';
  const answers = s.messages.filter((m) => m.role === 'assistant').length;
  const when = dateOf(s.createdAt);
  return answers ? `${when} · решено${answers > 1 ? ` · вопросов ${answers - 1}` : ''}` : `${when} · не решено`;
}

function SolveList() {
  const sols = useTable('solutions');
  const ui = solveUi.use();
  const net = netStore.use();
  const list = [...sols].sort((a, b) => b.createdAt - a.createdAt);
  const start = (files?: File[]) => {
    const s = newSolution();
    navStore.set({ solveId: s.id });
    requestAnimationFrame(() => scrollMain(0));
    if (files?.length) void addPhotos(s.id, files);
  };
  return (
    <>
      {!hasServer() || !net.online ? (
        <div className="banner info small">
          <span>ℹ️</span>
          <div className="grow">Решать задания нейросеть может только через твой сервер и при интернете.</div>
        </div>
      ) : null}
      <PhotoPicker className="solve-hero" onFiles={(f) => start(f)} label="Сфотографировать задание">
        <span className="solve-hero-icon">
          <Icon name="camera" size={28} />
        </span>
        <span className="grow">
          <b>Сфотографировать задание</b>
          <small>или выбрать фото — нейросеть решит и объяснит</small>
        </span>
      </PhotoPicker>
      <button className="btn secondary block" onClick={() => start()}>
        <Icon name="edit" /> Написать текстом
      </button>

      {list.length ? (
        <>
          <div className="section-title">История</div>
          <div className="list">
            {list.map((s) => (
              <button key={s.id} className="list-item" onClick={() => navStore.set({ solveId: s.id })}>
                <span className="emoji">{s.attachments?.length ? '📷' : '✍️'}</span>
                <div className="grow">
                  <div className="li-title ellipsis">{s.title}</div>
                  <div className="li-sub">{statusLine(s, !!ui.busy[s.id])}</div>
                </div>
                <Icon name="right" className="chev" />
              </button>
            ))}
          </div>
        </>
      ) : (
        <Empty emoji="🧠" title="Заданий пока нет">
          Сфотографируй задачу из учебника, тест или задание с доски — получишь решение по шагам и сможешь задать уточняющие вопросы.
        </Empty>
      )}
    </>
  );
}

function AutoText({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(320, Math.max(96, el.scrollHeight + 2))}px`;
  }, [value]);
  return <textarea ref={ref} className="textarea" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
}

function SolveDetail({ id }: { id: string }) {
  const sol = useRecord('solutions', id);
  const ui = solveUi.use();
  const uploads = ui.uploads[id] || [];
  const busy = !!ui.busy[id];
  const [mode, setMode] = useState<string>(SOLVE_MODES[0].id);
  const [note, setNote] = useState('');
  const [ask, setAsk] = useState('');
  const [showText, setShowText] = useState(false);
  const answers = sol?.messages.length ?? 0;

  useEffect(() => {
    if (answers || busy) requestAnimationFrame(() => scrollMain('bottom'));
  }, [answers, busy]);

  if (!sol) {
    return (
      <Empty emoji="🗑️" title="Задание удалено">
        <button className="btn secondary" onClick={() => navStore.set({ solveId: null })}>
          К списку
        </button>
      </Empty>
    );
  }

  const solved = sol.messages.some((m) => m.role === 'assistant');
  const canSolve = !busy && !uploads.length && !!(sol.ocr.trim() || note.trim());

  const run = async (fresh = false) => {
    const base = SOLVE_MODES.find((m) => m.id === mode)?.text || SOLVE_MODES[0].text;
    patch('solutions', id, { question: note.trim() ? `${base}\nУточнение: ${note.trim()}` : base, ...(fresh ? { messages: [] } : {}) });
    await solveNow(id);
  };
  const sendFollowUp = async () => {
    const q = ask.trim();
    if (!q) return;
    setAsk('');
    if (!(await solveNow(id, q))) setAsk(q);
  };

  const textBlock = (
    <div className="field">
      <label>{sol.attachments.length || uploads.length ? 'Текст с фото — поправь, если распозналось с ошибками' : 'Условие задания'}</label>
      <AutoText
        value={sol.ocr}
        onChange={(v) => patch('solutions', id, { ocr: v })}
        placeholder={uploads.length ? 'Распознаю текст на фото…' : 'Вставь или напиши условие задания'}
      />
    </div>
  );

  return (
    <div className="chat-screen solve-detail">
      <div className="solve-photos">
        <Attachments list={sol.attachments} />
        {uploads.map((u) => (
          <div key={u.id} className="att-thumb pending">
            <img src={u.url} alt="" />
            <span>распознаю…</span>
          </div>
        ))}
        <PhotoPicker className="att-thumb att-add" onFiles={(f) => void addPhotos(id, f)} label="Добавить фото">
          <Icon name="camera" />
          <span>{sol.attachments.length || uploads.length ? 'ещё фото' : 'фото'}</span>
        </PhotoPicker>
      </div>

      {!solved ? (
        <>
          {textBlock}
          <div className="label" style={{ marginBottom: 6 }}>
            Что сделать
          </div>
          <div className="chips wrap">
            {SOLVE_MODES.map((m) => (
              <button key={m.id} className={`chip ${mode === m.id ? 'active' : ''}`} onClick={() => setMode(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
          <input className="input" style={{ margin: '8px 0 12px' }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Уточнение, если нужно: «только пункт б»" />
          <button className="btn block" disabled={!canSolve} onClick={() => void run()}>
            <Icon name="sparkles" /> {busy ? 'Решаю…' : uploads.length ? 'Дождись распознавания…' : 'Решить'}
          </button>
        </>
      ) : (
        <button className="disclosure" onClick={() => setShowText(!showText)}>
          <span className="grow">Текст задания</span>
          <Icon name={showText ? 'close' : 'right'} size={16} />
        </button>
      )}
      {solved && showText ? textBlock : null}

      <div className="chat">
        {sol.messages.map((m, i) =>
          m.role === 'assistant' && i === 0 ? (
            <div key={m.at} className="answer">
              {m.text}
            </div>
          ) : (
            <div key={m.at} className={`msg ${m.role}`}>
              {m.text}
            </div>
          ),
        )}
        {busy ? <div className="msg assistant pending">Решаю…</div> : null}
      </div>

      {solved ? (
        <>
          <div className="row wrap solve-actions">
            <button
              className="btn secondary small"
              onClick={() => {
                solutionToNote(sol);
                toast('Сохранил в заметки', { label: 'Открыть', run: () => openSub('notes') });
              }}
            >
              📝 В заметки
            </button>
            <button
              className="btn secondary small"
              onClick={() => {
                solutionToTask(sol);
                toast('Добавил задачу', { label: 'Открыть', run: () => openSub('tasks') });
              }}
            >
              ✅ В задачи
            </button>
            <button className="btn secondary small" disabled={busy} onClick={() => void run(true)}>
              <Icon name="refresh" /> Заново
            </button>
            <span className="spacer" />
            <button
              className="icon-btn plain danger-text"
              aria-label="Удалить задание"
              onClick={() => {
                if (!confirm('Удалить задание?')) return;
                navStore.set({ solveId: null });
                remove('solutions', id);
              }}
            >
              <Icon name="trash" />
            </button>
          </div>
          <div className="composer">
            <div className="box">
              <textarea rows={1} value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Спросить ещё: «почему так?»" />
              <button className="send" disabled={busy || !ask.trim()} onClick={() => void sendFollowUp()} aria-label="Спросить">
                <Icon name="send" />
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function SolveScreen() {
  const nav = navStore.use();
  return nav.solveId ? <SolveDetail id={nav.solveId} /> : <SolveList />;
}
