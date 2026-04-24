// Mycelium MVP — Dashboard Server
// Fastify server with REST API + SSE endpoint for the web dashboard.
// Bootstraps the full demo internally, runs it in the background, and
// serves real-time state at http://localhost:3000

import Fastify from 'fastify';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createFirehose, subscribe, unsubscribe } from '../../firehose/index.js';
import { bootstrapIntelligence } from '../../intelligence/index.js';
import { bootstrapAgents, createAgentRunner } from '../../agents/engine.js';
import { createMayor, DASHBOARD_TEMPLATE, GATEWAY_TEMPLATE, startProject } from '../../orchestrator/mayor.js';
import { generateIdentity } from '../../identity/index.js';
import { createMemoryRepository, listRecords, getRecord } from '../../repository/index.js';
import { getStampsForAgent, aggregateReputation } from '../../reputation/index.js';
import { createDuckDB, queryAll, queryOne, execute } from '../../storage/duckdb.js';
import { initPersistence, loadFirehoseLog, loadIdentities, saveIdentity, getConn, shutdownPersistence, registerAgentMapping, loadJetstreamCursor, saveJetstreamCursor } from '../../storage/persistence.js';
import { getLexicons, getLexicon } from '../../lexicon/index.js';
import { initPdsBridge, isPdsBridgeEnabled, mirrorRecord } from '../../atproto/pds-bridge.js';
import { initJetstream } from '../../atproto/jetstream.js';
import type {
  AgentCapability,
  AgentIdentity,
  AgentProfile,
  AgentRepository,
  AgentState,
  AggregatedReputation,
  Firehose,
  FirehoseEvent,
  ReputationStamp,
  TaskClaim,
  TaskCompletion,
  TaskPosting,
  Mayor,
} from '../../schemas/types.js';
import { CONSTANTS } from '../../constants.js';
import { AGENT_ROSTER } from '../../agents/roster.js';
import type { BootstrappedAgent } from '../../agents/engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PUBLIC_DIR = join(__dirname, 'public');

// ─── Bootstrap state ──────────────────────────────────────────────────────────

// Deployment role flags — set at startup, read by bootstrapDemo and the entry point
const isOrchestrator = process.argv.includes('--orchestrator');
const isWorker = process.argv.includes('--worker');

interface DemoState {
  firehose: Firehose;
  mayors: Mayor[];
  agents: BootstrappedAgent[];
  dbInstance: Awaited<ReturnType<typeof createDuckDB>>['instance'];
  isOrchestrator: boolean;
  isWorker: boolean;
}

