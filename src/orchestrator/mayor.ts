// Mayor orchestrator: monitors firehose, assigns tasks, reviews completions, issues stamps.

import type {
  AgentCapability,
  AgentProfile,
  AgentRepository,
  AggregatedReputation,
  DecompositionTemplate,
  Firehose,
  FirehoseEvent,
  Mayor,
  AgentIdentity,
  ReputationDimensions,
  TaskClaim,
  TaskCompletion,
  TaskPosting,
  TaskReview,
} from '../schemas/types.js';
import { subscribe } from '../firehose/index.js';
import { putRecord, getRecord } from '../repository/index.js';
import { postTask, assignTask, reviewCompletion, reopenTask, transitionTask, getTask } from './wanted-board.js';
import { createStamp, aggregateReputation, rankClaims } from '../reputation/index.js';
import { getStampsForAgent } from '../reputation/index.js';
import type { ClaimCandidate } from '../reputation/index.js';

// ─── Demo template ────────────────────────────────────────────────────────────

/** Pre-defined decomposition template for "Build the Mycelium Dashboard". */
export const DASHBOARD_TEMPLATE: DecompositionTemplate = {
  projectPattern: 'Build the Mycelium Dashboard',
  tasks: [
    {
      id: 'task-001',
      title: 'Design component library',
      description: 'Build a reusable React component library with TypeScript.',
      requiredCapabilities: [
        { domain: 'frontend', tags: ['react', 'typescript', 'components'], minProficiency: 'advanced' },
      ],
      complexity: 'medium',
      priority: 'high',
      dependsOn: [],
    },
    {
      id: 'task-002',
      title: 'Build REST API for agent data',
      description: 'Create a REST API that serves agent data to the dashboard.',
      requiredCapabilities: [
        { domain: 'backend', tags: ['api-design', 'node-js'], minProficiency: 'intermediate' },
      ],
      complexity: 'medium',
      priority: 'high',
      dependsOn: [],
    },
    {
      id: 'task-003',
      title: 'Implement authentication',
      description: 'Add JWT-based authentication to the REST API.',
      requiredCapabilities: [
        { domain: 'security', tags: ['authentication', 'backend'], minProficiency: 'advanced' },
      ],
      complexity: 'high',
      priority: 'high',
      dependsOn: ['task-002'],
    },
    {
      id: 'task-004',
      title: 'Set up CI/CD pipeline',
      description: 'Configure GitHub Actions CI/CD pipeline with Docker.',
      requiredCapabilities: [
        { domain: 'devops', tags: ['ci-cd', 'docker'], minProficiency: 'intermediate' },
      ],
      complexity: 'medium',
      priority: 'normal',
      dependsOn: [],
    },
    {
      id: 'task-005',
      title: 'Create agent profile cards',
      description: 'Design and implement agent profile card components.',
      requiredCapabilities: [
        { domain: 'frontend', tags: ['react', 'frontend'], minProficiency: 'beginner' },
      ],
      complexity: 'low',
      priority: 'normal',
      dependsOn: ['task-001'],
    },
    {
      id: 'task-006',
      title: 'Build firehose event stream UI',
      description: 'Create a real-time event stream UI using WebSocket/SSE.',
      requiredCapabilities: [
        { domain: 'frontend', tags: ['react', 'websocket', 'typescript'], minProficiency: 'advanced' },
      ],
      complexity: 'high',
      priority: 'high',
      dependsOn: ['task-001'],
    },
    {
      id: 'task-007',
      title: 'Write integration tests',
      description: 'Write comprehensive integration and E2E tests.',
      requiredCapabilities: [
        { domain: 'testing', tags: ['integration-testing', 'e2e-testing'], minProficiency: 'intermediate' },
      ],
      complexity: 'medium',
      priority: 'normal',
      dependsOn: ['task-002', 'task-003', 'task-005', 'task-006'],
    },
    {
      id: 'task-008',
      title: 'Deploy to staging',
      description: 'Deploy the application to the staging environment.',
      requiredCapabilities: [
        { domain: 'devops', tags: ['deployment', 'devops'], minProficiency: 'beginner' },
      ],
      complexity: 'low',
      priority: 'normal',
      dependsOn: ['task-004', 'task-007'],
    },
  ],
};

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create the Mayor orchestrator and register its firehose subscription.
 * Mayor.subscribeToFirehose() is called internally — must be invoked BEFORE
 * any agent.profile records are written so the registry is populated correctly.
 */
