import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createStore } from '../db/store';
import { Icon } from './Icon';

// ---------- Шторка ----------

export function Sheet({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="sheet-grab" />
        <div className="sheet-head">
          <h2>{title}</h2>
          {actions}
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <Icon name="close" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

// ---------- Поля ----------

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint ? <div className="tiny muted">{hint}</div> : null}
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  return (
    <label className="toggle">
      <span className="grow">
        <span>{label}</span>
        {hint ? <div className="tiny muted">{hint}</div> : null}
      </span>
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span />
      </span>
    </label>
  );
}

export function Progress({ value, tone }: { value: number; tone?: 'ok' | 'warn' | 'danger' }) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <div className={`progress ${tone || ''}`}>
      <i style={{ width: `${v * 100}%` }} />
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.v} className={o.v === value ? 'active' : ''} onClick={() => onChange(o.v)} type="button">
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ emoji, title, children }: { emoji: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="big">{emoji}</div>
      <div style={{ fontWeight: 600, color: 'var(--text)' }}>{title}</div>
      {children ? <div className="small" style={{ marginTop: 6 }}>{children}</div> : null}
    </div>
  );
}

export function AutoTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { maxRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { maxRows, ...rest } = props;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, (maxRows || 6) * 24 + 22)}px`;
  }, [props.value, maxRows]);
  return <textarea ref={ref} rows={1} {...rest} />;
}

// ---------- Уведомления внутри приложения ----------

interface ToastItem {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

export const toastStore = createStore<{ items: ToastItem[] }>({ items: [] });
let toastId = 0;

export function toast(text: string, action?: ToastItem['action'], ms = 3500) {
  const id = ++toastId;
  toastStore.set((s) => ({ items: [...s.items.slice(-1), { id, text, action }] }));
  setTimeout(() => toastStore.set((s) => ({ items: s.items.filter((t) => t.id !== id) })), action ? ms + 2500 : ms);
}

export function Toasts() {
  const { items } = toastStore.use();
  return (
    <div className="toast-wrap">
      {items.map((t) => (
        <div className="toast" key={t.id}>
          <span>{t.text}</span>
          {t.action ? (
            <button
              onClick={() => {
                t.action!.run();
                toastStore.set((s) => ({ items: s.items.filter((x) => x.id !== t.id) }));
              }}
            >
              {t.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function NumInput({ value, onChange, placeholder, className }: { value: number | null | undefined; onChange: (v: number | null) => void; placeholder?: string; className?: string }) {
  const fmt = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? '' : String(v).replace('.', ','));
  const [text, setText] = useState(fmt(value));
  useEffect(() => {
    const parsed = Number(text.replace(',', '.'));
    if ((value == null && text.trim() !== '') || (value != null && parsed !== value)) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      className={`input ${className || ''}`}
      inputMode="decimal"
      type="text"
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^0-9.,-]/g, '');
        setText(raw);
        const t = raw.replace(',', '.').trim();
        if (t === '' || t === '-') return onChange(null);
        const n = Number(t);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}