async function bootstrapDemo(): Promise<DemoState> {
  // Fail fast if contradictory role flags are set
  if (isOrchestrator && isWorker) {
    console.error('[dashboard] Error: --orchestrator and --worker are mutually exclusive');
    process.exit(1);
  }

  // Ensure data directory exists and open DuckDB
  mkdirSync('./data', { recursive: true });
  const { instance: dbInstance, conn } = await createDuckDB('./data/mycelium.duckdb');
  initPersistence(conn);

  const firehose = createFirehose();

  // Restore firehose log from DuckDB if available (restart recovery)
  const savedEvents = await loadFirehoseLog();
  if (savedEvents.length > 0) {
    firehose.log.push(...savedEvents);
    firehose.seq = savedEvents[savedEvents.length - 1].seq + 1;
    console.log(`[dashboard] Restored ${savedEvents.length} events from DuckDB`);
  }

  // Load saved agent identities for persistence across runs
  const savedIdentities = await loadIdentities();
  console.log(
    savedIdentities.size > 0
      ? `[dashboard] Loaded ${savedIdentities.size} saved identities from DuckDB`
      : '[dashboard] First run — generating fresh agent identities',
  );

  const intelligence = bootstrapIntelligence(firehose, savedIdentities);

  // ── Mayor setup (orchestrator or full-node; skipped in worker mode) ──────────
  let mayorAlpha: Mayor | undefined;
  let mayorBeta: Mayor | undefined;
  let mayorIdentity: AgentIdentity | undefined;
  let mayorBetaIdentity: AgentIdentity | undefined;
  let mayorRepo: AgentRepository | undefined;
  let mayorBetaRepo: AgentRepository | undefined;
  let savedMayorIdentity: AgentIdentity | undefined;
  let savedMayorBetaIdentity: AgentIdentity | undefined;

  if (!isWorker) {
    savedMayorIdentity = savedIdentities.get('mayor.mycelium.local');
    mayorIdentity = savedMayorIdentity ?? generateIdentity('mayor.mycelium.local', 'Mayor Alpha (Orchestrator)');
    mayorRepo = createMemoryRepository(mayorIdentity, firehose);
    mayorAlpha = createMayor(mayorIdentity, mayorRepo, firehose, DASHBOARD_TEMPLATE);

    savedMayorBetaIdentity = savedIdentities.get('mayor-beta.mycelium.local');
    mayorBetaIdentity = savedMayorBetaIdentity ?? generateIdentity('mayor-beta.mycelium.local', 'Mayor Beta (Orchestrator)');
    mayorBetaRepo = createMemoryRepository(mayorBetaIdentity, firehose);
    mayorBeta = createMayor(mayorBetaIdentity, mayorBetaRepo, firehose, GATEWAY_TEMPLATE);
  }

  // ── Agent setup (worker or full-node; skipped in orchestrator mode) ──────────
  let agents: BootstrappedAgent[] = [];
  let newAgentIdentities: AgentIdentity[] = [];
  if (!isOrchestrator) {
    const bootstrapped = bootstrapAgents(firehose, intelligence, savedIdentities);
    agents = bootstrapped.agents;
    newAgentIdentities = bootstrapped.newIdentities;
  }

  // Save intelligence provider identities (no PDS accounts, safe to save now)
  for (const id of intelligence.newIdentities) {
    saveIdentity(id);
  }

  // Register did→handle mappings so the PDS bridge can route mirror calls
  for (const { def, identity } of agents) {
    registerAgentMapping(identity.did, def.handle);
  }
  // Mayors get PDS accounts in Phase 14 — register their DIDs too
  if (mayorIdentity) registerAgentMapping(mayorIdentity.did, mayorIdentity.handle);
  if (mayorBetaIdentity) registerAgentMapping(mayorBetaIdentity.did, mayorBetaIdentity.handle);

  // Init PDS bridge if configured (env-gated; no-op when PDS_ENDPOINT is not set).
  // Bridge init happens BEFORE saving agent identities so plcDid is set on first save (no double-save race).
  // localPlcDids is passed as a mutable Set so the bridge can add Mayor plcDids even on lazy-established sessions,
  // preventing Jetstream echo loops where our own Mayor events re-enter the local firehose.
  const pdsEndpoint = process.env.PDS_ENDPOINT;
  const pdsAdminPassword = process.env.PDS_ADMIN_PASSWORD;
  const localPlcDids = new Set<string>();
  if (pdsEndpoint && pdsAdminPassword) {
    // Orchestrator: mayor accounts only. Worker: agent accounts only. Full: all accounts.
    const pdsAgents = [
      ...(!isOrchestrator ? agents.map(({ def }) => ({ handle: def.handle })) : []),
      ...(!isWorker && mayorIdentity ? [{ handle: mayorIdentity.handle }] : []),
      ...(!isWorker && mayorBetaIdentity ? [{ handle: mayorBetaIdentity.handle }] : []),
    ];
    const plcDids = await initPdsBridge(
      pdsAgents,
      pdsEndpoint,
      pdsAdminPassword,
      process.env.PDS_HOSTNAME ?? 'test',
      localPlcDids,
    );
    // Apply PDS-assigned did:plc to agent identities (bridge is authoritative)
    for (const { def, identity } of agents) {
      const plcDid = plcDids.get(def.handle);
      if (plcDid && plcDid !== identity.plcDid) identity.plcDid = plcDid;
    }
    // Apply PDS-assigned did:plc to Mayor identities
    for (const identity of [mayorIdentity, mayorBetaIdentity]) {
      if (!identity) continue;
      const plcDid = plcDids.get(identity.handle);
      if (plcDid && plcDid !== identity.plcDid) identity.plcDid = plcDid;
    }
    // Populate localPlcDids from all registered handles (bridge also keeps it current on lazy sessions)
    for (const plcDid of plcDids.values()) localPlcDids.add(plcDid);

    // Keep Jetstream alive with periodic heartbeats.
    // Jetstream kills itself after 15s of no new PDS events (designed for high-volume bsky.network
    // use). Our quiet local PDS triggers this constantly, causing subscriber connections to cycle and
    // miss events. A 10s heartbeat ensures Jetstream stays alive and cross-node relays are stable.
    if (pdsAgents.length > 0) {
      const heartbeatHandle = pdsAgents[0].handle;
      setInterval(() => {
        mirrorRecord(heartbeatHandle, 'network.mycelium.heartbeat', 'heartbeat', {
          $type: 'network.mycelium.heartbeat',
          timestamp: new Date().toISOString(),
        });
      }, 10_000);
    }
  }

  // Init Jetstream federation consumer if configured (env-gated).
  // localPlcDids prevents re-broadcasting our own events back into the firehose.
  // Orchestrator mode: use cursor=0 on first connect (no saved cursor) to replay all stored
  // Jetstream events — this catches worker agent profiles even if workers started before us.
  // Worker/full mode: live tail only when no cursor (safe, no replay side-effects on restart).
  const jetstreamEndpoint = process.env.JETSTREAM_ENDPOINT;
  if (jetstreamEndpoint) {
    const savedCursor = await loadJetstreamCursor(jetstreamEndpoint);
    initJetstream(
      jetstreamEndpoint,
      firehose,
      localPlcDids,
      savedCursor ?? (isOrchestrator ? 0 : undefined),
      (timeUs) => saveJetstreamCursor(jetstreamEndpoint, timeUs),
    );
  }

  // Save new agent identities with plcDid already populated (single save, no race)
  for (const id of newAgentIdentities) {
    saveIdentity(id);
  }
  // Save existing agent identities if their plcDid changed (first PDS run, or PDS wiped/recreated)
  for (const { def, identity } of agents) {
    if (identity.plcDid && identity.plcDid !== savedIdentities?.get(def.handle)?.plcDid) {
      saveIdentity(identity);
    }
  }
  // Save Mayor identities — new on first run, updated if plcDid changed (only in orchestrator/full mode)
  if (!isWorker) {
    for (const { identity, saved } of [
      { identity: mayorIdentity, saved: savedMayorIdentity },
      { identity: mayorBetaIdentity, saved: savedMayorBetaIdentity },
    ]) {
      if (!identity) continue;
      if (!saved || (identity.plcDid && identity.plcDid !== saved.plcDid)) {
        saveIdentity(identity);
      }
    }
  }

  // mayorRepos: empty in worker mode (agents use it to skip startTask for cross-node tasks)
  const mayorRepos: Map<string, AgentRepository> = isWorker
    ? new Map()
    : new Map([
        ...(mayorIdentity && mayorRepo ? [[mayorIdentity.did, mayorRepo] as [string, AgentRepository]] : []),
        ...(mayorBetaIdentity && mayorBetaRepo ? [[mayorBetaIdentity.did, mayorBetaRepo] as [string, AgentRepository]] : []),
      ]);

  const runners = agents.map(({ def, identity, repo }) =>
    createAgentRunner(def, identity, repo, mayorRepos, firehose, intelligence, undefined, { forceAccept: true }),
  );
  runners.forEach((r) => r.start());

  const mayors: Mayor[] = [];
  if (mayorAlpha) mayors.push(mayorAlpha);
  if (mayorBeta) mayors.push(mayorBeta);

  return { firehose, mayors, agents, dbInstance, isOrchestrator, isWorker };
}

