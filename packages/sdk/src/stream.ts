import { ClawGateError } from './errors.js';
import type { ChatChunk } from '@clawgate/shared';

/**
 * Parse an OpenAI-compatible SSE stream into an AsyncIterable of ChatChunk.
 *
 * Protocol:
 *   • Each event is a line starting with `data: `.
 *   • `data: [DONE]` terminates the stream.
 *   • Every other `data:` payload is a JSON ChatChunk or an error envelope.
 */
export async function* parseSseStream(response: Response): AsyncGenerator<ChatChunk, void, void> {
  if (!response.body) {
    throw new ClawGateError('Streaming response has no body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nlIndex: number;
      while ((nlIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nlIndex).replace(/\r$/, '');
        buffer = buffer.slice(nlIndex + 1);

        if (!line || !line.startsWith('data: ')) continue;
        const payload = line.slice(6);
        if (payload === '[DONE]') return;

        let parsed: unknown;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue; // skip malformed chunk
        }

        if (parsed && typeof parsed === 'object' && 'error' in parsed) {
          const err = (parsed as { error: { message?: string } }).error;
          throw new ClawGateError(err?.message ?? 'stream error', { body: parsed });
        }

        yield parsed as ChatChunk;
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}
