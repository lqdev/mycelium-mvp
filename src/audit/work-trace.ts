// WorkTrace: derives a human-readable proof chain for a task from the firehose log.
// This is a derived view — not a persisted record — built on demand from existing events.

import type {
  Firehose,
  FirehoseEvent,
  MatchRecommendation,
  ReputationStamp,
  TaskAssignment,
  TaskClaim,
  TaskCompletion,
  TaskPosting,
  VerificationResult,
} from '../schemas/types.js';

// ─── Public types ─────────────────────────────────────────────────────────────

export type TraceRole =
  | 'requester'
  | 'work-index'
  | 'matcher'
  | 'coordinator'
  | 'worker'
  | 'verifier'
  | 'attestor'
  | 'auditor';

export interface WorkTraceStep {
  role: TraceRole;
  eventType: string;
  uri?: string;
  did?: string;
  seq?: number;
  summary: string;
  timestamp?: string;
  detail?: Record<string, unknown>;
}

export interface TaskWorkTrace {
  scope: 'task';
  taskId: string;
  taskUri: string;
  title: string;
  status: string;
  steps: WorkTraceStep[];
  summary: string;
  consequences: string[];
  missingEvidence: string[];
}

// ─── Handle registry ──────────────────────────────────────────────────────────

/** Simple DID→handle lookup built from the firehose log. */
function buildHandleMap(log: FirehoseEvent[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of log) {
    if (e.collection === 'network.mycelium.agent.profile' && e.record) {
      const p = e.record as { handle?: string };
      if (p.handle) map.set(e.did, p.handle.split('.')[0]);
    }
  }
  return map;
}

function shortDid(did: string): string {
  return did.length > 20 ? `${did.slice(0, 12)}…${did.slice(-6)}` : did;
}

function handleOrDid(did: string, handles: Map<string, string>): string {
  return handles.get(did) ?? shortDid(did);
}

const ATTESTOR_LABELS: Record<string, string> = {
  requester: 'Requester',
  mayor: 'Mayor',
  peer: 'Peer',
  verifier: 'Verifier',
};

function attestorLabel(attestorType: ReputationStamp['attestorType'] | string | undefined): string {
  return attestorType ? (ATTESTOR_LABELS[attestorType] ?? attestorType) : 'Mayor';
}

// ─── WorkTrace builder ────────────────────────────────────────────────────────

/**
 * Build a WorkTrace for a task, scanning the firehose for all related events.
 *
 * @param firehose - the shared firehose (all events visible here)
 * @param taskUri  - AT URI of the task posting record
 * @param taskId   - template task ID (e.g. "task-001")
 * @param title    - human-readable task title
 * @param mayorDid - DID of the mayor/coordinator participant
 */
