// Mayor orchestrator: monitors firehose, assigns tasks, reviews completions, issues stamps.

import { randomUUID } from 'node:crypto';
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
  MatchRecommendation,
  ReputationDimensions,
  TaskAssignment,
  TaskClaim,
  TaskCompletion,
  TaskPosting,
  TaskReview,
  VerificationResult,
} from '../schemas/types.js';
import { subscribe } from '../firehose/index.js';
import { putRecord, getRecord } from '../repository/index.js';
import { postTask, assignTask, reviewCompletion, reopenTask, transitionTask, getTask } from './wanted-board.js';
import { createStamp, aggregateReputation, rankClaims } from '../reputation/index.js';
import { getStampsForAgent } from '../reputation/index.js';
import type { ClaimCandidate } from '../reputation/index.js';

function makeProofChainRkey(prefix: 'rec' | 'assign' | 'ver'): string {
  return `${prefix}-${randomUUID()}`;
}

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
  const pendingClaims = new Map<string, PendingClaimEntry[]>();

  subscribe(firehose, undefined, (event) => {
    handleFirehoseEvent(mayor, pendingClaims, event);
  });

  return mayor;
}

// ─── Firehose handler ─────────────────────────────────────────────────────────

function handleFirehoseEvent(
  mayor: Mayor,
  pendingClaims: Map<string, PendingClaimEntry[]>,
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
    const existing = pendingClaims.get(claim.taskUri) ?? [];
    existing.push({ claim, claimUri });
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
      createStamp({
        attestorRepo: mayor.repo,
        subjectDid: info.completerDid,
        taskUri: info.uri,
        completionUri: info.completionUri,
        taskDomain,
        dimensions,
        attestorType: 'requester',
      });
    }
  }
}

// ─── Claim processing ─────────────────────────────────────────────────────────

/** Internal type: claim + its AT URI, carried through claim processing. */
interface PendingClaimEntry {
  claim: TaskClaim;
  claimUri: string;
}

