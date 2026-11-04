// Превращаем VLESS-ключ (vless://…) в конфиг Xray-клиента с SOCKS5-прокси внутри сервера.
// Нужно, когда Telegram недоступен с сервера напрямую: бот ходит через socks5://xray:10808.

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

export function xrayConfig(outbound, { socksPort = 10808 } = {}) {
  return {
    log: { loglevel: 'warning' },
    inbounds: [{ tag: 'socks-in', listen: '0.0.0.0', port: socksPort, protocol: 'socks', settings: { auth: 'noauth', udp: false } }],
    outbounds: [outbound, { tag: 'direct', protocol: 'freedom' }],
  };
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