export function buildWorkTrace(
  firehose: Firehose,
  taskUri: string,
  taskId: string,
  title: string,
  mayorDid: string,
): TaskWorkTrace {
  const log = firehose.log;
  const handles = buildHandleMap(log);
  const steps: WorkTraceStep[] = [];
  const missingEvidence: string[] = [];

  // ── 1. Task posting ──────────────────────────────────────────────────────
  const postingEvent = log.find(
    (e) => e.collection === 'network.mycelium.task.posting' && `at://${e.did}/${e.collection}/${e.rkey}` === taskUri,
  );
  if (postingEvent) {
    const posting = postingEvent.record as TaskPosting;
    steps.push({
      role: 'requester',
      eventType: 'task.posting',
      uri: taskUri,
      did: postingEvent.did,
      seq: postingEvent.seq,
      timestamp: postingEvent.timestamp,
      summary: `${handleOrDid(postingEvent.did, handles)} posted task: "${title}"`,
      detail: {
        complexity: posting.complexity,
        capabilities: posting.requiredCapabilities.map((c) => `${c.domain}/${c.tags.join(',')}`),
      },
    });
  } else {
    missingEvidence.push('Task posting record not found');
  }

  // Work-index acknowledgement (first status update = open)
  const openUpdate = log.find(
    (e) =>
      e.collection === 'network.mycelium.task.posting' &&
      `at://${e.did}/${e.collection}/${e.rkey}` === taskUri &&
      (e.record as TaskPosting | null)?.status === 'open' &&
      e.operation === 'update',
  );
  if (openUpdate) {
    steps.push({
      role: 'work-index',
      eventType: 'task.indexed',
      uri: taskUri,
      did: openUpdate.did,
      seq: openUpdate.seq,
      timestamp: openUpdate.timestamp,
      summary: 'Task indexed on Wanted Board — open for claims',
    });
  }

  // ── 2. Claims ────────────────────────────────────────────────────────────
  const claimEvents = log.filter(
    (e) => e.collection === 'network.mycelium.task.claim' && (e.record as TaskClaim).taskUri === taskUri,
  );
  for (const ce of claimEvents) {
    const claim = ce.record as TaskClaim;
    const claimUri = `at://${ce.did}/${ce.collection}/${ce.rkey}`;
    steps.push({
      role: 'worker',
      eventType: 'task.claim',
      uri: claimUri,
      did: ce.did,
      seq: ce.seq,
      timestamp: ce.timestamp,
      summary: `${handleOrDid(ce.did, handles)} claimed task (confidence: ${claim.proposal.confidenceLevel})`,
      detail: { confidenceLevel: claim.proposal.confidenceLevel },
    });
  }
  if (claimEvents.length === 0) {
    missingEvidence.push('No claim records found — task may still be open');
  }

  // ── 3. Match recommendation ───────────────────────────────────────────────
  const recEvents = log.filter(
    (e) =>
      e.collection === 'network.mycelium.match.recommendation' &&
      (e.record as MatchRecommendation).taskUri === taskUri,
  );
  for (const re of recEvents) {
    const rec = re.record as MatchRecommendation;
    const recUri = `at://${re.did}/${re.collection}/${re.rkey}`;
    const topRank = rec.rankings[0];
    const winner = topRank ? handleOrDid(topRank.candidateDid, handles) : 'unknown';
    steps.push({
      role: 'matcher',
      eventType: 'match.recommendation',
      uri: recUri,
      did: re.did,
      seq: re.seq,
      timestamp: re.timestamp,
      summary: `Matcher ranked ${rec.rankings.length} candidate(s) — top pick: ${winner} (score: ${topRank?.score?.toFixed(1) ?? '?'})`,
      detail: {
        policy: rec.policy,
        rankings: rec.rankings.map((r) => ({
          rank: r.rank,
          candidate: handleOrDid(r.candidateDid, handles),
          score: r.score,
          reasons: r.reasons,
        })),
      },
    });
  }
  if (recEvents.length === 0 && claimEvents.length > 0) {
    missingEvidence.push('Match recommendation not yet written');
  }

  // ── 4. Task assignment ────────────────────────────────────────────────────
  const assignEvents = log.filter(
    (e) =>
      e.collection === 'network.mycelium.task.assignment' &&
      (e.record as TaskAssignment).taskUri === taskUri,
  );
  for (const ae of assignEvents) {
    const asgn = ae.record as TaskAssignment;
    const asgnUri = `at://${ae.did}/${ae.collection}/${ae.rkey}`;
    steps.push({
      role: 'coordinator',
      eventType: 'task.assignment',
      uri: asgnUri,
      did: ae.did,
      seq: ae.seq,
      timestamp: ae.timestamp,
      summary: `Coordinator assigned task to ${handleOrDid(asgn.assigneeDid, handles)} (policy: ${asgn.assignmentPolicy})`,
      detail: {
        assignee: handleOrDid(asgn.assigneeDid, handles),
        assignmentPolicy: asgn.assignmentPolicy,
        matchRecommendationUri: asgn.matchRecommendationUri,
      },
    });
  }
  if (assignEvents.length === 0 && claimEvents.length > 0) {
    missingEvidence.push('Task assignment record not yet written');
  }

  // ── 5. Completion ─────────────────────────────────────────────────────────
  const completionEvents = log.filter(
    (e) =>
      e.collection === 'network.mycelium.task.completion' &&
      (e.record as TaskCompletion).taskUri === taskUri,
  );
  for (const ce of completionEvents) {
    const comp = ce.record as TaskCompletion;
    const compUri = `at://${ce.did}/${ce.collection}/${ce.rkey}`;
    const metrics = comp.metrics;
    const metricParts: string[] = [];
    if (metrics.testsTotal) metricParts.push(`tests: ${metrics.testsPassed ?? 0}/${metrics.testsTotal}`);
    if (metrics.coveragePercent !== undefined && metrics.coveragePercent !== null) {
      metricParts.push(`coverage: ${metrics.coveragePercent}%`);
    }
    if (metrics.linesOfCode) metricParts.push(`${metrics.linesOfCode} LoC`);
    steps.push({
      role: 'worker',
      eventType: 'task.completion',
      uri: compUri,
      did: ce.did,
      seq: ce.seq,
      timestamp: ce.timestamp,
      summary: `${handleOrDid(ce.did, handles)} submitted completion${metricParts.length ? ` — ${metricParts.join(', ')}` : ''}`,
      detail: { metrics, summary: comp.summary },
    });
  }
  if (completionEvents.length === 0 && assignEvents.length > 0) {
    missingEvidence.push('Completion record not yet submitted');
  }

  // ── 6. Verification results ───────────────────────────────────────────────
  const verEvents = log.filter(
    (e) =>
      e.collection === 'network.mycelium.verification.result' &&
      (e.record as VerificationResult).taskUri === taskUri,
  );
  for (const ve of verEvents) {
    const ver = ve.record as VerificationResult;
    const verUri = `at://${ve.did}/${ve.collection}/${ve.rkey}`;
    const icon = ver.status === 'passed' ? '✓' : ver.status === 'failed' ? '✗' : '~';
    steps.push({
      role: 'verifier',
      eventType: 'verification.result',
      uri: verUri,
      did: ve.did,
      seq: ve.seq,
      timestamp: ve.timestamp,
      summary: `Verifier checked completion: ${icon} ${ver.status} — ${ver.summary}`,
      detail: {
        verificationType: ver.verificationType,
        status: ver.status,
        evidence: ver.evidence,
      },
    });
  }
  if (verEvents.length === 0 && completionEvents.length > 0) {
    missingEvidence.push('Verification result not yet written');
  }

  // ── 7. Reputation stamps ──────────────────────────────────────────────────
  const stampEvents = log.filter(
    (e) =>
      e.collection === 'network.mycelium.reputation.stamp' &&
      (e.record as ReputationStamp).taskUri === taskUri,
  );
  for (const se of stampEvents) {
    const stamp = se.record as ReputationStamp;
    const stampUri = `at://${se.did}/${se.collection}/${se.rkey}`;
    const label = attestorLabel(stamp.attestorType);
    steps.push({
      role: 'attestor',
      eventType: 'reputation.stamp',
      uri: stampUri,
      did: se.did,
      seq: se.seq,
      timestamp: se.timestamp,
      summary: `${label} issued ${stamp.assessment} stamp to ${handleOrDid(stamp.subjectDid, handles)} (score: ${stamp.overallScore.toFixed(0)}/100)`,
      detail: {
        assessment: stamp.assessment,
        overallScore: stamp.overallScore,
        attestorType: stamp.attestorType,
        evidenceUris: stamp.evidenceUris,
      },
    });
  }

  // ── 8. Determine task status from posting events ───────────────────────────
  const allPostingUpdates = log
    .filter((e) => e.collection === 'network.mycelium.task.posting' && `at://${e.did}/${e.collection}/${e.rkey}` === taskUri)
    .sort((a, b) => b.seq - a.seq);
  const latestStatus = allPostingUpdates.length > 0
    ? ((allPostingUpdates[0].record as TaskPosting | null)?.status ?? 'pending')
    : 'pending';

  // Sort all steps by seq (preserves causal order)
  steps.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

  // ── 9. Summary and consequences ───────────────────────────────────────────
  const { summary, consequences } = buildNarrative(
    steps,
    latestStatus,
    title,
    stampEvents.map((se) => se.record as ReputationStamp),
    handles,
    mayorDid,
  );

  return {
    scope: 'task',
    taskId,
    taskUri,
    title,
    status: latestStatus,
    steps,
    summary,
    consequences,
    missingEvidence,
  };
}