// ─── REST response builders ───────────────────────────────────────────────────

/**
 * Resolve a display handle for an agent DID, checking local agents first,
 * then the Mayor's agentRegistry (for remote/cross-node agents in orchestrator mode).
 */
function resolveAgentHandle(state: DemoState, did: string): string | undefined {
  const localAgent = state.agents.find((a) => a.identity.did === did || a.identity.plcDid === did);
  if (localAgent) return localAgent.def.handle.split('.')[0];
  // Check mayors' agentRegistries (populated by Jetstream profile events from remote nodes)
  for (const mayor of state.mayors) {
    const entry = mayor.agentRegistry.get(did);
    if (entry) return entry.handle?.split('.')[0] ?? did.slice(-8);
  }
  return undefined;
}

function buildAgentList(state: DemoState) {
  const local = state.agents.map(({ def, identity, repo }) => {
    let profile: AgentProfile | null = null;
    try {
      profile = getRecord(repo, 'network.mycelium.agent.profile', 'self').content as AgentProfile;
    } catch {
      // no-op
    }
    const caps = listRecords(repo, 'network.mycelium.agent.capability').map(
      (r) => r.content as AgentCapability,
    );
    const stamps = getStampsForAgent(state.firehose, identity.did);
    const reputation = stamps.length > 0 ? aggregateReputation(stamps) : null;
    return {
      did: identity.did,
      handle: def.handle.split('.')[0],
      displayName: def.displayName,
      description: def.description,
      model: def.primaryModelSlug,
      capabilities: caps.map((c) => ({ name: c.name, domain: c.domain, proficiency: c.proficiencyLevel })),
      reputation,
      isExternal: false,
    };
  });

  // In orchestrator mode, local agents is empty — build agent list from Mayor's agentRegistry
  // (populated by Jetstream profile events from remote worker nodes)
  if (state.isOrchestrator && local.length === 0) {
    const seen = new Set<string>();
    const external: typeof local = [];
    for (const mayor of state.mayors) {
      for (const [, entry] of mayor.agentRegistry) {
        if (seen.has(entry.did)) continue;
        seen.add(entry.did);
        const stamps = getStampsForAgent(state.firehose, entry.did);
        external.push({
          did: entry.did,
          handle: entry.handle?.split('.')[0] ?? entry.did.slice(-8),
          displayName: entry.handle ?? entry.did,
          description: '🌐 External agent (discovered via Jetstream)',
          model: 'unknown',
          capabilities: entry.capabilities.map((c) => ({ name: c.name, domain: c.domain, proficiency: c.proficiencyLevel })),
          reputation: stamps.length > 0 ? aggregateReputation(stamps) : null,
          isExternal: true,
        });
      }
    }
    return external;
  }

  return local;
}

