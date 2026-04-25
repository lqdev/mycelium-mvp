// Mycelium Dashboard — Vanilla JS, no framework, no build step.
// Connects to the SSE stream and REST API to drive the 2×2 grid layout.

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  agents: [],
  participants: [],
  tasks: [],
  firehoseEvents: [],
  reputation: [],
  filter: 'all',
  sseConnected: false,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function shortDid(did) {
  if (!did) return '';
  return did.slice(0, 16) + '…' + did.slice(-4);
}

function classifyCollection(collection) {
  if (!collection) return 'other';
  if (collection.startsWith('network.mycelium.agent')) return 'agent';
  if (collection.startsWith('network.mycelium.task')) return 'task';
  if (collection.startsWith('network.mycelium.reputation')) return 'reputation';
  if (collection.startsWith('network.mycelium.intelligence')) return 'intel';
  if (collection.startsWith('network.mycelium.knowledge')) return 'knowledge';
  if (collection.startsWith('network.mycelium.tool')) return 'tool';
  return 'other';
}

function collectionShort(collection) {
  if (!collection) return '';
  const parts = collection.split('.');
  return parts.slice(2).join('.');
}

function formatTime(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString('en-US', { hour12: false });
  } catch {
    return '';
  }
}

function statusBadgeClass(status) {
  const map = {
    open: 'status-open',
    claimed: 'status-claimed',
    assigned: 'status-assigned',
    in_progress: 'status-in_progress',
    completed: 'status-completed',
    accepted: 'status-accepted',
    rejected: 'status-rejected',
  };
  return map[status] || '';
}

