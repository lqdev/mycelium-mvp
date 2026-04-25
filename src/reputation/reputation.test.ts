import { describe, it, expect } from 'vitest';
import {
  scoreToAssessment,
  computeOverallScore,
  createStamp,
  getStampsForAgent,
  aggregateReputation,
  getTrustLevel,
  rankClaims,
  type ClaimCandidate,
} from './index.js';
import { createMemoryRepository } from '../repository/index.js';
import { generateIdentity } from '../identity/index.js';
import { createFirehose } from '../firehose/index.js';
import { publish } from '../firehose/index.js';
import type { ReputationDimensions, ReputationStamp } from '../schemas/types.js';

const NOW = '2026-01-01T00:00:00.000Z';

const PERFECT_DIMS: ReputationDimensions = {
  codeQuality: 10,
  reliability: 10,
  communication: 10,
  creativity: 10,
  efficiency: 10,
};

const GOOD_DIMS: ReputationDimensions = {
  codeQuality: 8,
  reliability: 8,
  communication: 7,
  creativity: 7,
  efficiency: 8,
};

const POOR_DIMS: ReputationDimensions = {
  codeQuality: 4,
  reliability: 3,
  communication: 4,
  creativity: 3,
  efficiency: 4,
};

function makeStamp(dims: ReputationDimensions, subjectDid: string, domain = 'backend', overallScore?: number, taskUri?: string): ReputationStamp {
  const score = overallScore ?? (dims.codeQuality * 0.30 + dims.reliability * 0.25 + dims.efficiency * 0.20 + dims.communication * 0.15 + dims.creativity * 0.10) * 10;
  return {
    $type: 'network.mycelium.reputation.stamp',
    subjectDid,
    attestorDid: 'did:key:z6MkAttestor',
    taskUri: taskUri ?? 'at://did:key:z6MkMayor/network.mycelium.task.posting/task-1',
    completionUri: 'at://did:key:z6MkAgent/network.mycelium.task.completion/comp-1',
    taskDomain: domain,
    dimensions: dims,
    overallScore: score,
    assessment: scoreToAssessment(score),
    createdAt: NOW,
  };
}

// ─── scoreToAssessment ────────────────────────────────────────────────────────

describe('scoreToAssessment()', () => {
  it('maps 100 → exceptional', () => expect(scoreToAssessment(100)).toBe('exceptional'));
  it('maps 90 → exceptional', () => expect(scoreToAssessment(90)).toBe('exceptional'));
  it('maps 89 → strong', () => expect(scoreToAssessment(89)).toBe('strong'));
  it('maps 80 → strong', () => expect(scoreToAssessment(80)).toBe('strong'));
  it('maps 65 → satisfactory', () => expect(scoreToAssessment(65)).toBe('satisfactory'));
  it('maps 50 → needs_improvement', () => expect(scoreToAssessment(50)).toBe('needs_improvement'));
  it('maps 0 → unsatisfactory', () => expect(scoreToAssessment(0)).toBe('unsatisfactory'));
});

// ─── computeOverallScore ─────────────────────────────────────────────────────

describe('computeOverallScore()', () => {
  it('returns 100 for all-10 dimensions', () => {
    expect(computeOverallScore(PERFECT_DIMS)).toBeCloseTo(100);
  });

  it('returns 0 for all-0 dimensions', () => {
    expect(computeOverallScore({ codeQuality: 0, reliability: 0, communication: 0, creativity: 0, efficiency: 0 })).toBe(0);
  });

  it('uses correct weights', () => {
    // Only codeQuality = 10, rest = 0 → 10 * 0.30 * 10 = 30
    const dims: ReputationDimensions = { codeQuality: 10, reliability: 0, communication: 0, creativity: 0, efficiency: 0 };
    expect(computeOverallScore(dims)).toBeCloseTo(30);
  });
});

// ─── createStamp ──────────────────────────────────────────────────────────────

