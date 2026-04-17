import type { FastifyPluginAsync } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import {
  RouterClient, getYamlConfig, pushRoutingLog,
  getRedis, REDIS_KEYS, incrCostRealtime,
} from '@clawgate/core';

// ── 请求/响应类型 ────────────────────────────────────────��───
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: {
    index: number;
    message: ChatMessage;
    finish_reason: 'stop' | 'length' | 'error';
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ── 静态价格表 (USD per 1M token) ────────────────────────────
const PRICE_TABLE: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-sonnet-4-5-20250514': { input: 3.0, output: 15.0 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
};

function estimateUsd(model: string, promptTokens: number, completionTokens: number): number {
  const price = PRICE_TABLE[model] ?? { input: 0, output: 0 };
  return (promptTokens * price.input + completionTokens * price.output) / 1_000_000;
}

// ── 工具函数 ─────────────────────────────────────────────────
class ConfigError extends Error {}

function generateId(): string {
  return `chatcmpl-${Date.now().toString(36)}`;
}

function lastUserMessage(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].content;
  }
  return '';
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── 预算检查 ─────────────────────────────────────────────────
async function checkBudget(): Promise<{ allowed: boolean; spentUsd: number; limitUsd: number }> {
  const config = getYamlConfig();
  const limitUsd = config.budgets?.daily_limit_usd;
  if (!limitUsd) return { allowed: true, spentUsd: 0, limitUsd: 0 };

  try {
    const redis = getRedis();
    const key = REDIS_KEYS.costsRealtime(todayStr());
    const all = await redis.hgetall(key);
    let spentUsd = 0;
    for (const [field, value] of Object.entries(all)) {
      if (field.endsWith(':estimated_usd')) {
        spentUsd += parseFloat(value) || 0;
      }
    }
    return { allowed: spentUsd < limitUsd, spentUsd, limitUsd };
  } catch {
    // Redis 不可用时放行（不阻塞业务）
    return { allowed: true, spentUsd: 0, limitUsd };
  }
}

// ── Anthropic Provider ───────────────────────────────────────
const anthropicClient = process.env['ANTHROPIC_API_KEY']
  ? new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] })
  : null;

async function callAnthropic(
  messages: ChatMessage[],
  model: string,
  maxTokens: number,
  temperature?: number,
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  if (!anthropicClient) throw new ConfigError('ANTHROPIC_API_KEY not set');

  const system = messages.find(m => m.role === 'system')?.content;
  const userMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const response = await anthropicClient.messages.create({
    model,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    messages: userMessages,
  });

  const content = response.content[0]?.type === 'text' ? response.content[0].text : '';
  return {
    content,
    promptTokens: response.usage.input_tokens,
    completionTokens: response.usage.output_tokens,
  };
}

// ── OpenAI Provider ──────────────────────────────────────────
const openaiClient = process.env['OPENAI_API_KEY']
  ? new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] })
  : null;

async function callOpenAI(
  messages: ChatMessage[],
  model: string,
  maxTokens: number,
  temperature?: number,
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  if (!openaiClient) throw new ConfigError('OPENAI_API_KEY not set');

  const response = await openaiClient.chat.completions.create({
    model,
    max_tokens: maxTokens,
    ...(temperature !== undefined ? { temperature } : {}),
    messages,
  });

  const content = response.choices[0]?.message.content ?? '';
  return {
    content,
    promptTokens: response.usage?.prompt_tokens ?? 0,
    completionTokens: response.usage?.completion_tokens ?? 0,
  };
}

// ── Ollama Provider ──────────────────────────────────────────
const ollamaUrl = process.env['OLLAMA_URL'] ?? 'http://127.0.0.1:11434';

