import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSubscription, parseVless, toXrayOutbound, xrayConfig } from '../src/vless.js';

const UUID = '11111111-2222-3333-4444-555555555555';
const REALITY = `vless://${UUID}@1.2.3.4:443?type=tcp&security=reality&pbk=PUBKEYabc_-&fp=chrome&sni=www.microsoft.com&sid=ab12&spx=%2F&flow=xtls-rprx-vision#%F0%9F%87%B3%F0%9F%87%B1%20Netherlands`;
const WS_TLS = `vless://${UUID}@cdn.example.com:443?type=ws&security=tls&path=%2Fws%3Fed%3D2048&host=cdn.example.com&sni=cdn.example.com&alpn=h2%2Chttp%2F1.1#DE`;
const GRPC = `vless://${UUID}@[2001:db8::1]:8443?type=grpc&serviceName=gun&mode=multi&security=reality&pbk=K&sid=01&sni=a.b#FI`;
const XHTTP = `vless://${UUID}@x.example.com:443?type=xhttp&path=%2Fx&mode=packet-up&security=tls&sni=x.example.com#XH`;

test('reality + vision', () => {
  const v = parseVless(REALITY);
  assert.equal(v.name, '🇳🇱 Netherlands');
  const o = toXrayOutbound(v);
  assert.equal(o.settings.vnext[0].address, '1.2.3.4');
  assert.equal(o.settings.vnext[0].users[0].flow, 'xtls-rprx-vision');
  assert.deepEqual(o.streamSettings.realitySettings, { serverName: 'www.microsoft.com', fingerprint: 'chrome', publicKey: 'PUBKEYabc_-', shortId: 'ab12', spiderX: '/' });
  assert.equal(o.streamSettings.network, 'tcp');
});

test('ws + tls, grpc over IPv6, xhttp', () => {
  const ws = toXrayOutbound(parseVless(WS_TLS));
  assert.equal(ws.streamSettings.wsSettings.path, '/ws?ed=2048');
  assert.equal(ws.streamSettings.wsSettings.host, 'cdn.example.com');
  assert.deepEqual(ws.streamSettings.tlsSettings.alpn, ['h2', 'http/1.1']);
  const g = toXrayOutbound(parseVless(GRPC));
  assert.equal(g.settings.vnext[0].address, '2001:db8::1');
  assert.equal(g.settings.vnext[0].port, 8443);
  assert.deepEqual(g.streamSettings.grpcSettings, { serviceName: 'gun', multiMode: true });
  const x = toXrayOutbound(parseVless(XHTTP));
  assert.equal(x.streamSettings.network, 'xhttp');
  assert.equal(x.streamSettings.xhttpSettings.mode, 'packet-up');
});

test('config has an internal socks inbound and proxy as default outbound', () => {
  const c = xrayConfig(toXrayOutbound(parseVless(REALITY)));
  assert.equal(c.inbounds[0].protocol, 'socks');
  assert.equal(c.inbounds[0].port, 10808);
  assert.equal(c.outbounds[0].tag, 'proxy');
});

test('subscription in base64 with mixed protocols', () => {
  const body = Buffer.from([REALITY, 'vmess://eyJ2IjoiMiJ9', WS_TLS, 'trojan://p@h:443#t'].join('\n')).toString('base64');
  const sub = parseSubscription(body);
  assert.equal(sub.vless.length, 2);
  assert.deepEqual(sub.other.sort(), ['trojan', 'vmess']);
  assert.equal(parseSubscription(`${REALITY}\n${GRPC}`).vless.length, 2);
});

test('bad input is explained', () => {
  assert.throws(() => parseVless('vmess://abc'), /не VLESS/);
  assert.throws(() => parseVless('ерунда'), /vless/);
  assert.throws(() => toXrayOutbound(parseVless(`vless://${UUID}@h:443?type=kcp`)), /не поддерживается/);
  assert.throws(() => toXrayOutbound(parseVless(`vless://${UUID}@h:443?security=reality&sni=a`)), /pbk/);
});
