import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Вложения задач (картинки из пересланных переписок) — хранятся на сервере в DATA_DIR/files.
const DIR = path.join(config.dataDir, 'files');
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' };
const ID_RE = /^[a-f0-9]{24}\.[a-z0-9]{2,4}$/;

export function saveFile(buf, mime = 'image/jpeg') {
  fs.mkdirSync(DIR, { recursive: true });
  const id = `${crypto.randomBytes(12).toString('hex')}.${EXT[mime] || 'bin'}`;
  fs.writeFileSync(path.join(DIR, id), buf);
  return id;
}

export function filePath(id) {
  return ID_RE.test(String(id)) ? path.join(DIR, id) : null;
}

export function fileHandler(req, res) {
  const p = filePath(req.params.id);
  if (!p || !fs.existsSync(p)) return res.status(404).json({ error: 'Файл не найден' });
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.sendFile(p);
}
