import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync } from 'fs';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

let db: Db | null = null;

export function getDb(): Db {
  if (!db) throw new Error('Database not initialised. Call initDb() first.');
  return db;
}

/**
 * 获取项目根目录（文件所在位置向上回退 4 层：db/index.ts → core → packages → 项目根）
 */
function getProjectRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // packages/core/src/db/index.ts → 回退到项目根
  return join(__dirname, '../../../..');
}

export function initDb(dbPath?: string): Db {
  // 使用固定路径（项目根目录），替代 process.cwd()
  const path = dbPath ?? join(getProjectRoot(), 'clawgate.db');
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const sqlite = new Database(path);

  // WAL mode for better concurrent read performance
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  db = drizzle(sqlite, { schema });
  migrate(sqlite);
  return db;
}

/**
 * 数据库迁移函数
 * 原则：
 * 1. 使用 CREATE TABLE IF NOT EXISTS —— 首次创建表
 * 2. 使用 ALTER TABLE ADD COLUMN —— 已有表添加新列
 * 3. 绝不删除已有表或数据
 */
function migrate(sqlite: InstanceType<typeof Database>): void {
  // 获取现有表信息（用于判断是否需要迁移）
  const tableInfo = sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type='table'"
  ).all() as { name: string }[];
  const existingTables = new Set(tableInfo.map(t => t.name));

  // 创建表（如果不存在）
  sqlite.exec(`
    -- 核心表：agents
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
      team_id          TEXT NOT NULL,
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
      team_id       TEXT,
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
    CREATE INDEX IF NOT EXISTS idx_dags_team_id ON dags(team_id);

    -- v1.0 团队部署架构表
    CREATE TABLE IF NOT EXISTS teams (
      id        TEXT PRIMARY KEY,
      name      TEXT NOT NULL,
      slug      TEXT NOT NULL UNIQUE,
      owner_id  TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS members (
      id          TEXT PRIMARY KEY,
      team_id     TEXT NOT NULL REFERENCES teams(id),
      email       TEXT NOT NULL,
      name        TEXT,
      role        TEXT NOT NULL DEFAULT 'member',
      api_key     TEXT NOT NULL UNIQUE,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS instances (
      id                 TEXT PRIMARY KEY,
      team_id            TEXT NOT NULL REFERENCES teams(id),
      member_id          TEXT NOT NULL REFERENCES members(id),
      name               TEXT NOT NULL,
      environment        TEXT NOT NULL DEFAULT 'development',
      tags               TEXT,
      gateway_url        TEXT NOT NULL,
      gateway_token      TEXT NOT NULL,
      status             TEXT NOT NULL DEFAULT 'offline',
      last_heartbeat_at  TEXT,
      version            TEXT,
      platform           TEXT,
      pid                INTEGER,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL
    );

    -- v1.0: dags 表添加 team_id（迁移现有表）
    -- SQLite 不支持 ALTER TABLE ADD COLUMN 带外键约束，需重建表
    -- 这里仅创建新表时包含 team_id

    CREATE INDEX IF NOT EXISTS idx_teams_slug ON teams(slug);
    CREATE INDEX IF NOT EXISTS idx_members_api_key ON members(api_key);
    CREATE INDEX IF NOT EXISTS idx_members_team_id ON members(team_id);
    CREATE INDEX IF NOT EXISTS idx_instances_team_id ON instances(team_id);
    CREATE INDEX IF NOT EXISTS idx_instances_environment ON instances(environment);

    -- v1.0 Phase 3: 告警表
    CREATE TABLE IF NOT EXISTS alerts (
      id              TEXT PRIMARY KEY,
      team_id         TEXT NOT NULL REFERENCES teams(id),
      instance_id     TEXT REFERENCES instances(id),
      type            TEXT NOT NULL,
      severity        TEXT NOT NULL,
      message         TEXT NOT NULL,
      details         TEXT,
      acknowledged    INTEGER NOT NULL DEFAULT 0,
      acknowledged_by TEXT,
      acknowledged_at TEXT,
      created_at      TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_alerts_team_id ON alerts(team_id);
    CREATE INDEX IF NOT EXISTS idx_alerts_acknowledged ON alerts(acknowledged);
    CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at);
  `);

  // =========================================================================
  // 列级别迁移（对已存在的表添加新列）
  // =========================================================================

  // v1.0: dags 表添加 team_id 列（如果不存在）
  if (existingTables.has('dags')) {
    try {
      const dagsColumns = sqlite.prepare('PRAGMA table_info(dags)').all() as { name: string }[];
      const hasTeamId = dagsColumns.some(c => c.name === 'team_id');
      if (!hasTeamId) {
        sqlite.exec(`ALTER TABLE dags ADD COLUMN team_id TEXT NOT NULL DEFAULT 'default-team'`);
        console.log('[DB Migration] Added team_id column to dags table');
      }
    } catch (err) {
      console.error('[DB Migration] Failed to add team_id to dags:', err);
    }
  }

  // v0.6: dag_runs 表添加 team_id 列（如果不存在）
  if (existingTables.has('dag_runs')) {
    try {
      const dagRunsColumns = sqlite.prepare('PRAGMA table_info(dag_runs)').all() as { name: string }[];
      const hasTeamId = dagRunsColumns.some(c => c.name === 'team_id');
      if (!hasTeamId) {
        sqlite.exec(`ALTER TABLE dag_runs ADD COLUMN team_id TEXT`);
        console.log('[DB Migration] Added team_id column to dag_runs table');
      }
    } catch (err) {
      console.error('[DB Migration] Failed to add team_id to dag_runs:', err);
    }
  }

  // D1: dags 表添加 cron_timezone 列（如果不存在）
  if (existingTables.has('dags')) {
    try {
      const dagsColumns = sqlite.prepare('PRAGMA table_info(dags)').all() as { name: string }[];
      const hasCronTimezone = dagsColumns.some(c => c.name === 'cron_timezone');
      if (!hasCronTimezone) {
        sqlite.exec(`ALTER TABLE dags ADD COLUMN cron_timezone TEXT`);
        console.log('[DB Migration] Added cron_timezone column to dags table');
      }
    } catch (err) {
      console.error('[DB Migration] Failed to add cron_timezone to dags:', err);
    }
  }

  // =========================================================================
  // 未来迁移模板（复制使用）
  // =========================================================================
  // if (existingTables.has('表名')) {
  //   try {
  //     const columns = sqlite.prepare('PRAGMA table_info(表名)').all() as { name: string }[];
  //     if (!columns.some(c => c.name === '新列名')) {
  //       sqlite.exec(`ALTER TABLE 表名 ADD COLUMN 新列名 类型 约束`);
  //       console.log('[DB Migration] Added 新列名 column to 表名 table');
  //     }
  //   } catch (err) {
  //     console.error('[DB Migration] Failed:', err);
  //   }
  // }
}

export { schema };