describe('createStamp()', () => {
  it('creates a stamp and stores it in the attestor repo', () => {
    const attestorId = generateIdentity('mayor.local', 'Mayor');
    const attestorRepo = createMemoryRepository(attestorId);
    const subjectDid = 'did:key:z6MkSubject';

    const { stamp, uri } = createStamp(
      attestorRepo,
      subjectDid,
      'at://did:key:z6Mk/network.mycelium.task.posting/t1',
      'at://did:key:z6Mk/network.mycelium.task.completion/c1',
      'backend',
      GOOD_DIMS,
    );

    expect(stamp.subjectDid).toBe(subjectDid);
    expect(stamp.overallScore).toBeCloseTo(computeOverallScore(GOOD_DIMS));
    expect(stamp.assessment).toBeTruthy();
    expect(uri).toContain('network.mycelium.reputation.stamp');
  });

  it('applies rework penalty to overallScore', () => {
    const attestorRepo = createMemoryRepository(generateIdentity('mayor.local', 'Mayor'));
    const { stamp } = createStamp(
      attestorRepo,
      'did:key:z6MkSubject',
      'at://did:key:z6Mk/network.mycelium.task.posting/t1',
      'at://did:key:z6Mk/network.mycelium.task.completion/c1',
      'backend',
      PERFECT_DIMS,
      undefined,
      10, // rework penalty
    );
    expect(stamp.overallScore).toBeCloseTo(90); // 100 - 10
    expect(stamp.assessment).toBe('exceptional'); // 90 is still exceptional
  });

  it('score does not go below 0 with large penalty', () => {
    const attestorRepo = createMemoryRepository(generateIdentity('mayor.local', 'Mayor'));
    const { stamp } = createStamp(
      attestorRepo,
      'did:key:z6MkSubject',
      'at://did:key:z6Mk/network.mycelium.task.posting/t1',
      'at://did:key:z6Mk/network.mycelium.task.completion/c1',
      'backend',
      POOR_DIMS,
      undefined,
      200, // massive penalty
    );
    expect(stamp.overallScore).toBe(0);
  });
});

// ─── getStampsForAgent ────────────────────────────────────────────────────────

describe('getStampsForAgent()', () => {
  it('returns stamps for a specific subject from firehose log', () => {
    const fh = createFirehose();
    const subjectDid = 'did:key:z6MkSubjectA';
    const otherDid = 'did:key:z6MkSubjectB';

    publish(fh, {
      seq: 1, type: 'commit', operation: 'create',
      did: 'did:key:z6MkMayor', collection: 'network.mycelium.reputation.stamp', rkey: 's1',
      record: makeStamp(GOOD_DIMS, subjectDid),
      timestamp: NOW,
    });
    publish(fh, {
      seq: 2, type: 'commit', operation: 'create',
      did: 'did:key:z6MkMayor', collection: 'network.mycelium.reputation.stamp', rkey: 's2',
      record: makeStamp(GOOD_DIMS, otherDid),
      timestamp: NOW,
    });

    const stamps = getStampsForAgent(fh, subjectDid);
    expect(stamps).toHaveLength(1);
    expect(stamps[0]?.subjectDid).toBe(subjectDid);
  });

  it('returns empty array when no stamps exist', () => {
    const fh = createFirehose();
    expect(getStampsForAgent(fh, 'did:key:z6MkNobody')).toHaveLength(0);
  });
});

// ─── aggregateReputation ──────────────────────────────────────────────────────

describe('aggregateReputation()', () => {
  it('returns zero-score for empty stamps array', () => {
    const agg = aggregateReputation([]);
    expect(agg.totalTasks).toBe(0);
    expect(agg.overallScore).toBe(0);
    expect(agg.trustLevel).toBe('newcomer');
    expect(agg.recentTrend).toBe('stable');
  });

  it('correctly counts totalTasks (unique task URIs)', () => {
    const subjectDid = 'did:key:z6MkAgent';
    const stamps = [
      makeStamp(GOOD_DIMS, subjectDid, 'backend', undefined, 'at://did:key:z6MkMayor/network.mycelium.task.posting/task-1'),
      makeStamp(GOOD_DIMS, subjectDid, 'backend', undefined, 'at://did:key:z6MkMayor/network.mycelium.task.posting/task-2'),
    ];
    const agg = aggregateReputation(stamps);
    expect(agg.totalTasks).toBe(2);
  });

  it('counts duplicate taskUri stamps as one task (multi-attestor)', () => {
    const subjectDid = 'did:key:z6MkAgent';
    const taskUri = 'at://did:key:z6MkMayor/network.mycelium.task.posting/task-1';
    const stamps = [
      { ...makeStamp(GOOD_DIMS, subjectDid, 'backend', undefined, taskUri), attestorType: 'mayor' as const },
      { ...makeStamp(GOOD_DIMS, subjectDid, 'backend', undefined, taskUri), attestorType: 'requester' as const },
    ];
    const agg = aggregateReputation(stamps);
    expect(agg.totalTasks).toBe(1);
  });

  it('populates taskBreakdown per domain', () => {
    const subjectDid = 'did:key:z6MkAgent';
    const stamps = [
      makeStamp(GOOD_DIMS, subjectDid, 'backend'),
      makeStamp(GOOD_DIMS, subjectDid, 'frontend'),
      makeStamp(GOOD_DIMS, subjectDid, 'backend'),
    ];
    const agg = aggregateReputation(stamps);
    expect(agg.taskBreakdown['backend']?.count).toBe(2);
    expect(agg.taskBreakdown['frontend']?.count).toBe(1);
  });

  it('stable trend with single stamp', () => {
    const agg = aggregateReputation([makeStamp(GOOD_DIMS, 'did:key:z6Mk')]);
    expect(agg.recentTrend).toBe('stable');
  });
});

