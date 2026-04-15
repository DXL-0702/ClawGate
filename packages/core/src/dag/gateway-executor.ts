import { GatewayClient } from '../gateway/index.js';

export interface ExecuteNodeOptions {
  agentId: string;
  prompt: string;
  timeoutMs?: number;
  onMessage?: (chunk: string) => void;
}

export interface ExecuteNodeResult {
  success: boolean;
  output: string;
  error?: string;
  metadata: {
    sessionKey: string;
    durationMs: number;
    messageCount: number;
  };
}

interface ParallelNode {
  nodeId: string;
  agentId: string;
  prompt: string;
  onMessage?: (chunk: string) => void;
}

// 并发控制上限（可通过环境变量覆盖）
const MAX_PARALLEL_SESSIONS = parseInt(
  process.env['CLAWGATE_MAX_PARALLEL_SESSIONS'] ?? '5',
  10
);

/**
 * 收集 Session 消息（WebSocket 事件订阅）
 * 订阅 session.message 实时推送，支持流式回调
 */
function collectMessages(
  gateway: GatewayClient,
  sessionKey: string,
  timeoutMs: number,
  onMessage?: (chunk: string) => void
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const messages: string[] = [];
    let sessionEnded = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    // 清理函数
    const cleanup = (unsubscribeMsg: () => void, unsubscribeEnd: () => void) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      unsubscribeMsg();
      unsubscribeEnd();
    };

    // 订阅实时消息事件
    const unsubscribeMsg = gateway.onEvent('session.message', (data: unknown) => {
      const msg = data as { key?: string; content?: string };
      if (msg.key === sessionKey && msg.content) {
        messages.push(msg.content);
        // 流式回调
        onMessage?.(msg.content);
      }
    });

    // 订阅 Session 结束事件
    const unsubscribeEnd = gateway.onEvent('session.end', (data: unknown) => {
      const evt = data as { key?: string };
      if (evt.key === sessionKey) {
        sessionEnded = true;
        cleanup(unsubscribeMsg, unsubscribeEnd);
        resolve(messages);
      }
    });

    // 超时处理
    timeoutId = setTimeout(() => {
      if (!sessionEnded) {
        cleanup(unsubscribeMsg, unsubscribeEnd);
        reject(new Error(`Session timeout after ${timeoutMs}ms: ${sessionKey}`));
      }
    }, timeoutMs);
  });
}

/**
 * 执行单个 Agent 节点
 * 策略：创建独立 Session → 发送消息 → WebSocket 事件收集响应 → 清理 Session
 */
export async function executeAgentNode(
  gateway: GatewayClient,
  opts: ExecuteNodeOptions
): Promise<ExecuteNodeResult> {
  const { agentId, prompt, timeoutMs = 60000, onMessage } = opts;
  const startTime = Date.now();

  let session: { key: string } | null = null;

  try {
    // 1. 创建 Session
    session = await gateway.createSession(agentId);
    const sessionKey = session.key;

    // 2. 发送消息
    await gateway.sendMessage(sessionKey, prompt);

    // 3. 收集响应（WebSocket 事件订阅）
    const messages = await collectMessages(gateway, sessionKey, timeoutMs, onMessage);

    const duration = Date.now() - startTime;

    return {
      success: true,
      output: messages.join('\n'),
      metadata: {
        sessionKey,
        durationMs: duration,
        messageCount: messages.length,
      },
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : 'Execution failed';

    return {
      success: false,
      output: '',
      error: errorMsg,
      metadata: {
        sessionKey: session?.key ?? '',
        durationMs: duration,
        messageCount: 0,
      },
    };
  } finally {
    // 4. 清理 Session（无论成功与否）
    if (session) {
      try {
        await gateway.abortSession(session.key);
      } catch {
        // 清理失败不抛异常，避免掩盖主错误
      }
    }
  }
}

/**
 * 并行执行多个 Agent 节点（带并发控制）
 * 最大并发数由 CLAWGATE_MAX_PARALLEL_SESSIONS 控制（默认 5）
 */
export async function executeAgentNodesParallel(
  gateway: GatewayClient,
  nodes: ParallelNode[],
  globalTimeoutMs?: number
): Promise<Map<string, ExecuteNodeResult>> {
  const results = new Map<string, ExecuteNodeResult>();

  // 并发控制：使用简易信号量
  const executing: Promise<void>[] = [];

  for (const node of nodes) {
    const executePromise = (async () => {
      const result = await executeAgentNode(gateway, {
        agentId: node.agentId,
        prompt: node.prompt,
        timeoutMs: globalTimeoutMs,
        onMessage: node.onMessage,
      });
      results.set(node.nodeId, result);
    })();

    executing.push(executePromise);

    // 达到并发上限时，等待任意一个完成
    if (executing.length >= MAX_PARALLEL_SESSIONS) {
      await Promise.race(executing);
      // 移除已完成的 Promise
      const completedIndex = await Promise.race(
        executing.map((p, i) => p.then(() => i))
      );
      executing.splice(completedIndex, 1);
    }
  }

  // 等待所有剩余任务完成
  await Promise.all(executing);

  return results;
}
