import { config } from './config.js';
import { saveFile } from './files.js';
import { mediaEnabled, recognizeImage } from './media.js';

// «Решить»: фото задания сохраняем (чтобы показывать в истории) и распознаём на нём текст (Yandex Vision OCR).
// Само решение приложение просит у нейросети через обычный /api/ai — с распознанным текстом.

const MIME_OK = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 12 * 1024 * 1024;
export const MOCK_OCR = 'Тестовое распознавание: решите уравнение 2x + 3 = 7.';

export async function solvePhotoHandler(req, res) {
  const { data, mime = 'image/jpeg' } = req.body || {};
  if (typeof data !== 'string' || !data) return res.status(400).json({ error: 'Нет фото' });
  if (!MIME_OK.has(mime)) return res.status(400).json({ error: 'Нужна картинка JPEG, PNG или WebP' });
  const buf = Buffer.from(data.replace(/^data:[^,]+,/, ''), 'base64');
  if (!buf.length) return res.status(400).json({ error: 'Пустое фото' });
  if (buf.length > MAX_BYTES) return res.status(413).json({ error: 'Фото слишком большое' });
  const fileId = saveFile(buf, mime);
  if (!mediaEnabled()) {
    if (config.ai.provider === 'mock') return res.json({ fileId, text: MOCK_OCR, ocr: 'ok' });
    return res.json({
      fileId,
      text: '',
      ocr: 'off',
      error: 'Распознавание фото не настроено на сервере (нужны YANDEX_API_KEY и YANDEX_FOLDER_ID). Впиши условие текстом.',
    });
  }
  try {
    res.json({ fileId, text: await recognizeImage(buf, mime), ocr: 'ok' });
  } catch (e) {
    console.warn('[solve] ocr failed:', e.message);
    res.json({ fileId, text: '', ocr: 'error', error: String(e.message || e) });
  }
}
