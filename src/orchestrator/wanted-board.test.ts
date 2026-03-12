import { describe, it, expect } from 'vitest';
import {
  postTask,
  claimTask,
  assignTask,
  startTask,
  completeTask,
  transitionTask,
  reviewCompletion,
  getTask,
  shouldClaim,
} from './wanted-board.js';
import { createMemoryRepository } from '../repository/index.js';
import { generateIdentity } from '../identity/index.js';
import { createFirehose } from '../firehose/index.js';
import { InvalidStateTransitionError } from '../errors.js';
import type { AgentCapability } from '../schemas/types.js';

function makeOrchestratorRepo() {
  const identity = generateIdentity('mayor.local', 'Mayor');
  const firehose = createFirehose();
  return { repo: createMemoryRepository(identity, firehose), identity, firehose };
}

function makeAgentRepo() {
  const identity = generateIdentity('agent.local', 'Agent');
  return { repo: createMemoryRepository(identity), identity };
}

const TASK_SPEC = {
  title: 'Build auth module',
  description: 'Implement JWT authentication',
  requiredCapabilities: [
    { domain: 'backend', tags: ['nodejs', 'jwt'], minProficiency: 'intermediate' as const },
  ],
  complexity: 'medium' as const,
  priority: 'high' as const,
  context: { projectName: 'Demo', projectDescription: 'MVP project' },
  deliverables: ['src/auth.ts'],
};

const COMPLETION_RESULTS = {
  summary: 'Implemented JWT auth',
  artifacts: [
    { name: 'auth.ts', type: 'code' as const, contentHash: 'sha256-abc', size: 512, description: 'Auth module' },
  ],
  metrics: { executionTime: 'PT1H', linesOfCode: 200, testsPassed: 10, testsTotal: 10 },
};

// ─── postTask ─────────────────────────────────────────────────────────────────

describe('postTask()', () => {
  it('creates a task.posting with status "open"', () => {
    const { repo } = makeOrchestratorRepo();
    const { uri } = postTask(repo, TASK_SPEC);
    const task = getTask(repo, uri);
    expect(task.status).toBe('open');
    expect(task.title).toBe(TASK_SPEC.title);
    expect(task.claimUris).toEqual([]);
  });

  it('uses a deterministic rkey when provided', () => {
    const { repo } = makeOrchestratorRepo();
    const { rkey } = postTask(repo, TASK_SPEC, 'my-task-1');
    expect(rkey).toBe('my-task-1');
  });
});

// ─── claimTask ────────────────────────────────────────────────────────────────

describe('claimTask()', () => {
  it('creates a task.claim record in the agent repo', () => {
    const { repo: orchRepo } = makeOrchestratorRepo();
    const { repo: agentRepo, identity } = makeAgentRepo();
    const { uri: taskUri } = postTask(orchRepo, TASK_SPEC);

    const { uri: claimUri } = claimTask(agentRepo, taskUri, TASK_SPEC.title, {
      approach: 'Use express-jwt',
      estimatedDuration: 'PT2H',
      confidenceLevel: 'high',
    }, ['nodejs']);

    expect(claimUri).toContain(identity.did);
    expect(claimUri).toContain('network.mycelium.task.claim');
  });

  it('does NOT change task status (orchestrator observes firehose)', () => {
    const { repo: orchRepo } = makeOrchestratorRepo();
    const { repo: agentRepo } = makeAgentRepo();
    const { uri: taskUri } = postTask(orchRepo, TASK_SPEC);

    claimTask(agentRepo, taskUri, TASK_SPEC.title, {
      approach: 'approach',
      estimatedDuration: 'PT1H',
      confidenceLevel: 'medium',
    }, []);

    expect(getTask(orchRepo, taskUri).status).toBe('open');
  });
});

// ─── assignTask ───────────────────────────────────────────────────────────────

