export class ProviderError extends Error {
  constructor(status, message, retryable = false) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

export async function fetchWithTimeout(url, init, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new ProviderError(504, 'Нейросеть не ответила вовремя', true);
    throw new ProviderError(502, `Не удалось связаться с нейросетью: ${e.message}`, true);
  } finally {
    clearTimeout(timer);
  }
}

export function errorFromResponse(provider, status, body) {
  let detail = String(body || '').slice(0, 400);
  try {
    const j = JSON.parse(body);
    detail = j?.error?.message || j?.message || j?.error || detail;
    if (typeof detail !== 'string') detail = JSON.stringify(detail).slice(0, 400);
  } catch {
    /* не JSON */
  }
  let hint = '';
  if (status === 401 || status === 403) {
    hint = provider === 'yandex'
      ? ' Проверь YANDEX_API_KEY, YANDEX_FOLDER_ID и роль ai.languageModels.user у сервисного аккаунта.'
      : ' Проверь API-ключ.';
  } else if (status === 429) {
    hint = ' Превышен лимит запросов, попробуй через минуту.';
  }
  return new ProviderError(status, `${provider}: ошибка ${status}. ${detail}${hint}`.trim(), status === 429 || status >= 500);
}
