// Reputation module: stamp creation, aggregation, trust levels, claim ranking.
// Scores are in the range 0–10 per dimension and 0–100 for overall.

import type {
  AgentCapability,
  AgentRepository,
  AggregatedReputation,
  Firehose,
  ReputationDimensions,
  ReputationStamp,
  TaskPosting,
} from '../schemas/types.js';
import { putRecord } from '../repository/index.js';
import { CONSTANTS } from '../constants.js';

// ─── Assessment score mapping ─────────────────────────────────────────────────

const ASSESSMENT_TABLE: ReadonlyArray<[number, ReputationStamp['assessment']]> = [
  [90, 'exceptional'],
  [80, 'strong'],
  [65, 'satisfactory'],
  [50, 'needs_improvement'],
  [0, 'unsatisfactory'],
];

export function scoreToAssessment(score: number): ReputationStamp['assessment'] {
  return (ASSESSMENT_TABLE.find(([min]) => score >= min) ?? ASSESSMENT_TABLE.at(-1))![1];
}

// ─── Weighted overall score ───────────────────────────────────────────────────

/**
 * Compute the weighted overall score from dimension scores (0–10 each).
 * Returns a value in 0–100 (multiplied by 10 to match the overall scale).
 */
export function computeOverallScore(dimensions: ReputationDimensions): number {
  const w = CONSTANTS.REPUTATION_DIMENSION_WEIGHTS;
  return (
    (dimensions.codeQuality * w.codeQuality +
      dimensions.reliability * w.reliability +
      dimensions.efficiency * w.efficiency +
      dimensions.communication * w.communication +
      dimensions.creativity * w.creativity) *
    10
  );
}

// ─── Comment generation ───────────────────────────────────────────────────────

function generateAssessmentComment(
  dimensions: ReputationDimensions,
  assessment: ReputationStamp['assessment'],
): string {
  const entries = Object.entries(dimensions) as Array<[keyof ReputationDimensions, number]>;
  const [topDim] = entries.sort((a, b) => b[1] - a[1]);
  const [lowDim] = entries.sort((a, b) => a[1] - b[1]);

  const assessmentPhrases: Record<ReputationStamp['assessment'], string> = {
    exceptional: 'Outstanding performance across all dimensions.',
    strong: 'Solid work with commendable results.',
    satisfactory: 'Completed the task to an acceptable standard.',
    needs_improvement: 'Work completed but fell short in key areas.',
    unsatisfactory: 'Work did not meet the required standard.',
  };

  return `${assessmentPhrases[assessment]} Particularly strong in ${topDim[0]} (${topDim[1].toFixed(1)}); area for growth: ${lowDim[0]} (${lowDim[1].toFixed(1)}).`;
}

// ─── Stamp creation ───────────────────────────────────────────────────────────

export interface CreateStampParams {
  attestorRepo: AgentRepository;
  subjectDid: string;
  taskUri: string;
  completionUri: string;
  taskDomain: string;
  dimensions: ReputationDimensions;
  intelligenceDid?: string;
  reworkPenalty?: number;
  knowledgeRefs?: ReputationStamp['knowledgeRefs'];
  toolRefs?: ReputationStamp['toolRefs'];
  attestorType?: ReputationStamp['attestorType'];
  evidenceUris?: string[];
}

/**
 * Create a reputation stamp and write it to the attestor's repository.
 * The overall score, assessment, and comment are computed internally.
 */
export function createStamp(params: CreateStampParams): { stamp: ReputationStamp; uri: string } {
  const {
    attestorRepo,
    subjectDid,
    taskUri,
    completionUri,
    taskDomain,
    dimensions,
    intelligenceDid,
    reworkPenalty = 0,
    knowledgeRefs,
    toolRefs,
    attestorType,
    evidenceUris,
  } = params;

  const rawScore = computeOverallScore(dimensions);
  const overallScore = Math.max(0, rawScore - reworkPenalty);
  const assessment = scoreToAssessment(overallScore);
  const comment = generateAssessmentComment(dimensions, assessment);

  const rkey = `stamp-${Date.now()}-${subjectDid.slice(-8)}`;
  const now = new Date().toISOString();

  const stamp: ReputationStamp = {
    $type: 'network.mycelium.reputation.stamp',
    subjectDid,
    attestorDid: attestorRepo.did,
    taskUri,
    completionUri,
    taskDomain,
    intelligenceDid,
    dimensions,
    overallScore,
    assessment,
    comment,
    knowledgeRefs,
    toolRefs,
    attestorType,
    evidenceUris,
    createdAt: now,
  };

  const result = putRecord(attestorRepo, 'network.mycelium.reputation.stamp', rkey, stamp);
  return { stamp, uri: result.uri };
}

