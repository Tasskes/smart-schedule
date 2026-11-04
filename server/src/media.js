import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fetchWithTimeout } from './ai/http.js';
import { config } from './config.js';

// Голосовые → текст (Yandex SpeechKit, синхронное распознавание кусками по 25 секунд)
// и текст с картинок (Yandex Vision OCR). Реализации можно подменить в тестах.

const yc = () => config.ai.yandex;
export const mediaEnabled = () => !!(yc().apiKey && yc().folderId);
const auth = () => (yc().apiKey.startsWith('t1.') ? `Bearer ${yc().apiKey}` : `Api-Key ${yc().apiKey}`);

function mediaError(service, status, body) {
  if (status === 401 || status === 403) {
    const role = service === 'SpeechKit' ? 'ai.speechkit-stt.user' : 'ai.vision.user';
    const scope = service === 'SpeechKit' ? 'yc.ai.speechkitStt.execute' : 'yc.ai.vision.execute';
    return new Error(`${service}: нет доступа — дай сервисному аккаунту роль ${role}, а API-ключу область ${scope}`);
  }
  let msg = String(body || '').slice(0, 200);
  try {
    const j = JSON.parse(body);
    msg = j.message || j.error_message || j.error?.message || msg;
  } catch {
    /* не JSON */
  }
  return new Error(`${service}: ошибка ${status}. ${msg}`);
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 180000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      if (err.code === 'ENOENT') return reject(new Error('на сервере нет ffmpeg — он нужен для длинных голосовых и аудиофайлов'));
      reject(new Error(`ffmpeg: ${String(stderr || err.message).trim().slice(0, 200)}`));
    });
  });
}

/** Перекодируем что угодно (ogg, mp3, m4a, mp4-кружок) в OGG Opus и режем на куски по 25 с */
export async function splitAudio(buf, segmentSec = 25) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ss-audio-'));
  try {
    const input = path.join(dir, 'input');
    await fs.writeFile(input, buf);
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-i', input, '-vn', '-ac', '1', '-ar', '48000',
      '-c:a', 'libopus', '-b:a', '32k', '-f', 'segment', '-segment_time', String(segmentSec),
      '-reset_timestamps', '1', path.join(dir, 'part%03d.ogg'),
    ]);
    const files = (await fs.readdir(dir)).filter((f) => f.startsWith('part')).sort();
    return Promise.all(files.map((f) => fs.readFile(path.join(dir, f))));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function recognizeChunk(buf) {
  const url = `${config.media.sttUrl}?folderId=${encodeURIComponent(yc().folderId)}&lang=ru-RU&format=oggopus`;
  const res = await fetchWithTimeout(url, { method: 'POST', headers: { Authorization: auth() }, body: buf }, 60000);
  const text = await res.text();
  if (!res.ok) throw mediaError('SpeechKit', res.status, text);
  try {
    return String(JSON.parse(text).result || '').trim();
  } catch {
    throw new Error('SpeechKit вернул непонятный ответ');
  }
}

async function speechToText(buf, { mime = 'audio/ogg', duration = 0 } = {}) {
  if (!mediaEnabled()) throw new Error('расшифровка не настроена (нужны YANDEX_API_KEY и YANDEX_FOLDER_ID)');
  const shortOgg = /ogg|opus/i.test(mime) && duration > 0 && duration <= 29 && buf.length < 1_000_000;
  const chunks = shortOgg ? [buf] : await splitAudio(buf);
  const parts = [];
  for (const c of chunks) parts.push(await recognizeChunk(c));
  return parts.filter(Boolean).join(' ').trim();
}

async function imageToText(buf, mime = 'image/jpeg') {
  if (!mediaEnabled()) throw new Error('распознавание картинок не настроено (нужны YANDEX_API_KEY и YANDEX_FOLDER_ID)');
  const mimeType = /png/i.test(mime) ? 'PNG' : /pdf/i.test(mime) ? 'PDF' : 'JPEG';
  const res = await fetchWithTimeout(
    config.media.ocrUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth(), 'x-folder-id': yc().folderId, 'x-data-logging-enabled': 'false' },
      body: JSON.stringify({ mimeType, languageCodes: ['ru', 'en'], model: 'page', content: buf.toString('base64') }),
    },
    60000,
  );
  const text = await res.text();
  if (!res.ok) throw mediaError('Vision OCR', res.status, text);
  try {
    return String(JSON.parse(text)?.result?.textAnnotation?.fullText || '').trim();
  } catch {
    throw new Error('Vision OCR вернул непонятный ответ');
  }
}

let impl = { stt: speechToText, ocr: imageToText };
export function setMediaImpl(over) {
  impl = { ...impl, ...over };
}
export const transcribe = (buf, opts) => impl.stt(buf, opts);
export const recognizeImage = (buf, mime) => impl.ocr(buf, mime);