async function callOllama(
  messages: ChatMessage[],
  model: string,
  temperature?: number,
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  const response = await fetch(`${ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, messages, stream: false,
      ...(temperature !== undefined ? { options: { temperature } } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as {
    message: { content: string };
    prompt_eval_count?: number;
    eval_count?: number;
  };

  return {
    content: data.message.content,
    promptTokens: data.prompt_eval_count ?? 0,
    completionTokens: data.eval_count ?? 0,
  };
}

// ── Failover 分发 ────────────────────────────────────────────
function inferProvider(model: string): string {
  if (model.startsWith('claude')) return 'anthropic';
  if (model.startsWith('gpt'))    return 'openai';
  return 'ollama';
}

async function callProvider(
  messages: ChatMessage[],
  model: string,
  maxTokens: number,
  temperature?: number,
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  const provider = inferProvider(model);
  if (provider === 'anthropic') return callAnthropic(messages, model, maxTokens, temperature);
  if (provider === 'openai')    return callOpenAI(messages, model, maxTokens, temperature);
  return callOllama(messages, model, temperature);
}

async function dispatchWithFailover(
  router: RouterClient,
  messages: ChatMessage[],
  primaryModel: string,
  primaryProvider: string,
  maxTokens: number,
  temperature?: number,
): Promise<{ content: string; promptTokens: number; completionTokens: number; usedModel: string; usedProvider: string }> {
  // Build candidate list: primary first, then YAML providers as fallback
  const config = getYamlConfig();
  const candidates: { model: string; provider: string }[] = [
    { model: primaryModel, provider: primaryProvider },
  ];
  for (const p of config.providers ?? []) {
    if (p.model !== primaryModel) {
      candidates.push({ model: p.model, provider: p.name });
    }
  }

  // Query circuit breaker status (soft dependency on Rust)
  const circuitMap = await router.circuitStatus();

  for (const candidate of candidates) {
    // Skip providers with open circuit
    if (circuitMap && circuitMap[candidate.provider]?.state === 'Open') {
      continue;
    }

    try {
      const result = await callProvider(messages, candidate.model, maxTokens, temperature);
      // Report success asynchronously
      setImmediate(() => { router.reportOutcome(candidate.provider, true).catch(() => {}); });
      return { ...result, usedModel: candidate.model, usedProvider: candidate.provider };
    } catch (err) {
      if (err instanceof ConfigError) {
        // API key not configured — skip, don't report to circuit breaker
        continue;
      }
      // Report failure asynchronously
      setImmediate(() => { router.reportOutcome(candidate.provider, false).catch(() => {}); });
    }
  }

  throw new Error('All providers unavailable');
}

// ── SSE Streaming ────────────────────────────────────────────
async function streamAnthropic(
  messages: ChatMessage[],
  model: string,
  maxTokens: number,
  temperature: number | undefined,
  raw: import('node:http').ServerResponse,
  id: string,
): Promise<{ promptTokens: number; completionTokens: number }> {
  if (!anthropicClient) throw new ConfigError('ANTHROPIC_API_KEY not set');

  const system = messages.find(m => m.role === 'system')?.content;
  const userMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const stream = anthropicClient.messages.stream({
    model,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    messages: userMessages,
  });

  let promptTokens = 0;
  let completionTokens = 0;

  stream.on('text', (text) => {
    const chunk = {
      id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
    };
    raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
  });

  const finalMessage = await stream.finalMessage();
  promptTokens = finalMessage.usage.input_tokens;
  completionTokens = finalMessage.usage.output_tokens;

  // Send final chunk with finish_reason
  const doneChunk = {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  };
  raw.write(`data: ${JSON.stringify(doneChunk)}\n\n`);

  return { promptTokens, completionTokens };
}

async function streamOpenAI(
  messages: ChatMessage[],
  model: string,
  maxTokens: number,
  temperature: number | undefined,
  raw: import('node:http').ServerResponse,
  id: string,
): Promise<{ promptTokens: number; completionTokens: number }> {
  if (!openaiClient) throw new ConfigError('OPENAI_API_KEY not set');

  const stream = await openaiClient.chat.completions.create({
    model,
    max_tokens: maxTokens,
    ...(temperature !== undefined ? { temperature } : {}),
    messages,
    stream: true,
    stream_options: { include_usage: true },
  });

  let promptTokens = 0;
  let completionTokens = 0;

  for await (const chunk of stream) {
    if (chunk.usage) {
      promptTokens = chunk.usage.prompt_tokens ?? 0;
      completionTokens = chunk.usage.completion_tokens ?? 0;
    }
    const sseChunk = {
      id,
      object: 'chat.completion.chunk',
      created: chunk.created,
      model,
      choices: chunk.choices.map(c => ({
        index: c.index,
        delta: c.delta,
        finish_reason: c.finish_reason,
      })),
    };
    raw.write(`data: ${JSON.stringify(sseChunk)}\n\n`);
  }

  return { promptTokens, completionTokens };
}

async function streamOllama(
  messages: ChatMessage[],
  model: string,
  temperature: number | undefined,
  raw: import('node:http').ServerResponse,
  id: string,
): Promise<{ promptTokens: number; completionTokens: number }> {
  const response = await fetch(`${ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, messages, stream: true,
      ...(temperature !== undefined ? { options: { temperature } } : {}),
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Ollama stream error: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let promptTokens = 0;
  let completionTokens = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line) as {
          message?: { content: string };
          done: boolean;
          prompt_eval_count?: number;
          eval_count?: number;
        };

        if (data.message?.content) {
          const chunk = {
            id,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{ index: 0, delta: { content: data.message.content }, finish_reason: null }],
          };
          raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        if (data.done) {
          promptTokens = data.prompt_eval_count ?? 0;
          completionTokens = data.eval_count ?? 0;
          const doneChunk = {
            id,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          };
          raw.write(`data: ${JSON.stringify(doneChunk)}\n\n`);
        }
      } catch {
        // skip malformed JSON lines
      }
    }
  }

  return { promptTokens, completionTokens };
}

