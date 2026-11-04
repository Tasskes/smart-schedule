import { api, hasServer } from '../api';

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiRequest {
  system: string;
  messages: AiMessage[];
  json?: boolean;
  tier?: 'smart' | 'fast';
  temperature?: number;
  maxTokens?: number;
}

export async function aiRequest(req: AiRequest): Promise<string> {
  if (!hasServer()) throw new Error('Нейросеть работает через сервер. Подключись к серверу в настройках.');
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('Нет интернета — нейросеть недоступна');
  const res = await api<{ text: string }>('/api/ai', { body: req, timeoutMs: 200000 });
  return res.text;
}

/** Достаём JSON из ответа модели: без ```-обёрток, с обрезанным мусором вокруг */
export function parseJsonLoose<T = unknown>(text: string): T | null {
  if (!text) return null;
  let s = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s) as T;
  } catch {
    /* попробуем вырезать объект */
  }
  const start = s.search(/[{[]/);
  if (start < 0) return null;
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function dataBlock(data: unknown) {
  return `\n\n<данные>\n${JSON.stringify(data)}\n</данные>`;
}
