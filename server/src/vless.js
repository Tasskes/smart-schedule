// Превращаем VLESS-ключ (vless://…) в конфиг Xray-клиента с SOCKS5-прокси внутри сервера.
// Нужно, когда Telegram недоступен с сервера напрямую: бот ходит через socks5://xray:10808.
import dns from 'node:dns/promises';
import net from 'node:net';

const SUPPORTED_NETWORKS = new Set(['tcp', 'raw', 'ws', 'grpc', 'httpupgrade', 'xhttp', 'splithttp', 'h2', 'http']);

export function parseVless(uri) {
  let u;
  try {
    u = new URL(String(uri).trim());
  } catch {
    throw new Error('Не похоже на ключ vless://…');
  }
  if (u.protocol !== 'vless:') throw new Error(`Это не VLESS-ключ (${u.protocol.replace(':', '')})`);
  const id = decodeURIComponent(u.username || '');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!id || !host) throw new Error('В ключе нет id или адреса сервера');
  const q = u.searchParams;
  const get = (k) => (q.get(k) || '').trim();
  return {
    name: decodeURIComponent(u.hash.replace(/^#/, '')) || `${host}:${u.port || 443}`,
    id,
    host,
    port: Number(u.port || 443),
    type: (get('type') || 'tcp').toLowerCase(),
    security: (get('security') || 'none').toLowerCase(),
    encryption: get('encryption') || 'none',
    flow: get('flow'),
    sni: get('sni') || get('peer'),
    fp: get('fp'),
    alpn: get('alpn'),
    pbk: get('pbk'),
    sid: get('sid'),
    spx: get('spx'),
    path: get('path'),
    hostHeader: get('host'),
    serviceName: get('serviceName'),
    mode: get('mode'),
    headerType: get('headerType'),
    allowInsecure: get('allowInsecure') === '1' || get('insecure') === '1',
  };
}

export function toXrayOutbound(v) {
  if (!SUPPORTED_NETWORKS.has(v.type)) throw new Error(`Тип соединения «${v.type}» пока не поддерживается`);
  const network = v.type === 'raw' ? 'tcp' : v.type === 'splithttp' ? 'xhttp' : v.type === 'h2' ? 'http' : v.type;
  const stream = { network, security: v.security === 'xtls' ? 'tls' : v.security };
  if (stream.security === 'reality') {
    if (!v.pbk) throw new Error('В ключе REALITY нет публичного ключа (pbk)');
    stream.realitySettings = {
      serverName: v.sni,
      fingerprint: v.fp || 'chrome',
      publicKey: v.pbk,
      shortId: v.sid,
      spiderX: v.spx || '',
    };
  } else if (stream.security === 'tls') {
    stream.tlsSettings = {
      serverName: v.sni || v.hostHeader || v.host,
      ...(v.fp ? { fingerprint: v.fp } : {}),
      ...(v.alpn ? { alpn: v.alpn.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
      ...(v.allowInsecure ? { allowInsecure: true } : {}),
    };
  } else if (stream.security !== 'none') {
    throw new Error(`Шифрование «${v.security}» не поддерживается`);
  }
  if (network === 'ws') stream.wsSettings = { path: v.path || '/', ...(v.hostHeader ? { host: v.hostHeader } : {}) };
  if (network === 'grpc') stream.grpcSettings = { serviceName: v.serviceName || '', multiMode: v.mode === 'multi' };
  if (network === 'httpupgrade') stream.httpupgradeSettings = { path: v.path || '/', ...(v.hostHeader ? { host: v.hostHeader } : {}) };
  if (network === 'xhttp') stream.xhttpSettings = { path: v.path || '/', ...(v.hostHeader ? { host: v.hostHeader } : {}), mode: v.mode || 'auto' };
  if (network === 'http') stream.httpSettings = { path: v.path || '/', ...(v.hostHeader ? { host: v.hostHeader.split(',') } : {}) };
  if (network === 'tcp' && v.headerType === 'http') {
    stream.tcpSettings = {
      header: { type: 'http', request: { path: [v.path || '/'], headers: v.hostHeader ? { Host: v.hostHeader.split(',') } : {} } },
    };
  }
  return {
    tag: 'proxy',
    protocol: 'vless',
    settings: {
      vnext: [{ address: v.host, port: v.port, users: [{ id: v.id, encryption: v.encryption || 'none', ...(v.flow ? { flow: v.flow } : {}) }] }],
    },
    streamSettings: stream,
  };
}

const SOCKS_IN = (port) => ({ tag: 'socks-in', listen: '0.0.0.0', port, protocol: 'socks', settings: { auth: 'noauth', udp: false } });

export function xrayConfig(outbound, { socksPort = 10808 } = {}) {
  return {
    log: { loglevel: 'warning' },
    inbounds: [SOCKS_IN(socksPort)],
    outbounds: [outbound, { tag: 'direct', protocol: 'freedom' }],
  };
}

/**
 * Несколько серверов + автовыбор: Xray сам раз в probeInterval проверяет каждый сервер запросом
 * к probeURL (по умолчанию — Telegram API) и шлёт трафик через самый быстрый из рабочих (leastPing).
 * Если ни один не ответил — используется fallback (лучший по пингу при сборке конфига).
 */
export function xrayBalancedConfig(outbounds, { socksPort = 10808, probeURL = 'https://api.telegram.org/', probeInterval = '2m' } = {}) {
  if (!outbounds.length) throw new Error('Нет серверов для конфига');
  const tagged = outbounds.map((o, i) => ({ ...o, tag: `proxy-${i + 1}` }));
  return {
    log: { loglevel: 'warning' },
    inbounds: [SOCKS_IN(socksPort)],
    outbounds: [...tagged, { tag: 'direct', protocol: 'freedom' }],
    observatory: { subjectSelector: ['proxy-'], probeURL, probeInterval, enableConcurrency: true },
    routing: {
      domainStrategy: 'AsIs',
      balancers: [{ tag: 'auto', selector: ['proxy-'], strategy: { type: 'leastPing' }, fallbackTag: tagged[0].tag }],
      rules: [{ type: 'field', inboundTag: ['socks-in'], balancerTag: 'auto' }],
    },
  };
}

/** «Пинг» до сервера: время установки TCP-соединения с его портом (ICMP часто закрыт). Возвращает мс или null. */
export async function tcpPing(host, port, { attempts = 3, timeoutMs = 2500 } = {}) {
  let address = host;
  if (!net.isIP(host)) {
    try {
      address = (await dns.lookup(host)).address;
    } catch {
      return null;
    }
  }
  const times = [];
  for (let i = 0; i < attempts; i += 1) {
    const t = await new Promise((resolve) => {
      const start = process.hrtime.bigint();
      const sock = net.connect({ host: address, port });
      const done = (val) => {
        sock.destroy();
        resolve(val);
      };
      sock.setTimeout(timeoutMs, () => done(null));
      sock.once('connect', () => done(Number(process.hrtime.bigint() - start) / 1e6));
      sock.once('error', () => done(null));
    });
    if (t != null) times.push(t);
  }
  if (!times.length) return null;
  return Math.round(Math.min(...times));
}

const RU_RE = /\u{1F1F7}\u{1F1FA}|росси|russia|москв|moscow|петербург|\bспб\b|\bru\b/iu;
export const looksRussian = (name) => RU_RE.test(String(name || ''));

/** Пингуем все серверы параллельно и сортируем: сначала рабочие зарубежные, по возрастанию пинга */
export async function rankServers(servers, opts) {
  const pinged = await Promise.all(servers.map(async (v) => ({ v, ms: await tcpPing(v.host, v.port, opts), ru: looksRussian(v.name) })));
  return pinged.sort((a, b) => {
    if ((a.ms == null) !== (b.ms == null)) return a.ms == null ? 1 : -1;
    if (a.ru !== b.ru) return a.ru ? 1 : -1;
    return (a.ms ?? 1e9) - (b.ms ?? 1e9);
  });
}

/** Подписка — это base64 или обычный текст со списком ключей по одному в строке */
export function parseSubscription(body) {
  let text = String(body || '').trim();
  if (!text.includes('://')) {
    const decoded = Buffer.from(text.replace(/\s+/g, ''), 'base64').toString('utf8');
    if (decoded.includes('://')) text = decoded;
  }
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return {
    vless: lines.filter((s) => s.startsWith('vless://')),
    other: [...new Set(lines.filter((s) => /^[a-z0-9]+:\/\//i.test(s) && !s.startsWith('vless://')).map((s) => s.split('://')[0]))],
  };
}
