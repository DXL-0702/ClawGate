/**
 * OpenClaw 生命周期管理 API 路由
 *
 * 端点：
 * - GET  /api/openclaw/status    — 获取状态
 * - GET  /api/openclaw/update    — 检查更新
 * - POST /api/openclaw/restart   — 重启 Gateway
 * - POST /api/openclaw/upgrade   — 升级 OpenClaw
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { OpenClawLifecycle } from '@clawgate/core';

// 权限检查：简化版，仅检查管理员 Token 或本地请求
function isAuthorized(req: FastifyRequest): boolean {
  // 本地请求（127.0.0.1 / ::1）允许
  const remoteAddress = req.socket.remoteAddress;
  if (remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1') {
    return true;
  }

  // 检查管理员 Token（简化版，实际应验证 JWT/session）
  const adminToken = req.headers['x-admin-token'];
  return adminToken === process.env['CLAWGATE_ADMIN_TOKEN'];
}

export const openclawLifecycleRoutes: FastifyPluginAsync = async (app) => {
  const lifecycle = new OpenClawLifecycle();

  // GET /api/openclaw/status — 获取 OpenClaw 状态
  app.get('/openclaw/status', async (req, reply) => {
    try {
      const status = await lifecycle.getStatus();
      return {
        success: true,
        data: status,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      req.log.error({ err: errorMsg }, 'Failed to get OpenClaw status');
      return reply.status(500).send({
        success: false,
        error: 'Failed to get status',
        message: errorMsg,
      });
    }
  });

  // GET /api/openclaw/update — 检查更新
  app.get('/openclaw/update', async (req, reply) => {
    try {
      const updateInfo = await lifecycle.checkUpdate();
      return {
        success: true,
        data: updateInfo,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      req.log.error({ err: errorMsg }, 'Failed to check update');
      return reply.status(500).send({
        success: false,
        error: 'Failed to check update',
        message: errorMsg,
      });
    }
  });

  // POST /api/openclaw/restart — 重启 Gateway
  app.post<{ Body?: { force?: boolean } }>(
    '/openclaw/restart',
    async (req, reply) => {
      // 权限检查
      if (!isAuthorized(req)) {
        return reply.status(403).send({
          success: false,
          error: 'Forbidden',
          message: 'Admin token required for remote requests',
        });
      }

      // 确认检查（防止误触）
      const confirmHeader = req.headers['x-confirm-action'];
      if (confirmHeader !== 'restart') {
        return reply.status(400).send({
          success: false,
          error: 'Confirmation required',
          message: 'Please add header: X-Confirm-Action: restart',
        });
      }

      try {
        req.log.info('Restarting OpenClaw Gateway...');

        const result = await lifecycle.restart();

        if (result.success) {
          req.log.info({ pid: result.pid }, 'OpenClaw Gateway restarted');
          return {
            success: true,
            message: result.message,
            pid: result.pid,
          };
        } else {
          req.log.error({ error: result.error }, 'Failed to restart Gateway');
          return reply.status(502).send({
            success: false,
            error: 'Restart failed',
            message: result.message,
            detail: result.error,
          });
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        req.log.error({ err: errorMsg }, 'Unexpected error during restart');
        return reply.status(500).send({
          success: false,
          error: 'Internal error',
          message: errorMsg,
        });
      }
    }
  );

  // POST /api/openclaw/upgrade — 升级 OpenClaw
  app.post('/openclaw/upgrade', async (req, reply) => {
    // 权限检查
    if (!isAuthorized(req)) {
      return reply.status(403).send({
        success: false,
        error: 'Forbidden',
        message: 'Admin token required for remote requests',
      });
    }

    // 确认检查
    const confirmHeader = req.headers['x-confirm-action'];
    if (confirmHeader !== 'upgrade') {
      return reply.status(400).send({
        success: false,
        error: 'Confirmation required',
        message: 'Please add header: X-Confirm-Action: upgrade',
      });
    }

    try {
      req.log.info('Upgrading OpenClaw...');

      // 先检查更新
      const updateCheck = await lifecycle.checkUpdate();
      if (!updateCheck.hasUpdate) {
        return {
          success: true,
          message: 'Already at latest version',
          currentVersion: updateCheck.currentVersion,
          latestVersion: updateCheck.latestVersion,
        };
      }

      // 执行升级
      const result = await lifecycle.upgrade();

      if (result.success) {
        req.log.info({ version: result.version }, 'OpenClaw upgraded');
        return {
          success: true,
          message: result.message,
          version: result.version,
        };
      } else {
        req.log.error({ error: result.error }, 'Failed to upgrade OpenClaw');
        return reply.status(502).send({
          success: false,
          error: 'Upgrade failed',
          message: result.message,
          detail: result.error,
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      req.log.error({ err: errorMsg }, 'Unexpected error during upgrade');
      return reply.status(500).send({
        success: false,
        error: 'Internal error',
        message: errorMsg,
      });
    }
  });

  // 开发辅助端点：简化版重启（跳过确认头，仅限本地）
  if (process.env['NODE_ENV'] === 'development') {
    app.post('/openclaw/restart-dev', async (req, reply) => {
      const remoteAddress = req.socket.remoteAddress;
      if (remoteAddress !== '127.0.0.1' && remoteAddress !== '::1' && remoteAddress !== '::ffff:127.0.0.1') {
        return reply.status(403).send({ error: 'Dev endpoint only for localhost' });
      }

      const result = await lifecycle.restart();
      return result;
    });
  }
};

