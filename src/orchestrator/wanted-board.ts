// Wanted Board: task lifecycle and state machine for the Mycelium MVP.
// Manages the full post → claim → assign → complete → review cycle.

import { randomUUID } from 'node:crypto';
import type {
  AgentCapability,
  AgentRepository,
  TaskClaim,
  TaskCompletion,
  TaskPosting,
} from '../schemas/types.js';
import { putRecord, getRecord } from '../repository/index.js';
import { InvalidStateTransitionError } from '../errors.js';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus = TaskPosting['status'];

export type PostTaskSpec = Omit<
  TaskPosting,
  '$type' | 'status' | 'claimUris' | 'completionUri' | 'assigneeDid' | 'createdAt' | 'updatedAt'
>;

export type CompletionResults = {
  summary: string;
  artifacts: TaskCompletion['artifacts'];
  metrics: TaskCompletion['metrics'];
  notes?: string;
  intelligenceUsed?: TaskCompletion['intelligenceUsed'];
};

// ─── State Machine ────────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  open: ['claimed'],
  claimed: ['assigned', 'open'],
  assigned: ['in_progress'],
  in_progress: ['completed'],
  completed: ['accepted', 'open'],
  accepted: ['closed'],
  closed: [],
};

function validateTransition(current: TaskStatus, next: TaskStatus, taskUri: string): void {
  if (!(VALID_TRANSITIONS[current] as readonly string[]).includes(next)) {
    throw new InvalidStateTransitionError(current, next, taskUri);
  }
}

// ─── URI helpers ──────────────────────────────────────────────────────────────

/** Parse the collection and rkey from an AT URI (`at://did/collection/rkey`). */
function parseAtUri(uri: string): { collection: string; rkey: string } {
  const parts = uri.split('/');
  // at: | '' | did | collection | rkey
  const collection = parts[3];
  const rkey = parts[4];
  if (!collection || !rkey) throw new Error(`Invalid AT URI: "${uri}"`);
  return { collection, rkey };
}

// ─── Core operations ──────────────────────────────────────────────────────────

/**
 * Create a new task posting (status: "open") in the orchestrator's repository.
 *
 * @param rkey Optional deterministic rkey. Auto-generated if omitted.
 */
export function postTask(
  orchestratorRepo: AgentRepository,
  spec: PostTaskSpec,
  rkey?: string,
): { uri: string; rkey: string } {
  const taskRkey = rkey ?? `task-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  const content: TaskPosting = {
    $type: 'network.mycelium.task.posting',
    ...spec,
    status: 'open',
    claimUris: [],
    createdAt: now,
    updatedAt: now,
  };

  const result = putRecord(orchestratorRepo, 'network.mycelium.task.posting', taskRkey, content);
  return { uri: result.uri, rkey: taskRkey };
}

/**
 * Create a task.claim in the agent's repository.
 * Does NOT change task status — the orchestrator observes the firehose and calls assignTask.
 */
export function claimTask(
  agentRepo: AgentRepository,
  taskUri: string,
  taskTitle: string,
  proposal: TaskClaim['proposal'],
  matchingCapabilities: string[],
): { uri: string; rkey: string } {
  const rkey = `claim-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  const content: TaskClaim = {
    $type: 'network.mycelium.task.claim',
    taskUri,
    taskTitle,
    claimerDid: agentRepo.did,
    proposal,
    matchingCapabilities,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };

  const result = putRecord(agentRepo, 'network.mycelium.task.claim', rkey, content);
  return { uri: result.uri, rkey };
}

/**
 * Assign a task to the best candidate.
 * Transitions task status: open|claimed → assigned.
 * Updates assigneeDid on the task posting.
 *
 * @throws InvalidStateTransitionError if the task is not in open or claimed state
 */
