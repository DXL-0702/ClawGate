import { describe, it, expect } from 'vitest';
import { computeCacheKey } from '../src/dag/cache-key.js';

describe('computeCacheKey', () => {
  it('相同输入返回相同 hash', () => {
    const a = computeCacheKey('main', 'hello world');
    const b = computeCacheKey('main', 'hello world');
    expect(a).toBe(b);
  });

  it('不同 agentId 返回不同 hash', () => {
    const a = computeCacheKey('agent-1', 'hello world');
    const b = computeCacheKey('agent-2', 'hello world');
    expect(a).not.toBe(b);
  });

  it('不同 prompt 返回不同 hash', () => {
    const a = computeCacheKey('main', 'hello world');
    const b = computeCacheKey('main', 'hello world!');
    expect(a).not.toBe(b);
  });

  it('hash 长度为 64 字符', () => {
    const hash = computeCacheKey('main', 'test prompt');
    expect(hash).toHaveLength(64);
  });
});