export function createMayor(
  identity: AgentIdentity,
  repo: AgentRepository,
  firehose: Firehose,
  template: DecompositionTemplate,
): Mayor {
  const mayor: Mayor = {
    identity,
    repo,
    firehose,
    template,
    agentRegistry: new Map(),
    postedTasks: new Map(),
    rejectionLog: new Map(),
  };

  // Closure-based pending claims (not on Mayor struct to keep it clean)
  const pendingClaims = new Map<string, TaskClaim[]>();

  subscribe(firehose, undefined, (event) => {
    handleFirehoseEvent(mayor, pendingClaims, event);
  });

  return mayor;
}

// ─── Firehose handler ─────────────────────────────────────────────────────────

function handleFirehoseEvent(
  mayor: Mayor,
  pendingClaims: Map<string, TaskClaim[]>,
  event: FirehoseEvent,
): void {
  if (event.collection === 'network.mycelium.agent.profile') {
    // Don't register the mayor itself
    if (event.did === mayor.identity.did) return;

    const profile = event.record as AgentProfile;
    const existing = mayor.agentRegistry.get(event.did);
    if (existing) {
      existing.handle = profile.handle;
    } else {
      mayor.agentRegistry.set(event.did, {
        did: event.did,
        handle: profile.handle,
        capabilities: [],
        activeTasks: [],
        reputation: null,
      });
    }
  } else if (event.collection === 'network.mycelium.agent.capability') {
    const cap = event.record as AgentCapability;
    const entry = mayor.agentRegistry.get(event.did);
    if (entry) {
      const idx = entry.capabilities.findIndex((c) => c.slug === cap.slug);
      if (idx >= 0) {
        entry.capabilities[idx] = cap;
      } else {
        entry.capabilities.push(cap);
      }
    }
  } else if (event.collection === 'network.mycelium.task.claim') {
    const claim = event.record as TaskClaim;
    const claimUri = `at://${event.did}/${event.collection}/${event.rkey}`;
    const claimWithUri = { ...claim, _claimUri: claimUri };
    const existing = pendingClaims.get(claim.taskUri) ?? [];
    existing.push(claimWithUri as unknown as TaskClaim);
    pendingClaims.set(claim.taskUri, existing);
    // Schedule claim processing after all synchronous claim writes settle
    setTimeout(() => processClaimsForTask(mayor, pendingClaims, claim.taskUri), 0);
  } else if (event.collection === 'network.mycelium.task.completion') {
    const completion = event.record as TaskCompletion;
    const completionUri = `at://${event.did}/${event.collection}/${event.rkey}`;
    handleCompletion(mayor, completion, completionUri);
  } else if (event.collection === 'network.mycelium.task.posting') {
    // External task requester posted a project-level task — trigger decomposition.
    // Guard: ignore our own posts and only handle the first external posting.
    if (event.did === mayor.identity.did) return;
    if (mayor.externalTaskUri) return;
    const externalTask = event.record as TaskPosting;
    mayor.externalTaskUri = `at://${event.did}/${event.collection}/${event.rkey}`;
    mayor.externalTaskPosterDid = event.did;
    startProject(mayor, externalTask.description);
  } else if (event.collection === 'network.mycelium.task.review') {
    const review = event.record as TaskReview;
    // Only process reviews for our tracked external task from the verified requester.
    if (review.taskUri !== mayor.externalTaskUri) return;
    if (event.did !== mayor.externalTaskPosterDid) return;

    // Issue requester stamps for all accepted subtasks.
    const dim = review.score / 10;
    const dimensions: ReputationDimensions = {
      codeQuality: dim,
      reliability: dim,
      communication: dim,
      creativity: dim,
      efficiency: dim,
    };
    for (const [, info] of mayor.postedTasks) {
      if (info.status !== 'accepted' || !info.completerDid || !info.completionUri) continue;
      let taskDomain = 'software-engineering';
      try {
        const posting = getTask(mayor.repo, info.uri);
        taskDomain = posting.requiredCapabilities[0]?.domain ?? taskDomain;
      } catch { /* leave default */ }
      createStamp(
        mayor.repo,
        info.completerDid,
        info.uri,
        info.completionUri,
        taskDomain,
        dimensions,
        undefined,
        0,
        undefined,
        undefined,
        'requester',
      );
    }
  }
}

// ─── Claim processing ─────────────────────────────────────────────────────────