export function assignTask(
  orchestratorRepo: AgentRepository,
  taskUri: string,
  claimerDid: string,
): void {
  const { collection, rkey } = parseAtUri(taskUri);
  const stored = getRecord(orchestratorRepo, collection, rkey);
  const content = stored.content as TaskPosting;

  // Allow transition from either 'open' (direct assign) or 'claimed' (after claim)
  if (content.status !== 'open' && content.status !== 'claimed') {
    validateTransition(content.status, 'assigned', taskUri); // Will throw
  }

  putRecord(orchestratorRepo, collection, rkey, {
    ...content,
    status: 'assigned',
    assigneeDid: claimerDid,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Signal that the assigned agent has started working.
 * Transitions task status: assigned → in_progress.
 *
 * @throws InvalidStateTransitionError if task is not in assigned state
 */
export function startTask(orchestratorRepo: AgentRepository, taskUri: string): void {
  const { collection, rkey } = parseAtUri(taskUri);
  const stored = getRecord(orchestratorRepo, collection, rkey);
  const content = stored.content as TaskPosting;

  validateTransition(content.status, 'in_progress', taskUri);

  putRecord(orchestratorRepo, collection, rkey, {
    ...content,
    status: 'in_progress',
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Create a task.completion in the agent's repository.
 * Does NOT change task status — call transitionTask(orchestratorRepo, taskUri, 'completed')
 * after observing the completion event on the firehose.
 */
export function completeTask(
  agentRepo: AgentRepository,
  claimUri: string,
  taskUri: string,
  results: CompletionResults,
): { uri: string; rkey: string } {
  const rkey = `completion-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  const content: TaskCompletion = {
    $type: 'network.mycelium.task.completion',
    taskUri,
    claimUri,
    completerDid: agentRepo.did,
    ...results,
    createdAt: now,
  };

  const result = putRecord(agentRepo, 'network.mycelium.task.completion', rkey, content);
  return { uri: result.uri, rkey };
}

/**
 * Generic task status transition.
 * Used by orchestrator logic to advance task state from firehose-observed events.
 *
 * @throws InvalidStateTransitionError if the transition is not valid
 */
export function transitionTask(
  orchestratorRepo: AgentRepository,
  taskUri: string,
  to: TaskStatus,
  updates?: Partial<Pick<TaskPosting, 'completionUri' | 'assigneeDid' | 'claimUris'>>,
): void {
  const { collection, rkey } = parseAtUri(taskUri);
  const stored = getRecord(orchestratorRepo, collection, rkey);
  const content = stored.content as TaskPosting;

  validateTransition(content.status, to, taskUri);

  putRecord(orchestratorRepo, collection, rkey, {
    ...content,
    ...updates,
    status: to,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Review a completed task: accept it (→ "accepted") or reject/reopen (→ "open").
 * Call this from the orchestrator after verifying the task.completion.
 *
 * @throws InvalidStateTransitionError if task is not in "completed" state
 */
export function reviewCompletion(
  orchestratorRepo: AgentRepository,
  taskUri: string,
  accepted: boolean,
): void {
  const next: TaskStatus = accepted ? 'accepted' : 'open';
  transitionTask(orchestratorRepo, taskUri, next);
}

// ─── Read helpers ─────────────────────────────────────────────────────────────

/** Retrieve a task.posting record by its AT URI. */
export function getTask(orchestratorRepo: AgentRepository, taskUri: string): TaskPosting {
  const { collection, rkey } = parseAtUri(taskUri);
  const stored = getRecord(orchestratorRepo, collection, rkey);
  return stored.content as TaskPosting;
}

// ─── Capability matching ──────────────────────────────────────────────────────

/**
 * Determine whether an agent should self-nominate for a task.
 * Returns false if any required capability cannot be matched.
 */
export function shouldClaim(
  agentCapabilities: AgentCapability[],
  task: TaskPosting,
): boolean {
  const profLevels = ['beginner', 'intermediate', 'advanced', 'expert'] as const;

  for (const req of task.requiredCapabilities) {
    const match = agentCapabilities.find((c) => c.domain === req.domain);
    if (!match) return false;

    const agentProfIdx = profLevels.indexOf(match.proficiencyLevel);
    const reqProfIdx = profLevels.indexOf(req.minProficiency);
    if (agentProfIdx < reqProfIdx) return false;

    const overlap = match.tags.filter((t) => req.tags.includes(t)).length;
    if (overlap === 0) return false;
  }

  return true;
}