describe('assignTask()', () => {
  it('transitions task from open → assigned and sets assigneeDid', () => {
    const { repo: orchRepo } = makeOrchestratorRepo();
    const { repo: agentRepo, identity: agentId } = makeAgentRepo();
    const { uri: taskUri } = postTask(orchRepo, TASK_SPEC);

    assignTask(orchRepo, taskUri, agentId.did);

    const task = getTask(orchRepo, taskUri);
    expect(task.status).toBe('assigned');
    expect(task.assigneeDid).toBe(agentId.did);
  });

  it('rejects invalid transition (assigned → assigned)', () => {
    const { repo: orchRepo } = makeOrchestratorRepo();
    const { identity: agentId } = makeAgentRepo();
    const { uri: taskUri } = postTask(orchRepo, TASK_SPEC);
    assignTask(orchRepo, taskUri, agentId.did);

    expect(() => assignTask(orchRepo, taskUri, agentId.did)).toThrow(InvalidStateTransitionError);
  });
});

// ─── startTask ────────────────────────────────────────────────────────────────

describe('startTask()', () => {
  it('transitions task from assigned → in_progress', () => {
    const { repo: orchRepo } = makeOrchestratorRepo();
    const { identity: agentId } = makeAgentRepo();
    const { uri: taskUri } = postTask(orchRepo, TASK_SPEC);

    assignTask(orchRepo, taskUri, agentId.did);
    startTask(orchRepo, taskUri);

    expect(getTask(orchRepo, taskUri).status).toBe('in_progress');
  });

  it('rejects invalid transition (open → in_progress)', () => {
    const { repo: orchRepo } = makeOrchestratorRepo();
    const { uri: taskUri } = postTask(orchRepo, TASK_SPEC);

    expect(() => startTask(orchRepo, taskUri)).toThrow(InvalidStateTransitionError);
  });
});

// ─── completeTask ─────────────────────────────────────────────────────────────

describe('completeTask()', () => {
  it('creates a task.completion in the agent repo', () => {
    const { repo: orchRepo } = makeOrchestratorRepo();
    const { repo: agentRepo, identity: agentId } = makeAgentRepo();
    const { uri: taskUri } = postTask(orchRepo, TASK_SPEC);

    assignTask(orchRepo, taskUri, agentId.did);
    startTask(orchRepo, taskUri);
    const claimUri = `at://${agentId.did}/network.mycelium.task.claim/claim-abc`;

    const { uri: completionUri } = completeTask(agentRepo, claimUri, taskUri, COMPLETION_RESULTS);
    expect(completionUri).toContain('network.mycelium.task.completion');
    expect(completionUri).toContain(agentId.did);
  });
});

// ─── transitionTask ───────────────────────────────────────────────────────────

describe('transitionTask()', () => {
  it('advances task to given status', () => {
    const { repo: orchRepo } = makeOrchestratorRepo();
    const { uri: taskUri } = postTask(orchRepo, TASK_SPEC);

    transitionTask(orchRepo, taskUri, 'claimed');
    expect(getTask(orchRepo, taskUri).status).toBe('claimed');
  });

  it('throws on invalid transition', () => {
    const { repo: orchRepo } = makeOrchestratorRepo();
    const { uri: taskUri } = postTask(orchRepo, TASK_SPEC);

    expect(() => transitionTask(orchRepo, taskUri, 'closed')).toThrow(InvalidStateTransitionError);
  });
});

// ─── Full lifecycle ───────────────────────────────────────────────────────────