function processClaimsForTask(
  mayor: Mayor,
  pendingClaims: Map<string, TaskClaim[]>,
  taskUri: string,
): void {
  const claims = pendingClaims.get(taskUri);
  if (!claims || claims.length === 0) return;
  pendingClaims.delete(taskUri);

  // Fetch current task state
  let task: TaskPosting;
  try {
    task = getTask(mayor.repo, taskUri);
  } catch {
    return; // Task not in mayor's repo
  }

  // Only assign if still open or claimed
  if (task.status !== 'open' && task.status !== 'claimed') return;

  // Build ranking candidates
  const candidates: ClaimCandidate[] = claims.map((claim) => {
    const entry = mayor.agentRegistry.get(claim.claimerDid);
    return {
      did: claim.claimerDid,
      claim: { proposal: { confidenceLevel: claim.proposal.confidenceLevel } },
      capabilities: entry?.capabilities ?? [],
      activeTasks: entry?.activeTasks.length ?? 0,
      reputation: entry?.reputation ?? null,
    };
  });

  const ranked = rankClaims(candidates, task);
  const best = ranked[0];

  // Assign best available candidate even if score is negative (e.g. newcomer on high task).
  // The negative score already penalises preference — but blocking causes permanent stall
  // when no established agent is available (common early in a demo run).
  if (best) {
    try {
      assignTask(mayor.repo, taskUri, best.did);
      const entry = mayor.agentRegistry.get(best.did);
      if (entry) entry.activeTasks.push(taskUri);
    } catch {
      // Assignment may fail if task was already assigned
    }
  }
}

// ─── Quality evaluation ───────────────────────────────────────────────────────

const MAX_TASK_ATTEMPTS = 3;

/**
 * Evaluate completion quality using available metrics.
 * Only applies meaningful gate when intelligenceUsed is present —
 * simulation completions always pass to keep non-inference demos stable.
 */
function evaluateQuality(completion: TaskCompletion): { accept: boolean; reason: string } {
  // If no real inference was used, accept — simulation metrics are generated, not earned
  if (!completion.intelligenceUsed) {
    return { accept: true, reason: 'simulation — accepted by default' };
  }

  const { testsPassed, testsTotal, coveragePercent } = completion.metrics;
  let score = 0;
  let checks = 0;

  if (testsTotal && testsTotal > 0) {
    checks++;
    const passRate = (testsPassed ?? 0) / testsTotal;
    if (passRate >= 0.8) score++;
  }

  if (coveragePercent !== undefined && coveragePercent !== null) {
    checks++;
    if (coveragePercent >= 60) score++;
  }

  if (completion.summary && completion.summary.length > 30) {
    checks++;
    score++;
  }

  // If no checkable metrics, accept — can't penalise what we can't measure
  if (checks === 0) return { accept: true, reason: 'no measurable metrics' };

  const accept = score / checks >= 0.5;
  return { accept, reason: `quality ${score}/${checks} checks passed` };
}

// ─── Completion handling ──────────────────────────────────────────────────────

