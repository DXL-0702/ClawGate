import type { FastifyPluginAsync } from 'fastify';

interface FeedbackBody {
  prompt: string;
  model: string;
  complexity: 'simple' | 'complex';
  satisfied: boolean;
}

interface FeedbackResponse {
  recorded: boolean;
  suggested_model?: string;
}

const INTENT_SERVICE_URL = process.env['INTENT_SERVICE_URL'] ?? 'http://127.0.0.1:8000';

export const feedbackRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/route/feedback — L4 用户反馈采集
  app.post<{ Body: FeedbackBody }>('/route/feedback', async (req, reply) => {
    const { prompt, model, complexity, satisfied } = req.body;

    // 参数校验
    if (!prompt || !model || !complexity) {
      return reply.status(400).send({ error: 'Missing required fields: prompt, model, complexity' });
    }
    if (!['simple', 'complex'].includes(complexity)) {
      return reply.status(400).send({ error: 'complexity must be "simple" or "complex"' });
    }

    try {
      // 转发给 Python 意图服务
      const response = await fetch(`${INTENT_SERVICE_URL}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, model, complexity, satisfied }),
      });

      if (!response.ok) {
        const errText = await response.text();
        app.log.warn({ status: response.status, error: errText }, 'Intent service feedback failed');
        return reply.status(502).send({ error: 'Intent service unavailable', detail: errText });
      }

      const result = (await response.json()) as FeedbackResponse;

      // 如果有建议模型切换，记录到日志
      if (result.suggested_model) {
        app.log.info(
          { prompt: prompt.substring(0, 50), fromModel: model, toModel: result.suggested_model },
          'L4 feedback triggered model switch suggestion'
        );
      }

      return {
        recorded: result.recorded,
        suggestedModel: result.suggested_model,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      app.log.error({ err: errorMsg }, 'Failed to forward feedback to intent service');
      return reply.status(503).send({ error: 'Intent service unreachable', detail: errorMsg });
    }
  });

  // GET /api/route/feedback/stats — L4 反馈统计
  app.get('/route/feedback/stats', async (req, reply) => {
    try {
      const response = await fetch(`${INTENT_SERVICE_URL}/feedback/stats`);
      if (!response.ok) {
        return reply.status(502).send({ error: 'Intent service unavailable' });
      }
      const stats = await response.json();
      return stats;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      app.log.error({ err: errorMsg }, 'Failed to fetch feedback stats');
      return reply.status(503).send({ error: 'Intent service unreachable', detail: errorMsg });
    }
  });
};