describe('full task lifecycle', () => {
  it('post → claim → assign → start → complete → review → accepted', () => {
    const { repo: orchRepo } = makeOrchestratorRepo();
    const { repo: agentRepo, identity: agentId } = makeAgentRepo();

    // post
    const { uri: taskUri } = postTask(orchRepo, TASK_SPEC);
    expect(getTask(orchRepo, taskUri).status).toBe('open');

    // claim (no status change)
    const { uri: claimUri } = claimTask(agentRepo, taskUri, TASK_SPEC.title, {
      approach: 'JWT', estimatedDuration: 'PT2H', confidenceLevel: 'high',
    }, ['nodejs', 'jwt']);

    // assign
    assignTask(orchRepo, taskUri, agentId.did);
    expect(getTask(orchRepo, taskUri).status).toBe('assigned');

    // start
    startTask(orchRepo, taskUri);
    expect(getTask(orchRepo, taskUri).status).toBe('in_progress');

    // complete
    completeTask(agentRepo, claimUri, taskUri, COMPLETION_RESULTS);
    transitionTask(orchRepo, taskUri, 'completed');
    expect(getTask(orchRepo, taskUri).status).toBe('completed');

    // review → accept
    reviewCompletion(orchRepo, taskUri, true);
    expect(getTask(orchRepo, taskUri).status).toBe('accepted');
  });

  it('review → reject reopens the task to "open"', () => {
    const { repo: orchRepo } = makeOrchestratorRepo();
    const { repo: agentRepo, identity: agentId } = makeAgentRepo();
    const { uri: taskUri } = postTask(orchRepo, TASK_SPEC);
    const { uri: claimUri } = claimTask(agentRepo, taskUri, TASK_SPEC.title,
      { approach: 'A', estimatedDuration: 'PT1H', confidenceLevel: 'low' }, []);
    assignTask(orchRepo, taskUri, agentId.did);
    startTask(orchRepo, taskUri);
    completeTask(agentRepo, claimUri, taskUri, COMPLETION_RESULTS);
    transitionTask(orchRepo, taskUri, 'completed');

    reviewCompletion(orchRepo, taskUri, false); // reject
    expect(getTask(orchRepo, taskUri).status).toBe('open');
  });

  it('can close a task after accepting', () => {
    const { repo: orchRepo } = makeOrchestratorRepo();
    const { repo: agentRepo, identity: agentId } = makeAgentRepo();
    const { uri: taskUri } = postTask(orchRepo, TASK_SPEC);
    const { uri: claimUri } = claimTask(agentRepo, taskUri, TASK_SPEC.title,
      { approach: 'A', estimatedDuration: 'PT1H', confidenceLevel: 'high' }, []);
    assignTask(orchRepo, taskUri, agentId.did);
    startTask(orchRepo, taskUri);
    completeTask(agentRepo, claimUri, taskUri, COMPLETION_RESULTS);
    transitionTask(orchRepo, taskUri, 'completed');
    reviewCompletion(orchRepo, taskUri, true);
    transitionTask(orchRepo, taskUri, 'closed');
    expect(getTask(orchRepo, taskUri).status).toBe('closed');
  });
});

// ─── shouldClaim ──────────────────────────────────────────────────────────────

describe('shouldClaim()', () => {
  const agentCaps: AgentCapability[] = [
    {
      $type: 'network.mycelium.agent.capability',
      name: 'Node.js Backend',
      slug: 'nodejs-backend',
      domain: 'backend',
      description: 'Node.js backend development',
      proficiencyLevel: 'advanced',
      tags: ['nodejs', 'jwt', 'typescript'],
      tools: ['express'],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  it('returns true when agent meets all requirements', () => {
    expect(shouldClaim(agentCaps, { ...TASK_SPEC } as Parameters<typeof shouldClaim>[1])).toBe(true);
  });

  it('returns false when agent lacks required domain', () => {
    const frontendTask = {
      ...TASK_SPEC,
      requiredCapabilities: [{ domain: 'frontend', tags: ['react'], minProficiency: 'beginner' as const }],
    };
    expect(shouldClaim(agentCaps, frontendTask as Parameters<typeof shouldClaim>[1])).toBe(false);
  });

  it('returns false when agent proficiency is below minimum', () => {
    const expertTask = {
      ...TASK_SPEC,
      requiredCapabilities: [{ domain: 'backend', tags: ['nodejs'], minProficiency: 'expert' as const }],
    };
    expect(shouldClaim(agentCaps, expertTask as Parameters<typeof shouldClaim>[1])).toBe(false);
  });

  it('returns false when no tag overlap', () => {
    const noTagMatch = {
      ...TASK_SPEC,
      requiredCapabilities: [{ domain: 'backend', tags: ['python', 'django'], minProficiency: 'beginner' as const }],
    };
    expect(shouldClaim(agentCaps, noTagMatch as Parameters<typeof shouldClaim>[1])).toBe(false);
  });
});
