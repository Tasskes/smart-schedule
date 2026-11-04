import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { loginHandler, requireAuth } from './auth.js';
import { aiHandler, aiInfo, monthUsage } from './ai/index.js';
import { syncHandler } from './sync.js';
import {
  getSnapshot, onScheduleChanges, recentChanges, refreshSchedule, startSchedulePolling,
} from './tulsu.js';
import {
  addSubscription, calendarPath, icsHandler, removeSubscription, saveAgenda, sendToAll,
  startReminderLoop, subscriptionCount, vapidPublicKey,
} from './push.js';

if (!config.password) {
  console.error('Не задан APP_PASSWORD (пароль для входа в приложение). Укажи его в .env');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback, uniquelocal');
app.use(express.json({ limit: '25mb' }));

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.post('/api/login', loginHandler);
app.get('/cal/:file', icsHandler);

app.use('/api', requireAuth);

app.get('/api/status', (req, res) => {
  const snap = getSnapshot();
  res.json({
    ok: true,
    group: config.tulsu.group,
    schedule: snap ? { fetchedAt: snap.fetchedAt || null, error: snap.error || null, count: snap.classes?.length || 0 } : null,
    ai: { ...aiInfo(), usage: monthUsage() },
    push: { publicKey: vapidPublicKey, subscriptions: subscriptionCount() },
    calendarPath: calendarPath(),
    publicUrl: config.publicUrl || null,
    serverTime: Date.now(),
  });
});

app.get('/api/schedule', asyncRoute(async (req, res) => {
  let snap = getSnapshot();
  if (!snap || req.query.force === '1') snap = await refreshSchedule();
  const changes = recentChanges();
  const version = `${snap?.hash || 'none'}-${changes[0]?.id || 0}`;
  if (req.query.since && req.query.since === version) return res.json({ notModified: true, version });
  res.json({ ...snap, changes, version });
}));

app.post('/api/sync', syncHandler);
app.post('/api/ai', asyncRoute(aiHandler));

app.post('/api/push/subscribe', (req, res) => {
  addSubscription(req.body?.subscription);
  res.json({ ok: true });
});
app.post('/api/push/unsubscribe', (req, res) => {
  removeSubscription(req.body?.endpoint);
  res.json({ ok: true });
});
app.post('/api/push/test', asyncRoute(async (req, res) => {
  const sent = await sendToAll({ title: 'Проверка уведомлений', body: 'Если ты это видишь — всё работает 👍', tag: 'test', url: '/' });
  res.json({ ok: true, sent });
}));

app.post('/api/agenda', (req, res) => {
  const agenda = saveAgenda(req.body || {});
  res.json({ ok: true, items: agenda.items.length });
});

// Статика PWA
if (fs.existsSync(config.staticDir)) {
  app.use(
    express.static(config.staticDir, {
      index: false,
      setHeaders(res, filePath) {
        const base = path.basename(filePath);
        if (base === 'sw.js' || base.endsWith('.html') || base.endsWith('.webmanifest')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );
  const indexFile = path.join(config.staticDir, 'index.html');
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/cal/')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexFile);
  });
} else {
  console.warn(`Папка со сборкой клиента не найдена: ${config.staticDir} (собери: cd client && npm run build)`);
}

app.use((req, res) => res.status(404).json({ error: 'Не найдено' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: String(err.message || err) });
});

onScheduleChanges(async (changes) => {
  const lines = changes.map((c) => c.text);
  const body = lines.slice(0, 4).join('\n') + (lines.length > 4 ? `\nи ещё ${lines.length - 4}…` : '');
  await sendToAll({ title: '⚠️ Изменения в расписании', body, tag: 'schedule-changes', url: '/' });
});

app.listen(config.port, () => {
  console.log(`Умный распорядок: http://localhost:${config.port}  (ИИ: ${aiInfo().provider}, группа ${config.tulsu.group})`);
  startSchedulePolling();
  startReminderLoop();
});
