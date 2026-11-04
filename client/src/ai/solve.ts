import { api } from '../api';
import { fmtDM } from '../lib/dates';
import type { SolutionRec } from '../types';
import { aiRequest, dataBlock, type AiMessage } from './client';
import { SOLVE_SYSTEM } from './prompts';

export const SOLVE_MODES = [
  { id: 'solve', label: 'Реши с объяснением', text: 'Реши с объяснением по шагам.' },
  { id: 'answer', label: 'Только ответ', text: 'Дай ответ и коротко, как он получен.' },
  { id: 'check', label: 'Проверь моё решение', text: 'Проверь моё решение: найди ошибки и покажи верное.' },
  { id: 'explain', label: 'Объясни тему', text: 'Объясни тему простыми словами с примером.' },
] as const;

const blobToBase64 = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]+,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });

async function decode(file: Blob): Promise<{ src: CanvasImageSource; w: number; h: number; done: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      return { src: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close() };
    } catch {
      /* попробуем через <img> */
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  return { src: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
}

/** Фото с iPhone весит 3–5 МБ — уменьшаем до ~2000 px по длинной стороне: для распознавания текста этого хватает */
export async function shrinkImage(file: Blob, maxSide = 2000, quality = 0.85): Promise<{ data: string; mime: string }> {
  try {
    const { src, w, h, done } = await decode(file);
    const k = Math.min(1, maxSide / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * k));
    canvas.height = Math.max(1, Math.round(h * k));
    canvas.getContext('2d')!.drawImage(src, 0, 0, canvas.width, canvas.height);
    done();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
    if (blob) return { data: await blobToBase64(blob), mime: 'image/jpeg' };
  } catch {
    /* не смогли уменьшить — отправим как есть */
  }
  const mime = /png|webp/.test(file.type) ? file.type : 'image/jpeg';
  return { data: await blobToBase64(file), mime };
}

export interface PhotoResult {
  fileId: string;
  text: string;
  ocr: 'ok' | 'off' | 'error';
  error?: string;
}

export async function uploadSolvePhoto(file: Blob): Promise<PhotoResult> {
  const body = await shrinkImage(file);
  return api<PhotoResult>('/api/solve/photo', { body, timeoutMs: 120000 });
}

/** Нейросети иногда всё равно пишут markdown и LaTeX — приводим к обычному тексту */
export function cleanAnswer(text: string) {
  return String(text || '')
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\\\(|\\\)|\\\[|\\\]|\$\$/g, '')
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1)/($2)')
    .replace(/\\sqrt\{([^{}]+)\}/g, '√($1)')
    .replace(/\\cdot(?![a-z])/g, '·')
    .replace(/\\times(?![a-z])/g, '×')
    .replace(/\\leq?(?![a-z])/g, '≤')
    .replace(/\\geq?(?![a-z])/g, '≥')
    .replace(/\\neq(?![a-z])/g, '≠')
    .replace(/\\approx(?![a-z])/g, '≈')
    .replace(/\\pi(?![a-z])/g, 'π')
    .replace(/\^2(?![0-9])/g, '²')
    .replace(/\^3(?![0-9])/g, '³')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Короткое название задания для истории: первая содержательная строка */
export function solveTitle(sol: Pick<SolutionRec, 'ocr' | 'question' | 'createdAt'>) {
  const isMode = (q: string) => SOLVE_MODES.some((m) => m.text === q);
  const src = [sol.question && !isMode(sol.question) ? sol.question : '', sol.ocr]
    .join('\n')
    .split('\n')
    .map((l) => l.replace(/^тестовое распознавание:\s*/i, '').trim())
    .find((l) => l.length >= 3);
  if (!src) return `Задание от ${fmtDM(new Date(sol.createdAt).toISOString().slice(0, 10))}`;
  const title = src.charAt(0).toUpperCase() + src.slice(1);
  return title.length > 60 ? `${title.slice(0, 59)}…` : title;
}

/** Попросить нейросеть решить задание (или ответить на уточнение по нему) */
export async function askSolver(sol: SolutionRec, followUp?: string): Promise<string> {
  const first = [
    `Что сделать: ${sol.question.trim() || SOLVE_MODES[0].text}`,
    sol.ocr.trim() ? `Текст задания (распознан с фото, возможны ошибки):\n${sol.ocr.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const messages: AiMessage[] = [{ role: 'user', content: first }];
  for (const m of sol.messages) if (!m.error) messages.push({ role: m.role, content: m.text });
  if (followUp) messages.push({ role: 'user', content: followUp });
  const last = messages.length - 1;
  messages[last] = { ...messages[last], content: messages[last].content + dataBlock({ mode: 'solve' }) };
  const text = await aiRequest({ system: SOLVE_SYSTEM, messages, temperature: 0.2, maxTokens: 3000 });
  return cleanAnswer(text);
}