function buildTaskList(state: DemoState) {
  const tasks: Array<{ id: string; uri: string; status: string; title: string; domain: string; complexity: string; priority: string; assignee?: string; mayorHandle?: string }> = [];

  for (const mayor of state.mayors) {
    const mayorHandle = mayor.identity.handle?.split('.')[0] ?? 'mayor';

    for (const [id, info] of mayor.postedTasks) {
      const def = mayor.template.tasks.find((t) => t.id === id);
      if (!def) continue;
      let taskStatus = info.status;
      let assigneeDid: string | undefined;
      try {
        const { collection, rkey } = parseAtUri(info.uri);
        const stored = getRecord(mayor.repo, collection, rkey).content as TaskPosting;
        taskStatus = stored.status;
        assigneeDid = stored.assigneeDid;
      } catch {
        // use info.status
      }

      tasks.push({
        id,
        uri: info.uri,
        status: taskStatus,
        title: def.title,
        domain: def.requiredCapabilities[0]?.domain ?? 'general',
        complexity: def.complexity,
        priority: def.priority,
        assignee: assigneeDid ? resolveAgentHandle(state, assigneeDid) : undefined,
        mayorHandle,
      });
    }

    // Un-posted tasks still gated by dependencies
    for (const def of mayor.template.tasks) {
      if (mayor.postedTasks.has(def.id)) continue;
      tasks.push({
        id: def.id,
        uri: '',
        status: 'pending',
        title: def.title,
        domain: def.requiredCapabilities[0]?.domain ?? 'general',
        complexity: def.complexity,
        priority: def.priority,
        mayorHandle,
      });
    }
  }

  return tasks.sort((a, b) => a.id.localeCompare(b.id));
}

function buildReputationList(state: DemoState): AggregatedReputation[] {
  // In orchestrator mode, local agents is empty — collect reputation from firehose stamps
  // which carry the remote (cross-node) agent DIDs as subjects.
  if (state.isOrchestrator) {
    const seenDids = new Set<string>();
    const results: AggregatedReputation[] = [];
    for (const event of state.firehose.log) {
      if (event.collection !== 'network.mycelium.reputation.stamp') continue;
      const stamp = event.record as ReputationStamp;
      if (!stamp.subjectDid || seenDids.has(stamp.subjectDid)) continue;
      seenDids.add(stamp.subjectDid);
      const stamps = getStampsForAgent(state.firehose, stamp.subjectDid);
      if (stamps.length > 0) results.push(aggregateReputation(stamps));
    }
    return results;
  }
  return state.agents.flatMap(({ identity }) => {
    const stamps = getStampsForAgent(state.firehose, identity.did);
    if (stamps.length === 0) return [];
    return [aggregateReputation(stamps)];
  });
}

function parseAtUri(uri: string): { collection: string; rkey: string } {
  const parts = uri.split('/');
  return { collection: parts[3] ?? '', rkey: parts[4] ?? '' };
}

/**
 * Translate a did:plc-based AT URI to its canonical did:key form using the
 * known Mayor identities. Cross-node events from Jetstream carry did:plc
 * while local postedTasks/rejectionLog use did:key — this bridges the gap
 * for dashboard display comparisons.
 */
function normalizeMayorUri(mayors: Mayor[], uri: string): string {
  for (const mayor of mayors) {
    const plcDid = mayor.identity.plcDid;
    if (plcDid && uri.startsWith(`at://${plcDid}/`)) {
      return `at://${mayor.identity.did}/${uri.slice(`at://${plcDid}/`.length)}`;
    }
  }
  return uri;
}

// ─── Detail builders ──────────────────────────────────────────────────────────

/** Return full detail for a single agent by short handle (e.g. "atlas"). */
function buildAgentDetail(state: DemoState, handle: string) {
  const agent = state.agents.find((a) => a.def.handle.split('.')[0] === handle);
  if (!agent) return null;

  const { def, identity, repo } = agent;

  let profile: AgentProfile | null = null;
  try { profile = getRecord(repo, 'network.mycelium.agent.profile', 'self').content as AgentProfile; } catch { /* no-op */ }

  let agentState: AgentState | null = null;
  try { agentState = getRecord(repo, 'network.mycelium.agent.state', 'self').content as AgentState; } catch { /* no-op */ }

  const caps = listRecords(repo, 'network.mycelium.agent.capability').map(
    (r) => r.content as AgentCapability,
  );

  const stamps = getStampsForAgent(state.firehose, identity.did);
  const reputation = stamps.length > 0 ? aggregateReputation(stamps) : null;

  // Task history: claims and completions authored by this agent
  const claims = state.firehose.log
    .filter((e) => e.collection === 'network.mycelium.task.claim' && e.did === identity.did)
    .map((e) => ({ uri: `at://${e.did}/${e.collection}/${e.rkey}`, seq: e.seq, timestamp: e.timestamp, ...((e.record as TaskClaim)) }));

  const completions = state.firehose.log
    .filter((e) => e.collection === 'network.mycelium.task.completion' && e.did === identity.did)
    .map((e) => {
      const comp = e.record as TaskCompletion;
      let taskId: string | undefined;
      let taskTitle: string | undefined;
      for (const mayor of state.mayors) {
        const taskDef = mayor.template.tasks.find((t) => {
          const info = mayor.postedTasks.get(t.id);
          return info && info.uri === normalizeMayorUri(state.mayors, comp.taskUri);
        });
        if (taskDef) { taskId = taskDef.id; taskTitle = taskDef.title; break; }
      }
      return { uri: `at://${e.did}/${e.collection}/${e.rkey}`, seq: e.seq, timestamp: e.timestamp, taskId, taskTitle, ...comp };
    });

  // Roster behavior stats (informational, not secret internals)
  const roster = AGENT_ROSTER.find((r) => r.handle === def.handle);

  return {
    did: identity.did,
    handle: def.handle.split('.')[0],
    displayName: def.displayName,
    description: def.description,
    model: def.primaryModelSlug,
    intelligenceUsedFor: def.intelligenceUsedFor,
    maxConcurrentTasks: def.maxConcurrentTasks,
    agentType: def.agentType,
    profile,
    state: agentState,
    capabilities: caps,
    behavior: roster ? {
      speedMultiplier: roster.behavior.speedMultiplier,
      acceptRate: roster.behavior.acceptRate,
    } : null,
    stamps,
    reputation,
    claims,
    completions,
  };
}

