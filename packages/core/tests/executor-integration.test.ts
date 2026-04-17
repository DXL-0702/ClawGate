/**
 * DAG 执行器集成测试
 *
 * 使用内存 SQLite + Mock GatewayClient 验证 executeDagRun() 核心逻辑。
 * 覆盖 6 个场景：线性链、Diamond 并行、失败中断、循环依赖、单节点、变量边界。
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema.js';
import { executeDagRun, type DagRunParams } from '../src/dag/executor.js';
import type { GatewayClient } from '../src/gateway/index.js';

// ── 测试基础设施 ──────────────────────────────────────────────────

type TestDb = BetterSQLite3Database<typeof schema>;

/** 创建内存 SQLite + 表结构 */
function createTestDb(): TestDb {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = OFF'); // 测试环境不需要外键约束

  sqlite.exec(`
    CREATE TABLE dags (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, team_id TEXT NOT NULL,
      definition TEXT NOT NULL, trigger TEXT NOT NULL DEFAULT 'manual',
      cron_expression TEXT, enabled INTEGER NOT NULL DEFAULT 1,
      webhook_token TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE dag_runs (
      id TEXT PRIMARY KEY, dag_id TEXT NOT NULL, team_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending', triggered_by TEXT NOT NULL DEFAULT 'manual',
      output TEXT, error TEXT, started_at TEXT, ended_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE dag_node_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL,
      node_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      output TEXT, error TEXT, started_at TEXT, ended_at TEXT, created_at TEXT NOT NULL
    );
  `);

  return drizzle(sqlite, { schema });
}

/** 创建 dag_runs 初始记录（模拟 server route 的 INSERT） */
function seedDagRun(db: TestDb, runId: string, dagId: string): void {
  db.insert(schema.dagRuns).values({
    id: runId,
    dagId,
    status: 'pending',
    triggeredBy: 'manual',
    createdAt: new Date().toISOString(),
  }).run();
}

/** 查询所有节点状态 */
function getNodeStates(db: TestDb, runId: string) {
  return db
    .select({
      nodeId: schema.dagNodeStates.nodeId,
      status: schema.dagNodeStates.status,
      output: schema.dagNodeStates.output,
      error: schema.dagNodeStates.error,
    })
    .from(schema.dagNodeStates)
    .where(eq(schema.dagNodeStates.runId, runId))
    .all();
}

/** 查询 run 记录 */
function getDagRun(db: TestDb, runId: string) {
  const [run] = db
    .select()
    .from(schema.dagRuns)
    .where(eq(schema.dagRuns.id, runId))
    .all();
  return run;
}

// ── Mock GatewayClient ────────────────────────────────────────────

interface MockGateway {
  createSession: MockedFunction<(agentId: string) => Promise<{ key: string }>>;
  sendMessage: MockedFunction<(sessionKey: string, content: string) => Promise<void>>;
  abortSession: MockedFunction<(sessionKey: string) => Promise<void>>;
  onEvent: MockedFunction<(event: string, listener: (data: unknown) => void) => () => void>;
  emitEvent: (event: string, data: unknown) => void;
}

/**
 * 创建自动回复的 Mock Gateway
 * sendMessage 被调用后自动触发 session.message + session.end，
 * 回复内容为 `output:{prompt前20字符}`，模拟真实 Agent 响应。
 */
function createAutoReplyGateway(): MockGateway {
  const eventListeners = new Map<string, Array<(data: unknown) => void>>();
  let sessionCounter = 0;

  const gw: MockGateway = {
    createSession: vi.fn(async (_agentId: string) => {
      sessionCounter++;
      return { key: `agent:session-${sessionCounter}` };
    }),
    sendMessage: vi.fn(async (sessionKey: string, content: string) => {
      // 异步触发回复（模拟 WebSocket 延迟）
      setTimeout(() => {
        const reply = `output:${content.slice(0, 40)}`;
        gw.emitEvent('session.message', { key: sessionKey, content: reply });
        gw.emitEvent('session.end', { key: sessionKey });
      }, 5);
    }),
    abortSession: vi.fn(async () => {}),
    onEvent: vi.fn((event: string, listener: (data: unknown) => void) => {
      if (!eventListeners.has(event)) eventListeners.set(event, []);
      eventListeners.get(event)!.push(listener);
      return () => {
        const arr = eventListeners.get(event) ?? [];
        const idx = arr.indexOf(listener);
        if (idx !== -1) arr.splice(idx, 1);
      };
    }),
    emitEvent: (event: string, data: unknown) => {
      for (const fn of eventListeners.get(event) ?? []) fn(data);
    },
  };

  return gw;
}

