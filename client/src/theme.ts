import type { Appearance, ThemeName } from './types';

export const THEMES: { id: ThemeName; title: string; hint: string; preview: { bg: string; card: string; accent: string; text: string } }[] = [
  { id: 'classic', title: 'Классика', hint: 'Спокойный стиль iPhone', preview: { bg: '#f2f2f7', card: '#ffffff', accent: '#4f46e5', text: '#111114' } },
  { id: 'pastel', title: 'Пастель', hint: 'Тёплые мягкие цвета, крупные скругления', preview: { bg: '#faf6f1', card: '#ffffff', accent: '#e86f5c', text: '#2b2530' } },
  { id: 'neon', title: 'Неон', hint: 'Тёмная игровая тема со свечением', preview: { bg: '#0b0b14', card: '#151526', accent: '#7c5cff', text: '#ecebff' } },
];

export const ACCENTS = ['#4f46e5', '#7c3aed', '#db2777', '#e86f5c', '#d97706', '#059669', '#0284c7', '#334155'];

export const DEFAULT_APPEARANCE: Appearance = { theme: 'classic', mode: 'auto', accent: null };

export function applyAppearance(a: Appearance | undefined | null) {
  const ap = { ...DEFAULT_APPEARANCE, ...(a || {}) };
  const root = document.documentElement;
  root.dataset.theme = ap.theme;
  root.dataset.mode = ap.theme === 'neon' ? 'dark' : ap.mode;
  if (ap.accent) {
    root.style.setProperty('--accent', ap.accent);
    root.style.setProperty('--accent-text', '#ffffff');
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-text');
  }
  // цвет строки состояния iPhone под фон темы
  requestAnimationFrame(() => {
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    if (!bg) return;
    for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.setAttribute('content', bg);
  });
}
