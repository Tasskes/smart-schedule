import { config } from '../config.js';
import { db } from '../db.js';
import { localDateStr } from '../time.js';
import { ProviderError } from './http.js';
import { mockComplete } from './mock.js';
import { openaiComplete } from './openai.js';
import { yandexComplete } from './yandex.js';

export function aiInfo() {
  const p = config.ai.provider;
  if (p === 'yandex') {
    const y = config.ai.yandex;
    return { provider: 'yandex', configured: !!(y.apiKey && y.folderId), model: y.model, modelFast: y.modelFast };
  }
  if (p === 'openai') {
    const o = config.ai.openai;
    return { provider: 'openai', configured: !!(o.apiKey && o.model), model: o.model, modelFast: o.modelFast || o.model, baseUrl: o.baseUrl };
  }
  if (p === 'mock') return { provider: 'mock', configured: true, model: 'mock', modelFast: 'mock' };
  return { provider: 'none', configured: false };
}

const usageStmt = db.prepare(`
  INSERT INTO ai_usage (day, model, input, output, calls) VALUES (?, ?, ?, ?, 1)
  ON CONFLICT(day, model) DO UPDATE SET input = input + excluded.input, output = output + excluded.output, calls = calls + 1
`);
const monthStmt = db.prepare(
  'SELECT model, SUM(input) AS input, SUM(output) AS output, SUM(calls) AS calls FROM ai_usage WHERE day >= ? GROUP BY model',
);

export function monthUsage() {
  const monthStart = localDateStr().slice(0, 8) + '01';
  return monthStmt.all(monthStart).map((r) => ({ model: r.model, input: r.input, output: r.output, calls: r.calls }));
}

// Не больше двух одновременных запросов к нейросети
let active = 0;
const waiting = [];
async function limited(fn) {
  if (active >= 2) await new Promise((r) => waiting.push(r));
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

async function withRetry(fn) {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof ProviderError) || !e.retryable) throw e;
    await new Promise((r) => setTimeout(r, 2500));
    return fn();
  }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v)));

export async function complete(req) {
  const info = aiInfo();
  if (!info.configured) {
    throw new ProviderError(503, 'Нейросеть не настроена на сервере. Заполни настройки ИИ в файле .env и перезапусти сервер.');
  }
  const model = req.tier === 'fast' ? info.modelFast || info.model : info.model;
  const args = {
    system: String(req.system || ''),
    messages: req.messages,
    json: !!req.json,
    model,
    temperature: clamp(req.temperature ?? 0.4, 0, 1),
    maxTokens: Math.round(clamp(req.maxTokens ?? 4000, 100, 8000)),
    timeoutMs: config.ai.timeoutMs,
  };
  const call =
    info.provider === 'yandex'
      ? (a) => yandexComplete(config.ai.yandex, a)
      : info.provider === 'openai'
        ? (a) => openaiComplete(config.ai.openai, a)
        : mockComplete;
  const out = await limited(() => withRetry(() => call(args)));
  usageStmt.run(localDateStr(), model, out.usage?.input || 0, out.usage?.output || 0);
  return { text: out.text, usage: out.usage, model };
}

export async function aiHandler(req, res) {
  const { messages } = req.body || {};
  if (!Array.isArray(messages) || !messages.length || messages.length > 60) {
    return res.status(400).json({ error: 'messages: нужен непустой массив' });
  }
  for (const m of messages) {
    if (!m || typeof m.content !== 'string' || m.content.length > 120000) {
      return res.status(400).json({ error: 'Некорректное сообщение' });
    }
  }
  try {
    res.json(await complete(req.body));
  } catch (e) {
    let status = e instanceof ProviderError ? e.status : 500;
    console.warn('[ai]', status, e.message);
    // 401/403 от нейросети не должны выглядеть как «разлогинило» в приложении
    if (status === 401 || status === 403 || status < 400 || status >= 600) status = 502;
    res.status(status).json({ error: e.message });
  }
}
