#!/usr/bin/env node
// Собирает конфиг Xray из VLESS-ключа или ссылки подписки.
// Использование (на сервере):
//   mkdir -p xray
//   docker compose run --rm -T --no-deps app node scripts/vless-to-xray.mjs 'ССЫЛКА_ПОДПИСКИ_или_vless://...' > xray/config.json
// Без номера: пингуем все серверы и включаем автовыбор самого быстрого (Xray переключается сам).
// С номером в конце: используем только этот сервер.
import { parseSubscription, parseVless, rankServers, toXrayOutbound, xrayBalancedConfig, xrayConfig } from '../src/vless.js';

const [input, pick] = process.argv.slice(2);
const log = (...a) => console.error(...a);
const MAX_SERVERS = 20;

async function loadKeys() {
  if (/^vless:\/\//i.test(input)) return [input];
  if (!/^https?:\/\//i.test(input)) throw new Error('Нужен ключ vless://… или ссылка подписки https://…');
  const res = await fetch(input, { headers: { 'User-Agent': 'v2rayN/7.0' } }).catch((e) => {
    throw new Error(`Не удалось скачать подписку: ${e.cause?.code || e.message}`);
  });
  if (!res.ok) throw new Error(`Подписка ответила ${res.status}`);
  const sub = parseSubscription(await res.text());
  if (!sub.vless.length) throw new Error(`В подписке нет VLESS-ключей${sub.other.length ? ` (есть: ${sub.other.join(', ')})` : ''}`);
  return sub.vless;
}

async function main() {
  if (!input) {
    log("Укажи VLESS-ключ или ссылку подписки в кавычках: node scripts/vless-to-xray.mjs 'vless://…' > xray/config.json");
    process.exit(1);
  }
  const keys = await loadKeys();
  const servers = [];
  keys.forEach((k, i) => {
    try {
      const v = parseVless(k);
      toXrayOutbound(v); // проверяем, что ключ поддерживается
      servers.push({ ...v, n: i + 1 });
    } catch (e) {
      log(`  ${i + 1}) пропущен: ${e.message}`);
    }
  });
  if (!servers.length) throw new Error('Ни один ключ не подошёл');

  if (pick) {
    const chosen = servers.find((s) => s.n === Number(pick));
    if (!chosen) throw new Error(`Нет подходящего сервера под номером ${pick}`);
    process.stdout.write(JSON.stringify(xrayConfig(toXrayOutbound(chosen)), null, 2) + '\n');
    log(`Выбран только сервер ${chosen.n}) ${chosen.name}. Для автовыбора запусти команду без номера.`);
    return;
  }

  log(`Проверяю пинг до ${servers.length} серверов…`);
  const ranked = await rankServers(servers);
  for (const r of ranked) {
    const status = r.ms == null ? 'нет ответа' : `${r.ms} мс`;
    log(`  ${String(r.v.n).padStart(2)}) ${r.v.name} — ${status}${r.ru ? ' (Россия — Telegram через него, скорее всего, тоже не откроется)' : ''}`);
  }
  let alive = ranked.filter((r) => r.ms != null);
  if (!alive.length) {
    log('⚠️ Ни один сервер не ответил на пинг — добавляю все, Xray проверит их сам.');
    alive = ranked;
  }
  const use = alive.slice(0, MAX_SERVERS);
  const config = xrayBalancedConfig(use.map((r) => toXrayOutbound(r.v)));
  process.stdout.write(JSON.stringify(config, null, 2) + '\n');
  log(`Готово: в автовыборе ${use.length} серв., самый быстрый сейчас — ${use[0].v.name}.`);
  log('Xray каждые 2 минуты проверяет, через какой сервер Telegram отвечает быстрее, и переключается сам.');
}

main().catch((e) => {
  log(`Ошибка: ${e.message}`);
  process.exit(1);
});
