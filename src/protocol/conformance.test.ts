import { describe, expect, it } from 'vitest';
import { MemoryPdsConformanceAdapter, runProtocolConformance } from './conformance.js';

describe('Protocol 0.1 black-box conformance adapter', () => {
  it('passes the five-principal lifecycle and negative scope test', async () => {
    const report = await runProtocolConformance(new MemoryPdsConformanceAdapter());
    expect(report.passed).toBe(true);
    expect(report.checks).toHaveLength(7);
    expect(report.checks.every((check) => check.passed)).toBe(true);
  });
});
