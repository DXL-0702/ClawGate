import { describe, it, expect } from 'vitest';
import { topologicalSort, hasCycle } from '../src/dag/topo-sort.js';
import { substituteVariables, extractReferencedNodes } from '../src/dag/variable-subst.js';

// ─── topologicalSort ────────────────────────────────────────────────────────

describe('topologicalSort', () => {
  it('empty graph returns empty batches', () => {
    expect(topologicalSort([], [])).toEqual([]);
  });

  it('single node returns one batch', () => {
    const result = topologicalSort([{ id: 'A' }], []);
    expect(result).toEqual([['A']]);
  });

  it('no edges — all nodes in one parallel batch', () => {
    const nodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
    const result = topologicalSort(nodes, []);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(3);
    expect(result[0]).toContain('A');
    expect(result[0]).toContain('B');
    expect(result[0]).toContain('C');
  });

  it('linear chain A → B → C produces three sequential batches', () => {
    const nodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
    const edges = [
      { id: 'e1', source: 'A', target: 'B' },
      { id: 'e2', source: 'B', target: 'C' },
    ];
    const result = topologicalSort(nodes, edges);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(['A']);
    expect(result[1]).toEqual(['B']);
    expect(result[2]).toEqual(['C']);
  });

  it('diamond A → B, A → C, B → D, C → D produces three layers', () => {
    const nodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }];
    const edges = [
      { id: 'e1', source: 'A', target: 'B' },
      { id: 'e2', source: 'A', target: 'C' },
      { id: 'e3', source: 'B', target: 'D' },
      { id: 'e4', source: 'C', target: 'D' },
    ];
    const result = topologicalSort(nodes, edges);
    // Layer 0: A
    expect(result[0]).toEqual(['A']);
    // Layer 1: B and C (parallel)
    expect(result[1]).toHaveLength(2);
    expect(result[1]).toContain('B');
    expect(result[1]).toContain('C');
    // Layer 2: D
    expect(result[2]).toEqual(['D']);
  });

  it('throws on simple cycle A → B → A', () => {
    const nodes = [{ id: 'A' }, { id: 'B' }];
    const edges = [
      { id: 'e1', source: 'A', target: 'B' },
      { id: 'e2', source: 'B', target: 'A' },
    ];
    expect(() => topologicalSort(nodes, edges)).toThrow(/cycle/i);
  });

  it('throws on self-loop A → A', () => {
    const nodes = [{ id: 'A' }];
    const edges = [{ id: 'e1', source: 'A', target: 'A' }];
    expect(() => topologicalSort(nodes, edges)).toThrow(/cycle/i);
  });

  it('skips edges referencing non-existent nodes', () => {
    const nodes = [{ id: 'A' }, { id: 'B' }];
    const edges = [
      { id: 'e1', source: 'A', target: 'B' },
      { id: 'e2', source: 'X', target: 'A' }, // X 不存在
    ];
    // 不应抛错，正常排序
    const result = topologicalSort(nodes, edges);
    expect(result[0]).toEqual(['A']);
    expect(result[1]).toEqual(['B']);
  });
});

// ─── hasCycle ────────────────────────────────────────────────────────────────

describe('hasCycle', () => {
  it('returns false for acyclic graph', () => {
    const nodes = [{ id: 'A' }, { id: 'B' }];
    const edges = [{ id: 'e1', source: 'A', target: 'B' }];
    expect(hasCycle(nodes, edges)).toBe(false);
  });

  it('returns true for cyclic graph', () => {
    const nodes = [{ id: 'A' }, { id: 'B' }];
    const edges = [
      { id: 'e1', source: 'A', target: 'B' },
      { id: 'e2', source: 'B', target: 'A' },
    ];
    expect(hasCycle(nodes, edges)).toBe(true);
  });
});

// ─── substituteVariables ─────────────────────────────────────────────────────

describe('substituteVariables', () => {
  it('replaces known variable with context value', () => {
    const result = substituteVariables(
      '基于以下分析：{{node-1.output}}，请生成报告',
      { 'node-1': '代码复杂度高' }
    );
    expect(result).toBe('基于以下分析：代码复杂度高，请生成报告');
  });

  it('replaces multiple variables', () => {
    const result = substituteVariables(
      '{{node-1.output}} 和 {{node-2.output}}',
      { 'node-1': '结果A', 'node-2': '结果B' }
    );
    expect(result).toBe('结果A 和 结果B');
  });

  it('leaves unknown variable unchanged', () => {
    const result = substituteVariables(
      '{{node-99.output}}',
      { 'node-1': '结果A' }
    );
    expect(result).toBe('{{node-99.output}}');
  });

  it('returns prompt unchanged when context is empty', () => {
    const prompt = 'No variables here';
    expect(substituteVariables(prompt, {})).toBe(prompt);
  });

  it('replaces same variable referenced twice', () => {
    const result = substituteVariables(
      '{{node-1.output}} plus {{node-1.output}}',
      { 'node-1': 'X' }
    );
    expect(result).toBe('X plus X');
  });
});

// ─── extractReferencedNodes ──────────────────────────────────────────────────

describe('extractReferencedNodes', () => {
  it('extracts single reference', () => {
    expect(extractReferencedNodes('{{node-1.output}}')).toEqual(['node-1']);
  });

  it('extracts multiple unique references', () => {
    const refs = extractReferencedNodes('{{node-1.output}} and {{node-2.output}}');
    expect(refs).toContain('node-1');
    expect(refs).toContain('node-2');
    expect(refs).toHaveLength(2);
  });

  it('deduplicates repeated references', () => {
    const refs = extractReferencedNodes('{{node-1.output}} {{node-1.output}}');
    expect(refs).toEqual(['node-1']);
  });

  it('returns empty array when no references', () => {
    expect(extractReferencedNodes('Hello world')).toEqual([]);
  });
});
