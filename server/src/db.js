import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, 'app.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS records (
    tbl TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    seq INTEGER NOT NULL,
    PRIMARY KEY (tbl, id)
  );
  CREATE INDEX IF NOT EXISTS records_seq ON records(seq);
  CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS sent (key TEXT PRIMARY KEY, ts INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS ai_usage (
    day TEXT NOT NULL, model TEXT NOT NULL,
    input INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, model)
  );
  CREATE TABLE IF NOT EXISTS schedule_changes (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, data TEXT NOT NULL);
`);

const getStmt = db.prepare('SELECT v FROM kv WHERE k = ?');
const setStmt = db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v');

export const kv = {
  get(key, fallback = undefined) {
    const row = getStmt.get(key);
    if (!row) return fallback;
    try {
      return JSON.parse(row.v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    setStmt.run(key, JSON.stringify(value));
  },
};

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
