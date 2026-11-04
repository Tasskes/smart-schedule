import path from 'node:path';
import { fileURLToPath } from 'node:url';

const env = process.env;
const here = path.dirname(fileURLToPath(import.meta.url));

function pickProvider() {
  if (env.AI_PROVIDER) return env.AI_PROVIDER.toLowerCase();
  if (env.YANDEX_API_KEY) return 'yandex';
  if (env.OPENAI_API_KEY) return 'openai';
  return 'none';
}

export const config = {
  port: Number(env.PORT || 8080),
  password: env.APP_PASSWORD || '',
  dataDir: path.resolve(env.DATA_DIR || path.join(here, '../data')),
  staticDir: path.resolve(env.STATIC_DIR || path.join(here, '../../client/dist')),
  publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
  // Смещение часового пояса по умолчанию (Тула = Москва, UTC+3). Клиент присылает своё.
  tzOffsetMin: Number(env.TZ_OFFSET_MIN ?? 180),
  tulsu: {
    group: env.TULSU_GROUP || '720043-03',
    pollMin: Math.max(5, Number(env.TULSU_POLL_MIN || 30)),
    base: (env.TULSU_BASE || 'https://tulsu.ru/schedule/queries').replace(/\/$/, ''),
    disabled: env.TULSU_DISABLED === '1',
  },
  ai: {
    provider: pickProvider(),
    timeoutMs: Number(env.AI_TIMEOUT_MS || 180000),
    yandex: {
      apiKey: env.YANDEX_API_KEY || '',
      folderId: env.YANDEX_FOLDER_ID || '',
      model: env.AI_MODEL || 'yandexgpt/latest',
      modelFast: env.AI_MODEL_FAST || 'yandexgpt-lite/latest',
      url: env.YANDEX_URL || 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion',
    },
    openai: {
      baseUrl: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
      apiKey: env.OPENAI_API_KEY || '',
      model: env.AI_MODEL || env.OPENAI_MODEL || '',
      modelFast: env.AI_MODEL_FAST || env.OPENAI_MODEL_FAST || '',
    },
  },
  vapidSubject: env.VAPID_SUBJECT || 'mailto:smart-schedule@example.com',
  media: {
    // Голосовые → текст (Yandex SpeechKit) и текст с картинок (Yandex Vision OCR); ключ и каталог — те же, что у YandexGPT
    sttUrl: env.SPEECHKIT_URL || 'https://stt.api.cloud.yandex.net/speech/v1/stt:recognize',
    ocrUrl: env.VISION_OCR_URL || 'https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText',
    // Сколько ждать следующих пересланных сообщений, прежде чем собрать переписку в одну задачу
    debounceMs: Number(env.INBOX_DEBOUNCE_MS || 3500),
  },
  vk: {
    token: env.VK_GROUP_TOKEN || '',
    groupId: String(env.VK_GROUP_ID || '').replace(/^(club|public)/, '').trim(),
    apiBase: (env.VK_API_BASE || 'https://api.vk.com').replace(/\/$/, ''),
    version: env.VK_API_VERSION || '5.199',
  },
  telegram: {
    token: env.TELEGRAM_BOT_TOKEN || '',
    apiBase: (env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, ''),
    // необязательный HTTP(S)-прокси, если Telegram недоступен напрямую: http://user:pass@host:port
    proxy: env.TELEGRAM_PROXY || '',
  },
};
