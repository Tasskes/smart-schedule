import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Field, NumInput, Progress, Sheet, toast } from '../components/ui';
import { patch, put, remove, useTable } from '../db/store';
import { balance, earnedTotal, levelInfo, streak, streakMultiplier } from '../lib/game';
import type { RewardRec } from '../types';

function RewardSheet({ initial, onClose }: { initial?: RewardRec; onClose: () => void }) {
  const [title, setTitle] = useState(initial?.title || '');
  const [cost, setCost] = useState<number | null>(initial?.cost ?? 50);
  const [emoji, setEmoji] = useState(initial?.emoji || '🎁');
  const save = () => {
    if (!title.trim() || !cost) return toast('Нужны название и цена');
    if (initial) patch('rewards', initial.id, { title: title.trim(), cost, emoji });
    else put('rewards', { title: title.trim(), cost, emoji });
    onClose();
  };
  return (
    <Sheet title={initial ? 'Награда' : 'Новая награда'} onClose={onClose}>
      <div className="grid-3">
        <Field label="Эмодзи">
          <input className="input" value={emoji} onChange={(e) => setEmoji(e.target.value)} />
        </Field>
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Цена, 🪙">
            <NumInput value={cost} onChange={setCost} />
          </Field>
        </div>
      </div>
      <Field label="Чем себя порадовать">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Серия сериала" />
      </Field>
      <button className="btn block" onClick={save}>
        Сохранить
      </button>
      {initial ? (
        <button
          className="btn danger block"
          style={{ marginTop: 8 }}
          onClick={() => {
            remove('rewards', initial.id);
            onClose();
          }}
        >
          Удалить
        </button>
      ) : null}
    </Sheet>
  );
}

export function RewardsScreen() {
  const ledger = useTable('ledger');
  const rewards = useTable('rewards');
  const [edit, setEdit] = useState<RewardRec | null | 'new'>(null);
  const bal = balance(ledger);
  const earned = earnedTotal(ledger);
  const lvl = levelInfo(earned);
  const s = streak(ledger);
  const history = useMemo(() => [...ledger].sort((a, b) => b.ts - a.ts).slice(0, 60), [ledger]);

  const buy = (r: RewardRec) => {
    if (bal < r.cost) return toast(`Не хватает ${r.cost - bal} 🪙 — ещё чуть-чуть!`);
    if (!confirm(`Потратить ${r.cost} 🪙 на «${r.title}»?`)) return;
    put('ledger', { ts: Date.now(), amount: -r.cost, reason: `${r.emoji || '🎁'} ${r.title}`, kind: 'spend', ref: r.id });
    toast(`Наслаждайся: ${r.title} ${r.emoji || ''}`);
  };

  return (
    <>
      <div className="card center">
        <div className="big-num" style={{ color: 'var(--coin)' }}>🪙 {bal}</div>
        <div className="small muted">монет на счету</div>
        <div className="row" style={{ marginTop: 12 }}>
          <span className="small nowrap">Уровень {lvl.level}</span>
          <div className="grow">
            <Progress value={lvl.progress} />
          </div>
          <span className="tiny muted nowrap">ещё {lvl.toNext}</span>
        </div>
        <div className="small" style={{ marginTop: 10 }}>
          🔥 Серия: <b>{s}</b> дн. {s > 0 ? <span className="muted">· бонус к наградам +{Math.round((streakMultiplier(s) - 1) * 100)}%</span> : null}
        </div>
        <div className="tiny muted" style={{ marginTop: 6 }}>
          Монеты дают за отмеченные дела (ИИ сам оценивает их стоимость). Штрафов нет, а один пропущенный день в неделю серию не обрывает.
        </div>
      </div>

      <div className="section-title">
        Магазин наград
        <span className="spacer" />
        <button className="btn ghost small" style={{ minHeight: 0, padding: 0 }} onClick={() => setEdit('new')}>
          <Icon name="plus" /> Своя
        </button>
      </div>
      <div className="list">
        {[...rewards]
          .sort((a, b) => a.cost - b.cost)
          .map((r) => (
            <div className="list-item" key={r.id}>
              <span className="emoji">{r.emoji || '🎁'}</span>
              <button className="grow" style={{ border: 0, background: 'none', textAlign: 'left', padding: 0 }} onClick={() => setEdit(r)}>
                <div className="small" style={{ fontWeight: 600 }}>
                  {r.title}
                </div>
                <div className="tiny" style={{ color: 'var(--coin)' }}>
                  🪙 {r.cost}
                </div>
              </button>
              <button className={`btn small ${bal >= r.cost ? '' : 'secondary'}`} onClick={() => buy(r)}>
                Взять
              </button>
            </div>
          ))}
      </div>

      <div className="section-title">История</div>
      <div className="list">
        {history.map((l) => (
          <div className="list-item" key={l.id}>
            <div className="grow">
              <div className="small">{l.reason}</div>
              <div className="tiny muted">{new Date(l.ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
            </div>
            <b className="nowrap" style={{ color: l.amount >= 0 ? 'var(--ok)' : 'var(--danger)' }}>
              {l.amount >= 0 ? '+' : ''}
              {l.amount}
            </b>
          </div>
        ))}
      </div>
      {edit ? <RewardSheet initial={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} /> : null}
    </>
  );
}
