import { describe, it, expect, vi, beforeEach, MockedFunction } from 'vitest';
import {
  executeAgentNode,
  executeAgentNodesParallel,
  ExecuteNodeOptions,
} from '../src/dag/gateway-executor.js';
import { GatewayClient, Session } from '../src/gateway/index.js';

// Mock GatewayClient 类型
interface MockGatewayClient {
  createSession: MockedFunction<(agentId: string) => Promise<Session>>;
  sendMessage: MockedFunction<(sessionKey: string, content: string) => Promise<void>>;
  abortSession: MockedFunction<(sessionKey: string) => Promise<void>>;
  onEvent: MockedFunction<(event: string, listener: (data: unknown) => void) => () => void>;
  emitEvent: (event: string, data: unknown) => void;
}

const createMockGateway = (): MockGatewayClient => {
  const eventListeners = new Map<string, Array<(data: unknown) => void>>();

  return {
    createSession: vi.fn(),
    sendMessage: vi.fn(),
    abortSession: vi.fn(),
    onEvent: vi.fn((event: string, listener: (data: unknown) => void) => {
      if (!eventListeners.has(event)) {
        eventListeners.set(event, []);
      }
      eventListeners.get(event)!.push(listener);

      return () => {
        const listeners = eventListeners.get(event) ?? [];
        const idx = listeners.indexOf(listener);
        if (idx !== -1) listeners.splice(idx, 1);
      };
    }),
    emitEvent: (event: string, data: unknown) => {
      const listeners = eventListeners.get(event) ?? [];
      for (const fn of listeners) fn(data);
    },
  };
};

describe('executeAgentNode', () => {
  let gateway: MockGatewayClient;

  beforeEach(() => {
    gateway = createMockGateway();
    vi.clearAllMocks();
  });

  it('should execute single node successfully', async () => {
    // Arrange
    gateway.createSession.mockResolvedValue({ key: 'agent1:session123' });
    gateway.sendMessage.mockResolvedValue(undefined);

    const options: ExecuteNodeOptions = {
      agentId: 'agent1',
      prompt: 'Hello, analyze this code',
    };

    // Act
    const promise = executeAgentNode(gateway as unknown as GatewayClient, options);

    // 模拟 WebSocket 事件：收到消息
    setTimeout(() => {
      gateway.emitEvent('session.message', {
        key: 'agent1:session123',
        content: 'Analysis result here',
      });
    }, 10);

    // 模拟 Session 结束
    setTimeout(() => {
      gateway.emitEvent('session.end', { key: 'agent1:session123' });
    }, 50);

    const result = await promise;

    // Assert
    expect(result.success).toBe(true);
    expect(result.output).toBe('Analysis result here');
    expect(result.metadata.sessionKey).toBe('agent1:session123');
    expect(result.metadata.messageCount).toBe(1);
    expect(result.metadata.durationMs).toBeGreaterThan(0);

    // Verify cleanup
    expect(gateway.abortSession).toHaveBeenCalledWith('agent1:session123');
  });

  it('should collect multiple messages', async () => {
    gateway.createSession.mockResolvedValue({ key: 'agent1:session456' });
    gateway.sendMessage.mockResolvedValue(undefined);

    const messages: string[] = [];
    const options: ExecuteNodeOptions = {
      agentId: 'agent1',
      prompt: 'Generate code',
      onMessage: (chunk) => messages.push(chunk),
    };

    const promise = executeAgentNode(gateway as unknown as GatewayClient, options);

    // 模拟多轮消息
    setTimeout(() => {
      gateway.emitEvent('session.message', {
        key: 'agent1:session456',
        content: 'Step 1: Analyzing...',
      });
    }, 10);

    setTimeout(() => {
      gateway.emitEvent('session.message', {
        key: 'agent1:session456',
        content: 'Step 2: Generating...',
      });
    }, 30);

    setTimeout(() => {
      gateway.emitEvent('session.end', { key: 'agent1:session456' });
    }, 60);

    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.output).toBe('Step 1: Analyzing...\nStep 2: Generating...');
    expect(result.metadata.messageCount).toBe(2);
    expect(messages).toHaveLength(2); // 流式回调也收到 2 条
  });

  it('should handle timeout', async () => {
    gateway.createSession.mockResolvedValue({ key: 'agent1:timeout789' });
    gateway.sendMessage.mockResolvedValue(undefined);

    const options: ExecuteNodeOptions = {
      agentId: 'agent1',
      prompt: 'Slow task',
      timeoutMs: 100, // 100ms 超时
    };

    const result = await executeAgentNode(gateway as unknown as GatewayClient, options);

    expect(result.success).toBe(false);
    expect(result.error).toContain('timeout');
    expect(result.metadata.sessionKey).toBe('agent1:timeout789');

    // 即使超时也要清理
    expect(gateway.abortSession).toHaveBeenCalledWith('agent1:timeout789');
  });

  it('should handle createSession failure', async () => {
    gateway.createSession.mockRejectedValue(new Error('Agent not found'));

    const options: ExecuteNodeOptions = {
      agentId: 'invalid-agent',
      prompt: 'Hello',
    };

    const result = await executeAgentNode(gateway as unknown as GatewayClient, options);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Agent not found');
    expect(gateway.abortSession).not.toHaveBeenCalled(); // 未创建成功，不调用 abort
  });

  it('should cleanup even on sendMessage failure', async () => {
    gateway.createSession.mockResolvedValue({ key: 'agent1:fail000' });
    gateway.sendMessage.mockRejectedValue(new Error('Gateway disconnected'));

    const options: ExecuteNodeOptions = {
      agentId: 'agent1',
      prompt: 'Hello',
    };

    const result = await executeAgentNode(gateway as unknown as GatewayClient, options);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Gateway disconnected');
    // 即使发送失败也要清理 Session
    expect(gateway.abortSession).toHaveBeenCalledWith('agent1:fail000');
  });
});

