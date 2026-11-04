import { saveFile } from './files.js';
import { recognizeImage, transcribe } from './media.js';

// Собираем пересланную переписку в один текст: сообщения, расшифровки голосовых, текст с картинок.
// item = { author, time, text, media: [{ kind: 'image'|'voice'|'audio'|'video_note'|'doc', fetch(), duration?, transcript?, name? }] }

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const fmtDur = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

export function hasMedia(items) {
  return items.some((it) => it.media.some((m) => m.kind !== 'doc'));
}

export async function buildConversation(items, { maxImages = 10, maxVoices = 10 } = {}) {
  const lines = [];
  const attachments = [];
  const problems = new Set();
  let images = 0;
  let voices = 0;
  for (const it of items) {
    const head = `[${it.author}${it.time ? `, ${it.time}` : ''}]`;
    if (it.text) lines.push(`${head}: ${it.text}`);
    for (const m of it.media) {
      if (m.kind === 'image') {
        if (images >= maxImages) {
          problems.add(`картинок больше ${maxImages} — остальные пропущены`);
          continue;
        }
        images += 1;
        try {
          const { buf, mime } = await m.fetch();
          const id = saveFile(buf, mime);
          let text = '';
          try {
            text = await recognizeImage(buf, mime);
          } catch (e) {
            problems.add(`текст с картинок: ${e.message}`);
          }
          attachments.push({ id, kind: 'image', mime, from: it.author, text: clip(text, 3000) });
          lines.push(`${head}: 🖼 картинка${text ? `, текст на ней: «${clip(text, 1500)}»` : ' (текста на ней не найдено)'}`);
        } catch (e) {
          problems.add(`картинку не удалось скачать: ${e.message}`);
          lines.push(`${head}: 🖼 картинка (не удалось загрузить)`);
        }
      } else if (m.kind === 'voice' || m.kind === 'audio' || m.kind === 'video_note') {
        if (voices >= maxVoices) {
          problems.add(`голосовых больше ${maxVoices} — остальные пропущены`);
          continue;
        }
        voices += 1;
        let text = String(m.transcript || '').trim();
        if (!text) {
          try {
            const { buf, mime } = await m.fetch();
            text = await transcribe(buf, { mime, duration: m.duration || 0 });
          } catch (e) {
            problems.add(`голосовые: ${e.message}`);
          }
        }
        const label = m.kind === 'video_note' ? '📹 кружок' : m.kind === 'audio' ? '🎵 аудио' : '🎤 голосовое';
        const dur = m.duration ? ` ${fmtDur(m.duration)}` : '';
        lines.push(`${head}: ${label}${dur}${text ? `: «${clip(text, 3000)}»` : ' (не удалось расшифровать)'}`);
        if (text) attachments.push({ kind: 'voice', from: it.author, duration: m.duration || null, text: clip(text, 4000) });
      } else if (m.kind === 'doc') {
        lines.push(`${head}: 📎 файл${m.name ? ` «${m.name}»` : ''}`);
      }
    }
  }
  return {
    transcript: lines.join('\n'),
    attachments,
    problems: [...problems],
    stats: { messages: items.length, images, voices },
  };
}

/** Для одного своего сообщения с голосовым/картинкой: просто текст без разметки переписки */
export function plainText(items, convo) {
  const parts = items.map((it) => it.text).filter(Boolean);
  for (const a of convo.attachments) if (a.text) parts.push(a.kind === 'image' ? `Текст с картинки: ${a.text}` : a.text);
  return parts.join('\n').trim();
}
