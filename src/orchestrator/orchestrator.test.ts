import { describe, it, expect, beforeEach } from 'vitest';
import { createMayor, startProject, DASHBOARD_TEMPLATE } from './mayor.js';
import { postTask, claimTask, completeTask, startTask, transitionTask } from './wanted-board.js';
import { createFirehose } from '../firehose/index.js';
import { generateIdentity } from '../identity/index.js';
import { createMemoryRepository, getRecord, putRecord } from '../repository/index.js';
import type {
  AgentCapability,
  AgentProfile,
  Firehose,
  Mayor,
  ReputationDimensions,
  TaskPosting,
} from '../schemas/types.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeMayor(firehose: Firehose) {
  const identity = generateIdentity('mayor.mycelium.local', 'Mayor');
  const repo = createMemoryRepository(identity, firehose);
  return { mayor: createMayor(identity, repo, firehose, DASHBOARD_TEMPLATE), identity, repo };
}

function makeAgent(firehose: Firehose, handle: string) {
  const identity = generateIdentity(handle, handle);
  const repo = createMemoryRepository(identity, firehose);
  return { identity, repo };
}

/** Write a minimal agent.profile record to trigger mayor's registry update. */
function writeProfile(
  repo: ReturnType<typeof createMemoryRepository>,
  identity: ReturnType<typeof generateIdentity>,
  opts: { maxConcurrentTasks?: number } = {},
) {
  const now = new Date().toISOString();
  putRecord(repo, 'network.mycelium.agent.profile', 'self', {
    $type: 'network.mycelium.agent.profile',
    did: identity.did,
    handle: identity.handle,
    displayName: identity.displayName,
    description: 'Test agent',
    agentType: 'worker',
    intelligenceRefs: [],
    operator: { name: 'Test' },
    maxConcurrentTasks: opts.maxConcurrentTasks ?? 2,
    availabilityStatus: 'available',
    createdAt: now,
    updatedAt: now,
  } satisfies AgentProfile);
}

/** Write a capability record to trigger mayor's capability update. */
function writeCapability(
  repo: ReturnType<typeof createMemoryRepository>,
  rkey: string,
  domain: string,
  proficiencyLevel: AgentCapability['proficiencyLevel'],
  tags: string[],
) {
  const now = new Date().toISOString();
  putRecord(repo, 'network.mycelium.agent.capability', rkey, {
    $type: 'network.mycelium.agent.capability',
    name: rkey,
    slug: rkey,
    domain,
    description: `${rkey} capability`,
    proficiencyLevel,
    tags,
    tools: ['tool-a'],
    createdAt: now,
    updatedAt: now,
  } satisfies AgentCapability);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createMayor()', () => {
  let firehose: Firehose;

  beforeEach(() => {
    firehose = createFirehose();
  });

  it('returns a Mayor with empty agentRegistry and postedTasks', () => {
    const { mayor } = makeMayor(firehose);
    expect(mayor.agentRegistry.size).toBe(0);
    expect(mayor.postedTasks.size).toBe(0);
  });

  it('adds agent to registry when agent.profile is written', () => {
    const { mayor } = makeMayor(firehose);
    const agent = makeAgent(firehose, 'test-agent.local');
    writeProfile(agent.repo, agent.identity);

    expect(mayor.agentRegistry.has(agent.identity.did)).toBe(true);
    expect(mayor.agentRegistry.get(agent.identity.did)!.handle).toBe('test-agent.local');
    expect(mayor.agentRegistry.get(agent.identity.did)!.capabilities).toEqual([]);
  });

  it('does NOT add the mayor itself to the registry', () => {
    const { mayor, identity, repo } = makeMayor(firehose);
    writeProfile(repo, identity);
    expect(mayor.agentRegistry.has(identity.did)).toBe(false);
  });

  it('adds capability to agent registry entry when agent.capability is written', () => {
    const { mayor } = makeMayor(firehose);
    const agent = makeAgent(firehose, 'cap-agent.local');
    writeProfile(agent.repo, agent.identity);
    writeCapability(agent.repo, 'react-dev', 'frontend', 'expert', ['react', 'typescript']);

    const entry = mayor.agentRegistry.get(agent.identity.did)!;
    expect(entry.capabilities).toHaveLength(1);
    expect(entry.capabilities[0]!.slug).toBe('react-dev');
    expect(entry.capabilities[0]!.domain).toBe('frontend');
  });

  it('updates existing capability on second write', () => {
    const { mayor } = makeMayor(firehose);
    const agent = makeAgent(firehose, 'update-agent.local');
    writeProfile(agent.repo, agent.identity);
    writeCapability(agent.repo, 'react-dev', 'frontend', 'intermediate', ['react']);
    writeCapability(agent.repo, 'react-dev', 'frontend', 'expert', ['react', 'typescript']);

    const entry = mayor.agentRegistry.get(agent.identity.did)!;
    expect(entry.capabilities).toHaveLength(1);
    expect(entry.capabilities[0]!.proficiencyLevel).toBe('expert');
  });
});