/** Return full detail for a single task by template ID (e.g. "task-003" or "gw-002"). */
function buildTaskDetail(state: DemoState, taskId: string) {
  // Find which Mayor owns this task (by template definition)
  let ownerMayor: Mayor | undefined;
  let taskDef: Mayor['template']['tasks'][0] | undefined;
  for (const mayor of state.mayors) {
    const found = mayor.template.tasks.find((t) => t.id === taskId);
    if (found) { ownerMayor = mayor; taskDef = found; break; }
  }
  if (!ownerMayor || !taskDef) return null;

  const info = ownerMayor.postedTasks.get(taskId);

  let posting: TaskPosting | null = null;
  let taskUri = info?.uri ?? '';
  if (info) {
    try {
      const { collection, rkey } = parseAtUri(info.uri);
      posting = getRecord(ownerMayor.repo, collection, rkey).content as TaskPosting;
    } catch { /* not yet posted */ }
  }

  // Status timeline from firehose
  const taskRkey = taskUri ? parseAtUri(taskUri).rkey : taskId;
  const timeline = state.firehose.log
    .filter((e) => e.collection === 'network.mycelium.task.posting' && e.rkey === taskRkey)
    .map((e) => ({
      seq: e.seq,
      operation: e.operation,
      status: (e.record as TaskPosting | null)?.status ?? null,
      assigneeDid: (e.record as TaskPosting | null)?.assigneeDid ?? null,
      timestamp: e.timestamp,
    }));

  // Competing claims
  const claims = taskUri
    ? state.firehose.log
        .filter((e) => e.collection === 'network.mycelium.task.claim' && normalizeMayorUri(state.mayors, (e.record as TaskClaim).taskUri) === taskUri)
        .map((e) => {
          const claim = e.record as TaskClaim;
          return {
            seq: e.seq,
            timestamp: e.timestamp,
            claimerHandle: resolveAgentHandle(state, claim.claimerDid) ?? claim.claimerDid,
            claimerDid: claim.claimerDid,
            proposal: claim.proposal,
            matchingCapabilities: claim.matchingCapabilities,
            status: claim.status,
          };
        })
    : [];

  // Completion
  const completionEvent = taskUri
    ? state.firehose.log.find(
        (e) => e.collection === 'network.mycelium.task.completion' && normalizeMayorUri(state.mayors, (e.record as TaskCompletion).taskUri) === taskUri,
      )
    : undefined;
  const completion = completionEvent ? (completionEvent.record as TaskCompletion) : null;

  // Reputation stamp for this task
  const stamp = taskUri
    ? (state.firehose.log
        .find((e) => e.collection === 'network.mycelium.reputation.stamp' && normalizeMayorUri(state.mayors, (e.record as ReputationStamp).taskUri) === taskUri)
        ?.record as ReputationStamp | undefined) ?? null
    : null;

  // Rejection history for this task
  const rejections = (taskUri ? ownerMayor.rejectionLog.get(taskUri) : undefined)?.map(
    (r) => ({
      agentDid: r.agentDid,
      agentHandle: resolveAgentHandle(state, r.agentDid) ?? null,
      reason: r.reason,
    }),
  ) ?? [];

  // Dependency info (from the owning Mayor's template)
  const deps = taskDef.dependsOn.map((depId) => {
    const depInfo = ownerMayor!.postedTasks.get(depId);
    const depDef = ownerMayor!.template.tasks.find((t) => t.id === depId);
    return { id: depId, title: depDef?.title ?? depId, status: depInfo?.status ?? 'pending' };
  });

  // What depends on this task (within same Mayor's template)
  const dependents = ownerMayor.template.tasks
    .filter((t) => t.dependsOn.includes(taskId))
    .map((t) => ({ id: t.id, title: t.title }));

  // Assignee agent info
  const assigneeDid = posting?.assigneeDid;
  const assigneeHandle = assigneeDid ? resolveAgentHandle(state, assigneeDid) : undefined;
  const assigneeAgent = assigneeDid
    ? state.agents.find((a) => a.identity.did === assigneeDid)
    : undefined;

  return {
    id: taskId,
    uri: taskUri,
    title: taskDef.title,
    description: taskDef.description,
    requiredCapabilities: taskDef.requiredCapabilities,
    complexity: taskDef.complexity,
    priority: taskDef.priority,
    status: posting?.status ?? info?.status ?? 'pending',
    mayorHandle: ownerMayor.identity.handle.split('.')[0],
    assignee: assigneeDid ? {
      handle: assigneeHandle ?? assigneeDid.slice(-8),
      did: assigneeDid,
      model: assigneeAgent?.def.primaryModelSlug ?? 'unknown',
    } : null,
    posting,
    timeline,
    deps,
    dependents,
    claims,
    completion,
    stamp,
    rejections,
  };
}