// ── RouterClient 初始化 ───────────────────────────────────────
const routerUrl = process.env['ROUTER_URL'] ?? 'http://127.0.0.1:3001';
const fallbackModel = getYamlConfig().providers?.[0]?.model ?? 'claude-sonnet-4-6';
const fallbackProvider = getYamlConfig().providers?.[0]?.name ?? 'anthropic';
const router = new RouterClient(routerUrl, fallbackModel, fallbackProvider);

// ── 路由注册 ──────────────────────────────────────────────────
export const openaiRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: ChatCompletionRequest }>('/chat/completions', async (req, reply) => {
    const { messages, max_tokens = 4096, stream = false, temperature } = req.body;

    // 提取最后一条 user message 用于路由决策
    const prompt = lastUserMessage(messages);
    if (!prompt) {
      return reply.status(400).send({ error: 'messages must contain at least one user message' });
    }

    // 预算检查
    const budget = await checkBudget();
    if (!budget.allowed) {
      return reply.status(429).send({
        error: 'daily_budget_exceeded',
        spent_usd: budget.spentUsd,
        limit_usd: budget.limitUsd,
      });
    }

    // 调用智能路由，获取路由决策
    const decision = await router.route(prompt);

    // 异步写入路由决策日志（非阻塞）
    setImmediate(async () => {
      try {
        await pushRoutingLog({
          sessionKey: null,
          prompt,
          layer: decision.layer,
          model: decision.model,
          cacheHit: decision.cacheHit,
          latencyMs: decision.latencyMs,
        });
      } catch { /* non-fatal */ }
    });

    // ── Streaming 分支 ──────────────────────────────────────
    if (stream) {
      const id = generateId();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      try {
        let promptTokens = 0;
        let completionTokens = 0;
        const provider = inferProvider(decision.model);

        if (provider === 'anthropic') {
          ({ promptTokens, completionTokens } = await streamAnthropic(
            messages, decision.model, max_tokens, temperature, reply.raw, id));
        } else if (provider === 'openai') {
          ({ promptTokens, completionTokens } = await streamOpenAI(
            messages, decision.model, max_tokens, temperature, reply.raw, id));
        } else {
          ({ promptTokens, completionTokens } = await streamOllama(
            messages, decision.model, temperature, reply.raw, id));
        }

        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();

        // Report success + cost tracking
        setImmediate(() => { router.reportOutcome(provider, true).catch(() => {}); });
        setImmediate(async () => {
          try {
            const usd = estimateUsd(decision.model, promptTokens, completionTokens);
            await incrCostRealtime(todayStr(), decision.model, promptTokens, completionTokens, usd);
          } catch { /* non-fatal */ }
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'stream error';
        const errorChunk = { error: { message: msg, type: 'server_error' } };
        reply.raw.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();
      }
      return;
    }

    // ── Non-streaming 分支（Failover） ──────────────────────
    try {
      const { content, promptTokens, completionTokens, usedModel, usedProvider } =
        await dispatchWithFailover(
          router, messages, decision.model, inferProvider(decision.model),
          max_tokens, temperature,
        );

      // 异步成本追踪
      setImmediate(async () => {
        try {
          const usd = estimateUsd(usedModel, promptTokens, completionTokens);
          await incrCostRealtime(todayStr(), usedModel, promptTokens, completionTokens, usd);
        } catch { /* non-fatal */ }
      });

      const response: ChatCompletionResponse = {
        id: generateId(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: usedModel,
        choices: [{
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      };

      // 附加路由信息到响应头（便于调试）
      reply.header('X-ClawGate-Provider', usedProvider);
      reply.header('X-ClawGate-Model', usedModel);
      reply.header('X-ClawGate-Layer', decision.layer);

      return response;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      if (err instanceof ConfigError) return reply.status(400).send({ error: msg });
      return reply.status(503).send({ error: `all providers unavailable: ${msg}` });
    }
  });
};