function processClaimsForTask(
  mayor: Mayor,
  pendingClaims: Map<string, PendingClaimEntry[]>,
  taskUri: string,
): void {
  const entries = pendingClaims.get(taskUri);
  if (!entries || entries.length === 0) return;
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

  // Build ranking candidates, carrying claimUri through
  const candidates: Array<ClaimCandidate & { claimUri: string }> = entries.map(({ claim, claimUri }) => {
    const entry = mayor.agentRegistry.get(claim.claimerDid);
    return {
      did: claim.claimerDid,
      claimUri,
      claim: { proposal: { confidenceLevel: claim.proposal.confidenceLevel } },
      capabilities: entry?.capabilities ?? [],
      activeTasks: entry?.activeTasks.length ?? 0,
      reputation: entry?.reputation ?? null,
    };
  });

  const ranked = rankClaims(candidates, task);
  const best = ranked[0] as (typeof ranked[0] & { claimUri: string }) | undefined;

  // Write a match.recommendation record (audit snapshot regardless of assignment success)
  const now = new Date().toISOString();
  const recRkey = makeProofChainRkey('rec');
  const recommendation: MatchRecommendation = {
    $type: 'network.mycelium.match.recommendation',
    taskUri,
    matcherDid: mayor.identity.did,
    policy: 'trust-weighted',
    rankings: ranked.map((r, i) => {
      const c = r as typeof r & { claimUri: string };
      const rep = r.reputation;
      const reasons: string[] = [];
      if (rep && rep.totalTasks > 0) {
        reasons.push(`reputation score ${rep.overallScore.toFixed(1)} (${rep.totalTasks} task${rep.totalTasks > 1 ? 's' : ''})`);
      } else {
        reasons.push('newcomer — no prior reputation');
      }
      reasons.push(`confidence: ${r.claim.proposal.confidenceLevel}`);
      if (r.activeTasks > 0) reasons.push(`${r.activeTasks} active task(s) (load penalty)`);
      return {
        rank: i + 1,
        candidateDid: r.did,
        claimUri: c.claimUri,
        score: r.rankScore,
        reasons,
      };
    }),
    selectedDid: best?.did ?? '',
    selectedClaimUri: best?.claimUri ?? '',
    createdAt: now,
  };
  const recResult = putRecord(mayor.repo, 'network.mycelium.match.recommendation', recRkey, recommendation);
  const matchRecommendationUri = recResult.uri;

  // Assign best available candidate even if score is negative (e.g. newcomer on high task).
  // The negative score already penalises preference — but blocking causes permanent stall
  // when no established agent is available (common early in a demo run).
  if (best) {
    try {
      assignTask(mayor.repo, taskUri, best.did);
      const entry = mayor.agentRegistry.get(best.did);
      if (entry) entry.activeTasks.push(taskUri);

      // Write a task.assignment record that links the claim and the recommendation
      const assignRkey = makeProofChainRkey('assign');
      const assignment: TaskAssignment = {
        $type: 'network.mycelium.task.assignment',
        taskUri,
        claimUri: best.claimUri,
        coordinatorDid: mayor.identity.did,
        assigneeDid: best.did,
        matchRecommendationUri,
        assignmentPolicy: 'top-ranked',
        createdAt: now,
      };
      putRecord(mayor.repo, 'network.mycelium.task.assignment', assignRkey, assignment);
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

/** Write a verification.result record and return its URI. */
function writeVerificationResult(
  mayor: Mayor,
  completion: TaskCompletion,
  completionUri: string,
  accept: boolean,
  reason: string,
): string {
  const now = new Date().toISOString();
  const evidence: string[] = [];

  const { testsPassed, testsTotal, coveragePercent } = completion.metrics;
  if (testsTotal && testsTotal > 0) {
    const passRate = ((testsPassed ?? 0) / testsTotal) * 100;
    evidence.push(`Tests: ${testsPassed ?? 0}/${testsTotal} passed (${passRate.toFixed(0)}%)`);
  }
  if (coveragePercent !== undefined && coveragePercent !== null) {
    evidence.push(`Coverage: ${coveragePercent}%`);
  }
  if (completion.summary) {
    evidence.push(`Summary provided (${completion.summary.length} chars)`);
  }
  if (!completion.intelligenceUsed) {
    evidence.push('Simulation mode — no real inference metrics available');
  }
  if (evidence.length === 0) {
    evidence.push('No measurable metrics in completion record');
  }

  let status: VerificationResult['status'];
  if (!completion.intelligenceUsed) {
    status = 'inconclusive'; // Simulation: can't make strong claims
  } else {
    status = accept ? 'passed' : 'failed';
  }

  const verResult: VerificationResult = {
    $type: 'network.mycelium.verification.result',
    taskUri: completion.taskUri,
    completionUri,
    verifierDid: mayor.identity.did,
    verificationType: 'simulation-metrics',
    status,
    summary: `${accept ? 'Accepted' : 'Rejected'}: ${reason}`,
    evidence,
    createdAt: now,
  };
  const rkey = makeProofChainRkey('ver');
  const result = putRecord(mayor.repo, 'network.mycelium.verification.result', rkey, verResult);
  return result.uri;
}

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

  // Write verification result (always — before stamping, regardless of accept/reject)
  const verificationUri = writeVerificationResult(mayor, completion, completionUri, accept, reason);

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
    createStamp({
      attestorRepo: mayor.repo,
      subjectDid: completion.completerDid,
      taskUri,
      completionUri,
      taskDomain,
      dimensions: penaltyDims,
      intelligenceDid: completion.intelligenceUsed?.modelDid,
      knowledgeRefs: completion.knowledgeUsed,
      toolRefs: completion.toolsUsed,
      attestorType: 'mayor',
      evidenceUris: [verificationUri],
    });

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

  // Issue reputation stamp, referencing the verification result as evidence
  createStamp({
    attestorRepo: mayor.repo,
    subjectDid: completion.completerDid,
    taskUri,
    completionUri,
    taskDomain,
    dimensions: dims,
    intelligenceDid: completion.intelligenceUsed?.modelDid,
    knowledgeRefs: completion.knowledgeUsed,
    toolRefs: completion.toolsUsed,
    attestorType: 'mayor',
    evidenceUris: [verificationUri],
  });

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