/** Return full detail for a single firehose event by seq number. */
function buildEventDetail(state: DemoState, seq: number) {
  const event = state.firehose.log.find((e) => e.seq === seq);
  if (!event) return null;

  const mayorEntry = state.mayors.find((m) => m.identity.did === event.did);
  const handle = resolveAgentHandle(state, event.did)
    ?? (mayorEntry ? mayorEntry.identity.handle.split('.')[0] : null);
  const agent = state.agents.find((a) => a.identity.did === event.did);

  return {
    ...event,
    authorHandle: handle,
    authorDisplayName: agent ? agent.def.displayName : mayorEntry ? mayorEntry.identity.displayName : null,
  };
}

/** Return all individual stamps + aggregation for an agent by handle. */
function buildReputationDetail(state: DemoState, handle: string) {
  const agent = state.agents.find((a) => a.def.handle.split('.')[0] === handle);
  if (!agent) return null;

  const stamps = getStampsForAgent(state.firehose, agent.identity.did);
  const reputation = stamps.length > 0 ? aggregateReputation(stamps) : null;

  const stampsWithContext = stamps.map((stamp) => {
    let taskId: string | null = null;
    let taskTitle: string | null = null;
    for (const mayor of state.mayors) {
      const taskDef = mayor.template.tasks.find((t) => {
        const info = mayor.postedTasks.get(t.id);
        return info && info.uri === normalizeMayorUri(state.mayors, stamp.taskUri);
      });
      if (taskDef) { taskId = taskDef.id; taskTitle = taskDef.title; break; }
    }
    return { ...stamp, taskId, taskTitle };
  });

  return {
    did: agent.identity.did,
    handle,
    displayName: agent.def.displayName,
    model: agent.def.primaryModelSlug,
    reputation,
    stamps: stampsWithContext,
  };
}

// ─── Server ───────────────────────────────────────────────────────────────────

