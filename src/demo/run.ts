// Mycelium MVP — E2E Demo Runner
// Full bootstrap sequence + agent simulation + colored CLI output + summary table.

import chalk from 'chalk';
import Table from 'cli-table3';
import { createFirehose, subscribe } from '../firehose/index.js';
import { bootstrapIntelligence } from '../intelligence/index.js';
import { bootstrapAgents, createAgentRunner } from '../agents/engine.js';
import { createMayor, DASHBOARD_TEMPLATE, startProject } from '../orchestrator/mayor.js';
import { generateIdentity } from '../identity/index.js';
import { createMemoryRepository, listRecords, getRecord } from '../repository/index.js';
import { getStampsForAgent, aggregateReputation } from '../reputation/index.js';
import type { AgentProfile, AgentCapability, AggregatedReputation, Mayor } from '../schemas/types.js';
import { CONSTANTS } from '../constants.js';
import type { BootstrappedAgent } from '../agents/engine.js';

const isDryRun = process.argv.includes('--dry-run');
if (isDryRun) {
  console.log('✅ Mycelium MVP build check passed');
  process.exit(0);
}

// ─── Display helpers ──────────────────────────────────────────────────────────

const SEP = chalk.gray('═'.repeat(62));
const section = (title: string) => `\n${SEP}\n  ${chalk.bold(title)}\n${SEP}\n`;

function shortDid(did: string): string {
  return did.slice(0, 18) + '…' + did.slice(-4);
}

function stars(score: number): string {
  const filled = Math.round(score / 20);
  return chalk.yellow('★'.repeat(Math.min(5, filled))) + chalk.gray('☆'.repeat(Math.max(0, 5 - filled)));
}

function trustBadge(level: string): string {
  switch (level) {
    case 'expert':      return chalk.yellow('⭐ expert');
    case 'trusted':     return chalk.green('✅ trusted');
    case 'established': return chalk.blue('🔵 established');
    default:            return chalk.gray('⬜ newcomer');
  }
}

function trendArrow(trend: string): string {
  if (trend === 'improving') return chalk.green('↑');
  if (trend === 'declining') return chalk.red('↓');
  return chalk.gray('→');
}

function statusBadge(status: string): string {
  switch (status) {
    case 'open':        return chalk.blue('open');
    case 'claimed':     return chalk.cyan('claimed');
    case 'assigned':    return chalk.yellow('assigned');
    case 'in_progress': return chalk.yellow('in progress');
    case 'completed':   return chalk.green('completed');
    case 'accepted':    return chalk.green('accepted ✓');
    case 'closed':      return chalk.gray('closed');
    default:            return chalk.gray(status);
  }
}

function complexityColor(c: string): string {
  if (c === 'high')   return chalk.red(c);
  if (c === 'medium') return chalk.yellow(c);
  return chalk.green(c);
}

function priorityColor(p: string): string {
  if (p === 'critical') return chalk.red.bold(p);
  if (p === 'high')     return chalk.red(p);
  if (p === 'normal')   return chalk.white(p);
  return chalk.gray(p);
}

// ─── Wait for project completion ──────────────────────────────────────────────

