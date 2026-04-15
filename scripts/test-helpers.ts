// 简单测试断言工具

export function assertEquals(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`✗ ${message}: expected ${expected}, got ${actual}`);
  }
  console.log(`  ✓ ${message}`);
}

export function assertExists(value: unknown, message: string): void {
  if (value === undefined || value === null) {
    throw new Error(`✗ ${message}: value is ${value}`);
  }
  console.log(`  ✓ ${message}`);
}

export function assertTrue(value: boolean, message: string): void {
  if (!value) {
    throw new Error(`✗ ${message}: expected true, got ${value}`);
  }
  console.log(`  ✓ ${message}`);
}
