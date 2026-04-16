/**
 * GatewayPool - 多实例连接池管理
 *
 * 核心职责：
 * 1. 延迟连接：首次使用时才建立 WebSocket 连接
 * 2. 连接复用：同实例共享 GatewayClient
 * 3. 负载均衡：基于心跳数据选择最优实例
 * 4. 健康检测：自动清理断线/不健康实例
 *
 * @module GatewayPool
 */

import { GatewayClient } from './index.js';
import { getDb, schema, getRedis } from '../index.js';
import { eq, and } from 'drizzle-orm';

// ==================== 类型定义 ====================

/** 实例连接配置（从数据库加载） */
interface InstanceConfig {
  id: string;
  teamId: string;
  gatewayUrl: string;
  gatewayToken: string;
  environment: 'development' | 'staging' | 'production';
}

/** 实例运行时元数据 */
interface InstanceMetadata {
  id: string;
  lastLoad?: InstanceLoad;
  lastConnectedAt?: string;
  lastDisconnectedAt?: string;
  reconnectAttempts: number;
}

/** 实例负载信息（来自 Redis 心跳数据） */
interface InstanceLoad {
  activeSessions: number;
  queuedTasks: number;
  cpuUsage: number;
  memoryUsage: number;
  gatewayHealthy: boolean;
  timestamp: string;
}

/** 实例选择选项 */
export interface SelectOptions {
  /** 指定环境 */
  environment?: 'development' | 'staging' | 'production';
  /** 指定标签（需同时满足） */
  tags?: string[];
  /** 强制选择特定实例（覆盖负载策略） */
  instanceId?: string;
}

/** 健康检查结果 */
export interface HealthResult {
  instanceId: string;
  status: 'healthy' | 'unhealthy' | 'offline' | 'unknown';
  connectionStatus: 'connected' | 'disconnected' | 'connecting' | 'never';
  lastHeartbeatAt?: string;
  load?: InstanceLoad;
  error?: string;
}

// ==================== GatewayPool 类 ====================

export class GatewayPool {
  // ----- 状态存储 -----
  private connections = new Map<string, GatewayClient>();
  private connecting = new Set<string>(); // 正在建立连接的实例
  private metadata = new Map<string, InstanceMetadata>();

  // ----- 配置 -----
  private readonly reconnectIntervalMs = 5000;
  private readonly maxReconnectAttempts = 3;
  private readonly loadTTLSeconds = 20; // Redis 心跳数据 TTL

  // ----- 生命周期 -----

  /**
   * 获取或建立指定实例的连接
   * 核心方法：延迟连接策略，首次调用时才建立 WebSocket
   */
  async getConnection(instanceId: string): Promise<GatewayClient> {
    // 1. 已有连接直接返回
    if (this.connections.has(instanceId)) {
      const client = this.connections.get(instanceId)!;
      // TODO: 检查连接是否活跃，不活跃则重连
      return client;
    }

    // 2. 正在连接中，防止并发重复连接
    if (this.connecting.has(instanceId)) {
      throw new Error(`Connection to instance ${instanceId} is in progress`);
    }

    // 3. 延迟连接：加载配置并建立连接
    this.connecting.add(instanceId);
    try {
      const config = await this.loadInstanceConfig(instanceId);
      const client = await this.createConnection(instanceId, config);
      this.connections.set(instanceId, client);
      this.updateMetadata(instanceId, { lastConnectedAt: new Date().toISOString() });
      return client;
    } finally {
      this.connecting.delete(instanceId);
    }
  }

  /**
   * 断开指定实例的连接
   */
  async disconnect(instanceId: string): Promise<void> {
    const client = this.connections.get(instanceId);
    if (client) {
      client.disconnect();
      this.connections.delete(instanceId);
      this.updateMetadata(instanceId, {
        lastDisconnectedAt: new Date().toISOString(),
      });
    }
  }

  /**
   * 断开所有连接（用于优雅关闭）
   */
  async disconnectAll(): Promise<void> {
    const ids = Array.from(this.connections.keys());
    await Promise.all(ids.map((id) => this.disconnect(id)));
  }

  // ----- 实例选择策略 -----

