import { describe, expect, it } from 'vitest';
import { MemoryPdsConformanceAdapter, runProtocolConformance } from './conformance.js';
import { COLLECTIONS } from './constants.js';

describe('Protocol 0.1 black-box conformance adapter', () => {
  it('passes the five-principal lifecycle and negative scope test', async () => {
    const report = await runProtocolConformance(new MemoryPdsConformanceAdapter());
    expect(report.passed).toBe(true);
    expect(report.checks).toHaveLength(7);
    expect(report.checks.every((check) => check.passed)).toBe(true);
  });

  it('does not allow a create-only session to overwrite an immutable fact', async () => {
    const adapter = new MemoryPdsConformanceAdapter();
    const requester = await adapter.session('requester');
    const offer = {
      $type: COLLECTIONS.taskOffer,
      taskId: 'immutable-task',
      title: 'Immutable task',
      description: 'The first version',
      requiredCapabilities: ['typescript'],
      contextRefs: [],
      deliverables: ['patch'],
      requesterDid: requester.did,
      governance: { mode: 'requester-selected' as const },
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    await adapter.put(requester, COLLECTIONS.taskOffer, 'task-1', offer);
    await expect(adapter.put(requester, COLLECTIONS.taskOffer, 'task-1', {
      ...offer,
      title: 'Attempted overwrite',
    })).rejects.toThrow(/Permission denied for update/);
  });
});
