// Tests for the WorkTrace builder — covers accepted, pending, and missing-task cases.

import { describe, it, expect } from 'vitest';
import { buildWorkTrace } from './work-trace.js';
import { createFirehose, publish } from '../firehose/index.js';
import type { Firehose, MatchRecommendation, ReputationStamp, TaskAssignment, TaskClaim, TaskCompletion, TaskPosting, VerificationResult } from '../schemas/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MAYOR_DID = 'did:key:z6MkMayor';
const AGENT_DID = 'did:key:z6MkAgent';
const CUSTOMER_DID = 'did:key:z6MkCustomer';
const TASK_URI = `at://${MAYOR_DID}/network.mycelium.task.posting/task-001`;
const TASK_RKEY = 'task-001';
const TASK_ID = 'task-001';
const TASK_TITLE = 'Build Dashboard UI';

function makePosting(status: TaskPosting['status']): TaskPosting {
  return {
    $type: 'network.mycelium.task.posting',
    title: TASK_TITLE,
    description: 'Build a dashboard',
    requiredCapabilities: [{ domain: 'frontend', tags: ['react'], proficiencyLevel: 'intermediate' }],
    complexity: 'medium',
    priority: 'high',
    status,
    createdAt: new Date().toISOString(),
  };
}

function makeClaim(): TaskClaim {
  return {
    $type: 'network.mycelium.task.claim',
    taskUri: TASK_URI,
    claimerDid: AGENT_DID,
    matchingCapabilities: [{ domain: 'frontend', tags: ['react'], proficiencyLevel: 'intermediate' }],
    proposal: { approach: 'standard', confidenceLevel: 'high' },
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
}

function makeCompletion(): TaskCompletion {
  return {
    $type: 'network.mycelium.task.completion',
    taskUri: TASK_URI,
    completerDid: AGENT_DID,
    deliverables: [{ type: 'code', description: 'Frontend component', uri: 'at://test/a/b' }],
    metrics: { executionTime: '1m', testsPassed: 5, testsTotal: 5, coveragePercent: 90 },
    summary: 'Dashboard built with all required components',
    createdAt: new Date().toISOString(),
  };
}

function makeVerificationResult(status: VerificationResult['status']): VerificationResult {
  return {
    $type: 'network.mycelium.verification.result',
    taskUri: TASK_URI,
    completionUri: `at://${AGENT_DID}/network.mycelium.task.completion/c1`,
    verifierDid: MAYOR_DID,
    verificationType: 'simulation-metrics',
    status,
    summary: `Tests ${status}`,
    evidence: ['5/5 tests passed'],
    createdAt: new Date().toISOString(),
  };
}

function makeStamp(assessment: ReputationStamp['assessment'], attestorType: 'mayor' | 'requester'): ReputationStamp {
  return {
    $type: 'network.mycelium.reputation.stamp',
    subjectDid: AGENT_DID,
    attestorDid: attestorType === 'mayor' ? MAYOR_DID : CUSTOMER_DID,
    taskUri: TASK_URI,
    completionUri: `at://${AGENT_DID}/network.mycelium.task.completion/c1`,
    taskDomain: 'frontend',
    dimensions: { codeQuality: 8, reliability: 8, communication: 8, creativity: 8, efficiency: 8 },
    overallScore: 80,
    assessment,
    comment: 'Solid work',
    attestorType,
    createdAt: new Date().toISOString(),
  };
}

function makeMatchRecommendation(): MatchRecommendation {
  return {
    $type: 'network.mycelium.match.recommendation',
    taskUri: TASK_URI,
    matcherDid: MAYOR_DID,
    policy: 'trust-weighted',
    rankings: [{
      rank: 1,
      candidateDid: AGENT_DID,
      claimUri: `at://${AGENT_DID}/network.mycelium.task.claim/c1`,
      score: 75.5,
      reasons: ['reputation score 80.0 (3 tasks)', 'confidence: high'],
    }],
    selectedDid: AGENT_DID,
    selectedClaimUri: `at://${AGENT_DID}/network.mycelium.task.claim/c1`,
    createdAt: new Date().toISOString(),
  };
}

function makeTaskAssignment(): TaskAssignment {
  return {
    $type: 'network.mycelium.task.assignment',
    taskUri: TASK_URI,
    claimUri: `at://${AGENT_DID}/network.mycelium.task.claim/c1`,
    coordinatorDid: MAYOR_DID,
    assigneeDid: AGENT_DID,
    matchRecommendationUri: `at://${MAYOR_DID}/network.mycelium.match.recommendation/r1`,
    assignmentPolicy: 'top-ranked',
    createdAt: new Date().toISOString(),
  };
}

function seq(fh: Firehose) { return fh.seq++; }

function publishPosting(fh: Firehose, status: TaskPosting['status'], operation: 'create' | 'update' = 'create') {
  publish(fh, {
    seq: seq(fh), type: 'commit', operation,
    did: MAYOR_DID, collection: 'network.mycelium.task.posting', rkey: TASK_RKEY,
    record: makePosting(status),
    timestamp: new Date().toISOString(),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('buildWorkTrace()', () => {
  it('returns correct scope and taskId', () => {
    const fh = createFirehose();
    publishPosting(fh, 'open');
    const trace = buildWorkTrace(fh, TASK_URI, TASK_ID, TASK_TITLE, MAYOR_DID);
    expect(trace.scope).toBe('task');
    expect(trace.taskId).toBe(TASK_ID);
    expect(trace.taskUri).toBe(TASK_URI);
    expect(trace.title).toBe(TASK_TITLE);
  });

  it('includes task.posting step when posting event is present', () => {
    const fh = createFirehose();
    publishPosting(fh, 'open');
    const trace = buildWorkTrace(fh, TASK_URI, TASK_ID, TASK_TITLE, MAYOR_DID);
    const postingStep = trace.steps.find((s) => s.eventType === 'task.posting');
    expect(postingStep).toBeDefined();
    expect(postingStep?.role).toBe('requester');
    expect(postingStep?.summary).toContain(TASK_TITLE);
  });

  it('notes missing evidence for pending tasks with no claims', () => {
    const fh = createFirehose();
    publishPosting(fh, 'open');
    const trace = buildWorkTrace(fh, TASK_URI, TASK_ID, TASK_TITLE, MAYOR_DID);
    expect(trace.missingEvidence.some((m) => m.toLowerCase().includes('claim'))).toBe(true);
  });

  it('includes task.claim step when claims are present', () => {
    const fh = createFirehose();
    publishPosting(fh, 'open');
    publish(fh, {
      seq: seq(fh), type: 'commit', operation: 'create',
      did: AGENT_DID, collection: 'network.mycelium.task.claim', rkey: 'c1',
      record: makeClaim(), timestamp: new Date().toISOString(),
    });
    const trace = buildWorkTrace(fh, TASK_URI, TASK_ID, TASK_TITLE, MAYOR_DID);
    const claimStep = trace.steps.find((s) => s.eventType === 'task.claim');
    expect(claimStep).toBeDefined();
    expect(claimStep?.role).toBe('worker');
  });

  it('includes match.recommendation step when present', () => {
    const fh = createFirehose();
    publishPosting(fh, 'open');
    publish(fh, {
      seq: seq(fh), type: 'commit', operation: 'create',
      did: AGENT_DID, collection: 'network.mycelium.task.claim', rkey: 'c1',
      record: makeClaim(), timestamp: new Date().toISOString(),
    });
    publish(fh, {
      seq: seq(fh), type: 'commit', operation: 'create',
      did: MAYOR_DID, collection: 'network.mycelium.match.recommendation', rkey: 'r1',
      record: makeMatchRecommendation(), timestamp: new Date().toISOString(),
    });
    const trace = buildWorkTrace(fh, TASK_URI, TASK_ID, TASK_TITLE, MAYOR_DID);
    const recStep = trace.steps.find((s) => s.eventType === 'match.recommendation');
    expect(recStep).toBeDefined();
    expect(recStep?.role).toBe('matcher');
    expect(recStep?.summary).toContain('ranked');
  });

  it('includes task.assignment step when present', () => {
    const fh = createFirehose();
    publishPosting(fh, 'open');
    publish(fh, {
      seq: seq(fh), type: 'commit', operation: 'create',
      did: MAYOR_DID, collection: 'network.mycelium.task.assignment', rkey: 'a1',
      record: makeTaskAssignment(), timestamp: new Date().toISOString(),
    });
    const trace = buildWorkTrace(fh, TASK_URI, TASK_ID, TASK_TITLE, MAYOR_DID);
    const assignStep = trace.steps.find((s) => s.eventType === 'task.assignment');
    expect(assignStep).toBeDefined();
    expect(assignStep?.role).toBe('coordinator');
    expect(assignStep?.summary).toContain('assigned');
  });

  it('includes task.completion step with metric summary', () => {
    const fh = createFirehose();
    publishPosting(fh, 'completed');
    publish(fh, {
      seq: seq(fh), type: 'commit', operation: 'create',
      did: AGENT_DID, collection: 'network.mycelium.task.completion', rkey: 'comp1',
      record: makeCompletion(), timestamp: new Date().toISOString(),
    });
    const trace = buildWorkTrace(fh, TASK_URI, TASK_ID, TASK_TITLE, MAYOR_DID);
    const compStep = trace.steps.find((s) => s.eventType === 'task.completion');
    expect(compStep).toBeDefined();
    expect(compStep?.role).toBe('worker');
    expect(compStep?.summary).toContain('5/5');
  });

  it('includes verification.result step with status', () => {
    const fh = createFirehose();
    publishPosting(fh, 'completed');
    publish(fh, {
      seq: seq(fh), type: 'commit', operation: 'create',
      did: AGENT_DID, collection: 'network.mycelium.task.completion', rkey: 'comp1',
      record: makeCompletion(), timestamp: new Date().toISOString(),
    });
    publish(fh, {
      seq: seq(fh), type: 'commit', operation: 'create',
      did: MAYOR_DID, collection: 'network.mycelium.verification.result', rkey: 'v1',
      record: makeVerificationResult('passed'), timestamp: new Date().toISOString(),
    });
    const trace = buildWorkTrace(fh, TASK_URI, TASK_ID, TASK_TITLE, MAYOR_DID);
    const verStep = trace.steps.find((s) => s.eventType === 'verification.result');
    expect(verStep).toBeDefined();
    expect(verStep?.role).toBe('verifier');
    expect(verStep?.summary).toContain('passed');
  });

  it('includes reputation.stamp step when stamp is present', () => {
    const fh = createFirehose();
    publishPosting(fh, 'accepted');
    publish(fh, {
      seq: seq(fh), type: 'commit', operation: 'create',
      did: MAYOR_DID, collection: 'network.mycelium.reputation.stamp', rkey: 's1',
      record: makeStamp('strong', 'mayor'), timestamp: new Date().toISOString(),
    });
    const trace = buildWorkTrace(fh, TASK_URI, TASK_ID, TASK_TITLE, MAYOR_DID);
    const stampStep = trace.steps.find((s) => s.eventType === 'reputation.stamp');
    expect(stampStep).toBeDefined();
    expect(stampStep?.role).toBe('attestor');
    expect(stampStep?.summary).toContain('strong');
  });

  it('full accepted task has all 7 step types', () => {
    const fh = createFirehose();
    publishPosting(fh, 'open');
    publish(fh, {
      seq: seq(fh), type: 'commit', operation: 'update',
      did: MAYOR_DID, collection: 'network.mycelium.task.posting', rkey: TASK_RKEY,
      record: makePosting('open'), timestamp: new Date().toISOString(),
    });
    publish(fh, {
      seq: seq(fh), type: 'commit', operation: 'create',
      did: AGENT_DID, collection: 'network.mycelium.task.claim', rkey: 'c1',
      record: makeClaim(), timestamp: new Date().toISOString(),
    });
    publish(fh, {
      seq: seq(fh), type: 'commit', operation: 'create',
      did: MAYOR_DID, collection: 'network.mycelium.match.recommendation', rkey: 'r1',
      record: makeMatchRecommendation(), timestamp: new Date().toISOString(),
    });
    publish(fh, {
      seq: seq(fh), type: 'commit', operation: 'create',
      did: MAYOR_DID, collection: 'network.mycelium.task.assignment', rkey: 'a1',
      record: makeTaskAssignment(), timestamp: new Date().toISOString(),
    });
    publish(fh, {
      seq: seq(fh), type: 'commit', operation: 'create',
      did: AGENT_DID, collection: 'network.mycelium.task.completion', rkey: 'comp1',
      record: makeCompletion(), timestamp: new Date().toISOString(),
    });
    publish(fh, {
      seq: seq(fh), type: 'commit', operation: 'create',
      did: MAYOR_DID, collection: 'network.mycelium.verification.result', rkey: 'v1',
      record: makeVerificationResult('passed'), timestamp: new Date().toISOString(),
    });
    publish(fh, {
      seq: seq(fh), type: 'commit', operation: 'create',
      did: MAYOR_DID, collection: 'network.mycelium.reputation.stamp', rkey: 's1',
      record: makeStamp('strong', 'mayor'), timestamp: new Date().toISOString(),
    });

    const trace = buildWorkTrace(fh, TASK_URI, TASK_ID, TASK_TITLE, MAYOR_DID);
    const types = trace.steps.map((s) => s.eventType);
    expect(types).toContain('task.posting');
    expect(types).toContain('task.claim');
    expect(types).toContain('match.recommendation');
    expect(types).toContain('task.assignment');
    expect(types).toContain('task.completion');
    expect(types).toContain('verification.result');
    expect(types).toContain('reputation.stamp');
    expect(trace.missingEvidence).toHaveLength(0);
  });

  it('generates consequences mentioning the agent after acceptance', () => {
    const fh = createFirehose();
    publishPosting(fh, 'accepted');
    publish(fh, {
      seq: seq(fh), type: 'commit', operation: 'create',
      did: MAYOR_DID, collection: 'network.mycelium.reputation.stamp', rkey: 's1',
      record: makeStamp('strong', 'mayor'), timestamp: new Date().toISOString(),
    });
    const trace = buildWorkTrace(fh, TASK_URI, TASK_ID, TASK_TITLE, MAYOR_DID);
    expect(trace.consequences.some((c) => c.toLowerCase().includes('verified'))).toBe(true);
  });

  it('returns summary that mentions task title', () => {
    const fh = createFirehose();
    publishPosting(fh, 'open');
    const trace = buildWorkTrace(fh, TASK_URI, TASK_ID, TASK_TITLE, MAYOR_DID);
    expect(trace.summary).toContain(TASK_TITLE);
  });

  it('handles task with no posting event gracefully', () => {
    const fh = createFirehose();
    // No posting event — trace still builds with missing evidence noted
    const trace = buildWorkTrace(fh, TASK_URI, TASK_ID, TASK_TITLE, MAYOR_DID);
    expect(trace.missingEvidence.some((m) => m.toLowerCase().includes('posting'))).toBe(true);
    expect(trace.steps).toHaveLength(0);
  });

  it('steps are ordered by seq number', () => {
    const fh = createFirehose();
    publishPosting(fh, 'open');
    publish(fh, {
      seq: seq(fh), type: 'commit', operation: 'create',
      did: AGENT_DID, collection: 'network.mycelium.task.claim', rkey: 'c1',
      record: makeClaim(), timestamp: new Date().toISOString(),
    });
    const trace = buildWorkTrace(fh, TASK_URI, TASK_ID, TASK_TITLE, MAYOR_DID);
    const seqs = trace.steps.map((s) => s.seq ?? 0).filter((s) => s > 0);
    const sorted = [...seqs].sort((a, b) => a - b);
    expect(seqs).toEqual(sorted);
  });
});