// ─── getTrustLevel ────────────────────────────────────────────────────────────

describe('getTrustLevel()', () => {
  it('newcomer: 0 tasks', () => {
    expect(getTrustLevel({ totalTasks: 0, overallScore: 0 })).toBe('newcomer');
  });
  it('newcomer: 3 tasks but score < 60', () => {
    expect(getTrustLevel({ totalTasks: 3, overallScore: 55 })).toBe('newcomer');
  });
  it('established: 3 tasks, score ≥ 60', () => {
    expect(getTrustLevel({ totalTasks: 3, overallScore: 60 })).toBe('established');
  });
  it('trusted: 10 tasks, score ≥ 75', () => {
    expect(getTrustLevel({ totalTasks: 10, overallScore: 75 })).toBe('trusted');
  });
  it('expert: 25 tasks, score ≥ 85', () => {
    expect(getTrustLevel({ totalTasks: 25, overallScore: 85 })).toBe('expert');
  });
});

// ─── rankClaims ───────────────────────────────────────────────────────────────

describe('rankClaims()', () => {
  const backendCap = {
    $type: 'network.mycelium.agent.capability' as const,
    name: 'Backend', slug: 'backend', domain: 'backend', description: 'd',
    proficiencyLevel: 'expert' as const, tags: ['nodejs', 'jwt'],
    tools: [], createdAt: NOW, updatedAt: NOW,
  };

  const task = {
    $type: 'network.mycelium.task.posting' as const,
    title: 'Auth', description: 'JWT',
    requiredCapabilities: [{ domain: 'backend', tags: ['nodejs', 'jwt'], minProficiency: 'intermediate' as const }],
    complexity: 'medium' as const, priority: 'high' as const,
    context: { projectName: 'P', projectDescription: 'D' },
    deliverables: ['auth.ts'],
    status: 'open' as const,
    createdAt: NOW, updatedAt: NOW,
  };

  it('returns candidates sorted by descending rankScore', () => {
    const candidates: ClaimCandidate[] = [
      { did: 'did:key:A', claim: { proposal: { confidenceLevel: 'high' } }, capabilities: [backendCap], activeTasks: 0, reputation: null },
      { did: 'did:key:B', claim: { proposal: { confidenceLevel: 'low' } }, capabilities: [backendCap], activeTasks: 3, reputation: null },
    ];
    const ranked = rankClaims(candidates, task);
    expect(ranked[0]!.rankScore).toBeGreaterThan(ranked[1]!.rankScore);
    expect(ranked[0]!.did).toBe('did:key:A');
  });

  it('disqualifies newcomers from high-complexity tasks', () => {
    const highTask = { ...task, complexity: 'high' as const };
    const candidates: ClaimCandidate[] = [
      { did: 'did:key:N', claim: { proposal: { confidenceLevel: 'high' } }, capabilities: [backendCap], activeTasks: 0, reputation: null },
    ];
    const ranked = rankClaims(candidates, highTask);
    expect(ranked[0]!.rankScore).toBe(-1);
  });

  it('does NOT disqualify established+ agents from high-complexity tasks', () => {
    const highTask = { ...task, complexity: 'high' as const };
    const establishedRep = aggregateReputation([
      makeStamp(GOOD_DIMS, 'did:key:E', 'backend', undefined, 'at://did:key:z6MkMayor/network.mycelium.task.posting/task-e1'),
      makeStamp(GOOD_DIMS, 'did:key:E', 'backend', undefined, 'at://did:key:z6MkMayor/network.mycelium.task.posting/task-e2'),
      makeStamp(GOOD_DIMS, 'did:key:E', 'backend', undefined, 'at://did:key:z6MkMayor/network.mycelium.task.posting/task-e3'),
    ]);
    const candidates: ClaimCandidate[] = [
      { did: 'did:key:E', claim: { proposal: { confidenceLevel: 'high' } }, capabilities: [backendCap], activeTasks: 0, reputation: establishedRep },
    ];
    const ranked = rankClaims(candidates, highTask);
    expect(ranked[0]!.rankScore).toBeGreaterThan(0);
  });
});

