// All magic numbers and configuration constants for the Mycelium MVP.
// Import from here — never hardcode these values in individual modules.

export const CONSTANTS = {

  // ─── Execution Timing ─────────────────────────────────────────────────
  // Real delays (milliseconds) used in setTimeout during agent execution
  BASE_EXECUTION_TIME_MS: {
    low: 2000,      // 2 seconds
    medium: 5000,   // 5 seconds
    high: 10000,    // 10 seconds
  },
  // Jitter multiplier range: actual delay = base × speedMult × random(0.8, 1.2)
  EXECUTION_JITTER_MIN: 0.8,
  EXECUTION_JITTER_MAX: 1.2,

  // Simulated duration (minutes) stored in task.completion.executionTime
  SIMULATED_DURATION_MINUTES: {
    low: 30,        // ~24–45 min after speedMult
    medium: 60,     // ~48–80 min after speedMult
    high: 100,      // ~80–125 min after speedMult
  },

  // ─── Reputation Weights ───────────────────────────────────────────────
  // Overall score = weighted sum of dimension scores
  REPUTATION_DIMENSION_WEIGHTS: {
    codeQuality:    0.30,
    reliability:    0.25,
    efficiency:     0.20,
    communication:  0.15,
    creativity:     0.10,
  },

  // Recency weighting for aggregation
  REPUTATION_RECENCY_RECENT:  1.0,   // Last 5 stamps
  REPUTATION_RECENCY_MID:     0.8,   // Stamps 6–15
  REPUTATION_RECENCY_OLD:     0.5,   // Stamps 16+

  // Domain relevance weighting
  REPUTATION_DOMAIN_MATCH:    1.0,   // Stamp domain matches query domain
  REPUTATION_DOMAIN_OTHER:    0.7,   // Stamp domain does not match

  // Attestor type weighting (multi-attestor trust)
  REPUTATION_ATTESTOR_WEIGHTS: {
    mayor:     0.40,
    requester: 0.35,
    peer:      0.20,
    verifier:  0.05,
  },

  // ─── Trust Level Thresholds ───────────────────────────────────────────
  TRUST_LEVELS: {
    newcomer:    { minTasks: 0,  minAvgScore: 0  },
    established: { minTasks: 3,  minAvgScore: 60 },
    trusted:     { minTasks: 10, minAvgScore: 75 },
    expert:      { minTasks: 25, minAvgScore: 85 },
  },

  // ─── Trend Detection ──────────────────────────────────────────────────
  TREND_WINDOW_SIZE: 5,       // Evaluate last N stamps for trend
  TREND_DELTA_THRESHOLD: 5,   // Score change ≥5 = improving/declining; <5 = stable

  // ─── Ranking / Assignment ─────────────────────────────────────────────
  RANK_WEIGHT_CAPABILITY:    0.40,
  RANK_WEIGHT_REPUTATION:    0.35,
  RANK_LOAD_PENALTY:        15,    // Points deducted per active task
  RANK_CONFIDENCE_BONUS: {
    low:    0,
    medium: 5,
    high:   10,
  },
  RANK_NEWCOMER_REPUTATION:  50,   // Neutral score for agents with no reputation yet
  RANK_HIGH_COMPLEXITY_MIN_TRUST: 'established' as const,  // Newcomers can't take high tasks

  // ─── Capability Matching ──────────────────────────────────────────────
  // Tags are kebab-case, lowercase, exact string match.
  CAPABILITY_TAG_MATCH: 'exact' as const,   // No fuzzy matching in MVP

  // ─── Firehose ─────────────────────────────────────────────────────────
  FIREHOSE_SEQ_START: 1,   // seq counter starts at 1 (not 0)

  // ─── Dashboard ────────────────────────────────────────────────────────
  DASHBOARD_PORT: 3000,
  DASHBOARD_SSE_EVENT_NAME: 'firehose',  // SSE event type: `event: firehose\ndata: {...}\n\n`

  // ─── Rework Penalty ───────────────────────────────────────────────────
  REWORK_SCORE_PENALTY: 10,  // Points subtracted from overallScore when rework was required

  // ─── Proficiency Levels (ordered low→high for comparison) ─────────────
  PROFICIENCY_ORDER: ['beginner', 'intermediate', 'advanced', 'expert'] as const,

  // ─── Proficiency Scores for Assignment Ranking ────────────────────────
  PROFICIENCY_SCORE: {
    beginner:     25,
    intermediate: 50,
    advanced:     75,
    expert:       100,
  },

} as const;

export type TrustLevel = keyof typeof CONSTANTS.TRUST_LEVELS;
export type ProficiencyLevel = (typeof CONSTANTS.PROFICIENCY_ORDER)[number];
export type TaskComplexity = keyof typeof CONSTANTS.BASE_EXECUTION_TIME_MS;
export type ConfidenceLevel = keyof typeof CONSTANTS.RANK_CONFIDENCE_BONUS;
