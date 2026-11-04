#!/usr/bin/env node
// Собирает конфиг Xray из VLESS-ключа или ссылки подписки.
// Использование (на сервере):
//   mkdir -p xray
//   docker compose run --rm -T --no-deps app node scripts/vless-to-xray.mjs 'ССЫЛКА_ПОДПИСКИ_или_vless://...' [номер] > xray/config.json
// Список серверов из подписки печатается в консоль; без номера берётся первый.
import { parseSubscription, parseVless, toXrayOutbound, xrayConfig } from '../src/vless.js';

const [input, pick] = process.argv.slice(2);
const log = (...a) => console.error(...a);

async function main() {
  if (!input) {
    log("Укажи VLESS-ключ или ссылку подписки в кавычках: node scripts/vless-to-xray.mjs 'vless://…' > xray/config.json");
    process.exit(1);
  }
  let keys;
  if (/^vless:\/\//i.test(input)) {
    keys = [input];
  } else if (/^https?:\/\//i.test(input)) {
    const res = await fetch(input, { headers: { 'User-Agent': 'v2rayN/7.0' } }).catch((e) => {
      throw new Error(`Не удалось скачать подписку: ${e.cause?.code || e.message}`);
    });
    if (!res.ok) throw new Error(`Подписка ответила ${res.status}`);
    const sub = parseSubscription(await res.text());
    if (!sub.vless.length) {
      throw new Error(`В подписке нет VLESS-ключей${sub.other.length ? ` (есть: ${sub.other.join(', ')})` : ''}`);
    }
    keys = sub.vless;
  } else {
    throw new Error('Нужен ключ vless://… или ссылка подписки https://…');
  }

  const parsed = keys.map((k) => {
    try {
      return { ok: true, v: parseVless(k) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  log('Серверы:');
  parsed.forEach((p, i) => log(`  ${i + 1}) ${p.ok ? `${p.v.name} — ${p.v.host}:${p.v.port} (${p.v.security}/${p.v.type})` : `ошибка: ${p.error}`}`));
  const index = pick ? Number(pick) - 1 : parsed.findIndex((p) => p.ok);
  const chosen = parsed[index];
  if (!chosen || !chosen.ok) throw new Error(`Нет подходящего сервера под номером ${pick || 1}`);
  const config = xrayConfig(toXrayOutbound(chosen.v));
  process.stdout.write(JSON.stringify(config, null, 2) + '\n');
  log(`Выбран: ${index + 1}) ${chosen.v.name}. Конфиг записан. Другой сервер — добавь его номер в конце команды.`);
}

main().catch((e) => {
  log(`Ошибка: ${e.message}`);
  process.exit(1);
});