// ─── createStamp — attestorType ───────────────────────────────────────────────

describe('createStamp() attestorType', () => {
  it('defaults to undefined when attestorType is not provided', () => {
    const repo = createMemoryRepository(generateIdentity('mayor.local', 'Mayor'));
    const { stamp } = createStamp(
      repo, 'did:key:z6MkSubject',
      'at://did:key:z6Mk/network.mycelium.task.posting/t1',
      'at://did:key:z6Mk/network.mycelium.task.completion/c1',
      'backend', GOOD_DIMS,
    );
    expect(stamp.attestorType).toBeUndefined();
  });

  it('stores attestorType: requester when explicitly provided', () => {
    const repo = createMemoryRepository(generateIdentity('mayor.local', 'Mayor'));
    const { stamp } = createStamp(
      repo, 'did:key:z6MkSubject',
      'at://did:key:z6Mk/network.mycelium.task.posting/t1',
      'at://did:key:z6Mk/network.mycelium.task.completion/c1',
      'backend', GOOD_DIMS,
      undefined, 0, undefined, undefined, 'requester',
    );
    expect(stamp.attestorType).toBe('requester');
  });

  it('stores attestorType: mayor when explicitly provided', () => {
    const repo = createMemoryRepository(generateIdentity('mayor.local', 'Mayor'));
    const { stamp } = createStamp(
      repo, 'did:key:z6MkSubject',
      'at://did:key:z6Mk/network.mycelium.task.posting/t1',
      'at://did:key:z6Mk/network.mycelium.task.completion/c1',
      'backend', GOOD_DIMS,
      undefined, 0, undefined, undefined, 'mayor',
    );
    expect(stamp.attestorType).toBe('mayor');
  });
});

// ─── aggregateReputation — multi-attestor ─────────────────────────────────────

describe('aggregateReputation() multi-attestor', () => {
  const subjectDid = 'did:key:z6MkAgent';
  const TASK_URI_1 = 'at://did:key:z6MkMayor/network.mycelium.task.posting/task-1';
  const TASK_URI_2 = 'at://did:key:z6MkMayor/network.mycelium.task.posting/task-2';

  it('backward compat: only mayor stamps produce same score as before', () => {
    const stamps = [
      { ...makeStamp(GOOD_DIMS, subjectDid, 'backend', undefined, TASK_URI_1), attestorType: 'mayor' as const },
      { ...makeStamp(GOOD_DIMS, subjectDid, 'backend', undefined, TASK_URI_2), attestorType: 'mayor' as const },
    ];
    const mixedAgg = aggregateReputation(stamps);
    // All mayor stamps: attestor weight cancels algebraically; score should equal uniform result
    const baseAgg = aggregateReputation([
      makeStamp(GOOD_DIMS, subjectDid, 'backend', undefined, TASK_URI_1),
      makeStamp(GOOD_DIMS, subjectDid, 'backend', undefined, TASK_URI_2),
    ]);
    expect(mixedAgg.overallScore).toBeCloseTo(baseAgg.overallScore, 5);
  });

  it('populates breakdownByAttestor with correct counts', () => {
    const stamps = [
      { ...makeStamp(GOOD_DIMS, subjectDid, 'backend', undefined, TASK_URI_1), attestorType: 'mayor' as const },
      { ...makeStamp(GOOD_DIMS, subjectDid, 'backend', undefined, TASK_URI_1), attestorType: 'requester' as const },
    ];
    const agg = aggregateReputation(stamps);
    expect(agg.breakdownByAttestor?.['mayor']?.count).toBe(1);
    expect(agg.breakdownByAttestor?.['requester']?.count).toBe(1);
  });

  it('requester stamp with lower score reduces overallScore', () => {
    const mayorStamp = { ...makeStamp(PERFECT_DIMS, subjectDid, 'backend', 100, TASK_URI_1), attestorType: 'mayor' as const };
    const requesterStamp = { ...makeStamp(POOR_DIMS, subjectDid, 'backend', undefined, TASK_URI_1), attestorType: 'requester' as const };
    const stamps = [mayorStamp, requesterStamp];
    const agg = aggregateReputation(stamps);
    // Mixed attestors: weighted average should be lower than pure mayor score of 100
    expect(agg.overallScore).toBeLessThan(100);
    expect(agg.overallScore).toBeGreaterThan(0);
  });
});