async function startServer(state: DemoState, port: number): Promise<void> {
  const fastify = Fastify({ logger: false });

  // ── Static files ──────────────────────────────────────────────────────────

  fastify.get('/', async (_req, reply) => {
    const html = await readFile(join(PUBLIC_DIR, 'index.html'), 'utf-8');
    return reply.type('text/html').send(html);
  });

  fastify.get('/app.js', async (_req, reply) => {
    const js = await readFile(join(PUBLIC_DIR, 'app.js'), 'utf-8');
    return reply.type('application/javascript').send(js);
  });

  fastify.get('/style.css', async (_req, reply) => {
    const css = await readFile(join(PUBLIC_DIR, 'style.css'), 'utf-8');
    return reply.type('text/css').send(css);
  });

  // ── REST API (list) ───────────────────────────────────────────────────────

  fastify.get('/api/agents', async () => buildAgentList(state));

  fastify.get('/api/tasks', async () => buildTaskList(state));

  fastify.get('/api/firehose', async () => ({
    events: state.firehose.log.slice(-200), // Last 200 events
    total: state.firehose.log.length,
  }));

  fastify.get('/api/reputation', async () => buildReputationList(state));

  fastify.get('/api/status', async () => {
    // Agent count: local agents for worker/full mode; agentRegistry size for orchestrator
    const agentCount = state.isOrchestrator
      ? (() => {
          const seen = new Set<string>();
          for (const mayor of state.mayors) {
            for (const [did] of mayor.agentRegistry) seen.add(did);
          }
          return seen.size;
        })()
      : state.agents.length;

    return {
      mode: state.isOrchestrator ? 'orchestrator' : state.isWorker ? 'worker' : 'full',
      tasksPosted: state.mayors.reduce((sum, m) => sum + m.postedTasks.size, 0),
      tasksTotal: state.mayors.reduce((sum, m) => sum + m.template.tasks.length, 0),
      tasksAccepted: state.mayors.reduce((sum, m) => sum + [...m.postedTasks.values()].filter((t) => t.status === 'accepted').length, 0),
      firehoseEvents: state.firehose.log.length,
      agents: agentCount,
    };
  });

  // ── REST API (detail) ─────────────────────────────────────────────────────

  fastify.get<{ Params: { handle: string } }>('/api/agents/:handle', async (req, reply) => {
    const detail = buildAgentDetail(state, req.params.handle);
    if (!detail) return reply.status(404).send({ error: 'Agent not found' });
    return detail;
  });

  fastify.get<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const detail = buildTaskDetail(state, req.params.id);
    if (!detail) return reply.status(404).send({ error: 'Task not found' });
    return detail;
  });

  fastify.get<{ Params: { seq: string } }>('/api/firehose/:seq', async (req, reply) => {
    const seq = parseInt(req.params.seq, 10);
    if (isNaN(seq)) return reply.status(400).send({ error: 'Invalid seq' });
    const detail = buildEventDetail(state, seq);
    if (!detail) return reply.status(404).send({ error: 'Event not found' });
    return detail;
  });

  fastify.get<{ Params: { handle: string } }>('/api/reputation/:handle', async (req, reply) => {
    const detail = buildReputationDetail(state, req.params.handle);
    if (!detail) return reply.status(404).send({ error: 'Agent not found' });
    return detail;
  });

  // ── Export endpoints ──────────────────────────────────────────────────────

  fastify.get('/api/export/firehose.parquet', async (_req, reply) => {
    const conn = getConn();
    if (!conn) return reply.status(503).send({ error: 'Persistence not initialized' });

    const tmpPath = join(tmpdir(), `mycelium-firehose-${Date.now()}.parquet`).replace(/\\/g, '/');
    try {
      await execute(conn, `COPY (SELECT * FROM firehose_events ORDER BY seq) TO '${tmpPath}' (FORMAT PARQUET)`);
      const data = await readFile(tmpPath);
      return reply
        .type('application/octet-stream')
        .header('Content-Disposition', 'attachment; filename="firehose.parquet"')
        .send(data);
    } catch (err) {
      return reply.status(500).send({ error: String(err) });
    }
  });

  fastify.get('/api/db/stats', async (_req, reply) => {
    const conn = getConn();
    if (!conn) return reply.status(503).send({ error: 'Persistence not initialized' });

    const [records, commits, events] = await Promise.all([
      queryAll<{ cnt: number }>(conn, 'SELECT COUNT(*) AS cnt FROM records'),
      queryAll<{ cnt: number }>(conn, 'SELECT COUNT(*) AS cnt FROM commits'),
      queryAll<{ cnt: number }>(conn, 'SELECT COUNT(*) AS cnt FROM firehose_events'),
    ]);

    return {
      records: records[0]?.cnt ?? 0,
      commits: commits[0]?.cnt ?? 0,
      firehoseEvents: events[0]?.cnt ?? 0,
    };
  });

  // ── Inspection endpoints ──────────────────────────────────────────────────

  /** Read-only SQL explorer — only SELECT and WITH (CTEs) allowed. */
  fastify.get<{ Querystring: { q: string } }>('/api/sql', async (req, reply) => {
    const conn = getConn();
    if (!conn) return reply.status(503).send({ error: 'Persistence not initialized' });

    const sql = (req.query.q ?? '').trim();
    if (!sql) return reply.status(400).send({ error: 'Query parameter ?q= is required' });

    // Only allow read statements — must start with SELECT or WITH (for CTEs)
    if (!/^(SELECT|WITH)\b/i.test(sql)) {
      return reply.status(400).send({ error: 'Only SELECT statements are allowed' });
    }

    try {
      const rows = await queryAll(conn, sql);
      return { rows, count: rows.length };
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** AT URI resolver — look up a record by at://did/collection/rkey URI. */
  fastify.get<{ Querystring: { uri: string } }>('/api/record', async (req, reply) => {
    const uri = (req.query.uri ?? '').trim();
    if (!uri) return reply.status(400).send({ error: 'Query parameter ?uri= is required' });
    if (!uri.startsWith('at://')) return reply.status(400).send({ error: 'URI must start with at://' });

    const conn = getConn();
    if (!conn) return reply.status(503).send({ error: 'Persistence not initialized' });

    const row = await queryOne<{
      uri: string; repo_did: string; collection: string; rkey: string;
      content: string; sig: string; created_at: string; updated_at: string;
    }>(conn, 'SELECT * FROM records WHERE uri = $1', [uri]);

    if (!row) return reply.status(404).send({ error: `No record found for URI: ${uri}` });

    let content: unknown = row.content;
    try { content = JSON.parse(row.content); } catch { /* return raw string */ }
    return { ...row, content };
  });

  // ── Lexicon endpoints ─────────────────────────────────────────────────────

  // List all network.mycelium.* Lexicons
  fastify.get('/lexicon', async (_req, reply) => {
    const list = getLexicons().map(l => ({ id: l.id, description: l.description }));
    reply.header('Access-Control-Allow-Origin', '*').send(list);
  });

  // Serve a specific Lexicon by NSID (dots are valid in Fastify params)
  fastify.get<{ Params: { nsid: string } }>('/lexicon/:nsid', async (req, reply) => {
    const lex = getLexicon(req.params.nsid);
    if (!lex) return reply.status(404).send({ error: 'Lexicon not found', nsid: req.params.nsid });
    reply
      .header('Content-Type', 'application/json')
      .header('Access-Control-Allow-Origin', '*')
      .send(lex);
  });

  // AT Proto standard Lexicon resolution path
  fastify.get<{ Params: { nsid: string } }>('/.well-known/atproto-lexicon/:nsid', async (req, reply) => {
    const lex = getLexicon(req.params.nsid);
    if (!lex) return reply.status(404).send({ error: 'Lexicon not found', nsid: req.params.nsid });
    reply
      .header('Content-Type', 'application/json')
      .header('Access-Control-Allow-Origin', '*')
      .send(lex);
  });

  // ── SSE endpoint ──────────────────────────────────────────────────────────

  fastify.get('/api/events', (req, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    reply.raw.flushHeaders();

    // Replay recent events so the client catches up
    const recentEvents = state.firehose.log.slice(-50);
    for (const event of recentEvents) {
      reply.raw.write(`event: ${CONSTANTS.DASHBOARD_SSE_EVENT_NAME}\ndata: ${JSON.stringify(event)}\n\n`);
    }

    // Subscribe for new events
    const subId = subscribe(state.firehose, undefined, (event: FirehoseEvent) => {
      if (!reply.raw.writableEnded) {
        reply.raw.write(
          `event: ${CONSTANTS.DASHBOARD_SSE_EVENT_NAME}\ndata: ${JSON.stringify(event)}\n\n`,
        );
      }
    });

    // Send heartbeat every 15 seconds to keep connection alive
    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) {
        reply.raw.write(': heartbeat\n\n');
      } else {
        clearInterval(heartbeat);
      }
    }, 15_000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      try { unsubscribe(state.firehose, subId); } catch { /* already cleaned up */ }
    });

    // Return a never-resolving promise to keep connection open
    return new Promise(() => {});
  });

  await fastify.listen({ port, host: '0.0.0.0' });
  console.log(`\n🌐 Dashboard: http://localhost:${port}`);
  console.log(`   API: http://localhost:${port}/api/agents`);
  console.log(`   SSE: http://localhost:${port}/api/events`);
  console.log(`   SQL: http://localhost:${port}/api/sql?q=SELECT+*+FROM+agent_identities`);
  console.log(`   Record: http://localhost:${port}/api/record?uri=at://...`);
  console.log(`   Lexicons: http://localhost:${port}/lexicon`);
  console.log(`   Export: http://localhost:${port}/api/export/firehose.parquet`);
  console.log(`   DB Stats: http://localhost:${port}/api/db/stats`);
  if (isPdsBridgeEnabled()) {
    console.log(`   PDS bridge: ✅ ${process.env.PDS_ENDPOINT} (records mirrored via XRPC)`);
  } else {
    console.log(`   PDS bridge: ⏸  disabled (set PDS_ENDPOINT + PDS_ADMIN_PASSWORD to enable)`);
  }
  console.log();
}

