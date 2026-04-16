import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

let db: Db | null = null;

export function getDb(): Db {
  if (!db) throw new Error('Database not initialised. Call initDb() first.');
  return db;
}

export function initDb(dbPath?: string): Db {
  const path = dbPath ?? join(process.cwd(), 'clawgate.db');
  const dir = join(path, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const sqlite = new Database(path);

  // WAL mode for better concurrent read performance
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  db = drizzle(sqlite, { schema });
  migrate(sqlite);
  return db;
}

function migrate(sqlite: InstanceType<typeof Database>): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      config_path TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'unknown',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      key          TEXT PRIMARY KEY,
      agent_id     TEXT NOT NULL,
      session_id   TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'active',
      token_input  INTEGER NOT NULL DEFAULT 0,
      token_output INTEGER NOT NULL DEFAULT 0,
      model        TEXT,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS costs (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      date           TEXT NOT NULL,
      model          TEXT NOT NULL,
      provider       TEXT NOT NULL,
      token_input    INTEGER NOT NULL DEFAULT 0,
      token_output   INTEGER NOT NULL DEFAULT 0,
      estimated_usd  REAL NOT NULL DEFAULT 0,
      created_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS routing_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_key TEXT,
      prompt      TEXT NOT NULL,
      layer       TEXT NOT NULL,
      model       TEXT NOT NULL,
      cache_hit   INTEGER NOT NULL DEFAULT 0,
      latency_ms  REAL NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dags (
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      definition       TEXT NOT NULL,
      trigger          TEXT NOT NULL DEFAULT 'manual',
      cron_expression  TEXT,
      enabled          INTEGER NOT NULL DEFAULT 1,
      webhook_token    TEXT,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dag_runs (
      id            TEXT PRIMARY KEY,
      dag_id        TEXT NOT NULL REFERENCES dags(id),
      status        TEXT NOT NULL DEFAULT 'pending',
      triggered_by  TEXT NOT NULL DEFAULT 'manual',
      output        TEXT,
      error         TEXT,
      started_at    TEXT,
      ended_at      TEXT,
      created_at    TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON sessions(agent_id);
    CREATE INDEX IF NOT EXISTS idx_costs_date ON costs(date);
    CREATE INDEX IF NOT EXISTS idx_routing_logs_session_key ON routing_logs(session_key);
    CREATE INDEX IF NOT EXISTS idx_dag_runs_dag_id ON dag_runs(dag_id);
    CREATE INDEX IF NOT EXISTS idx_dags_trigger_enabled ON dags(trigger, enabled);

    CREATE TABLE IF NOT EXISTS dag_node_states (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id       TEXT NOT NULL,
      node_id      TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      output       TEXT,
      error        TEXT,
      started_at   TEXT,
      ended_at     TEXT,
      created_at   TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_node_states_run_id ON dag_node_states(run_id);
    CREATE INDEX IF NOT EXISTS idx_node_states_run_node ON dag_node_states(run_id, node_id);
  `);
}

export { schema };
