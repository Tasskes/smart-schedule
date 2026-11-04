import { errorFromResponse, fetchWithTimeout, ProviderError } from './http.js';

// Любой OpenAI-совместимый API (DeepSeek, OpenRouter, локальный LM Studio, совместимый режим Yandex и т.д.)
export async function openaiComplete(cfg, { system, messages, json, model, temperature, maxTokens, timeoutMs }) {
  const body = {
    model,
    temperature,
    max_tokens: maxTokens,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...messages
        .filter((m) => String(m.content ?? '').trim())
        .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) })),
    ],
  };
  if (json) body.response_format = { type: 'json_object' };

  const post = (b) =>
    fetchWithTimeout(
      `${cfg.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify(b),
      },
      timeoutMs,
    );

  let res = await post(body);
  if (!res.ok && json && res.status === 400) {
    delete body.response_format;
    res = await post(body);
  }
  if (!res.ok) throw errorFromResponse('AI', res.status, await res.text());
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new ProviderError(502, 'Нейросеть вернула пустой ответ');
  return {
    text,
    usage: { input: Number(data.usage?.prompt_tokens) || 0, output: Number(data.usage?.completion_tokens) || 0 },
  };
}