/**
 * 创建指定节点失败的 Mock Gateway
 * failNodeId 对应的节点 sendMessage 时触发 createSession 失败。
 */
function createFailingGateway(failNodePromptPrefix: string): MockGateway {
  const gw = createAutoReplyGateway();
  const originalSendMessage = gw.sendMessage.getMockImplementation()!;

  gw.sendMessage.mockImplementation(async (sessionKey: string, content: string) => {
    if (content.startsWith(failNodePromptPrefix)) {
      // 模拟执行失败：不发 session.end，而是让 createSession 正常但执行超时
      // 改为直接 throw 以快速失败
      throw new Error(`Execution failed: ${failNodePromptPrefix}`);
    }
    return originalSendMessage(sessionKey, content);
  });

  return gw;
}

// ── 测试用例 ──────────────────────────────────────────────────────

describe('executeDagRun — integration', () => {
  let db: TestDb;
  let gateway: MockGateway;

  beforeEach(() => {
    db = createTestDb();
    gateway = createAutoReplyGateway();
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────────────────────────
  // 场景 1: 线性链 A → B → C（变量替换 + 顺序执行）
  // ────────────────────────────────────────────────────────────────
  it('场景1: 线性链 A→B→C，变量正确传递，状态全部 completed', async () => {
    const runId = 'run-linear';
    const dagId = 'dag-linear';
    seedDagRun(db, runId, dagId);

    const definition: DagRunParams['definition'] = {
      nodes: [
        { id: 'A', type: 'agent', agentId: 'main', prompt: '分析代码复杂度' },
        { id: 'B', type: 'agent', agentId: 'main', prompt: '基于 {{A.output}} 优化' },
        { id: 'C', type: 'agent', agentId: 'main', prompt: '报告: {{A.output}} + {{B.output}}' },
      ],
      edges: [
        { id: 'e1', source: 'A', target: 'B' },
        { id: 'e2', source: 'B', target: 'C' },
      ],
    };

    const result = await executeDagRun({
      runId, definition,
      gateway: gateway as unknown as GatewayClient,
      db,
    });

    // 1. run 状态
    expect(result.status).toBe('completed');

    // 2. 所有节点 completed
    const states = getNodeStates(db, runId);
    expect(states).toHaveLength(3);
    for (const s of states) {
      expect(s.status).toBe('completed');
      expect(s.output).toBeTruthy();
    }

    // 3. 变量替换验证：B 的 prompt 应包含 A 的输出
    const sendCalls = gateway.sendMessage.mock.calls;
    expect(sendCalls).toHaveLength(3);

    // A 的 prompt 原样
    expect(sendCalls[0]![1]).toBe('分析代码复杂度');
    // B 的 prompt 应已替换 {{A.output}}
    expect(sendCalls[1]![1]).toContain('output:');
    expect(sendCalls[1]![1]).not.toContain('{{A.output}}');
    // C 的 prompt 应已替换 {{A.output}} 和 {{B.output}}
    expect(sendCalls[2]![1]).not.toContain('{{A.output}}');
    expect(sendCalls[2]![1]).not.toContain('{{B.output}}');

    // 4. dag_runs 记录更新
    const run = getDagRun(db, runId);
    expect(run?.status).toBe('completed');
    expect(run?.output).toBeTruthy();
    expect(run?.endedAt).toBeTruthy();
  });

  // ────────────────────────────────────────────────────────────────
  // 场景 2: Diamond 并行结构 A → [B, C] → D
  // ────────────────────────────────────────────────────────────────
  it('场景2: Diamond 并行批次，B/C 同批执行，D 等待汇聚', async () => {
    const runId = 'run-diamond';
    const dagId = 'dag-diamond';
    seedDagRun(db, runId, dagId);

    const definition: DagRunParams['definition'] = {
      nodes: [
        { id: 'A', type: 'agent', agentId: 'main', prompt: '入口任务' },
        { id: 'B', type: 'agent', agentId: 'main', prompt: '分支1: {{A.output}}' },
        { id: 'C', type: 'agent', agentId: 'main', prompt: '分支2: {{A.output}}' },
        { id: 'D', type: 'agent', agentId: 'main', prompt: '汇聚: {{B.output}} + {{C.output}}' },
      ],
      edges: [
        { id: 'e1', source: 'A', target: 'B' },
        { id: 'e2', source: 'A', target: 'C' },
        { id: 'e3', source: 'B', target: 'D' },
        { id: 'e4', source: 'C', target: 'D' },
      ],
    };

    const result = await executeDagRun({
      runId, definition,
      gateway: gateway as unknown as GatewayClient,
      db,
    });

    expect(result.status).toBe('completed');

    const states = getNodeStates(db, runId);
    expect(states).toHaveLength(4);
    for (const s of states) {
      expect(s.status).toBe('completed');
    }

    // D 的 prompt 应包含 B 和 C 的输出（变量已替换）
    const dCall = gateway.sendMessage.mock.calls[3]; // A=0, B/C=1&2(并行), D=3
    expect(dCall![1]).not.toContain('{{B.output}}');
    expect(dCall![1]).not.toContain('{{C.output}}');

    // dag_runs 最终输出应为 D 的输出
    const run = getDagRun(db, runId);
    expect(run?.status).toBe('completed');
  });

  // ────────────────────────────────────────────────────────────────
  // 场景 3: 失败中断，后续节点自动 skipped
  // ────────────────────────────────────────────────────────────────
  it('场景3: node-B 失败 → node-C 自动 skipped', async () => {
    const runId = 'run-fail';
    const dagId = 'dag-fail';
    seedDagRun(db, runId, dagId);

    const failGw = createFailingGateway('FAIL_THIS');

    const definition: DagRunParams['definition'] = {
      nodes: [
        { id: 'A', type: 'agent', agentId: 'main', prompt: '正常任务' },
        { id: 'B', type: 'agent', agentId: 'main', prompt: 'FAIL_THIS 触发失败' },
        { id: 'C', type: 'agent', agentId: 'main', prompt: '不应被执行' },
      ],
      edges: [
        { id: 'e1', source: 'A', target: 'B' },
        { id: 'e2', source: 'B', target: 'C' },
      ],
    };

    const result = await executeDagRun({
      runId, definition,
      gateway: failGw as unknown as GatewayClient,
      db,
    });

    expect(result.status).toBe('failed');
    expect(result.failedNodeId).toBe('B');

    const states = getNodeStates(db, runId);
    const stateMap = new Map(states.map((s) => [s.nodeId, s]));

    expect(stateMap.get('A')?.status).toBe('completed');
    expect(stateMap.get('B')?.status).toBe('failed');
    expect(stateMap.get('B')?.error).toContain('FAIL_THIS');
    expect(stateMap.get('C')?.status).toBe('skipped');

    // dag_runs 记录
    const run = getDagRun(db, runId);
    expect(run?.status).toBe('failed');
    expect(run?.error).toContain('Node "B" failed');
  });

  // ────────────────────────────────────────────────────────────────
  // 场景 4: 循环依赖检测 A → B → A
  // ────────────────────────────────────────────────────────────────
  it('场景4: 循环依赖，run 标记 failed，error 包含循环信息', async () => {
    const runId = 'run-cycle';
    const dagId = 'dag-cycle';
    seedDagRun(db, runId, dagId);

    const definition: DagRunParams['definition'] = {
      nodes: [
        { id: 'A', type: 'agent', agentId: 'main', prompt: '任务A' },
        { id: 'B', type: 'agent', agentId: 'main', prompt: '任务B' },
      ],
      edges: [
        { id: 'e1', source: 'A', target: 'B' },
        { id: 'e2', source: 'B', target: 'A' },
      ],
    };

    const result = await executeDagRun({
      runId, definition,
      gateway: gateway as unknown as GatewayClient,
      db,
    });

    expect(result.status).toBe('failed');

    // dag_runs 记录标记 failed，error 包含拓扑错误
    const run = getDagRun(db, runId);
    expect(run?.status).toBe('failed');
    expect(run?.error).toContain('topology error');
    expect(run?.error).toContain('cycle');

    // gateway 不应被调用（循环在执行前检测到）
    expect(gateway.createSession).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────────
  // 场景 5: 单节点 DAG（无 edges）
  // ────────────────────────────────────────────────────────────────
  it('场景5: 单节点无 edges，正常执行并 completed', async () => {
    const runId = 'run-single';
    const dagId = 'dag-single';
    seedDagRun(db, runId, dagId);

    const definition: DagRunParams['definition'] = {
      nodes: [
        { id: 'only', type: 'agent', agentId: 'main', prompt: '唯一节点' },
      ],
      // 无 edges
    };

    const result = await executeDagRun({
      runId, definition,
      gateway: gateway as unknown as GatewayClient,
      db,
    });

    expect(result.status).toBe('completed');

    const states = getNodeStates(db, runId);
    expect(states).toHaveLength(1);
    expect(states[0]!.status).toBe('completed');
    expect(states[0]!.output).toContain('output:');

    const run = getDagRun(db, runId);
    expect(run?.status).toBe('completed');
    expect(run?.output).toBeTruthy();
  });

  // ────────────────────────────────────────────────────────────────
  // 场景 6: 变量替换边界 — 未知变量原样保留
  // ────────────────────────────────────────────────────────────────
  it('场景6: 引用不存在的节点变量，原样保留不报错', async () => {
    const runId = 'run-varbound';
    const dagId = 'dag-varbound';
    seedDagRun(db, runId, dagId);

    const definition: DagRunParams['definition'] = {
      nodes: [
        { id: 'X', type: 'agent', agentId: 'main', prompt: '正常 + {{NONEXIST.output}} 保留' },
      ],
    };

    const result = await executeDagRun({
      runId, definition,
      gateway: gateway as unknown as GatewayClient,
      db,
    });

    expect(result.status).toBe('completed');

    // sendMessage 收到的 prompt 应保留 {{NONEXIST.output}}
    const sentPrompt = gateway.sendMessage.mock.calls[0]![1];
    expect(sentPrompt).toContain('{{NONEXIST.output}}');
  });

  // ────────────────────────────────────────────────────────────────
  // 场景 7: 10 节点长链路稳定性
  // ────────────────────────────────────────────────────────────────
  it('场景7: 10 节点线性链，执行顺序正确，无状态泄漏', async () => {
    const runId = 'run-long-chain';
    const dagId = 'dag-long-chain';
    seedDagRun(db, runId, dagId);

    const count = 10;
    const nodes = Array.from({ length: count }, (_, i) => ({
      id: `n${i}`,
      type: 'agent' as const,
      agentId: 'main',
      prompt: i === 0
        ? `Step-0 start`
        : `Step-${i} prev={{n${i - 1}.output}}`,
    }));

    const edges = Array.from({ length: count - 1 }, (_, i) => ({
      id: `e${i}`,
      source: `n${i}`,
      target: `n${i + 1}`,
    }));

    const result = await executeDagRun({
      runId,
      definition: { nodes, edges },
      gateway: gateway as unknown as GatewayClient,
      db,
    });

    expect(result.status).toBe('completed');

    // 全部 10 节点 completed
    const states = getNodeStates(db, runId);
    expect(states).toHaveLength(count);
    for (const s of states) {
      expect(s.status).toBe('completed');
      expect(s.output).toBeTruthy();
    }

    // 执行顺序验证：sendMessage 按 n0→n1→...→n9 严格顺序调用
    const calls = gateway.sendMessage.mock.calls;
    expect(calls).toHaveLength(count);
    expect(calls[0]![1]).toBe('Step-0 start');

    // 每个后续节点的 prompt 应包含上游输出（变量已替换）
    for (let i = 1; i < count; i++) {
      const prompt = calls[i]![1] as string;
      expect(prompt).toContain(`Step-${i}`);
      expect(prompt).not.toContain(`{{n${i - 1}.output}}`); // 变量已替换
      expect(prompt).toContain('output:'); // 包含上游 mock 输出
    }

    // dag_runs 最终输出为最后节点输出
    const run = getDagRun(db, runId);
    expect(run?.status).toBe('completed');
    expect(run?.output).toBeTruthy();
    expect(run?.endedAt).toBeTruthy();
  });

  // ────────────────────────────────────────────────────────────────
  // 场景 8: 条件 true 分支 — A→COND→B(true), C(false)
  // ────────────────────────────────────────────────────────────────
  it('场景8: 条件 true 分支，B=completed, C=skipped', async () => {
    const runId = 'run-cond-true';
    const dagId = 'dag-cond-true';
    seedDagRun(db, runId, dagId);

    const definition: DagRunParams['definition'] = {
      nodes: [
        { id: 'A', type: 'agent', agentId: 'main', prompt: '生成结果' },
        { id: 'COND', type: 'condition', expression: { left: '{{A.output}}', operator: 'not_empty' } },
        { id: 'B', type: 'agent', agentId: 'main', prompt: 'True 分支: {{A.output}}' },
        { id: 'C', type: 'agent', agentId: 'main', prompt: 'False 分支: 不应执行' },
      ],
      edges: [
        { id: 'e1', source: 'A', target: 'COND' },
        { id: 'e2', source: 'COND', target: 'B', sourceHandle: 'true' },
        { id: 'e3', source: 'COND', target: 'C', sourceHandle: 'false' },
      ],
    };

    const result = await executeDagRun({
      runId, definition,
      gateway: gateway as unknown as GatewayClient,
      db,
    });

    expect(result.status).toBe('completed');

    const states = getNodeStates(db, runId);
    const stateMap = new Map(states.map((s) => [s.nodeId, s]));

    expect(stateMap.get('A')?.status).toBe('completed');
    expect(stateMap.get('COND')?.status).toBe('completed');
    expect(stateMap.get('COND')?.output).toBe('true');
    expect(stateMap.get('B')?.status).toBe('completed');
    expect(stateMap.get('C')?.status).toBe('skipped');

    // 最终输出应为 B 的输出（非 condition 节点）
    const run = getDagRun(db, runId);
    expect(run?.status).toBe('completed');
    expect(run?.output).toBeTruthy();
  });

  // ────────────────────────────────────────────────────────────────
  // 场景 9: 条件 false 分支 — expression 取反
  // ────────────────────────────────────────────────────────────────
  it('场景9: 条件 false 分支，B=skipped, C=completed', async () => {
    const runId = 'run-cond-false';
    const dagId = 'dag-cond-false';
    seedDagRun(db, runId, dagId);

    const definition: DagRunParams['definition'] = {
      nodes: [
        { id: 'A', type: 'agent', agentId: 'main', prompt: '生成结果' },
        { id: 'COND', type: 'condition', expression: { left: '{{A.output}}', operator: 'empty' } },
        { id: 'B', type: 'agent', agentId: 'main', prompt: 'True 分支: 不应执行' },
        { id: 'C', type: 'agent', agentId: 'main', prompt: 'False 分支: {{A.output}}' },
      ],
      edges: [
        { id: 'e1', source: 'A', target: 'COND' },
        { id: 'e2', source: 'COND', target: 'B', sourceHandle: 'true' },
        { id: 'e3', source: 'COND', target: 'C', sourceHandle: 'false' },
      ],
    };

    const result = await executeDagRun({
      runId, definition,
      gateway: gateway as unknown as GatewayClient,
      db,
    });

    expect(result.status).toBe('completed');

    const states = getNodeStates(db, runId);
    const stateMap = new Map(states.map((s) => [s.nodeId, s]));

    // A 的输出非空 → empty 为 false → B(true)=skipped, C(false)=completed
    expect(stateMap.get('A')?.status).toBe('completed');
    expect(stateMap.get('COND')?.status).toBe('completed');
    expect(stateMap.get('COND')?.output).toBe('false');
    expect(stateMap.get('B')?.status).toBe('skipped');
    expect(stateMap.get('C')?.status).toBe('completed');
  });

  // ────────────────────────────────────────────────────────────────
  // 场景 10: 跳过传播 — A→COND→B(true)→D, COND→C(false)→E
  // ────────────────────────────────────────────────────────────────
  it('场景10: 跳过沿链传播，C=skipped → E=skipped', async () => {
    const runId = 'run-skip-propagation';
    const dagId = 'dag-skip-prop';
    seedDagRun(db, runId, dagId);

    const definition: DagRunParams['definition'] = {
      nodes: [
        { id: 'A', type: 'agent', agentId: 'main', prompt: '入口' },
        { id: 'COND', type: 'condition', expression: { left: '{{A.output}}', operator: 'not_empty' } },
        { id: 'B', type: 'agent', agentId: 'main', prompt: 'True 路径' },
        { id: 'C', type: 'agent', agentId: 'main', prompt: 'False 路径' },
        { id: 'D', type: 'agent', agentId: 'main', prompt: '继续 True: {{B.output}}' },
        { id: 'E', type: 'agent', agentId: 'main', prompt: '继续 False: {{C.output}}' },
      ],
      edges: [
        { id: 'e1', source: 'A', target: 'COND' },
        { id: 'e2', source: 'COND', target: 'B', sourceHandle: 'true' },
        { id: 'e3', source: 'COND', target: 'C', sourceHandle: 'false' },
        { id: 'e4', source: 'B', target: 'D' },
        { id: 'e5', source: 'C', target: 'E' },
      ],
    };

    const result = await executeDagRun({
      runId, definition,
      gateway: gateway as unknown as GatewayClient,
      db,
    });

    expect(result.status).toBe('completed');

    const states = getNodeStates(db, runId);
    const stateMap = new Map(states.map((s) => [s.nodeId, s]));

    // not_empty(A.output) = true → B active, C skipped
    expect(stateMap.get('A')?.status).toBe('completed');
    expect(stateMap.get('COND')?.status).toBe('completed');
    expect(stateMap.get('B')?.status).toBe('completed');
    expect(stateMap.get('C')?.status).toBe('skipped');
    expect(stateMap.get('D')?.status).toBe('completed');
    // E 的唯一入边来自 C（已 skipped）→ E 也 skipped
    expect(stateMap.get('E')?.status).toBe('skipped');
  });

  // ────────────────────────────────────────────────────────────────
  // 场景 11: contains 运算符 — 正确路由
  // ────────────────────────────────────────────────────────────────
  it('场景11: contains 运算符，正确路由到 ErrorHandler', async () => {
    const runId = 'run-contains';
    const dagId = 'dag-contains';
    seedDagRun(db, runId, dagId);

    // Mock gateway 让 A 输出包含 "output:" 前缀（默认行为）
    // 我们用 contains "output:" 做判断
    const definition: DagRunParams['definition'] = {
      nodes: [
        { id: 'A', type: 'agent', agentId: 'main', prompt: '分析代码' },
        { id: 'COND', type: 'condition', expression: { left: '{{A.output}}', operator: 'contains', right: 'output:' } },
        { id: 'ErrorHandler', type: 'agent', agentId: 'main', prompt: '处理错误' },
        { id: 'HappyPath', type: 'agent', agentId: 'main', prompt: '正常流程' },
      ],
      edges: [
        { id: 'e1', source: 'A', target: 'COND' },
        { id: 'e2', source: 'COND', target: 'ErrorHandler', sourceHandle: 'true' },
        { id: 'e3', source: 'COND', target: 'HappyPath', sourceHandle: 'false' },
      ],
    };

    const result = await executeDagRun({
      runId, definition,
      gateway: gateway as unknown as GatewayClient,
      db,
    });

    expect(result.status).toBe('completed');

    const states = getNodeStates(db, runId);
    const stateMap = new Map(states.map((s) => [s.nodeId, s]));

    // A 的输出是 "output:分析代码" → contains "output:" = true
    expect(stateMap.get('COND')?.output).toBe('true');
    expect(stateMap.get('ErrorHandler')?.status).toBe('completed');
    expect(stateMap.get('HappyPath')?.status).toBe('skipped');
  });

  // ────────────────────────────────────────────────────────────────
  // 场景 12: 向后兼容 — 纯 agent 节点 DAG 行为不变
  // ────────────────────────────────────────────────────────────────
  it('场景12: 纯 agent 节点 DAG，行为与改造前完全一致', async () => {
    const runId = 'run-compat';
    const dagId = 'dag-compat';
    seedDagRun(db, runId, dagId);

    const definition: DagRunParams['definition'] = {
      nodes: [
        { id: 'X', type: 'agent', agentId: 'main', prompt: '第一步' },
        { id: 'Y', type: 'agent', agentId: 'main', prompt: '第二步: {{X.output}}' },
        { id: 'Z', type: 'agent', agentId: 'main', prompt: '第三步: {{Y.output}}' },
      ],
      edges: [
        { id: 'e1', source: 'X', target: 'Y' },
        { id: 'e2', source: 'Y', target: 'Z' },
      ],
    };

    const result = await executeDagRun({
      runId, definition,
      gateway: gateway as unknown as GatewayClient,
      db,
    });

    expect(result.status).toBe('completed');

    const states = getNodeStates(db, runId);
    expect(states).toHaveLength(3);
    for (const s of states) {
      expect(s.status).toBe('completed');
      expect(s.output).toBeTruthy();
    }

    // 变量替换正确
    const calls = gateway.sendMessage.mock.calls;
    expect(calls).toHaveLength(3);
    expect(calls[0]![1]).toBe('第一步');
    expect(calls[1]![1]).not.toContain('{{X.output}}');
    expect(calls[2]![1]).not.toContain('{{Y.output}}');

    // 最终输出为 Z 的输出
    const run = getDagRun(db, runId);
    expect(run?.status).toBe('completed');
    expect(run?.output).toBeTruthy();
  });

  // ────────────────────────────────────────────────────────────────
  // 场景 13: 延迟节点 — A→DELAY(0s)→B，正常执行
  // ────────────────────────────────────────────────────────────────
  it('场景13: 延迟节点 0s，不阻塞，B 正常执行', async () => {
    const runId = 'run-delay-zero';
    const dagId = 'dag-delay-zero';
    seedDagRun(db, runId, dagId);

    const definition: DagRunParams['definition'] = {
      nodes: [
        { id: 'A', type: 'agent', agentId: 'main', prompt: '第一步' },
        { id: 'WAIT', type: 'delay', delaySeconds: 0 },
        { id: 'B', type: 'agent', agentId: 'main', prompt: '延迟后: {{A.output}}' },
      ],
      edges: [
        { id: 'e1', source: 'A', target: 'WAIT' },
        { id: 'e2', source: 'WAIT', target: 'B' },
      ],
    };

    const result = await executeDagRun({
      runId, definition,
      gateway: gateway as unknown as GatewayClient,
      db,
    });

    expect(result.status).toBe('completed');

    const states = getNodeStates(db, runId);
    const stateMap = new Map(states.map((s) => [s.nodeId, s]));

    expect(stateMap.get('A')?.status).toBe('completed');
    expect(stateMap.get('WAIT')?.status).toBe('completed');
    expect(stateMap.get('WAIT')?.output).toBe('0');
    expect(stateMap.get('B')?.status).toBe('completed');

    // 最终输出应为 B（非 delay 节点）
    const run = getDagRun(db, runId);
    expect(run?.output).toBeTruthy();
    expect(run?.output).not.toBe('0');
  });

  // ────────────────────────────────────────────────────────────────
  // 场景 14: 延迟节点 + 条件组合 — DELAY→COND 分支
  // ────────────────────────────────────────────────────────────────
  it('场景14: delay + condition 组合，正常工作', async () => {
    const runId = 'run-delay-cond';
    const dagId = 'dag-delay-cond';
    seedDagRun(db, runId, dagId);

    const definition: DagRunParams['definition'] = {
      nodes: [
        { id: 'A', type: 'agent', agentId: 'main', prompt: '生成结果' },
        { id: 'WAIT', type: 'delay', delaySeconds: 0 },
        { id: 'COND', type: 'condition', expression: { left: '{{A.output}}', operator: 'not_empty' } },
        { id: 'B', type: 'agent', agentId: 'main', prompt: 'True 路径' },
        { id: 'C', type: 'agent', agentId: 'main', prompt: 'False 路径' },
      ],
      edges: [
        { id: 'e1', source: 'A', target: 'WAIT' },
        { id: 'e2', source: 'WAIT', target: 'COND' },
        { id: 'e3', source: 'COND', target: 'B', sourceHandle: 'true' },
        { id: 'e4', source: 'COND', target: 'C', sourceHandle: 'false' },
      ],
    };

    const result = await executeDagRun({
      runId, definition,
      gateway: gateway as unknown as GatewayClient,
      db,
    });

    expect(result.status).toBe('completed');

    const states = getNodeStates(db, runId);
    const stateMap = new Map(states.map((s) => [s.nodeId, s]));

    expect(stateMap.get('WAIT')?.status).toBe('completed');
    expect(stateMap.get('COND')?.output).toBe('true');
    expect(stateMap.get('B')?.status).toBe('completed');
    expect(stateMap.get('C')?.status).toBe('skipped');
  });

  // ────────────────────────────────────────────────────────────────
  // 场景 15: 延迟节点在条件 false 分支中被跳过
  // ────────────────────────────────────────────────────────────────
  it('场景15: 条件分支中延迟节点被跳过', async () => {
    const runId = 'run-delay-skip';
    const dagId = 'dag-delay-skip';
    seedDagRun(db, runId, dagId);

    const definition: DagRunParams['definition'] = {
      nodes: [
        { id: 'A', type: 'agent', agentId: 'main', prompt: '入口' },
        { id: 'COND', type: 'condition', expression: { left: '{{A.output}}', operator: 'not_empty' } },
        { id: 'FAST', type: 'agent', agentId: 'main', prompt: 'True 快速路径' },
        { id: 'WAIT', type: 'delay', delaySeconds: 0 },
        { id: 'SLOW', type: 'agent', agentId: 'main', prompt: 'False 慢速路径' },
      ],
      edges: [
        { id: 'e1', source: 'A', target: 'COND' },
        { id: 'e2', source: 'COND', target: 'FAST', sourceHandle: 'true' },
        { id: 'e3', source: 'COND', target: 'WAIT', sourceHandle: 'false' },
        { id: 'e4', source: 'WAIT', target: 'SLOW' },
      ],
    };

    const result = await executeDagRun({
      runId, definition,
      gateway: gateway as unknown as GatewayClient,
      db,
    });

    expect(result.status).toBe('completed');

    const states = getNodeStates(db, runId);
    const stateMap = new Map(states.map((s) => [s.nodeId, s]));

    // true 分支执行
    expect(stateMap.get('FAST')?.status).toBe('completed');
    // false 分支全部跳过（delay + agent）
    expect(stateMap.get('WAIT')?.status).toBe('skipped');
    expect(stateMap.get('SLOW')?.status).toBe('skipped');
  });
});
