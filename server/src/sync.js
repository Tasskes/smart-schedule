import crypto from 'node:crypto';
import { db, kv, tx } from './db.js';

// Уникальный id этой базы: если сервер переустановили с нуля, клиент это заметит
// и заново выгрузит всё, что хранится в телефоне.
let serverId = kv.get('serverId');
if (!serverId) {
  serverId = crypto.randomBytes(8).toString('hex');
  kv.set('serverId', serverId);
}

// Таблицы, которые клиент синхронизирует. Сервер хранит записи «как есть» (JSON),
// конфликты решаются по updatedAt (последняя правка побеждает).
export const SYNC_TABLES = new Set([
  'events', 'tasks', 'goals', 'variables', 'routines', 'marks', 'food', 'products',
  'weights', 'fridge', 'rewards', 'ledger', 'chat', 'settings', 'prices', 'notes',
]);

const selectSince = db.prepare(
  'SELECT tbl, id, data, updated_at, deleted FROM records WHERE seq > ? AND seq <= ? ORDER BY seq',
);
const selectOne = db.prepare('SELECT updated_at FROM records WHERE tbl = ? AND id = ?');
const upsert = db.prepare(`
  INSERT INTO records (tbl, id, data, updated_at, deleted, seq) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(tbl, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at,
    deleted = excluded.deleted, seq = excluded.seq
`);

export function applySync({ since = 0, changes = [] }) {
  return tx(() => {
    const seqBefore = kv.get('seq', 0);
    const from = Number.isFinite(Number(since)) ? Number(since) : 0;
    // Изменения, которых у клиента ещё нет (до применения его собственных)
    const pulled = from >= seqBefore ? [] : selectSince.all(from, seqBefore);
    let seq = seqBefore;
    let accepted = 0;
    for (const ch of Array.isArray(changes) ? changes : []) {
      if (!ch || !SYNC_TABLES.has(ch.tbl)) continue;
      if (typeof ch.id !== 'string' || !ch.id || ch.id.length > 200) continue;
      const updatedAt = Number(ch.updatedAt) || 0;
      const current = selectOne.get(ch.tbl, ch.id);
      if (current && current.updated_at > updatedAt) continue; // на сервере новее
      seq += 1;
      upsert.run(ch.tbl, ch.id, JSON.stringify(ch.data ?? {}), updatedAt, ch.deleted ? 1 : 0, seq);
      accepted += 1;
    }
    kv.set('seq', seq);
    return {
      serverId,
      seq,
      accepted,
      changes: pulled.map((r) => ({
        tbl: r.tbl,
        id: r.id,
        data: JSON.parse(r.data),
        updatedAt: r.updated_at,
        deleted: !!r.deleted,
      })),
    };
  });
}

export function syncHandler(req, res) {
  res.json(applySync(req.body || {}));
}
