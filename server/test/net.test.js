import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

// Поддельный Telegram API и простой HTTP-прокси (CONNECT и обычные запросы)
const api = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.includes('/botBAD/')) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ ok: false, description: 'Unauthorized' }));
  }
  res.end(JSON.stringify({ ok: true, result: { username: 'fake_bot', via: req.headers['x-via-proxy'] || 'direct' } }));
});
let proxied = 0;
const proxy = http.createServer((req, res) => {
  proxied += 1;
  const u = new URL(req.url);
  const fwd = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: req.method, headers: { ...req.headers, 'x-via-proxy': 'yes' } }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  req.pipe(fwd);
});
proxy.on('connect', (req, socket, head) => {
  proxied += 1;
  const [host, port] = req.url.split(':');
  const s = net.connect(Number(port), host, () => {
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    s.write(head);
    s.pipe(socket);
    socket.pipe(s);
  });
  s.on('error', () => socket.destroy());
});
await new Promise((r) => api.listen(0, '127.0.0.1', r));
await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
after(() => {
  api.close();
  proxy.close();
});

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-net-'));
process.env.APP_PASSWORD = 'test';
process.env.TELEGRAM_BOT_TOKEN = 'TOKEN';
process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${api.address().port}`;
process.env.TELEGRAM_PROXY = `http://127.0.0.1:${proxy.address().port}`;

const { config } = await import('../src/config.js');
const { tg, netErrorText } = await import('../src/tgapi.js');

test('telegram calls go through TELEGRAM_PROXY', async () => {
  const me = await tg('getMe');
  assert.equal(me.username, 'fake_bot');
  assert.ok(proxied >= 1, 'request went through the proxy');
});

test('bad token gives a clear message', async () => {
  config.telegram.token = 'BAD';
  await assert.rejects(() => tg('getMe'), /токен/);
  config.telegram.token = 'TOKEN';
});

test('network errors are explained', async () => {
  const prev = config.telegram.proxy;
  config.telegram.proxy = '';
  const tmp = http.createServer();
  await new Promise((r) => tmp.listen(0, '127.0.0.1', r));
  const closedPort = tmp.address().port;
  await new Promise((r) => tmp.close(r));
  config.telegram.apiBase = `http://127.0.0.1:${closedPort}`;
  await assert.rejects(() => tg('getMe'), /Нет связи с Telegram: .*ECONNREFUSED/);
  config.telegram.proxy = prev;
  const e = new TypeError('fetch failed');
  e.cause = { code: 'ETIMEDOUT' };
  assert.match(netErrorText(e), /недоступен из сети сервера/);
});
