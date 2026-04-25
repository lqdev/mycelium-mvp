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
import { createMayor, DASHBOARD_TEMPLATE } from '../../orchestrator/mayor.js';
import { generateIdentity } from '../../identity/index.js';
import { createMemoryRepository, listRecords, getRecord } from '../../repository/index.js';
import { getStampsForAgent, aggregateReputation } from '../../reputation/index.js';
import { createDuckDB, queryAll, queryOne, execute } from '../../storage/duckdb.js';
import { initPersistence, loadFirehoseLog, loadIdentities, saveIdentity, getConn, shutdownPersistence, registerAgentMapping } from '../../storage/persistence.js';
import { getLexicons, getLexicon } from '../../lexicon/index.js';
import { initPdsBridge, isPdsBridgeEnabled } from '../../atproto/pds-bridge.js';
import { initJetstream } from '../../atproto/jetstream.js';
import { bootstrapKnowledgeProviders, type BootstrappedKnowledgeProvider } from '../../knowledge/index.js';
import { bootstrapToolProviders, type BootstrappedToolProvider } from '../../tools/index.js';
import { postTask, writeReview } from '../../orchestrator/wanted-board.js';
import { buildWorkTrace } from '../../audit/work-trace.js';
import type {
  AgentCapability,
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

interface NetworkParticipant {
  type: 'user' | 'agent' | 'mayor' | 'tool' | 'knowledge';
  did: string;
  handle: string;
  displayName: string;
  // agent
  model?: string;
  description?: string;
  capabilities?: Array<{ name: string; domain: string; proficiency: string }>;
  reputation?: AggregatedReputation | null;
  // user
  taskPostingCount?: number;
  taskReviewCount?: number;
  // mayor
  tasksManaged?: number;
  tasksAccepted?: number;
  // tool / knowledge
  itemCount?: number;
}

interface DemoState {
  firehose: Firehose;
  mayor: Mayor;
  mayorRepo: AgentRepository;
  mayorDid: string;
  customerRepo: AgentRepository;
  customerDid: string;
  agents: BootstrappedAgent[];
  kbProviders: BootstrappedKnowledgeProvider[];
  toolProviders: BootstrappedToolProvider[];
  participants: NetworkParticipant[];
  dbInstance: Awaited<ReturnType<typeof createDuckDB>>['instance'];
}

async function bootstrapDemo(): Promise<DemoState> {
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

  const mayorIdentity = generateIdentity('mayor.mycelium.local', 'Mayor (Orchestrator)');
  const mayorRepo = createMemoryRepository(mayorIdentity, firehose);
  const mayor = createMayor(mayorIdentity, mayorRepo, firehose, DASHBOARD_TEMPLATE);

  const customerIdentity = generateIdentity('customer.mycelium.local', 'Customer (Task Requester)');
  const customerRepo = createMemoryRepository(customerIdentity, firehose);

  const { agents, newIdentities: newAgentIdentities } = bootstrapAgents(firehose, intelligence, savedIdentities);

  // Save non-agent new identities (mayor, intelligence) — no PDS accounts, safe to save now
  for (const id of intelligence.newIdentities) {
    saveIdentity(id);
  }

  // Register did→handle mappings so the PDS bridge can route mirror calls
  for (const { def, identity } of agents) {
    registerAgentMapping(identity.did, def.handle);
  }

  // Init PDS bridge if configured (env-gated; no-op when PDS_ENDPOINT is not set).
  // Bridge init happens BEFORE saving agent identities so plcDid is set on first save (no double-save race).
  const pdsEndpoint = process.env.PDS_ENDPOINT;
  const pdsAdminPassword = process.env.PDS_ADMIN_PASSWORD;
  let localPlcDids = new Set<string>();
  if (pdsEndpoint && pdsAdminPassword) {
    const plcDids = await initPdsBridge(
      agents.map(({ def }) => ({ handle: def.handle })),
      pdsEndpoint,
      pdsAdminPassword,
      process.env.PDS_HOSTNAME ?? 'test',
    );
    // Apply PDS-assigned did:plc to each agent identity (bridge is authoritative)
    for (const { def, identity } of agents) {
      const plcDid = plcDids.get(def.handle);
      if (plcDid && plcDid !== identity.plcDid) {
        identity.plcDid = plcDid;
      }
    }
    localPlcDids = new Set(plcDids.values());
  }

  // Init Jetstream federation consumer if configured (env-gated).
  // localPlcDids prevents re-broadcasting our own events back into the firehose.
  const jetstreamEndpoint = process.env.JETSTREAM_ENDPOINT;
  if (jetstreamEndpoint) {
    initJetstream(jetstreamEndpoint, firehose, localPlcDids);
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

  // Bootstrap knowledge and tool providers
  const { providers: kbProviders } = bootstrapKnowledgeProviders(firehose, savedIdentities);
  const { providers: toolProviders } = bootstrapToolProviders(firehose, savedIdentities);

  const runners = agents.map(({ def, identity, repo }) =>
    createAgentRunner(def, identity, repo, mayorRepo, firehose, intelligence, undefined, {
      forceAccept: true,
      kbProviders,
      toolProviders,
    }),
  );
  runners.forEach((r) => r.start());

  const participants: NetworkParticipant[] = [
    {
      type: 'user',
      did: customerIdentity.did,
      handle: 'customer',
      displayName: 'Customer (Task Requester)',
    },
    {
      type: 'mayor',
      did: mayorIdentity.did,
      handle: 'mayor',
      displayName: 'Mayor (Orchestrator)',
    },
    ...agents.map(({ def, identity }) => ({
      type: 'agent' as const,
      did: identity.did,
      handle: def.handle.split('.')[0],
      displayName: def.displayName,
      model: def.primaryModelSlug,
      description: def.description,
    })),
    ...toolProviders.map((tp) => ({
      type: 'tool' as const,
      did: tp.identity.did,
      handle: tp.provider.name.toLowerCase().replace(/\s+/g, '-'),
      displayName: tp.provider.name,
    })),
    ...kbProviders.map((kb) => ({
      type: 'knowledge' as const,
      did: kb.identity.did,
      handle: kb.provider.name.toLowerCase().replace(/\s+/g, '-'),
      displayName: kb.provider.name,
    })),
  ];

  return { firehose, mayor, mayorRepo, mayorDid: mayorIdentity.did, customerRepo, customerDid: customerIdentity.did, agents, kbProviders, toolProviders, participants, dbInstance };
}

// ─── REST response builders ───────────────────────────────────────────────────

function buildAgentList(state: DemoState) {
  return state.agents.map(({ def, identity, repo }) => {
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
    };
  });
}

function buildTaskList(state: DemoState) {
  const tasks: Array<{ id: string; uri: string; status: string; title: string; domain: string; complexity: string; priority: string; assignee?: string }> = [];

  for (const [id, info] of state.mayor.postedTasks) {
    const def = DASHBOARD_TEMPLATE.tasks.find((t) => t.id === id);
    if (!def) continue;
    let taskStatus = info.status;
    let assigneeDid: string | undefined;
    try {
      const { collection, rkey } = parseAtUri(info.uri);
      const stored = getRecord(state.mayorRepo, collection, rkey).content as TaskPosting;
      taskStatus = stored.status;
      assigneeDid = stored.assigneeDid;
    } catch {
      // use info.status
    }
    const agentEntry = assigneeDid
      ? state.agents.find((a) => a.identity.did === assigneeDid)
      : undefined;

    tasks.push({
      id,
      uri: info.uri,
      status: taskStatus,
      title: def.title,
      domain: def.requiredCapabilities[0]?.domain ?? 'general',
      complexity: def.complexity,
      priority: def.priority,
      assignee: agentEntry?.def.handle.split('.')[0],
    });
  }

  // Add un-posted tasks (still gated by dependencies)
  for (const def of DASHBOARD_TEMPLATE.tasks) {
    if (state.mayor.postedTasks.has(def.id)) continue;
    tasks.push({
      id: def.id,
      uri: '',
      status: 'pending',
      title: def.title,
      domain: def.requiredCapabilities[0]?.domain ?? 'general',
      complexity: def.complexity,
      priority: def.priority,
    });
  }

  return tasks.sort((a, b) => a.id.localeCompare(b.id));
}

function buildReputationList(state: DemoState): AggregatedReputation[] {
  return state.agents.flatMap(({ identity }) => {
    const stamps = getStampsForAgent(state.firehose, identity.did);
    if (stamps.length === 0) return [];
    return [aggregateReputation(stamps)];
  });
}

function buildParticipantList(state: DemoState): NetworkParticipant[] {
  return state.participants.map((p) => {
    if (p.type === 'agent') {
      const agent = state.agents.find((a) => a.identity.did === p.did);
      if (!agent) return p;
      const caps = listRecords(agent.repo, 'network.mycelium.agent.capability').map(
        (r) => r.content as AgentCapability,
      );
      const stamps = getStampsForAgent(state.firehose, p.did);
      const reputation = stamps.length > 0 ? aggregateReputation(stamps) : null;
      return {
        ...p,
        capabilities: caps.map((c) => ({ name: c.name, domain: c.domain, proficiency: c.proficiencyLevel })),
        reputation,
      };
    }

    if (p.type === 'user') {
      const taskPostingCount = state.firehose.log.filter(
        (e) => e.did === p.did && e.collection === 'network.mycelium.task.posting',
      ).length;
      const taskReviewCount = state.firehose.log.filter(
        (e) => e.did === p.did && e.collection === 'network.mycelium.task.review',
      ).length;
      return { ...p, taskPostingCount, taskReviewCount };
    }

    if (p.type === 'mayor') {
      const tasksManaged = state.mayor.postedTasks.size;
      const tasksAccepted = [...state.mayor.postedTasks.values()].filter((t) => t.status === 'accepted').length;
      return { ...p, tasksManaged, tasksAccepted };
    }

    if (p.type === 'tool') {
      const tp = state.toolProviders.find((t) => t.identity.did === p.did);
      return { ...p, itemCount: tp?.definitions.length ?? 0 };
    }

    if (p.type === 'knowledge') {
      const kb = state.kbProviders.find((k) => k.identity.did === p.did);
      return { ...p, itemCount: kb?.documentUris.size ?? 0 };
    }

    return p;
  });
}

function parseAtUri(uri: string): { collection: string; rkey: string } {
  const parts = uri.split('/');
  return { collection: parts[3] ?? '', rkey: parts[4] ?? '' };
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
      const taskDef = DASHBOARD_TEMPLATE.tasks.find((t) => {
        const info = state.mayor.postedTasks.get(t.id);
        return info && info.uri === comp.taskUri;
      });
      return { uri: `at://${e.did}/${e.collection}/${e.rkey}`, seq: e.seq, timestamp: e.timestamp, taskId: taskDef?.id, taskTitle: taskDef?.title, ...comp };
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

/** Return full detail for a single task by template ID (e.g. "task-003"). */
function buildTaskDetail(state: DemoState, taskId: string) {
  const taskDef = DASHBOARD_TEMPLATE.tasks.find((t) => t.id === taskId);
  if (!taskDef) return null;

  const info = state.mayor.postedTasks.get(taskId);

  let posting: TaskPosting | null = null;
  let taskUri = info?.uri ?? '';
  if (info) {
    try {
      const { collection, rkey } = parseAtUri(info.uri);
      posting = getRecord(state.mayorRepo, collection, rkey).content as TaskPosting;
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
        .filter((e) => e.collection === 'network.mycelium.task.claim' && (e.record as TaskClaim).taskUri === taskUri)
        .map((e) => {
          const claim = e.record as TaskClaim;
          const agent = state.agents.find((a) => a.identity.did === e.did);
          return {
            seq: e.seq,
            timestamp: e.timestamp,
            claimerHandle: agent?.def.handle.split('.')[0] ?? claim.claimerDid,
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
        (e) => e.collection === 'network.mycelium.task.completion' && (e.record as TaskCompletion).taskUri === taskUri,
      )
    : undefined;
  const completion = completionEvent ? (completionEvent.record as TaskCompletion) : null;

  // Reputation stamps for this task (all attestors)
  const stamps = taskUri
    ? state.firehose.log
        .filter((e) => e.collection === 'network.mycelium.reputation.stamp' && (e.record as ReputationStamp).taskUri === taskUri)
        .map((e) => e.record as ReputationStamp)
    : [];

  // Rejection history for this task
  const rejections = (taskUri ? state.mayor.rejectionLog.get(taskUri) : undefined)?.map(
    (r) => ({
      agentDid: r.agentDid,
      agentHandle:
        state.agents.find((a) => a.identity.did === r.agentDid)?.def.handle.split('.')[0] ?? null,
      reason: r.reason,
    }),
  ) ?? [];

  // Dependency info
  const deps = taskDef.dependsOn.map((depId) => {
    const depInfo = state.mayor.postedTasks.get(depId);
    const depDef = DASHBOARD_TEMPLATE.tasks.find((t) => t.id === depId);
    return { id: depId, title: depDef?.title ?? depId, status: depInfo?.status ?? 'pending' };
  });

  // What depends on this task
  const dependents = DASHBOARD_TEMPLATE.tasks
    .filter((t) => t.dependsOn.includes(taskId))
    .map((t) => ({ id: t.id, title: t.title }));

  // Assignee agent info
  const assigneeAgent = posting?.assigneeDid
    ? state.agents.find((a) => a.identity.did === posting!.assigneeDid)
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
    assignee: assigneeAgent ? {
      handle: assigneeAgent.def.handle.split('.')[0],
      did: assigneeAgent.identity.did,
      model: assigneeAgent.def.primaryModelSlug,
    } : null,
    posting,
    timeline,
    deps,
    dependents,
    claims,
    completion,
    stamps,
    stamp: stamps[0] ?? null,
    rejections,
  };
}

/** Return full detail for a single firehose event by seq number. */
function buildEventDetail(state: DemoState, seq: number) {
  const event = state.firehose.log.find((e) => e.seq === seq);
  if (!event) return null;

  const agent = state.agents.find((a) => a.identity.did === event.did);
  const isMayor = event.did === state.mayor.identity.did;

  return {
    ...event,
    authorHandle: agent ? agent.def.handle.split('.')[0] : isMayor ? 'mayor' : null,
    authorDisplayName: agent ? agent.def.displayName : isMayor ? 'Mayor (Orchestrator)' : null,
  };
}

/** Return all individual stamps + aggregation for an agent by handle. */
function buildReputationDetail(state: DemoState, handle: string) {
  const agent = state.agents.find((a) => a.def.handle.split('.')[0] === handle);
  if (!agent) return null;

  const stamps = getStampsForAgent(state.firehose, agent.identity.did);
  const reputation = stamps.length > 0 ? aggregateReputation(stamps) : null;

  const stampsWithContext = stamps.map((stamp) => {
    const taskDef = DASHBOARD_TEMPLATE.tasks.find((t) => {
      const info = state.mayor.postedTasks.get(t.id);
      return info && info.uri === stamp.taskUri;
    });
    return { ...stamp, taskId: taskDef?.id ?? null, taskTitle: taskDef?.title ?? null };
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

  fastify.get('/api/participants', async () => buildParticipantList(state));

  fastify.get('/api/tasks', async () => buildTaskList(state));

  fastify.get('/api/firehose', async () => ({
    events: state.firehose.log.slice(-200), // Last 200 events
    total: state.firehose.log.length,
  }));

  fastify.get('/api/reputation', async () => buildReputationList(state));

  fastify.get('/api/status', async () => ({
    tasksPosted: state.mayor.postedTasks.size,
    tasksTotal: DASHBOARD_TEMPLATE.tasks.length,
    tasksAccepted: [...state.mayor.postedTasks.values()].filter((t) => t.status === 'accepted').length,
    firehoseEvents: state.firehose.log.length,
    agents: state.agents.length,
    participants: state.participants.length,
    customerDid: state.customerDid,
    mayorDid: state.mayorDid,
    knowledgeProviders: state.kbProviders.map((kb) => ({
      did: kb.identity.did,
      name: kb.provider.name,
      documentCount: kb.documentUris.size,
    })),
    toolProviders: state.toolProviders.map((tp) => ({
      did: tp.identity.did,
      name: tp.provider.name,
      toolCount: tp.definitions.length,
    })),
  }));

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

  fastify.get<{ Params: { id: string } }>('/api/tasks/:id/trace', async (req, reply) => {
    const taskId = req.params.id;
    const taskDef = DASHBOARD_TEMPLATE.tasks.find((t) => t.id === taskId);
    if (!taskDef) return reply.status(404).send({ error: 'Task not found' });
    const info = state.mayor.postedTasks.get(taskId);
    if (!info) return reply.status(404).send({ error: 'Task not yet posted', taskId });
    return buildWorkTrace(state.firehose, info.uri, taskId, taskDef.title, state.mayorDid);
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

// Kick off the demo project after server is ready
console.log('🎯 Starting project: "Build the Mycelium Dashboard"');
console.log('   Watch the real-time stream at http://localhost:3000\n');
// Kick off the demo project after server is ready — customer posts the project-level task
console.log('🎯 Starting project: "Build the Mycelium Dashboard"');
console.log('   Watch the real-time stream at http://localhost:3000\n');

const { uri: customerTaskUri } = postTask(state.customerRepo, {
  title: DASHBOARD_TEMPLATE.projectPattern,
  description: 'Build the Mycelium Dashboard — a full-stack federated agent orchestration UI.',
  requiredCapabilities: [{ domain: 'project-management', tags: [], minProficiency: 'expert' }],
  complexity: 'high',
  priority: 'high',
  requesterDid: state.customerDid,
  context: { projectName: DASHBOARD_TEMPLATE.projectPattern, projectDescription: 'Top-level customer request.' },
  deliverables: [],
});

// After all subtasks complete, customer writes a formal review
let reviewWritten = false;
const reviewInterval = setInterval(() => {
  const total = DASHBOARD_TEMPLATE.tasks.length;
  const accepted = [...state.mayor.postedTasks.values()].filter((t) => t.status === 'accepted').length;
  if (accepted >= total && !reviewWritten) {
    reviewWritten = true;
    clearInterval(reviewInterval);
    writeReview(state.customerRepo, {
      taskUri: customerTaskUri,
      reviewerDid: state.customerDid,
      outcome: 'accepted',
      score: 85,
      comment: `All ${total} subtasks delivered.`,
    });
  }
}, 1000);
