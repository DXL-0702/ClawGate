import type { FastifyPluginAsync } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { RouterClient, getYamlConfig, pushRoutingLog } from '@clawgate/core';

// ── 请求/响应类型 ────────────────────────────────────────────
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

// ── Anthropic Provider ───────────────────────────────────────
const anthropicClient = process.env['ANTHROPIC_API_KEY']
  ? new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] })
  : null;

async function callAnthropic(
  messages: ChatMessage[],
  model: string,
  maxTokens: number,
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
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  if (!openaiClient) throw new ConfigError('OPENAI_API_KEY not set');

  const response = await openaiClient.chat.completions.create({
    model,
    max_tokens: maxTokens,
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
async function callOllama(
  messages: ChatMessage[],
  model: string,
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  const ollamaUrl = process.env['OLLAMA_URL'] ?? 'http://127.0.0.1:11434';

  const response = await fetch(`${ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false }),
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

// ── Provider 分发 ─────────────────────────────────────────────
async function dispatchProvider(
  messages: ChatMessage[],
  model: string,
  maxTokens: number,
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  if (model.startsWith('claude-')) return callAnthropic(messages, model, maxTokens);
  if (model.startsWith('gpt-'))    return callOpenAI(messages, model, maxTokens);
  return callOllama(messages, model);
}

// ── RouterClient 初始化 ───────────────────────────────────────
const routerUrl = process.env['ROUTER_URL'] ?? 'http://127.0.0.1:3001';
const fallbackModel = getYamlConfig().providers?.[0]?.model ?? 'claude-sonnet-4-6';
const fallbackProvider = getYamlConfig().providers?.[0]?.name ?? 'anthropic';
const router = new RouterClient(routerUrl, fallbackModel, fallbackProvider);

// ── 路由注册 ──────────────────────────────────────────────────
export const openaiRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: ChatCompletionRequest }>('/chat/completions', async (req, reply) => {
    const { messages, max_tokens = 4096 } = req.body;

    // 提取最后一条 user message 用于路由决策
    const prompt = lastUserMessage(messages);
    if (!prompt) {
      return reply.status(400).send({ error: 'messages must contain at least one user message' });
    }

    // 调用智能路由，获取路由决策
    const decision = await router.route(prompt);

    // 异步写入路由决策日志（非阻塞，与 /api/route 保持一致）
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

    // Provider 分发 + 响应组装
    try {
      const { content, promptTokens, completionTokens } =
        await dispatchProvider(messages, decision.model, max_tokens);

      const response: ChatCompletionResponse = {
        id: generateId(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: decision.model,
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

      return response;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      if (err instanceof ConfigError) return reply.status(400).send({ error: msg });
      return reply.status(502).send({ error: `provider error: ${msg}` });
    }
  });
};
