import crypto from 'node:crypto';
import { db, kv, tx } from './db.js';

// Сервер тоже может создавать записи (например, из Telegram-бота).
// Они получают новый seq и при следующей синхронизации приезжают в телефон.

const upsert = db.prepare(`
  INSERT INTO records (tbl, id, data, updated_at, deleted, seq) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(tbl, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at,
    deleted = excluded.deleted, seq = excluded.seq
`);
const getOne = db.prepare('SELECT data, updated_at FROM records WHERE tbl = ? AND id = ?');
const listStmt = db.prepare('SELECT data FROM records WHERE tbl = ? AND deleted = 0 ORDER BY seq');

function putRaw(tbl, data) {
  const id = data.id || crypto.randomUUID();
  const cur = getOne.get(tbl, id);
  const updatedAt = Math.max(Date.now(), (cur?.updated_at || 0) + 1);
  const rec = { ...data, id, updatedAt };
  const seq = kv.get('seq', 0) + 1;
  upsert.run(tbl, id, JSON.stringify(rec), updatedAt, rec.deleted ? 1 : 0, seq);
  kv.set('seq', seq);
  return rec;
}

export function putMany(list) {
  return tx(() => list.map(({ tbl, data }) => ({ tbl, rec: putRaw(tbl, data) })));
}

export function getRecord(tbl, id) {
  const row = getOne.get(tbl, id);
  return row ? JSON.parse(row.data) : null;
}

export function setDeleted(list, deleted) {
  return tx(() => {
    let n = 0;
    for (const { tbl, id } of list) {
      const row = getOne.get(tbl, id);
      if (!row) continue;
      const data = JSON.parse(row.data);
      if (!!data.deleted === deleted) continue;
      putRaw(tbl, { ...data, id, deleted });
      n += 1;
    }
    return n;
  });
}

export function listRecords(tbl) {
  return listStmt.all(tbl).map((r) => JSON.parse(r.data)).filter((r) => !r.deleted);
}