  /**
   * 为任务选择最优实例
   * 核心逻辑：环境过滤 → 负载排序 → 选择最优
   */
  async selectForTask(
    teamId: string,
    options: SelectOptions = {}
  ): Promise<string | null> {
    // 1. 强制指定实例（覆盖策略）
    if (options.instanceId) {
      // 验证该实例是否属于此团队且在线
      const health = await this.checkHealth(options.instanceId);
      if (health.status === 'healthy') {
        return options.instanceId;
      }
      throw new Error(`Specified instance ${options.instanceId} is not healthy`);
    }

    // 2. 加载符合条件的候选实例
    const candidates = await this.loadCandidates(teamId, options);
    if (candidates.length === 0) {
      return null;
    }

    // 3. 获取候选实例的负载数据
    const candidatesWithLoad = await Promise.all(
      candidates.map(async (id) => ({
        id,
        load: await this.getInstanceLoad(id),
      }))
    );

    // 4. 过滤掉无负载数据的实例（视为 offline）
    const onlineCandidates = candidatesWithLoad.filter((c) => c.load !== null);
    if (onlineCandidates.length === 0) {
      return null;
    }

    // 5. 按负载排序，选择最优
    return this.selectByLoad(onlineCandidates);
  }

  // ----- 健康检查 -----

  /**
   * 检查单个实例健康状态
   */
  async checkHealth(instanceId: string): Promise<HealthResult> {
    const meta = this.metadata.get(instanceId);
    const client = this.connections.get(instanceId);
    const load = await this.getInstanceLoad(instanceId);

    // 判断连接状态
    let connectionStatus: HealthResult['connectionStatus'] = 'never';
    if (this.connecting.has(instanceId)) {
      connectionStatus = 'connecting';
    } else if (client) {
      // TODO: 更准确的连接状态检测
      connectionStatus = 'connected';
    } else if (meta?.lastConnectedAt) {
      connectionStatus = 'disconnected';
    }

    // 判断健康状态
    let status: HealthResult['status'] = 'unknown';
    if (!load) {
      status = 'offline';
    } else if (!load.gatewayHealthy || load.queuedTasks > 10) {
      status = 'unhealthy';
    } else {
      status = 'healthy';
    }

    return {
      instanceId,
      status,
      connectionStatus,
      lastHeartbeatAt: load?.timestamp,
      load: load || undefined,
    };
  }

  /**
   * 健康检查所有实例（用于定时任务）
   */
  async healthCheck(): Promise<HealthResult[]> {
    // 获取所有已知的实例 ID（从 connections 和 metadata）
    const allIds = new Set([
      ...this.connections.keys(),
      ...this.metadata.keys(),
    ]);

    const results = await Promise.all(
      Array.from(allIds).map((id) => this.checkHealth(id))
    );

    // 清理 unhealthy 实例的连接
    for (const result of results) {
      if (result.status === 'offline' || result.status === 'unhealthy') {
        const meta = this.metadata.get(result.instanceId);
        if (meta && meta.reconnectAttempts >= this.maxReconnectAttempts) {
          await this.disconnect(result.instanceId);
        }
      }
    }

    return results;
  }

  // ==================== 私有方法 ====================

  /**
   * 从数据库加载实例配置
   */
  private async loadInstanceConfig(instanceId: string): Promise<InstanceConfig> {
    const db = getDb();
    const [instance] = await db
      .select({
        id: schema.instances.id,
        teamId: schema.instances.teamId,
        gatewayUrl: schema.instances.gatewayUrl,
        gatewayToken: schema.instances.gatewayToken,
        environment: schema.instances.environment,
      })
      .from(schema.instances)
      .where(eq(schema.instances.id, instanceId));

    if (!instance) {
      throw new Error(`Instance ${instanceId} not found in database`);
    }

    return {
      id: instance.id,
      teamId: instance.teamId,
      gatewayUrl: instance.gatewayUrl,
      gatewayToken: instance.gatewayToken,
      environment: instance.environment as InstanceConfig['environment'],
    };
  }

