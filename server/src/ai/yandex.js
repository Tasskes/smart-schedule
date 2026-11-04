import { errorFromResponse, fetchWithTimeout, ProviderError } from './http.js';

// YandexGPT (Yandex AI Studio), нативный API:
// POST https://llm.api.cloud.yandex.net/foundationModels/v1/completion
export async function yandexComplete(cfg, { system, messages, json, model, temperature, maxTokens, timeoutMs }) {
  const modelUri = model.startsWith('gpt://') ? model : `gpt://${cfg.folderId}/${model}`;
  const msgs = [];
  if (system) msgs.push({ role: 'system', text: system });
  for (const m of messages) {
    const text = String(m.content ?? '').trim();
    if (!text) continue;
    msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', text });
  }
  const body = {
    modelUri,
    completionOptions: { stream: false, temperature, maxTokens: String(maxTokens) },
    messages: msgs,
  };
  if (json) body.jsonObject = true;

  const auth = cfg.apiKey.startsWith('t1.') ? `Bearer ${cfg.apiKey}` : `Api-Key ${cfg.apiKey}`;
  const post = (b) =>
    fetchWithTimeout(
      cfg.url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth, 'x-folder-id': cfg.folderId },
        body: JSON.stringify(b),
      },
      timeoutMs,
    );

  let res = await post(body);
  if (!res.ok && json && res.status === 400) {
    // Если модель не поддерживает JSON-режим — повторяем без него (JSON просим в промпте).
    const text = await res.text();
    if (!/json/i.test(text)) throw errorFromResponse('YandexGPT', 400, text);
    delete body.jsonObject;
    res = await post(body);
  }
  if (!res.ok) throw errorFromResponse('YandexGPT', res.status, await res.text());

  const data = await res.json();
  const alt = data?.result?.alternatives?.[0];
  if (!alt) throw new ProviderError(502, 'YandexGPT вернул пустой ответ');
  if (alt.status === 'ALTERNATIVE_STATUS_CONTENT_FILTER') {
    throw new ProviderError(422, 'YandexGPT отказался отвечать (фильтр контента). Переформулируй запрос.');
  }
  const usage = data.result.usage || {};
  return {
    text: alt.message?.text || '',
    usage: { input: Number(usage.inputTextTokens) || 0, output: Number(usage.completionTokens) || 0 },
  };
}