async function waitForCompletion(mayor: Mayor, timeoutMs = 150_000): Promise<void> {
  const total = mayor.template.tasks.length;
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = setInterval(() => {
      const posted = mayor.postedTasks.size;
      const accepted = [...mayor.postedTasks.values()].filter((t) => t.status === 'accepted').length;
      if (posted === total && accepted === total) {
        clearInterval(check);
        resolve();
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(check);
        const accepted2 = [...mayor.postedTasks.values()].filter((t) => t.status === 'accepted').length;
        reject(new Error(`Timed out after ${timeoutMs / 1000}s — ${accepted2}/${total} tasks accepted`));
      }
    }, 300);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(section('🍄  MYCELIUM MVP — Federated Agent Orchestration Demo'));
  console.log(chalk.dim('  A federated AI agent network simulating the AT Protocol.\n'));

  // ─── Step 1: Firehose ───────────────────────────────────────────────────────
  const firehose = createFirehose();

  // ─── Step 2: Intelligence providers + models ────────────────────────────────
  console.log(chalk.bold('⚡ Bootstrapping intelligence providers...'));
  const intelligence = bootstrapIntelligence(firehose);
  const { providers, models } = intelligence;

  // ─── Step 3: Mayor (subscribe BEFORE agents so registry is populated) ───────
  const mayorIdentity = generateIdentity('mayor.mycelium.local', 'Mayor (Orchestrator)');
  const mayorRepo = createMemoryRepository(mayorIdentity, firehose);
  const mayor = createMayor(mayorIdentity, mayorRepo, firehose, DASHBOARD_TEMPLATE);

  // ─── Step 4: Bootstrap agents ───────────────────────────────────────────────
  const { agents } = bootstrapAgents(firehose, intelligence);

  // ─── Step 5: Print bootstrap summary ────────────────────────────────────────
  let totalCapabilities = 0;

  for (const { def, identity, repo } of agents) {
    const profileRec = getRecord(repo, 'network.mycelium.agent.profile', 'self');
    const profile = profileRec.content as AgentProfile;
    const caps = listRecords(repo, 'network.mycelium.agent.capability').map(
      (r) => r.content as AgentCapability,
    );
    totalCapabilities += caps.length;

    const modelSlug = def.primaryModelSlug;
    const provider = intelligence.providers.githubModels.identity.handle.split('.')[0] === 'github-models'
      ? 'GitHub Models'
      : 'Ollama';
    const isCloud = ['claude-sonnet-4', 'claude-haiku-4', 'gpt-4', 'phi-4'].includes(modelSlug);

    console.log(
      `\n  🤖 ${chalk.cyan.bold(def.handle.split('.')[0].padEnd(8))} ` +
      `${chalk.dim(shortDid(identity.did))}  ${chalk.white(profile.description)}`,
    );
    for (const cap of caps) {
      const profColor =
        cap.proficiencyLevel === 'expert' ? chalk.yellow :
        cap.proficiencyLevel === 'advanced' ? chalk.green :
        cap.proficiencyLevel === 'intermediate' ? chalk.blue : chalk.gray;
      console.log(
        `     ${chalk.gray('├──')} ${chalk.white(cap.name)} ` +
        `${chalk.dim('(')}${profColor(cap.proficiencyLevel)}${chalk.dim(')')}`,
      );
    }
    console.log(
      `     ${chalk.gray('└──')} 🧠 powered by: ` +
      `${chalk.magenta(modelSlug)} ${chalk.dim('(')} ` +
      `${chalk.blue(isCloud ? 'GitHub Models' : 'Ollama')}${chalk.dim(')')}`,
    );
  }

  console.log(`\n  🧠 ${chalk.bold('Intelligence Providers')}`);
  console.log(
    `  ${chalk.gray('├──')} ${chalk.blue.bold('github-models')}  ${chalk.dim(shortDid(providers.githubModels.identity.did))}  ` +
    chalk.dim('Cloud Provider (Unified Gateway)'),
  );
  for (const [slug, modelId] of Object.entries({
    'claude-sonnet-4': models.claudeSonnet4,
    'claude-haiku-4': models.claudeHaiku4,
    'gpt-4': models.gpt4,
    'phi-4': models.phi4,
  })) {
    console.log(`  ${chalk.gray('│   ├──')} ${chalk.magenta(slug.padEnd(20))} ${chalk.dim(shortDid(modelId.did))}`);
  }
  console.log(
    `  ${chalk.gray('└──')} ${chalk.yellow.bold('ollama')}         ${chalk.dim(shortDid(providers.ollama.identity.did))}  ` +
    chalk.dim('Local Provider (Self-Hosted)'),
  );
  for (const [slug, modelId] of Object.entries({
    'llama-3-70b': models.llama3,
    'codellama': models.codellama,
  })) {
    console.log(`  ${chalk.gray('    ├──')} ${chalk.magenta(slug.padEnd(20))} ${chalk.dim(shortDid(modelId.did))}`);
  }

  console.log(
    `\n  🤖 ${chalk.cyan.bold('mayor'.padEnd(8))} ` +
    `${chalk.dim(shortDid(mayorIdentity.did))}  ${chalk.white('Orchestrator')}`,
  );
  console.log(`     ${chalk.gray('└──')} ${chalk.dim('(subscribed to firehose)')}`);

  const totalEvents = firehose.log.length;
  console.log(chalk.green(
    `\n✅ ${agents.length} agents bootstrapped | 2 providers | 6 models | ` +
    `${totalCapabilities} capability records | ${agents.length + 3} repositories created`,
  ));
  console.log(chalk.dim(`   📡 Firehose: ${totalEvents} events broadcast so far`));

  // ─── Step 6: Subscribe for live event logging ────────────────────────────────
  const claimLog: Map<string, string[]> = new Map(); // taskUri → [agent handles]
  const assignLog: Map<string, string> = new Map();  // taskUri → agent handle
  const completionLog: Map<string, string> = new Map(); // taskUri → agent handle

  // Build did→handle map
  const didToHandle = new Map<string, string>();
  for (const { def, identity } of agents) {
    didToHandle.set(identity.did, def.handle.split('.')[0]);
  }
  didToHandle.set(mayorIdentity.did, 'mayor');

  subscribe(firehose, { collections: ['network.mycelium.task.claim'] }, (event) => {
    const claim = event.record as { taskUri: string };
    const handle = didToHandle.get(event.did) ?? event.did.slice(0, 10);
    const existing = claimLog.get(claim.taskUri) ?? [];
    existing.push(handle);
    claimLog.set(claim.taskUri, existing);
  });

  subscribe(firehose, { collections: ['network.mycelium.task.completion'] }, (event) => {
    const comp = event.record as { taskUri: string };
    const handle = didToHandle.get(event.did) ?? event.did.slice(0, 10);
    completionLog.set(comp.taskUri, handle);
  });

  // ─── Step 7: Start agent runners ─────────────────────────────────────────────
  console.log(section('📋  PROJECT: Build the Mycelium Dashboard'));

  // forceAccept: true ensures every qualified task is claimed — without it,
  // tasks with a single eligible agent can get permanently stuck in the demo.
  const runners = agents.map(({ def, identity, repo }) =>
    createAgentRunner(def, identity, repo, mayorRepo, firehose, intelligence, undefined, { forceAccept: true }),
  );
  runners.forEach((r) => r.start());

  // ─── Step 8: Post initial tasks ──────────────────────────────────────────────
  console.log(chalk.bold('🎯 Mayor decomposing project into tasks...\n'));

  // Print task table
  const taskTable = new Table({
    head: [
      chalk.bold('#'),
      chalk.bold('Task'),
      chalk.bold('Domain'),
      chalk.bold('Priority'),
      chalk.bold('Complexity'),
      chalk.bold('Depends on'),
    ],
    colWidths: [4, 34, 12, 10, 12, 14],
    style: { compact: true },
  });

  DASHBOARD_TEMPLATE.tasks.forEach((t, i) => {
    taskTable.push([
      String(i + 1),
      t.title,
      chalk.dim(t.requiredCapabilities[0]?.domain ?? '-'),
      priorityColor(t.priority),
      complexityColor(t.complexity),
      t.dependsOn.length > 0 ? chalk.dim(t.dependsOn.map((d) => d.replace('task-', '#')).join(', ')) : chalk.dim('none'),
    ]);
  });

  console.log(taskTable.toString());
  console.log(chalk.dim('\n  📡 Tasks will be posted to Wanted Board as dependencies resolve...'));

  startProject(mayor, 'Build the Mycelium Dashboard');

  const initialPosted = mayor.postedTasks.size;
  console.log(chalk.dim(`  👁️  ${initialPosted} tasks posted (${DASHBOARD_TEMPLATE.tasks.length - initialPosted} gated by dependencies)`));

  // ─── Step 9: Wait for all tasks to complete ───────────────────────────────────
  console.log(section('🔨  EXECUTION IN PROGRESS'));
  console.log(chalk.dim('  Agents are claiming, executing, and completing tasks...\n'));

  let lastProgress = '';
  const progressInterval = setInterval(() => {
    const posted = mayor.postedTasks.size;
    const accepted = [...mayor.postedTasks.values()].filter((t) => t.status === 'accepted').length;
    const inProgress = [...mayor.postedTasks.values()].filter(
      (t) => t.status === 'in_progress' || t.status === 'assigned' || t.status === 'claimed',
    ).length;
    const total = DASHBOARD_TEMPLATE.tasks.length;
    const bar = '█'.repeat(accepted) + '░'.repeat(total - accepted);
    const line = `  [${chalk.green(bar)}] ${accepted}/${total} accepted  ${inProgress} in-flight  ${total - posted} pending`;
    if (line !== lastProgress) {
      process.stdout.write('\r' + line + '   ');
      lastProgress = line;
    }
  }, 400);

  try {
    await waitForCompletion(mayor);
  } finally {
    clearInterval(progressInterval);
    process.stdout.write('\n');
  }

  console.log(chalk.green('\n✅ All 8 tasks accepted!\n'));

  // Print completion events
  console.log(section('⭐  COMPLETIONS'));

  for (const taskDef of DASHBOARD_TEMPLATE.tasks) {
    const info = mayor.postedTasks.get(taskDef.id);
    if (!info) continue;
    const taskUri = info.uri;
    const agentHandle = completionLog.get(taskUri) ?? '?';
    const claimers = claimLog.get(taskUri) ?? [];
    const assigned = assignLog.get(taskUri) ?? agentHandle;

    console.log(
      `  ${chalk.green('✅')} ${chalk.cyan.bold(agentHandle.padEnd(8))} ` +
      `completed ${chalk.white.bold(`"${taskDef.title}"`)}`,
    );
    if (claimers.length > 1) {
      const others = claimers.filter((h) => h !== agentHandle);
      console.log(`     ${chalk.gray('├──')} ${chalk.dim('Competing claims from:')} ${others.join(', ')}`);
    }
    const artifacts = TASK_ARTIFACTS_MAP[taskDef.id] ?? [];
    if (artifacts.length > 0) {
      console.log(`     ${chalk.gray('└──')} ${chalk.dim('Artifacts:')} ${artifacts.slice(0, 4).join(', ')}`);
    }
  }

  // ─── Step 10: Summary table ────────────────────────────────────────────────
  console.log(section('📊  FINAL SUMMARY'));

  const summaryTable = new Table({
    head: [
      chalk.bold('Agent'),
      chalk.bold('Tasks'),
      chalk.bold('Score'),
      chalk.bold('Rating'),
      chalk.bold('Trust'),
      chalk.bold('Trend'),
      chalk.bold('Model'),
    ],
    colWidths: [10, 8, 8, 14, 16, 8, 22],
    style: { compact: true },
  });

  for (const { def, identity } of agents) {
    const stamps = getStampsForAgent(firehose, identity.did);
    const rep: AggregatedReputation | null = stamps.length > 0 ? aggregateReputation(stamps) : null;
    const handle = def.handle.split('.')[0];
    const score = rep ? Math.round(rep.overallScore) : 0;
    const taskCount = rep ? rep.totalTasks : 0;

    summaryTable.push([
      chalk.cyan(handle),
      String(taskCount),
      taskCount > 0 ? chalk.bold(String(score)) : chalk.gray('-'),
      taskCount > 0 ? stars(score) : chalk.gray('no stamps'),
      taskCount > 0 ? trustBadge(rep!.trustLevel) : chalk.gray('newcomer'),
      taskCount > 0 ? trendArrow(rep!.recentTrend) : chalk.gray('-'),
      chalk.magenta(def.primaryModelSlug),
    ]);
  }

  console.log(summaryTable.toString());

  const totalStamps = firehose.log.filter((e) => e.collection === 'network.mycelium.reputation.stamp').length;
  const totalFirehoseEvents = firehose.log.length;
  console.log(chalk.green(
    `\n🍄 Demo complete!  ${totalStamps} reputation stamps issued | ${totalFirehoseEvents} total firehose events`,
  ));
  console.log(chalk.dim('   Run `npm run dashboard` to explore results in the web UI at http://localhost:3000\n'));
}

// ─── Artifact name map (for summary output) ───────────────────────────────────

const TASK_ARTIFACTS_MAP: Record<string, string[]> = {
  'task-001': ['Button.tsx', 'Card.tsx', 'Input.tsx', 'Modal.tsx', 'theme.ts', 'index.ts'],
  'task-002': ['routes.ts', 'handlers.ts', 'middleware.ts', 'openapi.yaml'],
  'task-003': ['auth.ts', 'jwt.ts', 'middleware.ts', 'auth.test.ts'],
  'task-004': ['Dockerfile', 'docker-compose.yml', '.github/workflows/ci.yml'],
  'task-005': ['AgentCard.tsx', 'AgentCard.test.tsx', 'AgentCard.stories.tsx'],
  'task-006': ['FirehoseStream.tsx', 'useFirehose.ts', 'EventCard.tsx', 'VirtualList.tsx'],
  'task-007': ['api.test.ts', 'auth.test.ts', 'lifecycle.test.ts', 'reputation.test.ts'],
  'task-008': ['deploy.sh', 'staging.env', 'healthcheck.ts'],
};

main().catch((e: Error) => {
  console.error(chalk.red('\n❌ Demo failed:'), e.message);
  process.exit(1);
});