// ─── Stamp retrieval ──────────────────────────────────────────────────────────

/**
 * Scan the firehose event log and extract all reputation stamps for a given subject DID.
 * Stamps may be in any agent's repository — the firehose sees all writes.
 */
export function getStampsForAgent(firehose: Firehose, subjectDid: string): ReputationStamp[] {
  return firehose.log
    .filter(
      (e) =>
        e.collection === 'network.mycelium.reputation.stamp' &&
        e.record !== null &&
        (e.record as ReputationStamp).subjectDid === subjectDid,
    )
    .map((e) => e.record as ReputationStamp);
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

/** Recency weight based on stamp position (most recent = index 0). */
function recencyWeight(reverseIndex: number): number {
  if (reverseIndex < 5) return CONSTANTS.REPUTATION_RECENCY_RECENT;
  if (reverseIndex < 15) return CONSTANTS.REPUTATION_RECENCY_MID;
  return CONSTANTS.REPUTATION_RECENCY_OLD;
}

/**
 * Aggregate reputation stamps into a summary for an agent.
 *
 * @param queryDomain Optional domain to prioritize in weighting
 */
export function aggregateReputation(
  stamps: ReputationStamp[],
  queryDomain?: string,
): AggregatedReputation {
  if (stamps.length === 0) {
    return {
      did: '',
      totalTasks: 0,
      averageScores: { codeQuality: 0, reliability: 0, communication: 0, creativity: 0, efficiency: 0 },
      overallScore: 0,
      taskBreakdown: {},
      recentTrend: 'stable',
      trustLevel: 'newcomer',
    };
  }

  // Sort newest first for recency indexing
  const sorted = [...stamps].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const dims: ReputationDimensions = { codeQuality: 0, reliability: 0, communication: 0, creativity: 0, efficiency: 0 };
  let weightSum = 0;
  let weightedOverall = 0;

  sorted.forEach((stamp, reverseIdx) => {
    const rw = recencyWeight(reverseIdx);
    const dw = queryDomain && stamp.taskDomain !== queryDomain
      ? CONSTANTS.REPUTATION_DOMAIN_OTHER
      : CONSTANTS.REPUTATION_DOMAIN_MATCH;
    const aw = CONSTANTS.REPUTATION_ATTESTOR_WEIGHTS[stamp.attestorType ?? 'mayor'];
    const w = rw * dw * aw;

    for (const key of Object.keys(dims) as Array<keyof ReputationDimensions>) {
      dims[key] += stamp.dimensions[key] * w;
    }
    weightedOverall += stamp.overallScore * w;
    weightSum += w;
  });

  const averageScores: ReputationDimensions = {
    codeQuality: dims.codeQuality / weightSum,
    reliability: dims.reliability / weightSum,
    communication: dims.communication / weightSum,
    creativity: dims.creativity / weightSum,
    efficiency: dims.efficiency / weightSum,
  };

  const overallScore = weightedOverall / weightSum;

  // Per-domain breakdown (simple average, no recency weighting)
  const taskBreakdown: AggregatedReputation['taskBreakdown'] = {};
  for (const stamp of stamps) {
    const b = taskBreakdown[stamp.taskDomain];
    if (!b) {
      taskBreakdown[stamp.taskDomain] = { count: 1, avgScore: stamp.overallScore };
    } else {
      const newCount = b.count + 1;
      taskBreakdown[stamp.taskDomain] = {
        count: newCount,
        avgScore: (b.avgScore * b.count + stamp.overallScore) / newCount,
      };
    }
  }

  // Per-attestor breakdown
  const breakdownByAttestor: NonNullable<AggregatedReputation['breakdownByAttestor']> = {};
  for (const stamp of stamps) {
    const at = stamp.attestorType ?? 'mayor';
    const b = breakdownByAttestor[at];
    if (!b) {
      breakdownByAttestor[at] = { count: 1, avgScore: stamp.overallScore };
    } else {
      const newCount = b.count + 1;
      breakdownByAttestor[at] = {
        count: newCount,
        avgScore: (b.avgScore * b.count + stamp.overallScore) / newCount,
      };
    }
  }

  // Count unique tasks (by taskUri) rather than total stamps
  const uniqueTaskUris = new Set(stamps.map((s) => s.taskUri));
  const totalTasks = uniqueTaskUris.size;

  // Trend detection (sliding window of up to TREND_WINDOW_SIZE stamps)
  const recentTrend = computeTrend(sorted);

  // Trust level
  const did = stamps[0]!.subjectDid;
  const trustLevel = getTrustLevel({ totalTasks, overallScore });

  return {
    did,
    totalTasks,
    averageScores,
    overallScore,
    taskBreakdown,
    breakdownByAttestor,
    recentTrend,
    trustLevel,
  };
}

function computeTrend(sortedNewestFirst: ReputationStamp[]): AggregatedReputation['recentTrend'] {
  const window = sortedNewestFirst.slice(0, CONSTANTS.TREND_WINDOW_SIZE);
  if (window.length < 2) return 'stable';

  const half = Math.ceil(window.length / 2);
  const recentAvg =
    window.slice(0, half).reduce((s, x) => s + x.overallScore, 0) / half;
  const olderCount = window.length - half;
  if (olderCount === 0) return 'stable';
  const olderAvg =
    window.slice(half).reduce((s, x) => s + x.overallScore, 0) / olderCount;

  const delta = recentAvg - olderAvg;
  if (delta > CONSTANTS.TREND_DELTA_THRESHOLD) return 'improving';
  if (delta < -CONSTANTS.TREND_DELTA_THRESHOLD) return 'declining';
  return 'stable';
}

/**
 * Determine trust level from task count and overall score.
 * Evaluated from highest threshold downward; returns the highest level achieved.
 */
export function getTrustLevel(
  stats: Pick<AggregatedReputation, 'totalTasks' | 'overallScore'>,
): AggregatedReputation['trustLevel'] {
  const levels = CONSTANTS.TRUST_LEVELS;
  if (stats.totalTasks >= levels.expert.minTasks && stats.overallScore >= levels.expert.minAvgScore) {
    return 'expert';
  }
  if (stats.totalTasks >= levels.trusted.minTasks && stats.overallScore >= levels.trusted.minAvgScore) {
    return 'trusted';
  }
  if (stats.totalTasks >= levels.established.minTasks && stats.overallScore >= levels.established.minAvgScore) {
    return 'established';
  }
  return 'newcomer';
}

// ─── Claim ranking ────────────────────────────────────────────────────────────

export interface ClaimCandidate {
  did: string;
  claim: { proposal: { confidenceLevel: 'low' | 'medium' | 'high' } };
  capabilities: AgentCapability[];
  activeTasks: number;
  reputation: AggregatedReputation | null;
}

/**
 * Rank claim candidates for a task.
 * Returns candidates sorted by descending rankScore.
 * Newcomers are disqualified from high-complexity tasks (rankScore = -1).
 */
export function rankClaims(
  candidates: ClaimCandidate[],
  task: TaskPosting,
): Array<ClaimCandidate & { rankScore: number }> {
  return candidates
    .map((candidate) => {
      const rep = candidate.reputation;
      const trustLevel = rep?.trustLevel ?? 'newcomer';

      // Disqualify newcomers from high-complexity tasks
      if (task.complexity === 'high' && trustLevel === 'newcomer') {
        return { ...candidate, rankScore: -1 };
      }

      // Capability fit score (0–100)
      let capabilityScore = 0;
      for (const req of task.requiredCapabilities) {
        const match = candidate.capabilities.find((c) => c.domain === req.domain);
        if (match) {
          const profScore = CONSTANTS.PROFICIENCY_SCORE[match.proficiencyLevel];
          const tagOverlap =
            req.tags.length > 0
              ? match.tags.filter((t) => req.tags.includes(t)).length / req.tags.length
              : 1;
          capabilityScore += profScore * tagOverlap;
        }
      }
      if (task.requiredCapabilities.length > 0) {
        capabilityScore /= task.requiredCapabilities.length;
      }

      const reputationScore = rep && rep.totalTasks > 0 ? rep.overallScore : CONSTANTS.RANK_NEWCOMER_REPUTATION;
      const loadPenalty = candidate.activeTasks * CONSTANTS.RANK_LOAD_PENALTY;
      const confidenceBonus = CONSTANTS.RANK_CONFIDENCE_BONUS[candidate.claim.proposal.confidenceLevel];

      const rankScore =
        capabilityScore * CONSTANTS.RANK_WEIGHT_CAPABILITY +
        reputationScore * CONSTANTS.RANK_WEIGHT_REPUTATION -
        loadPenalty +
        confidenceBonus;

      return { ...candidate, rankScore };
    })
    .sort((a, b) => b.rankScore - a.rankScore);
}