// ─── Entry point ──────────────────────────────────────────────────────────────

console.log('🍄 Mycelium MVP — Dashboard Server');
const modeLabel = isOrchestrator ? ' [orchestrator — dispatch center]'
  : isWorker ? ' [worker — agent guild]'
  : ' [full node]';
console.log(`   Mode: ${modeLabel}`);
console.log('   Bootstrapping demo state...');

const state = await bootstrapDemo();

// Graceful shutdown: close DuckDB so in-flight async writes can flush
function shutdown(): void {
  console.log('\n[dashboard] Shutting down...');
  shutdownPersistence();
  state.dbInstance.closeSync();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await startServer(state, CONSTANTS.DASHBOARD_PORT);

// Kick off projects only if we have mayors (orchestrator or full-node mode).
// In orchestrator mode, delay 8s to let cursor=0 Jetstream replay settle so
// agent profiles are registered before the first claim auction.
if (state.mayors.length > 0) {
  const projectDelay = state.isOrchestrator ? 8_000 : 0;
  setTimeout(() => {
    const [mayorAlpha, mayorBeta] = state.mayors;
    console.log('🎯 Starting project: "Build the Mycelium Dashboard" (Mayor Alpha)');
    console.log('   Watch the real-time stream at http://localhost:3000\n');
    startProject(mayorAlpha, 'Build the Mycelium Dashboard');
    setTimeout(() => {
      console.log('🎯 Starting project: "Build the AI Coordination Protocol" (Mayor Beta)');
      startProject(mayorBeta, 'Build the AI Coordination Protocol');
    }, 5000);
  }, projectDelay);
  if (state.isOrchestrator && projectDelay > 0) {
    console.log(`⏳ Waiting ${projectDelay / 1000}s for Jetstream replay before starting projects...`);
  }
} else {
  console.log('ℹ️  Worker mode: no mayors to start projects — listening for tasks via Jetstream');
}