// ─── Narrative generation ─────────────────────────────────────────────────────

function buildNarrative(
  steps: WorkTraceStep[],
  status: string,
  title: string,
  stamps: ReputationStamp[],
  handles: Map<string, string>,
  _mayorDid: string,
): { summary: string; consequences: string[] } {
  const workerSteps = steps.filter((s) => s.role === 'worker' && s.eventType === 'task.completion');
  const verSteps = steps.filter((s) => s.role === 'verifier');
  const stampSteps = steps.filter((s) => s.role === 'attestor');

  // Summary
  let summary: string;
  if (status === 'accepted' || status === 'review_approved') {
    const worker = workerSteps[0];
    const workerName = worker?.did ? handleOrDid(worker.did, handles) : 'a worker';
    const stamp = stamps.find((s) => s.attestorType === 'mayor') ?? stamps[0];
    const score = stamp ? ` (score: ${stamp.overallScore.toFixed(0)}/100)` : '';
    summary = `"${title}" completed by ${workerName} and verified by the Mayor${score}. All evidence is signed and traceable.`;
  } else if (status === 'completed') {
    summary = `"${title}" was submitted and is awaiting review.`;
  } else if (status === 'in_progress') {
    summary = `"${title}" is assigned and work is in progress.`;
  } else if (status === 'claimed') {
    summary = `"${title}" has been claimed and is awaiting assignment.`;
  } else if (status === 'open') {
    summary = `"${title}" is open and waiting for claims.`;
  } else {
    summary = `"${title}" is ${status}.`;
  }

  // Consequences
  const consequences: string[] = [];

  if (stamps.length > 0) {
    const mayorStamp = stamps.find((s) => s.attestorType === 'mayor');
    if (mayorStamp) {
      const subjectName = handleOrDid(mayorStamp.subjectDid, handles);
      const domain = mayorStamp.taskDomain;
      const assessment = mayorStamp.assessment;
      consequences.push(
        `${subjectName} now has a verified ${domain} completion on record (${assessment}).`,
      );
      if (mayorStamp.overallScore >= 80) {
        consequences.push(
          `Future ${domain} tasks will rank ${subjectName} higher under trust-weighted matching.`,
        );
      } else if (mayorStamp.overallScore < 50) {
        consequences.push(
          `Future ${domain} tasks will rank ${subjectName} lower until reputation recovers.`,
        );
      }
    }

    const requesterStamp = stamps.find((s) => s.attestorType === 'requester');
    if (requesterStamp) {
      consequences.push(
        `Requester also attested to the work — multi-attestor evidence strengthens the trust signal.`,
      );
    }
  }

  if (verSteps.length > 0) {
    const verStep = verSteps[verSteps.length - 1];
    const verDetail = verStep.detail as { status?: string; verificationType?: string } | undefined;
    if (verDetail?.status === 'inconclusive') {
      consequences.push(
        `Verification was inconclusive (simulation mode) — stamps remain valid but carry lower evidential weight.`,
      );
    }
  }

  if (stampSteps.length === 0 && (status === 'accepted' || status === 'review_approved')) {
    consequences.push('Reputation stamps are being issued — check back shortly.');
  }

  if (consequences.length === 0) {
    consequences.push('Work is in progress — consequences will be visible once verification and stamping complete.');
  }

  return { summary, consequences };
}