function statusLabel(status) {
  const map = {
    open: '○ open',
    claimed: '◑ claimed',
    assigned: '◕ assigned',
    in_progress: '⟳ in progress',
    completed: '✓ completed',
    accepted: '✅ accepted',
    rejected: '✗ rejected',
    pending: '⊡ pending',
  };
  return map[status] || status;
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function resolveHandle(did) {
  if (!did) return shortDid(did);
  const p = state.participants.find((x) => x.did === did);
  return p ? p.handle : shortDid(did);
}

function classifyDid(did) {
  if (!did) return 'other';
  const p = state.participants.find((x) => x.did === did);
  return p ? p.type : 'other';
}

function participantEmoji(type) {
  const map = { user: '👤', agent: '🤖', mayor: '🏛️', tool: '🔧', knowledge: '📚' };
  return map[type] || '●';
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Render: Network Participants ──────────────────────────────────────────────

function renderParticipantCard(p) {
  const badge = `<span class="type-badge type-${esc(p.type)}">${participantEmoji(p.type)}</span>`;

  if (p.type === 'agent') {
    const caps = (p.capabilities || []).slice(0, 5);
    const rep = p.reputation;
    const score = rep ? Math.round(rep.overallScore) : null;
    const trust = rep ? rep.trustLevel : 'newcomer';
    return `
      <div class="participant-card agent-card" role="button" tabindex="0"
           onclick="openDetail('agent','${esc(p.handle)}')"
           onkeydown="if(event.key==='Enter')openDetail('agent','${esc(p.handle)}')">
        <div class="agent-header">
          ${badge}
          <span class="agent-handle">${esc(p.handle)}</span>
          <span class="agent-model">${esc(p.model)}</span>
        </div>
        <div class="agent-did">${esc(shortDid(p.did))}</div>
        <div class="caps">
          ${caps.map((c) => `<span class="cap-tag ${esc(c.proficiency)}" title="${esc(c.domain)}">${esc(c.name)}</span>`).join('')}
        </div>
        ${score !== null ? `
          <div class="agent-rep-mini">
            <span class="score-num">${score}</span><span>/100</span>
            <span class="trust-badge ${esc(trust)}" style="display:inline-block">${esc(trust)}</span>
          </div>
        ` : '<div class="agent-rep-mini" style="color:var(--muted)">no stamps yet</div>'}
      </div>
    `;
  }

  if (p.type === 'user') {
    return `
      <div class="participant-card">
        <div class="agent-header">
          ${badge}
          <span class="agent-handle">${esc(p.handle)}</span>
          <span style="color:var(--muted);font-size:11px">Task Requester</span>
        </div>
        <div class="agent-did">${esc(shortDid(p.did))}</div>
        <div class="agent-rep-mini">
          <span>📋 ${p.taskPostingCount || 0} task${(p.taskPostingCount || 0) !== 1 ? 's' : ''} posted</span>
          <span style="color:var(--border)">·</span>
          <span>✍️ ${p.taskReviewCount || 0} review${(p.taskReviewCount || 0) !== 1 ? 's' : ''}</span>
        </div>
      </div>
    `;
  }

  if (p.type === 'mayor') {
    return `
      <div class="participant-card">
        <div class="agent-header">
          ${badge}
          <span class="agent-handle">${esc(p.handle)}</span>
          <span style="color:var(--muted);font-size:11px">Orchestrator</span>
        </div>
        <div class="agent-did">${esc(shortDid(p.did))}</div>
        <div class="agent-rep-mini">
          <span>🗂️ ${p.tasksManaged || 0} managed</span>
          <span style="color:var(--border)">·</span>
          <span>✅ ${p.tasksAccepted || 0} accepted</span>
        </div>
      </div>
    `;
  }

  // tool / knowledge
  return `
    <div class="participant-card">
      <div class="agent-header">
        ${badge}
        <span class="agent-handle">${esc(p.displayName || p.handle)}</span>
      </div>
      <div class="agent-did">${esc(shortDid(p.did))}</div>
      <div class="agent-rep-mini" style="color:var(--muted)">
        ${p.itemCount || 0} ${p.type === 'tool' ? 'tool' : 'document'}${(p.itemCount || 0) !== 1 ? 's' : ''}
      </div>
    </div>
  `;
}

function renderParticipants() {
  const container = document.getElementById('agents-list');
  if (!container) return;

  if (state.participants.length === 0) {
    container.innerHTML = '<div class="placeholder">Bootstrapping network…</div>';
    return;
  }

  const groups = [
    { type: 'user',      label: 'Human Users' },
    { type: 'mayor',     label: 'Orchestrator' },
    { type: 'agent',     label: 'AI Agents' },
    { type: 'tool',      label: 'Tool Providers' },
    { type: 'knowledge', label: 'Knowledge Providers' },
  ];

  const html = [];
  for (const { type, label } of groups) {
    const members = state.participants.filter((p) => p.type === type);
    if (members.length === 0) continue;
    html.push(`<div class="participant-group-header">${participantEmoji(type)} ${esc(label)}</div>`);
    for (const p of members) html.push(renderParticipantCard(p));
  }

  container.innerHTML = html.join('');
}

// Keep renderAgents() for internal use by the reputation panel (state.agents still populated separately)
function renderAgents() {
  const container = document.getElementById('agents-list');
  if (!container) return;

  if (state.agents.length === 0) {
    container.innerHTML = '<div class="placeholder">Bootstrapping agents…</div>';
    return;
  }

  container.innerHTML = state.agents.map((agent) => {
    const caps = (agent.capabilities || []).slice(0, 5);
    const rep = agent.reputation;
    const score = rep ? Math.round(rep.overallScore) : null;
    const trust = rep ? rep.trustLevel : 'newcomer';

    return `
      <div class="agent-card" role="button" tabindex="0"
           onclick="openDetail('agent', '${esc(agent.handle)}')"
           onkeydown="if(event.key==='Enter')openDetail('agent','${esc(agent.handle)}')">
        <div class="agent-header">
          <span class="agent-handle">${esc(agent.handle)}</span>
          <span class="agent-model">${esc(agent.model)}</span>
        </div>
        <div class="agent-did">${esc(shortDid(agent.did))}</div>
        <div class="caps">
          ${caps.map((c) => `
            <span class="cap-tag ${esc(c.proficiency)}" title="${esc(c.domain)}">
              ${esc(c.name)}
            </span>
          `).join('')}
        </div>
        ${score !== null ? `
          <div class="agent-rep-mini">
            <span class="score-num">${score}</span>
            <span>/100</span>
            <span class="trust-badge ${esc(trust)}" style="display:inline-block">${esc(trust)}</span>
          </div>
        ` : '<div class="agent-rep-mini" style="color:var(--muted)">no stamps yet</div>'}
      </div>
    `;
  }).join('');
}

// ── Render: Wanted Board ──────────────────────────────────────────────────────

function renderTasks() {
  const container = document.getElementById('tasks-list');
  if (!container) return;

  if (state.tasks.length === 0) {
    container.innerHTML = '<div class="placeholder">Waiting for project to start…</div>';
    return;
  }

  container.innerHTML = state.tasks.map((task) => {
    const statusClass = statusBadgeClass(task.status);
    const num = task.id ? task.id.replace('task-0', '#').replace('task-', '#') : '';

    return `
      <div class="task-card" data-status="${esc(task.status)}" role="button" tabindex="0"
           onclick="openDetail('task', '${esc(task.id)}')"
           onkeydown="if(event.key==='Enter')openDetail('task','${esc(task.id)}')">
        <div class="task-header">
          <span class="task-id">${esc(num)}</span>
          <span class="task-title">${esc(task.title)}</span>
        </div>
        <div class="task-meta">
          <span class="badge domain">${esc(task.domain)}</span>
          <span class="badge status ${statusClass}">${esc(statusLabel(task.status))}</span>
          ${task.assignee ? `<span class="badge assignee">→ ${esc(task.assignee)}</span>` : ''}
          ${task.status === 'pending' ? '<span class="badge pending">awaiting deps</span>' : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ── Render: Firehose Stream ───────────────────────────────────────────────────

let firehoseContainer = null;

function renderFirehoseEvent(event) {
  if (!firehoseContainer) {
    firehoseContainer = document.getElementById('firehose-list');
  }
  if (!firehoseContainer) return;

  const kind = classifyCollection(event.collection);
  const participantType = classifyDid(event.did);

  // Apply filter
  if (state.filter === 'user') {
    if (participantType !== 'user') return;
  } else if (state.filter !== 'all' && kind !== state.filter) return;

  const row = document.createElement('div');
  row.className = 'event-row';
  row.dataset.kind = kind;
  row.dataset.participantType = participantType;
  row.setAttribute('role', 'button');
  row.setAttribute('tabindex', '0');
  row.onclick = () => openDetail('event', event.seq);
  row.onkeydown = (e) => { if (e.key === 'Enter') openDetail('event', event.seq); };

  const col = collectionShort(event.collection);
  const body = describeEvent(event);

  row.innerHTML = `
    <span class="event-seq">#${event.seq}</span>
    <span class="event-type ${kind}">${esc(col)}</span>
    <span class="event-body" title="${esc(body)}">${esc(body)}</span>
    <span class="event-time">${esc(formatTime(event.timestamp))}</span>
  `;

  firehoseContainer.prepend(row);

  // Keep at most 300 rows for performance
  while (firehoseContainer.children.length > 300) {
    firehoseContainer.removeChild(firehoseContainer.lastChild);
  }
}

function describeEvent(event) {
  const col = event.collection ?? '';
  const record = event.record ?? {};

  if (col === 'network.mycelium.agent.profile') {
    return `${event.operation} profile — ${record.handle ?? event.did}`;
  }
  if (col === 'network.mycelium.agent.capability') {
    return `${event.operation} capability — ${record.name ?? event.rkey} (${record.proficiencyLevel ?? '?'})`;
  }
  if (col === 'network.mycelium.task.posting') {
    const poster = resolveHandle(event.did);
    return `${event.operation} task — "${record.title ?? event.rkey}" [${record.status ?? '?'}] by ${poster}`;
  }
  if (col === 'network.mycelium.task.claim') {
    return `${event.operation} claim — "${record.taskTitle ?? '?'}" (${record.proposal?.confidenceLevel ?? '?'})`;
  }
  if (col === 'network.mycelium.task.completion') {
    return `${event.operation} completion — task done by ${resolveHandle(record.completerDid ?? event.did)}`;
  }
  if (col === 'network.mycelium.task.review') {
    return `${event.operation} review — ${record.outcome ?? '?'} (score: ${record.score ?? '?'}) by ${resolveHandle(event.did)}`;
  }
  if (col === 'network.mycelium.reputation.stamp') {
    return `${event.operation} stamp — ${record.taskDomain ?? '?'} score: ${Math.round(record.overallScore ?? 0)}`;
  }
  if (col === 'network.mycelium.intelligence.model') {
    return `${event.operation} model — ${record.name ?? event.rkey} (${record.modelOrigin ?? '?'})`;
  }
  if (col === 'network.mycelium.intelligence.provider') {
    return `${event.operation} provider — ${record.name ?? event.rkey} (${record.providerType ?? '?'})`;
  }
  if (col === 'network.mycelium.knowledge.provider') {
    return `${event.operation} knowledge provider — ${record.name ?? event.rkey}`;
  }
  if (col === 'network.mycelium.knowledge.document') {
    return `${event.operation} knowledge doc — ${record.title ?? event.rkey}`;
  }
  if (col === 'network.mycelium.knowledge.query') {
    return `${event.operation} knowledge query — ${record.verificationLevel ?? 'claimed'} (${record.resultCount ?? 0} results)`;
  }
  if (col === 'network.mycelium.tool.provider') {
    return `${event.operation} tool provider — ${record.name ?? event.rkey}`;
  }
  if (col === 'network.mycelium.tool.definition') {
    return `${event.operation} tool definition — ${record.name ?? event.rkey} (${record.category ?? '?'})`;
  }
  if (col === 'network.mycelium.tool.invocation') {
    return `${event.operation} tool invocation — ${record.success ? '✅' : '❌'} ${record.toolUri ? record.toolUri.split('/').pop() : event.rkey}`;
  }
  return `${event.operation} ${event.collection} [${event.rkey}]`;
}

// ── Render: Reputation Board ──────────────────────────────────────────────────

function renderReputation() {
  const container = document.getElementById('reputation-list');
  if (!container) return;

  const reps = state.reputation;

  // Merge agent info
  const cards = state.agents.map((agent) => {
    const rep = reps.find((r) => r.did === agent.did) || agent.reputation;
    return { agent, rep };
  }).filter(({ rep }) => rep && rep.totalTasks > 0);

  if (cards.length === 0) {
    container.innerHTML = '<div class="placeholder">Waiting for completed tasks…</div>';
    return;
  }

  // Sort by score descending
  cards.sort((a, b) => (b.rep?.overallScore ?? 0) - (a.rep?.overallScore ?? 0));

  const dims = ['codeQuality', 'reliability', 'efficiency', 'communication', 'creativity'];
  const dimLabels = {
    codeQuality: 'Code Quality',
    reliability: 'Reliability',
    efficiency: 'Efficiency',
    communication: 'Communication',
    creativity: 'Creativity',
  };

  container.innerHTML = cards.map(({ agent, rep }) => {
    const score = Math.round(rep.overallScore);
    const trust = rep.trustLevel ?? 'newcomer';
    const trend = rep.recentTrend ?? 'stable';
    const trendIcon = trend === 'improving' ? '↑' : trend === 'declining' ? '↓' : '→';

    const bars = dims.map((dim) => {
      const val = rep.averageScores?.[dim] ?? 0;
      const pct = Math.round(val * 10); // 0–10 → 0–100%
      return `
        <div class="rep-bar-row">
          <span class="rep-dim-label">${esc(dimLabels[dim])}</span>
          <div class="rep-bar-track">
            <div class="rep-bar-fill" style="width:${pct}%"></div>
          </div>
          <span class="rep-dim-val">${val.toFixed(1)}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="rep-card" role="button" tabindex="0"
           onclick="openDetail('reputation', '${esc(agent.handle)}')"
           onkeydown="if(event.key==='Enter')openDetail('reputation','${esc(agent.handle)}')">
        <div class="rep-header">
          <span class="rep-handle">${esc(agent.handle)}</span>
          <span class="trust-badge ${esc(trust)}">${esc(trust)}</span>
          <span style="color:var(--muted);font-size:11px">${esc(trendIcon)}</span>
          <span class="rep-score">${score}</span>
        </div>
        <div class="rep-bars">${bars}</div>
        <div class="rep-stats">
          <span>${rep.totalTasks} task${rep.totalTasks !== 1 ? 's' : ''}</span>
          <span>·</span>
          <span>${esc(agent.model)}</span>
        </div>
      </div>
    `;
  }).join('');
}

// ── Fetch REST data ───────────────────────────────────────────────────────────

async function fetchAll() {
  try {
    const [participants, agents, tasks, reputation, status] = await Promise.all([
      fetch('/api/participants').then((r) => r.json()),
      fetch('/api/agents').then((r) => r.json()),
      fetch('/api/tasks').then((r) => r.json()),
      fetch('/api/reputation').then((r) => r.json()),
      fetch('/api/status').then((r) => r.json()),
    ]);

    state.participants = participants;
    state.agents = agents;
    state.tasks = tasks;
    state.reputation = reputation;

    renderParticipants();
    renderTasks();
    renderReputation();
    updateStatusBar(status);
  } catch (e) {
    console.error('Fetch error:', e);
  }
}

function updateStatusBar(status) {
  const el = (id) => document.getElementById(id);
  if (status) {
    el('task-progress').textContent = `${status.tasksAccepted}/${status.tasksTotal} tasks`;
    el('participant-count').textContent = `${status.participants} participants`;
    el('event-count').textContent = `${status.firehoseEvents} events`;
  }
}

// ── SSE connection ────────────────────────────────────────────────────────────

function connectSSE() {
  const dot = document.getElementById('sse-dot');
  const source = new EventSource('/api/events');

  source.addEventListener('firehose', (e) => {
    try {
      const event = JSON.parse(e.data);
      renderFirehoseEvent(event);

      // Refresh REST data on meaningful events
      const col = event.collection ?? '';
      if (
        col.startsWith('network.mycelium.task') ||
        col.startsWith('network.mycelium.reputation') ||
        col === 'network.mycelium.agent.profile'
      ) {
        clearTimeout(refreshDebounce);
        refreshDebounce = setTimeout(fetchAll, 300);
      }
    } catch (err) {
      console.error('SSE parse error', err);
    }
  });

  source.onopen = () => {
    dot.classList.remove('error');
    dot.classList.add('connected');
    state.sseConnected = true;
  };

  source.onerror = () => {
    dot.classList.remove('connected');
    dot.classList.add('error');
    state.sseConnected = false;
    // Reconnect after 3 seconds
    setTimeout(connectSSE, 3000);
    source.close();
  };
}

let refreshDebounce = null;

// ── Filter buttons ────────────────────────────────────────────────────────────

function initFilters() {
  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.filter = btn.dataset.filter ?? 'all';

      // Re-render events matching filter
      const container = document.getElementById('firehose-list');
      if (!container) return;
      container.querySelectorAll('.event-row').forEach((row) => {
        const kind = row.dataset.kind ?? '';
        const pt = row.dataset.participantType ?? '';
        let visible;
        if (state.filter === 'all') {
          visible = true;
        } else if (state.filter === 'user') {
          visible = pt === 'user';
        } else {
          visible = kind === state.filter;
        }
        row.style.display = visible ? '' : 'none';
      });
    });
  });
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function openDetail(type, id) {
  const panel = document.getElementById('detail-panel');
  const overlay = document.getElementById('overlay');
  const titleEl = document.getElementById('detail-title');
  const subtitleEl = document.getElementById('detail-subtitle');
  const bodyEl = document.getElementById('detail-body');

  panel.classList.add('open');
  overlay.classList.add('open');
  panel.removeAttribute('aria-hidden');
  overlay.removeAttribute('aria-hidden');
  titleEl.textContent = 'Loading…';
  subtitleEl.textContent = '';
  bodyEl.innerHTML = '<div class="placeholder">Fetching data…</div>';

  const endpoints = {
    agent:      `/api/agents/${encodeURIComponent(id)}`,
    task:       `/api/tasks/${encodeURIComponent(id)}`,
    event:      `/api/firehose/${encodeURIComponent(id)}`,
    reputation: `/api/reputation/${encodeURIComponent(id)}`,
  };

  const url = endpoints[type];
  if (!url) return;

  fetch(url)
    .then((r) => { if (!r.ok) throw new Error(`${r.status} ${r.statusText}`); return r.json(); })
    .then((data) => {
      if (type === 'agent')      renderAgentDetail(data);
      if (type === 'task')       renderTaskDetail(data);
      if (type === 'event')      renderEventDetail(data);
      if (type === 'reputation') renderReputationDetail(data);
    })
    .catch((e) => {
      titleEl.textContent = 'Error';
      bodyEl.innerHTML = `<div class="placeholder" style="color:var(--red)">${esc(e.message)}</div>`;
    });
}

function closeDetail() {
  const panel = document.getElementById('detail-panel');
  const overlay = document.getElementById('overlay');
  panel.classList.remove('open');
  overlay.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  overlay.setAttribute('aria-hidden', 'true');
}

function initDetailPanel() {
  document.getElementById('detail-close').addEventListener('click', closeDetail);
  document.getElementById('overlay').addEventListener('click', closeDetail);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });
}

// ── Detail renderers ──────────────────────────────────────────────────────────

function renderAgentDetail(data) {
  const titleEl = document.getElementById('detail-title');
  const subtitleEl = document.getElementById('detail-subtitle');
  const bodyEl = document.getElementById('detail-body');

  titleEl.textContent = data.displayName || data.handle;
  subtitleEl.textContent = data.description || '';

  const caps = (data.capabilities || []).map((c) => `
    <div class="detail-cap-card">
      <div class="detail-cap-header">
        <span class="cap-tag ${esc(c.proficiencyLevel)}">${esc(c.name)}</span>
        <span style="color:var(--muted);font-size:10px">${esc(c.domain)} · ${esc(c.proficiencyLevel)}</span>
      </div>
      <div style="font-size:11px;color:var(--muted);margin:3px 0;line-height:1.4">${esc(c.description || '')}</div>
      ${c.tags?.length ? `<div class="detail-tags">${c.tags.map((t) => `<span class="detail-tag">${esc(t)}</span>`).join('')}</div>` : ''}
      ${c.tools?.length ? `<div class="detail-tags">${c.tools.map((t) => `<span class="detail-tag tool">${esc(t)}</span>`).join('')}</div>` : ''}
    </div>
  `).join('');

  const historyItems = [
    ...(data.claims || []).map((c) => ({ ...c, _type: 'claim' })),
    ...(data.completions || []).map((c) => ({ ...c, _type: 'completion' })),
  ].sort((a, b) => (a.seq || 0) - (b.seq || 0));

  const historyRows = historyItems.map((item) => {
    const isDone = item._type === 'completion';
    const taskLabel = item.taskTitle || item.taskId || shortDid(item.taskUri || '');
    const taskId = item.taskId || '';
    const taskClick = taskId ? `onclick="openDetail('task','${esc(taskId)}');return false"` : '';
    return `
      <div class="timeline-item">
        <span class="timeline-dot ${isDone ? 'done' : 'claim'}"></span>
        <span class="timeline-label">${isDone ? '✓ completed' : '◎ claimed'}</span>
        <a class="detail-link" ${taskClick} href="#">${esc(taskLabel)}</a>
        <span class="timeline-time">${esc(formatTime(item.createdAt || item.timestamp || ''))}</span>
      </div>
    `;
  }).join('') || '<div class="placeholder" style="padding:4px 0">No task history yet</div>';

  const stamps = (data.stamps || []).map((stamp) => renderStampCard(stamp)).join('') ||
    '<div class="placeholder" style="padding:4px 0">No stamps yet</div>';

  bodyEl.innerHTML = `
    <div class="kv-table">
      <span class="kv-key">handle</span><span class="kv-val">${esc(data.handle)}</span>
      <span class="kv-key">model</span><span class="kv-val"><span class="agent-model">${esc(data.model)}</span></span>
      <span class="kv-key">type</span><span class="kv-val">${esc(data.agentType)}</span>
      <span class="kv-key">max concurrent</span><span class="kv-val">${esc(data.maxConcurrentTasks)}</span>
      <span class="kv-key">intelligence for</span><span class="kv-val">${esc((data.intelligenceUsedFor || []).join(', '))}</span>
      <span class="kv-key">DID</span><span class="kv-val mono">${esc(data.did)}</span>
    </div>
    ${data.behavior ? `
    <div class="detail-section">
      <div class="detail-section-title">Behavior</div>
      <div class="kv-table">
        <span class="kv-key">speed</span><span class="kv-val">${data.behavior.speedMultiplier}×</span>
        <span class="kv-key">accept rate</span><span class="kv-val">${Math.round(data.behavior.acceptRate * 100)}%</span>
      </div>
    </div>` : ''}
    <div class="detail-section">
      <div class="detail-section-title">Capabilities (${(data.capabilities || []).length})</div>
      ${caps || '<div class="placeholder" style="padding:4px 0">None</div>'}
    </div>
    <div class="detail-section">
      <div class="detail-section-title">Task History</div>
      <div class="timeline">${historyRows}</div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">Reputation Stamps (${(data.stamps || []).length})</div>
      ${stamps}
    </div>
  `;
}

function renderTaskDetail(data) {
  const titleEl = document.getElementById('detail-title');
  const subtitleEl = document.getElementById('detail-subtitle');
  const bodyEl = document.getElementById('detail-body');

  titleEl.textContent = data.title;
  subtitleEl.textContent = data.id;

  const complexityColors = { low: 'var(--green)', medium: 'var(--yellow)', high: 'var(--red)', critical: 'var(--red)' };
  const complexityColor = complexityColors[data.complexity] || 'var(--muted)';

  const deps = (data.deps || []).map((dep) => `
    <span class="detail-dep ${esc(dep.status)}" onclick="openDetail('task','${esc(dep.id)}')" style="cursor:pointer">
      ${esc(dep.id)} — ${esc(dep.title)} <span class="badge status ${statusBadgeClass(dep.status)}" style="margin-left:4px">${esc(statusLabel(dep.status))}</span>
    </span>
  `).join('') || '<span style="color:var(--muted);font-size:11px">none</span>';

  const dependents = (data.dependents || []).map((d) => `
    <span class="detail-dep" onclick="openDetail('task','${esc(d.id)}')" style="cursor:pointer">${esc(d.id)} — ${esc(d.title)}</span>
  `).join('') || '<span style="color:var(--muted);font-size:11px">none</span>';

  const timeline = (data.timeline || []).map((t) => `
    <div class="timeline-item">
      <span class="timeline-dot ${esc(t.status || t.operation || 'update')}"></span>
      <span class="timeline-label">${esc(t.operation)}${t.status ? ` → ${esc(t.status)}` : ''}</span>
      ${t.assigneeDid ? `<span style="color:var(--muted);font-size:10px">(${shortDid(t.assigneeDid)})</span>` : ''}
      <span class="timeline-time">${esc(formatTime(t.timestamp))}</span>
    </div>
  `).join('') || '<div class="placeholder" style="padding:4px 0">Not yet posted</div>';

  const claims = (data.claims || []).map((c) => `
    <div class="claim-card">
      <div class="claim-header">
        <a class="detail-link" onclick="openDetail('agent','${esc(c.claimerHandle)}');return false" href="#">${esc(c.claimerHandle)}</a>
        <span class="badge confidence-${esc(c.proposal?.confidenceLevel)}">${esc(c.proposal?.confidenceLevel)} confidence</span>
        <span class="badge status ${statusBadgeClass(c.status)}">${esc(statusLabel(c.status))}</span>
      </div>
      <div class="claim-approach">${esc(c.proposal?.approach || '')}</div>
      <div style="color:var(--muted);font-size:10px;margin-top:3px">Est: ${esc(c.proposal?.estimatedDuration || '')}</div>
    </div>
  `).join('') || '<div class="placeholder" style="padding:4px 0">No claims yet</div>';

  let completionHtml = '';
  if (data.completion) {
    const c = data.completion;
    const artifacts = (c.artifacts || []).map((a) => `
      <div class="artifact-row">
        <span class="artifact-name">${esc(a.name)}</span>
        <span class="badge">${esc(a.type)}</span>
        <span style="color:var(--muted)">${formatSize(a.size)}</span>
      </div>
    `).join('');
    completionHtml = `
      <div class="detail-section">
        <div class="detail-section-title">Completion</div>
        <div class="kv-table">
          <span class="kv-key">summary</span><span class="kv-val">${esc(c.summary)}</span>
          <span class="kv-key">exec time</span><span class="kv-val">${esc(c.metrics?.executionTime)}</span>
          ${c.metrics?.linesOfCode != null ? `<span class="kv-key">lines of code</span><span class="kv-val">${c.metrics.linesOfCode}</span>` : ''}
          ${c.metrics?.testsPassed != null ? `<span class="kv-key">tests</span><span class="kv-val">${c.metrics.testsPassed}/${c.metrics.testsTotal} passed${c.metrics.coveragePercent != null ? ` · ${c.metrics.coveragePercent}% cov` : ''}</span>` : ''}
          ${c.intelligenceUsed ? `<span class="kv-key">model DID</span><span class="kv-val mono">${esc(shortDid(c.intelligenceUsed.modelDid))}</span>` : ''}
        </div>
        ${artifacts ? `<div class="detail-section-title" style="margin-top:8px">Artifacts</div><div class="artifacts-list">${artifacts}</div>` : ''}
        ${c.notes ? `<div class="stamp-comment" style="margin-top:6px">${esc(c.notes)}</div>` : ''}
      </div>`;
  }

  const reqCaps = (data.requiredCapabilities || []).map((c) => `
    <div class="kv-table" style="margin-bottom:6px">
      <span class="kv-key">domain</span><span class="kv-val">${esc(c.domain)}</span>
      <span class="kv-key">min proficiency</span><span class="kv-val">${esc(c.minProficiency)}</span>
      ${c.tags?.length ? `<span class="kv-key">tags</span><span class="kv-val">${c.tags.map((t) => `<span class="detail-tag">${esc(t)}</span>`).join(' ')}</span>` : ''}
    </div>
  `).join('');

  const stampHtml = data.stamp ? `
    <div class="detail-section">
      <div class="detail-section-title">Reputation Stamp</div>
      ${renderStampCard(data.stamp)}
    </div>` : '';

  const rejectionsArr = data.rejections || [];
  const rejectionsHtml = rejectionsArr.length > 0 ? `
    <div class="detail-section">
      <div class="detail-section-title">Rejection History (${rejectionsArr.length})</div>
      ${rejectionsArr.map((r, i) => `
        <div class="rejection-card">
          <div class="rejection-header">
            <span class="badge status status-rejected">✗ rejected</span>
            <strong style="font-size:12px;color:var(--accent)">${esc(r.agentHandle || shortDid(r.agentDid))}</strong>
            <span style="font-size:10px;color:var(--muted)">#${i + 1}</span>
          </div>
          <div class="rejection-reason">${esc(r.reason)}</div>
        </div>`).join('')}
    </div>` : '';

  bodyEl.innerHTML = `
    <div class="kv-table">
      <span class="kv-key">id</span><span class="kv-val mono">${esc(data.id)}</span>
      <span class="kv-key">status</span><span class="kv-val"><span class="badge status ${statusBadgeClass(data.status)}">${esc(statusLabel(data.status))}</span></span>
      <span class="kv-key">complexity</span><span class="kv-val" style="color:${complexityColor}">${esc(data.complexity)}</span>
      <span class="kv-key">priority</span><span class="kv-val">${esc(data.priority)}</span>
      ${data.assignee ? `<span class="kv-key">assignee</span><span class="kv-val"><a class="detail-link" onclick="openDetail('agent','${esc(data.assignee.handle)}');return false" href="#">${esc(data.assignee.handle)}</a> <span class="agent-model">${esc(data.assignee.model)}</span></span>` : ''}
    </div>
    ${data.description ? `<div class="detail-description">${esc(data.description)}</div>` : ''}
    <div class="detail-section">
      <div class="detail-section-title">Required Capabilities</div>
      ${reqCaps || '<span style="color:var(--muted);font-size:11px">none</span>'}
    </div>
    <div class="detail-section">
      <div class="detail-section-title">Depends on</div>
      <div class="detail-deps">${deps}</div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">Blocks</div>
      <div class="detail-deps">${dependents}</div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">Status Timeline</div>
      <div class="timeline">${timeline}</div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">Claims (${(data.claims || []).length})</div>
      ${claims}
    </div>
    ${completionHtml}
    ${stampHtml}
    ${rejectionsHtml}
  `;
}

function renderEventDetail(data) {
  const titleEl = document.getElementById('detail-title');
  const subtitleEl = document.getElementById('detail-subtitle');
  const bodyEl = document.getElementById('detail-body');

  titleEl.textContent = `Event #${data.seq}`;
  subtitleEl.textContent = collectionShort(data.collection || '');

  const col = data.collection || '';
  const kind = classifyCollection(col);

  bodyEl.innerHTML = `
    <div class="kv-table">
      <span class="kv-key">seq</span><span class="kv-val mono">#${esc(data.seq)}</span>
      <span class="kv-key">operation</span><span class="kv-val">${esc(data.operation)}</span>
      <span class="kv-key">collection</span><span class="kv-val"><span class="event-type ${esc(kind)}" style="font-size:11px">${esc(collectionShort(col))}</span></span>
      <span class="kv-key">rkey</span><span class="kv-val mono">${esc(data.rkey)}</span>
      ${data.authorHandle ? `<span class="kv-key">author</span><span class="kv-val"><a class="detail-link" onclick="openDetail('agent','${esc(data.authorHandle)}');return false" href="#">${esc(data.authorHandle)}</a></span>` : ''}
      <span class="kv-key">DID</span><span class="kv-val mono">${esc(shortDid(data.did))}</span>
      <span class="kv-key">timestamp</span><span class="kv-val" style="font-size:11px">${esc(data.timestamp)}</span>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">Record Payload</div>
      <pre class="json-view">${esc(JSON.stringify(data.record, null, 2))}</pre>
    </div>
  `;
}

function renderReputationDetail(data) {
  const titleEl = document.getElementById('detail-title');
  const subtitleEl = document.getElementById('detail-subtitle');
  const bodyEl = document.getElementById('detail-body');

  titleEl.textContent = `${data.displayName || data.handle} — Reputation`;
  subtitleEl.textContent = data.model || '';

  const rep = data.reputation;
  const dims = ['codeQuality', 'reliability', 'efficiency', 'communication', 'creativity'];
  const dimLabels = {
    codeQuality: 'Code Quality',
    reliability: 'Reliability',
    efficiency: 'Efficiency',
    communication: 'Communication',
    creativity: 'Creativity',
  };

  const aggBars = rep ? dims.map((d) => {
    const val = rep.averageScores?.[d] ?? 0;
    return `<div class="rep-bar-row">
      <span class="rep-dim-label">${esc(dimLabels[d])}</span>
      <div class="rep-bar-track"><div class="rep-bar-fill" style="width:${Math.round(val * 10)}%"></div></div>
      <span class="rep-dim-val">${val.toFixed(1)}</span>
    </div>`;
  }).join('') : '';

  const stampCards = (data.stamps || []).map((stamp) => renderStampCard(stamp, true)).join('') ||
    '<div class="placeholder">No stamps yet</div>';

  bodyEl.innerHTML = `
    ${rep ? `
    <div class="kv-table">
      <span class="kv-key">handle</span><span class="kv-val"><a class="detail-link" onclick="openDetail('agent','${esc(data.handle)}');return false" href="#">${esc(data.handle)}</a></span>
      <span class="kv-key">trust level</span><span class="kv-val"><span class="trust-badge ${esc(rep.trustLevel)}">${esc(rep.trustLevel)}</span></span>
      <span class="kv-key">overall score</span><span class="kv-val"><strong>${Math.round(rep.overallScore)}</strong>/100</span>
      <span class="kv-key">total tasks</span><span class="kv-val">${rep.totalTasks}</span>
      <span class="kv-key">recent trend</span><span class="kv-val">${esc(rep.recentTrend)}</span>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">Average Scores</div>
      <div class="rep-bars">${aggBars}</div>
    </div>` : '<div class="placeholder">No reputation data yet</div>'}
    <div class="detail-section">
      <div class="detail-section-title">All Stamps (${(data.stamps || []).length})</div>
      ${stampCards}
    </div>
  `;
}

/** Shared stamp card renderer used by agent + task + reputation detail views. */
function renderStampCard(stamp, showTaskLink = false) {
  const dims = ['codeQuality', 'reliability', 'efficiency', 'communication', 'creativity'];
  const dimLabels = {
    codeQuality: 'Code Quality',
    reliability: 'Reliability',
    efficiency: 'Efficiency',
    communication: 'Communication',
    creativity: 'Creativity',
  };
  const dimBars = dims.map((d) => {
    const val = stamp.dimensions?.[d] ?? 0;
    return `<div class="rep-bar-row">
      <span class="rep-dim-label">${esc(dimLabels[d])}</span>
      <div class="rep-bar-track"><div class="rep-bar-fill" style="width:${Math.round(val * 10)}%"></div></div>
      <span class="rep-dim-val">${val.toFixed(1)}</span>
    </div>`;
  }).join('');

  const taskLink = showTaskLink && stamp.taskId
    ? `<a class="detail-link" onclick="openDetail('task','${esc(stamp.taskId)}');return false" href="#" style="font-size:11px">${esc(stamp.taskId)}</a>`
    : '';

  return `
    <div class="stamp-card">
      <div class="stamp-header">
        <span class="badge assessment-${esc(stamp.assessment)}">${esc(stamp.assessment)}</span>
        <span style="color:var(--muted);font-size:10px">${esc(stamp.taskDomain || '')}</span>
        ${taskLink}
        <span class="rep-score" style="font-size:16px;margin-left:auto">${Math.round(stamp.overallScore)}</span>
      </div>
      ${stamp.comment ? `<div class="stamp-comment">${esc(stamp.comment)}</div>` : ''}
      <div class="rep-bars" style="margin-top:5px">${dimBars}</div>
      <div style="font-size:10px;color:var(--muted);margin-top:3px">${esc(stamp.createdAt || '')}</div>
    </div>
  `;
}

// ── SQL Explorer ──────────────────────────────────────────────────────────────

function initSqlPanel() {
  const toggle = document.getElementById('sql-toggle');
  const body = document.getElementById('sql-body');
  const input = document.getElementById('sql-input');
  const runBtn = document.getElementById('sql-run');
  const results = document.getElementById('sql-results');

  toggle.addEventListener('click', () => {
    const collapsed = body.classList.toggle('collapsed');
    toggle.textContent = collapsed ? '▶' : '▼';
    toggle.title = collapsed ? 'Expand' : 'Collapse';
  });

  async function runQuery() {
    const sql = input.value.trim();
    if (!sql) return;
    runBtn.disabled = true;
    runBtn.textContent = '…';
    results.innerHTML = '';
    try {
      const res = await fetch(`/api/sql?q=${encodeURIComponent(sql)}`);
      const json = await res.json();
      if (!res.ok) {
        results.innerHTML = `<div class="sql-error">${esc(json.error || 'Unknown error')}</div>`;
        return;
      }
      const rows = json.rows || [];
      if (rows.length === 0) {
        results.innerHTML = `<div class="sql-count">No rows returned.</div>`;
        return;
      }
      const cols = Object.keys(rows[0]);
      const headerHtml = cols.map((c) => `<th>${esc(c)}</th>`).join('');
      const rowsHtml = rows.map((r) =>
        `<tr>${cols.map((c) => {
          const v = r[c];
          const str = v === null ? '<span style="color:var(--muted)">null</span>' : esc(String(v));
          return `<td title="${esc(String(v ?? ''))}">${str}</td>`;
        }).join('')}</tr>`
      ).join('');
      results.innerHTML = `
        <div class="sql-count">${rows.length} row${rows.length !== 1 ? 's' : ''}</div>
        <div class="sql-table-wrap">
          <table class="sql-table"><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>
        </div>`;
    } catch (err) {
      results.innerHTML = `<div class="sql-error">${esc(err.message)}</div>`;
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = 'Run';
    }
  }

  runBtn.addEventListener('click', runQuery);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      runQuery();
    }
  });

  document.querySelectorAll('.sql-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      input.value = btn.dataset.sql;
      runQuery();
    });
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initFilters();
  initDetailPanel();
  initSqlPanel();
  fetchAll();
  connectSSE();

  // Poll REST every 2 seconds to pick up task status changes
  setInterval(fetchAll, 2000);
});