describe('startProject()', () => {
  let firehose: Firehose;
  let mayor: Mayor;

  beforeEach(() => {
    firehose = createFirehose();
    ({ mayor } = makeMayor(firehose));
  });

  it('posts exactly 3 tasks with no dependencies (task-001, task-002, task-004)', () => {
    startProject(mayor, 'Build the Mycelium Dashboard');
    expect(mayor.postedTasks.size).toBe(3);
    expect(mayor.postedTasks.has('task-001')).toBe(true);
    expect(mayor.postedTasks.has('task-002')).toBe(true);
    expect(mayor.postedTasks.has('task-004')).toBe(true);
  });

  it('does NOT post task-003 (depends on task-002)', () => {
    startProject(mayor, 'Build the Mycelium Dashboard');
    expect(mayor.postedTasks.has('task-003')).toBe(false);
  });

  it('does NOT post task-005 or task-006 (depend on task-001)', () => {
    startProject(mayor, 'Build the Mycelium Dashboard');
    expect(mayor.postedTasks.has('task-005')).toBe(false);
    expect(mayor.postedTasks.has('task-006')).toBe(false);
  });

  it('each posted task has status "open" and a valid AT URI', () => {
    startProject(mayor, 'Build the Mycelium Dashboard');
    for (const [, info] of mayor.postedTasks) {
      expect(info.status).toBe('open');
      expect(info.uri).toMatch(/^at:\/\//);
    }
  });

  it('does not re-post already-posted tasks on second call', () => {
    startProject(mayor, 'Build the Mycelium Dashboard');
    startProject(mayor, 'Build the Mycelium Dashboard');
    expect(mayor.postedTasks.size).toBe(3);
  });
});

describe('Mayor claim processing (async)', () => {
  let firehose: Firehose;
  let mayor: Mayor;
  let mayorRepo: ReturnType<typeof createMemoryRepository>;

  beforeEach(() => {
    firehose = createFirehose();
    const setup = makeMayor(firehose);
    mayor = setup.mayor;
    mayorRepo = setup.repo;
    startProject(mayor, 'Build the Mycelium Dashboard');
  });

  it('assigns a task when an agent claims it (after timer flush)', async () => {
    // Register an agent with frontend capability
    const agent = makeAgent(firehose, 'frontend-agent.local');
    writeProfile(agent.repo, agent.identity);
    writeCapability(agent.repo, 'react-dev', 'frontend', 'expert', ['react', 'typescript', 'components']);

    // Agent claims task-001 (frontend task)
    const task001Uri = mayor.postedTasks.get('task-001')!.uri;
    claimTask(agent.repo, task001Uri, 'Design component library', {
      approach: 'Use React + TypeScript',
      estimatedDuration: 'PT52M',
      confidenceLevel: 'high',
    }, ['react-dev']);

    // Flush the setTimeout(0) in mayor's claim handler
    await new Promise((r) => setTimeout(r, 50));

    // Check task was assigned
    const task = getRecord(mayorRepo, 'network.mycelium.task.posting', 'task-001');
    const posting = task.content as TaskPosting;
    expect(posting.assigneeDid).toBe(agent.identity.did);
    expect(posting.status).toBe('assigned');
  });

  it('assigns to highest-ranked candidate when multiple agents claim', async () => {
    // Expert agent
    const expertAgent = makeAgent(firehose, 'expert-agent.local');
    writeProfile(expertAgent.repo, expertAgent.identity);
    writeCapability(expertAgent.repo, 'react-dev', 'frontend', 'expert', ['react', 'typescript', 'components']);

    // Beginner agent
    const beginnerAgent = makeAgent(firehose, 'beginner-agent.local');
    writeProfile(beginnerAgent.repo, beginnerAgent.identity);
    writeCapability(beginnerAgent.repo, 'react-basic', 'frontend', 'beginner', ['react', 'typescript', 'components']);

    const task001Uri = mayor.postedTasks.get('task-001')!.uri;

    claimTask(beginnerAgent.repo, task001Uri, 'Design component library', {
      approach: 'Basic approach',
      estimatedDuration: 'PT60M',
      confidenceLevel: 'medium',
    }, ['react-basic']);

    claimTask(expertAgent.repo, task001Uri, 'Design component library', {
      approach: 'Expert approach',
      estimatedDuration: 'PT52M',
      confidenceLevel: 'high',
    }, ['react-dev']);

    await new Promise((r) => setTimeout(r, 50));

    const task = getRecord(mayorRepo, 'network.mycelium.task.posting', 'task-001');
    const posting = task.content as TaskPosting;
    // Expert should win (higher capability score)
    expect(posting.assigneeDid).toBe(expertAgent.identity.did);
  });
});

describe('Mayor completion handling', () => {
  let firehose: Firehose;
  let mayor: Mayor;
  let mayorRepo: ReturnType<typeof createMemoryRepository>;

  beforeEach(() => {
    firehose = createFirehose();
    const setup = makeMayor(firehose);
    mayor = setup.mayor;
    mayorRepo = setup.repo;
    startProject(mayor, 'Build the Mycelium Dashboard');
  });

  it('issues a reputation stamp after task completion is accepted', async () => {
    const agent = makeAgent(firehose, 'stamp-agent.local');
    writeProfile(agent.repo, agent.identity);
    writeCapability(agent.repo, 'react-dev', 'frontend', 'expert', ['react', 'typescript', 'components']);

    const task001Uri = mayor.postedTasks.get('task-001')!.uri;
    const { uri: claimUri } = claimTask(agent.repo, task001Uri, 'Design component library', {
      approach: 'Use React',
      estimatedDuration: 'PT52M',
      confidenceLevel: 'high',
    }, ['react-dev']);

    await new Promise((r) => setTimeout(r, 50));

    // Manually start the task (agent calls startTask)
    startTask(mayorRepo, task001Uri);

    // Agent completes the task
    const { uri: completionUri } = completeTask(agent.repo, claimUri, task001Uri, {
      summary: 'Done',
      artifacts: [{ name: 'Button.tsx', type: 'code', contentHash: 'sha256-abc', size: 100, description: 'Component' }],
      metrics: { executionTime: 'PT52M' },
    });

    // Verify stamp was issued (mayor handles completion synchronously via firehose)
    const stamps = firehose.log.filter(
      (e) =>
        e.collection === 'network.mycelium.reputation.stamp' &&
        (e.record as { subjectDid?: string }).subjectDid === agent.identity.did,
    );
    expect(stamps).toHaveLength(1);
  });

  it('posts task-003 after task-002 is accepted', async () => {
    const agent = makeAgent(firehose, 'backend-agent.local');
    writeProfile(agent.repo, agent.identity);
    writeCapability(agent.repo, 'api-design', 'backend', 'expert', ['api-design', 'node-js']);

    const task002Uri = mayor.postedTasks.get('task-002')!.uri;
    const { uri: claimUri } = claimTask(agent.repo, task002Uri, 'Build REST API', {
      approach: 'Use Express',
      estimatedDuration: 'PT40M',
      confidenceLevel: 'high',
    }, ['api-design']);

    await new Promise((r) => setTimeout(r, 50));
    startTask(mayorRepo, task002Uri);

    // task-003 should not be posted yet
    expect(mayor.postedTasks.has('task-003')).toBe(false);

    completeTask(agent.repo, claimUri, task002Uri, {
      summary: 'API done',
      artifacts: [{ name: 'routes.ts', type: 'code', contentHash: 'sha256-def', size: 200, description: 'Routes' }],
      metrics: { executionTime: 'PT40M' },
    });

    // Mayor accepts task-002 completion → task-003 should now be posted
    expect(mayor.postedTasks.has('task-003')).toBe(true);
    expect(mayor.postedTasks.get('task-003')!.status).toBe('open');
  });
});