describe('executeAgentNodesParallel', () => {
  let gateway: MockGatewayClient;

  beforeEach(() => {
    gateway = createMockGateway();
    vi.clearAllMocks();
  });

  it('should execute multiple nodes in parallel', async () => {
    // Arrange
    gateway.createSession
      .mockResolvedValueOnce({ key: 'agent1:session1' })
      .mockResolvedValueOnce({ key: 'agent2:session2' })
      .mockResolvedValueOnce({ key: 'agent1:session3' });

    gateway.sendMessage.mockResolvedValue(undefined);

    const nodes = [
      { nodeId: 'node-1', agentId: 'agent1', prompt: 'Task 1' },
      { nodeId: 'node-2', agentId: 'agent2', prompt: 'Task 2' },
      { nodeId: 'node-3', agentId: 'agent1', prompt: 'Task 3' },
    ];

    // Act
    const promise = executeAgentNodesParallel(gateway as unknown as GatewayClient, nodes);

    // 模拟各节点完成
    setTimeout(() => {
      gateway.emitEvent('session.message', { key: 'agent1:session1', content: 'Result 1' });
      gateway.emitEvent('session.end', { key: 'agent1:session1' });
    }, 10);

    setTimeout(() => {
      gateway.emitEvent('session.message', { key: 'agent2:session2', content: 'Result 2' });
      gateway.emitEvent('session.end', { key: 'agent2:session2' });
    }, 20);

    setTimeout(() => {
      gateway.emitEvent('session.message', { key: 'agent1:session3', content: 'Result 3' });
      gateway.emitEvent('session.end', { key: 'agent1:session3' });
    }, 30);

    const results = await promise;

    // Assert
    expect(results.size).toBe(3);
    expect(results.get('node-1')?.success).toBe(true);
    expect(results.get('node-1')?.output).toBe('Result 1');
    expect(results.get('node-2')?.success).toBe(true);
    expect(results.get('node-2')?.output).toBe('Result 2');
    expect(results.get('node-3')?.success).toBe(true);
    expect(results.get('node-3')?.output).toBe('Result 3');

    // Verify all sessions cleaned up
    expect(gateway.abortSession).toHaveBeenCalledTimes(3);
  });

  it('should handle partial failures', async () => {
    gateway.createSession
      .mockResolvedValueOnce({ key: 'agent1:session1' })
      .mockRejectedValueOnce(new Error('Agent2 not found'))
      .mockResolvedValueOnce({ key: 'agent1:session3' });

    gateway.sendMessage.mockResolvedValue(undefined);

    const nodes = [
      { nodeId: 'node-1', agentId: 'agent1', prompt: 'Task 1' },
      { nodeId: 'node-2', agentId: 'agent2', prompt: 'Task 2' },
      { nodeId: 'node-3', agentId: 'agent1', prompt: 'Task 3' },
    ];

    const promise = executeAgentNodesParallel(gateway as unknown as GatewayClient, nodes);

    setTimeout(() => {
      gateway.emitEvent('session.message', { key: 'agent1:session1', content: 'OK' });
      gateway.emitEvent('session.end', { key: 'agent1:session1' });
    }, 10);

    setTimeout(() => {
      gateway.emitEvent('session.message', { key: 'agent1:session3', content: 'OK' });
      gateway.emitEvent('session.end', { key: 'agent1:session3' });
    }, 20);

    const results = await promise;

    expect(results.get('node-1')?.success).toBe(true);
    expect(results.get('node-2')?.success).toBe(false);
    expect(results.get('node-2')?.error).toBe('Agent2 not found');
    expect(results.get('node-3')?.success).toBe(true);
  });
});
