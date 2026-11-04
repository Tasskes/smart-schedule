import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

// Поддельный Telegram API + минимальный SOCKS5-сервер с логином и паролем
const api = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, result: { username: 'fake_bot' } }));
});
const seen = { auth: null, connects: 0 };
const socks = net.createServer((sock) => {
  let stage = 'greet';
  let buf = Buffer.alloc(0);
  const onData = (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (stage === 'greet' && buf.length >= 2 && buf.length >= 2 + buf[1]) {
      const methods = [...buf.subarray(2, 2 + buf[1])];
      buf = buf.subarray(2 + buf[1]);
      if (methods.includes(2)) {
        sock.write(Buffer.from([5, 2]));
        stage = 'auth';
      } else {
        sock.write(Buffer.from([5, 0xff]));
        sock.end();
        return;
      }
    }
    if (stage === 'auth' && buf.length >= 2) {
      const ul = buf[1];
      if (buf.length < 2 + ul + 1) return;
      const pl = buf[2 + ul];
      if (buf.length < 3 + ul + pl) return;
      seen.auth = `${buf.subarray(2, 2 + ul)}:${buf.subarray(3 + ul, 3 + ul + pl)}`;
      buf = buf.subarray(3 + ul + pl);
      sock.write(Buffer.from([1, seen.auth === 'user:pass' ? 0 : 1]));
      stage = seen.auth === 'user:pass' ? 'request' : 'closed';
      if (stage === 'closed') return sock.end();
    }
    if (stage === 'request' && buf.length >= 4) {
      const atyp = buf[3];
      let host;
      let off;
      if (atyp === 1) {
        if (buf.length < 10) return;
        host = [...buf.subarray(4, 8)].join('.');
        off = 8;
      } else if (atyp === 3) {
        const len = buf[4];
        if (buf.length < 5 + len + 2) return;
        host = buf.subarray(5, 5 + len).toString();
        off = 5 + len;
      } else return sock.end();
      const port = buf.readUInt16BE(off);
      const rest = buf.subarray(off + 2);
      stage = 'pipe';
      sock.removeListener('data', onData);
      const up = net.connect(port, host, () => {
        seen.connects += 1;
        sock.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
        if (rest.length) up.write(rest);
        sock.pipe(up);
        up.pipe(sock);
      });
      up.on('error', () => sock.destroy());
    }
  };
  sock.on('data', onData);
  sock.on('error', () => undefined);
});
await new Promise((r) => api.listen(0, '127.0.0.1', r));
await new Promise((r) => socks.listen(0, '127.0.0.1', r));
after(() => {
  api.close();
  socks.close();
});

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-socks-'));
process.env.APP_PASSWORD = 'test';
process.env.TELEGRAM_BOT_TOKEN = 'TOKEN';
process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${api.address().port}`;
process.env.TELEGRAM_PROXY = `socks5://user:pass@127.0.0.1:${socks.address().port}`;

const { config } = await import('../src/config.js');
const { tg, proxyProblem } = await import('../src/tgapi.js');

test('telegram works through a SOCKS5 proxy with login and password', async () => {
  const me = await tg('getMe');
  assert.equal(me.username, 'fake_bot');
  assert.equal(seen.auth, 'user:pass');
  assert.ok(seen.connects >= 1);
});

test('wrong proxy formats are explained', async () => {
  assert.match(proxyProblem('tg://proxy?server=1.2.3.4&port=443&secret=abc'), /MTProto/);
  assert.match(proxyProblem('https://t.me/proxy?server=1.2.3.4&port=443&secret=abc'), /MTProto/);
  assert.match(proxyProblem('vless://uuid@host:443'), /не поддерживается/);
  assert.match(proxyProblem('socks5://1.2.3.4'), /порт/);
  assert.equal(proxyProblem('http://user:pass@1.2.3.4:8080'), null);
  const prev = config.telegram.proxy;
  config.telegram.proxy = 'tg://proxy?server=1.2.3.4&secret=x';
  await assert.rejects(() => tg('getMe'), /MTProto/);
  config.telegram.proxy = prev;
});