function handleCompletion(
  mayor: Mayor,
  completion: TaskCompletion,
  completionUri: string,
): void {
  const { taskUri } = completion;

  // Transition task: in_progress → completed
  try {
    transitionTask(mayor.repo, taskUri, 'completed', { completionUri });
  } catch {
    return; // Task may not be in in_progress state (rework path or duplicate event)
  }

  // Find this task in postedTasks tracking
  let taskId: string | undefined;
  let taskInfo: { status: string; uri: string; attempts: number; completionUri?: string; completerDid?: string } | undefined;
  for (const [id, info] of mayor.postedTasks) {
    if (info.uri === taskUri) { taskId = id; taskInfo = info; break; }
  }

  const { accept, reason } = evaluateQuality(completion);
  const attempts = (taskInfo?.attempts ?? 0) + 1;

  if (taskInfo) taskInfo.attempts = attempts;

  // Reject and re-open if quality fails and we haven't hit the attempt cap
  if (!accept && attempts < MAX_TASK_ATTEMPTS) {
    // Re-open task for another agent to claim
    reopenTask(mayor.repo, taskUri);
    if (taskInfo) taskInfo.status = 'open';

    // Record rejection for demo display
    if (taskId) {
      const existing = mayor.rejectionLog.get(taskUri) ?? [];
      existing.push({ agentDid: completion.completerDid, reason });
      mayor.rejectionLog.set(taskUri, existing);
    }

    // Issue a low-quality reputation stamp
    let task: TaskPosting;
    try { task = getTask(mayor.repo, taskUri); } catch { return; }
    const taskDomain = task.requiredCapabilities[0]?.domain ?? 'general';

    const penaltyDims: ReputationDimensions = {
      codeQuality: 2 + Math.random() * 2,
      reliability: 2 + Math.random() * 2,
      communication: 4 + Math.random() * 2,
      creativity: 4 + Math.random() * 2,
      efficiency: 2 + Math.random() * 2,
    };
    createStamp(
      mayor.repo,
      completion.completerDid,
      taskUri,
      completionUri,
      taskDomain,
      penaltyDims,
      completion.intelligenceUsed?.modelDid,
      0,
      completion.knowledgeUsed,
      completion.toolsUsed,
      'mayor',
    );

    // Update agent registry after rejection
    const entry = mayor.agentRegistry.get(completion.completerDid);
    if (entry) {
      entry.activeTasks = entry.activeTasks.filter((t) => t !== taskUri);
      const stamps = getStampsForAgent(mayor.firehose, completion.completerDid);
      entry.reputation = stamps.length > 0 ? aggregateReputation(stamps) : null;
    }

    if (process.env.MYCELIUM_DEBUG) {
      console.warn(`[mayor] rejected ${taskUri}: ${reason} (attempt ${attempts}/${MAX_TASK_ATTEMPTS})`);
    }
    return;
  }

  // Accept (quality passed, or force-accept after hitting attempt cap)
  reviewCompletion(mayor.repo, taskUri, true);

  // Determine task domain for the reputation stamp
  let task: TaskPosting;
  try {
    task = getTask(mayor.repo, taskUri);
  } catch {
    return;
  }
  const taskDomain = task.requiredCapabilities[0]?.domain ?? 'general';

  // Generate quality dimensions (Mayor's assessment)
  const dims: ReputationDimensions = {
    codeQuality: 7.5 + Math.random() * 2,
    reliability: 7.5 + Math.random() * 2,
    communication: 7.5 + Math.random() * 2,
    creativity: 7.5 + Math.random() * 2,
    efficiency: 7.5 + Math.random() * 2,
  };

  // Issue reputation stamp
  createStamp(
    mayor.repo,
    completion.completerDid,
    taskUri,
    completionUri,
    taskDomain,
    dims,
    completion.intelligenceUsed?.modelDid,
    0,
    completion.knowledgeUsed,
    completion.toolsUsed,
    'mayor',
  );

  // Update agent registry: remove from activeTasks, refresh reputation
  const entry = mayor.agentRegistry.get(completion.completerDid);
  if (entry) {
    entry.activeTasks = entry.activeTasks.filter((t) => t !== taskUri);
    const stamps = getStampsForAgent(mayor.firehose, completion.completerDid);
    entry.reputation = stamps.length > 0 ? aggregateReputation(stamps) : null;
  }

  // Mark task as accepted in postedTasks tracking, storing completion details for requester stamps
  for (const [, info] of mayor.postedTasks) {
    if (info.uri === taskUri) {
      info.status = 'accepted';
      info.completionUri = completionUri;
      info.completerDid = completion.completerDid;
      break;
    }
  }

  // Post newly unblocked tasks
  checkAndPostUnblockedTasks(mayor);
}

// ─── Project management ───────────────────────────────────────────────────────

/**
 * Post the initial tasks (those with no dependencies) to kick off the project.
 * Mayor monitors subsequent completions to post dependency-gated tasks.
 */
export function startProject(mayor: Mayor, projectDescription: string): void {
  for (const taskDef of mayor.template.tasks) {
    if (mayor.postedTasks.has(taskDef.id)) continue;
    if (taskDef.dependsOn.length === 0) {
      const result = postTask(
        mayor.repo,
        {
          title: taskDef.title,
          description: taskDef.description,
          requiredCapabilities: taskDef.requiredCapabilities,
          complexity: taskDef.complexity,
          priority: taskDef.priority,
          context: {
            projectName: mayor.template.projectPattern,
            projectDescription,
          },
          deliverables: [],
        },
        taskDef.id,
      );
      mayor.postedTasks.set(taskDef.id, { status: 'open', uri: result.uri, attempts: 0 });
    }
  }
}

function checkAndPostUnblockedTasks(mayor: Mayor): void {
  for (const taskDef of mayor.template.tasks) {
    if (mayor.postedTasks.has(taskDef.id)) continue;

    const allDepsResolved = taskDef.dependsOn.every((depId) => {
      const dep = mayor.postedTasks.get(depId);
      return dep && (dep.status === 'accepted' || dep.status === 'closed');
    });

    if (allDepsResolved) {
      const result = postTask(
        mayor.repo,
        {
          title: taskDef.title,
          description: taskDef.description,
          requiredCapabilities: taskDef.requiredCapabilities,
          complexity: taskDef.complexity,
          priority: taskDef.priority,
          context: {
            projectName: mayor.template.projectPattern,
            projectDescription: mayor.template.projectPattern,
          },
          deliverables: [],
        },
        taskDef.id,
      );
      mayor.postedTasks.set(taskDef.id, { status: 'open', uri: result.uri, attempts: 0 });
    }
  }
}
