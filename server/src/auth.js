import crypto from 'node:crypto';
import { config } from './config.js';
import { kv } from './db.js';

let secret = kv.get('secret');
if (!secret) {
  secret = crypto.randomBytes(32).toString('hex');
  kv.set('secret', secret);
}

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

// Токен сессии зависит от пароля: смена APP_PASSWORD разлогинивает все устройства.
export function sessionToken() {
  return crypto.createHmac('sha256', secret).update('session:' + config.password).digest('hex');
}

const attempts = new Map();

export function loginHandler(req, res) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60000);
  if (recent.length >= 10) {
    return res.status(429).json({ error: 'Слишком много попыток. Подожди 10 минут.' });
  }
  const password = String(req.body?.password ?? '');
  if (!config.password || !safeEqual(sha(password), sha(config.password))) {
    recent.push(now);
    attempts.set(ip, recent);
    return res.status(401).json({ error: 'Неверный пароль' });
  }
  attempts.delete(ip);
  res.json({ token: sessionToken() });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token && safeEqual(token, sessionToken())) return next();
  res.status(401).json({ error: 'Требуется вход' });
}

export function calSecret() {
  let s = kv.get('calSecret');
  if (!s) {
    s = crypto.randomBytes(18).toString('base64url');
    kv.set('calSecret', s);
  }
  return s;
}