  /**
   * 创建 GatewayClient 连接
   */
  private async createConnection(
    instanceId: string,
    config: InstanceConfig
  ): Promise<GatewayClient> {
    // 注意：这里需要适配 GatewayClient 的认证方式
    // TODO: Issue 6 解决后，需要完整的 challenge-response 认证
    const client = new GatewayClient({
      url: config.gatewayUrl,
      token: config.gatewayToken,
      reconnectIntervalMs: this.reconnectIntervalMs,
    });

    await client.connect();

    // 监听断开事件，自动清理
    // TODO: GatewayClient 需要暴露断开事件

    return client;
  }

  /**
   * 加载符合条件的候选实例列表
   */
  private async loadCandidates(
    teamId: string,
    options: SelectOptions
  ): Promise<string[]> {
    const db = getDb();

    // 构建查询条件数组
    const conditions: ReturnType<typeof eq>[] = [
      eq(schema.instances.teamId, teamId),
    ];

    // 环境过滤
    if (options.environment) {
      conditions.push(eq(schema.instances.environment, options.environment));
    }

    const instances = await db
      .select({ id: schema.instances.id, tags: schema.instances.tags })
      .from(schema.instances)
      .where(and(...conditions));

    // 标签过滤（内存过滤，因为 tags 是 JSON）
    let candidates = instances;
    if (options.tags && options.tags.length > 0) {
      candidates = instances.filter((i) => {
        if (!i.tags) return false;
        try {
          const tags = JSON.parse(i.tags) as string[];
          return options.tags!.every((t) => tags.includes(t));
        } catch {
          return false;
        }
      });
    }

    return candidates.map((i) => i.id);
  }

  /**
   * 从 Redis 获取实例负载数据
   */
  private async getInstanceLoad(instanceId: string): Promise<InstanceLoad | null> {
    try {
      const redis = getRedis();
      const loadKey = `instance:load:${instanceId}`;
      const data = await redis.hgetall(loadKey);

      if (!data || Object.keys(data).length === 0) {
        return null;
      }

      return {
        activeSessions: parseInt(data.activeSessions || '0', 10),
        queuedTasks: parseInt(data.queuedTasks || '0', 10),
        cpuUsage: parseInt(data.cpuUsage || '0', 10),
        memoryUsage: parseInt(data.memoryUsage || '0', 10),
        gatewayHealthy: data.gatewayHealthy === 'true',
        timestamp: data.timestamp,
      };
    } catch {
      return null;
    }
  }

  /**
   * 基于负载选择最优实例
   * 策略：活跃连接数 → 队列任务数 → CPU 使用率
   */
  private selectByLoad(
    candidates: { id: string; load: InstanceLoad | null }[]
  ): string | null {
    // 过滤掉无负载数据的
    const withLoad = candidates.filter((c): c is { id: string; load: InstanceLoad } =>
      c.load !== null
    );

    if (withLoad.length === 0) {
      return null;
    }

    // 计算综合评分（越低越好）
    const scored = withLoad.map((c) => {
      const score =
        c.load.activeSessions * 10 + // 活跃连接权重最高
        c.load.queuedTasks * 5 +       // 队列任务次之
        c.load.cpuUsage;               // CPU 使用率
      return { id: c.id, score, load: c.load };
    });

    // 排序并选择最优
    scored.sort((a, b) => a.score - b.score);

    // 如果最优实例 gatewayHealthy=false，尝试找次优的健康实例
    for (const candidate of scored) {
      if (candidate.load.gatewayHealthy) {
        return candidate.id;
      }
    }

    // 如果没有健康实例，返回最优的（可能不健康但至少可用）
    return scored[0]?.id || null;
  }

  /**
   * 更新元数据
   */
  private updateMetadata(
    instanceId: string,
    updates: Partial<InstanceMetadata>
  ): void {
    const existing = this.metadata.get(instanceId) || {
      id: instanceId,
      reconnectAttempts: 0,
    };
    this.metadata.set(instanceId, { ...existing, ...updates });
  }
}

// ==================== 单例导出 ====================

let globalPool: GatewayPool | null = null;

/** 获取全局 GatewayPool 实例 */
export function getGatewayPool(): GatewayPool {
  if (!globalPool) {
    globalPool = new GatewayPool();
  }
  return globalPool;
}

/** 重置全局实例（主要用于测试） */
export function resetGatewayPool(): void {
  globalPool = null;
}
