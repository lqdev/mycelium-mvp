# Mycelium MVP — Intelligence Reference

> Complete specification for intelligence providers, models, capability tags, and agent-to-model assignments. This is the canonical reference for `src/intelligence/index.ts` and the bootstrap module.

---

## Overview

The MVP uses **2 intelligence providers** and **6 models**:

| Provider | Type | Models | Used For |
|----------|------|--------|----------|
| GitHub Models | `cloud` | Claude Sonnet 4, Claude Haiku 4, GPT-4, Phi-4 | Cloud AI via unified GitHub gateway |
| Local Ollama | `local` | Llama 3 70B, CodeLlama | Self-hosted local inference |

> **MVP Simulation Note:** Endpoints are stored in records for architectural fidelity, but **no real HTTP requests are made**. All agent "execution" is simulated with `setTimeout` delays and pre-defined mock output. The intelligence system demonstrates that providers/models are first-class protocol entities with DIDs — not that it calls real LLMs.

---

## Intelligence Providers

### Provider 1: GitHub Models

| Field | Value |
|-------|-------|
| `handle` | `github-models.mycelium.local` |
| `displayName` | `GitHub Models` |
| `providerType` | `cloud` |
| `endpoint` | `https://api.github.com/models` |
| `operator.name` | `GitHub` |
| `operator.contactUri` | `https://github.com` |
| `trustSignals.verified` | `true` |
| `trustSignals.uptime` | `99.9` |
| `trustSignals.dataRetentionPolicy` | `"minimal"` |

**What it represents:** GitHub's unified cloud AI gateway aggregating models from Anthropic, OpenAI, Microsoft, and Meta under a single API. In production, authenticate with a GitHub PAT (`Authorization: Bearer ${GITHUB_TOKEN}`). In MVP, endpoint is stored metadata only.

**Record construction (bootstrap):**
```typescript
const githubModelsRecord: IntelligenceProvider = {
  $type: "network.mycelium.intelligence.provider",
  did: githubModelsIdentity.did,
  name: "GitHub Models",
  providerType: "cloud",
  description: "Unified cloud gateway aggregating models from Anthropic, OpenAI, Microsoft, Meta, and other providers through GitHub's API.",
  endpoint: "https://api.github.com/models",
  operator: { name: "GitHub", contactUri: "https://github.com" },
  modelsOffered: [],  // Populated after model DIDs are generated (step 8 of bootstrap)
  trustSignals: { verified: true, uptime: 99.9, dataRetentionPolicy: "minimal" },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
```

---

### Provider 2: Local Ollama

| Field | Value |
|-------|-------|
| `handle` | `ollama.mycelium.local` |
| `displayName` | `Local Ollama` |
| `providerType` | `local` |
| `endpoint` | `http://localhost:11434` |
| `operator.name` | `Mycelium Demo` |
| `operator.contactUri` | `mailto:demo@mycelium.network` |
| `trustSignals.verified` | `false` |
| `trustSignals.uptime` | `95.0` |
| `trustSignals.dataRetentionPolicy` | `"none"` |

**What it represents:** Self-hosted open-source model inference. In production, Ollama listens at `http://localhost:11434` with no auth header required. In MVP, endpoint is stored metadata only.

**Record construction (bootstrap):**
```typescript
const ollamaRecord: IntelligenceProvider = {
  $type: "network.mycelium.intelligence.provider",
  did: ollamaIdentity.did,
  name: "Local Ollama",
  providerType: "local",
  description: "Self-hosted local AI inference. Serves open-source models without external API dependencies.",
  endpoint: "http://localhost:11434",
  operator: { name: "Mycelium Demo", contactUri: "mailto:demo@mycelium.network" },
  modelsOffered: [],  // Populated after model DIDs are generated (step 8 of bootstrap)
  trustSignals: { verified: false, uptime: 95.0, dataRetentionPolicy: "none" },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
```

---

## Intelligence Models

All 6 models have DIDs generated at bootstrap using `generateIdentity()`. Below is the full specification.

### Model Summary Table

| # | `slug` (rkey) | `name` | `modelOrigin` | Provider | `contextWindow` | `costTier` |
|---|---------------|--------|---------------|----------|-----------------|------------|
| 1 | `claude-sonnet-4` | Claude Sonnet 4 | Anthropic | GitHub Models | 200000 | `standard` |
| 2 | `claude-haiku-4` | Claude Haiku 4 | Anthropic | GitHub Models | 200000 | `standard` |
| 3 | `gpt-4` | GPT-4 | OpenAI | GitHub Models | 128000 | `standard` |
| 4 | `phi-4` | Phi-4 | Microsoft | GitHub Models | 16384 | `free` |
| 5 | `llama-3-70b` | Llama 3 70B | Meta | Local Ollama | 8192 | `free` |
| 6 | `codellama` | CodeLlama | Meta | Local Ollama | 4096 | `free` |

> **`modelOrigin` is display-only.** It records the original model creator (e.g., "Anthropic") separately from `providerDid` (who serves it, e.g., GitHub Models). It is **never used in logic** — capability matching, assignment, and routing all use `providerDid` and `capabilities[]`. `modelOrigin` exists so the dashboard can show "Claude Sonnet 4 by Anthropic via GitHub Models" without mixing up provider and creator.

---

### Model 1: Claude Sonnet 4

```typescript
{
  $type: "network.mycelium.intelligence.model",
  did: claudeSonnet4Identity.did,           // generated at bootstrap
  providerDid: githubModelsIdentity.did,
  name: "Claude Sonnet 4",
  slug: "claude-sonnet-4",
  version: "2026-03",
  modelOrigin: "Anthropic",
  capabilities: ["code-generation", "code-review", "architecture-design", "reasoning", "analysis"],
  domains: ["frontend", "backend", "architecture", "testing", "security"],
  contextWindow: 200000,
  constraints: { maxTokensPerRequest: 8192, costTier: "standard" },
  benchmarks: { "code-quality": 94, "reasoning": 92, "analysis": 91 },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}
```

**Assigned to:** atlas (primary), beacon (primary), echo (primary)

---

### Model 2: Claude Haiku 4

```typescript
{
  $type: "network.mycelium.intelligence.model",
  did: claudeHaiku4Identity.did,
  providerDid: githubModelsIdentity.did,
  name: "Claude Haiku 4",
  slug: "claude-haiku-4",
  version: "2026-03",
  modelOrigin: "Anthropic",
  capabilities: ["code-generation", "fast-inference", "summarization", "scripting"],
  domains: ["devops", "scripting", "documentation", "backend"],
  contextWindow: 200000,
  constraints: { maxTokensPerRequest: 4096, costTier: "standard" },
  benchmarks: { "code-quality": 84, "speed": 96, "summarization": 90 },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}
```

**Assigned to:** delta (primary)

---

### Model 3: GPT-4

```typescript
{
  $type: "network.mycelium.intelligence.model",
  did: gpt4Identity.did,
  providerDid: githubModelsIdentity.did,
  name: "GPT-4",
  slug: "gpt-4",
  version: "2024-11",
  modelOrigin: "OpenAI",
  capabilities: ["code-generation", "security-analysis", "analysis", "conversation"],
  domains: ["security", "backend", "general", "architecture"],
  contextWindow: 128000,
  constraints: { maxTokensPerRequest: 8192, costTier: "standard" },
  benchmarks: { "code-quality": 89, "security-analysis": 93, "reasoning": 90 },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}
```

**Assigned to:** cipher (primary)

---

### Model 4: Phi-4

```typescript
{
  $type: "network.mycelium.intelligence.model",
  did: phi4Identity.did,
  providerDid: githubModelsIdentity.did,
  name: "Phi-4",
  slug: "phi-4",
  version: "2024-12",
  modelOrigin: "Microsoft",
  capabilities: ["reasoning", "instruction-following", "code-generation", "general-purpose"],
  domains: ["general", "research", "scripting"],
  contextWindow: 16384,
  constraints: { maxTokensPerRequest: 4096, costTier: "free" },
  benchmarks: { "reasoning": 85, "instruction-following": 88 },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}
```

**Assigned to:** *(none in MVP demo — available in catalog, not assigned to a demo agent)*

---

### Model 5: Llama 3 70B

```typescript
{
  $type: "network.mycelium.intelligence.model",
  did: llama3Identity.did,
  providerDid: ollamaIdentity.did,
  name: "Llama 3 70B",
  slug: "llama-3-70b",
  version: "2024-07",
  modelOrigin: "Meta",
  capabilities: ["code-generation", "conversation", "general-purpose", "local-first"],
  domains: ["general", "frontend", "backend"],
  contextWindow: 8192,
  constraints: { maxTokensPerRequest: 4096, costTier: "free" },
  benchmarks: { "code-quality": 76, "reasoning": 78, "general": 82 },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}
```

**Assigned to:** forge (primary)

---

### Model 6: CodeLlama

```typescript
{
  $type: "network.mycelium.intelligence.model",
  did: codeLlamaIdentity.did,
  providerDid: ollamaIdentity.did,
  name: "CodeLlama",
  slug: "codellama",
  version: "2023-08",
  modelOrigin: "Meta",
  capabilities: ["code-generation", "code-completion", "local-first"],
  domains: ["backend", "scripting", "devops"],
  contextWindow: 4096,
  constraints: { maxTokensPerRequest: 2048, costTier: "free" },
  benchmarks: { "code-quality": 74, "code-completion": 83 },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}
```

**Assigned to:** *(none in MVP demo — available in catalog, not assigned to a demo agent)*

---

## Agent-to-Model Assignment Table

This is the **fixed assignment** used throughout the MVP demo. It is defined in `src/agents/roster.ts` and does not change at runtime.

| Agent | Handle | `intelligenceRefs[0].modelDid` | Model | Provider | Rationale |
|-------|--------|-------------------------------|-------|----------|-----------|
| atlas | `atlas.mycelium.local` | `claudeSonnet4Identity.did` | Claude Sonnet 4 | GitHub Models | Frontend design requires strong code-gen + architecture reasoning |
| beacon | `beacon.mycelium.local` | `claudeSonnet4Identity.did` | Claude Sonnet 4 | GitHub Models | Backend API benefits from deep code-gen + analysis |
| cipher | `cipher.mycelium.local` | `gpt4Identity.did` | GPT-4 | GitHub Models | Security analysis maps to GPT-4's strengths in the demo |
| delta | `delta.mycelium.local` | `claudeHaiku4Identity.did` | Claude Haiku 4 | GitHub Models | DevOps/scripting tasks suit fast inference (haiku) |
| echo | `echo.mycelium.local` | `claudeSonnet4Identity.did` | Claude Sonnet 4 | GitHub Models | QA/testing needs detail-oriented, analytical reasoning |
| forge | `forge.mycelium.local` | `llama3Identity.did` | Llama 3 70B | Local Ollama | Generalist local model; illustrates local/cloud provider split |

**How `intelligenceRefs` is populated in each agent profile:**
```typescript
// Example: atlas agent profile
intelligenceRefs: [{
  modelDid: claudeSonnet4Identity.did,
  providerDid: githubModelsIdentity.did,
  role: "primary",
  usedFor: ["code-generation", "code-review", "architecture-design"],
}]
```

**Each demo agent has exactly 1 entry in `intelligenceRefs` (primary model only).** Secondary/specialized refs are reserved for future use.

---

## Intelligence Bootstrap Function

**File:** `src/intelligence/index.ts`

```typescript
// Core operations:
// - bootstrapIntelligence(firehose) → IntelligenceBootstrapResult
//     Creates both providers + all 6 models. Returns all identities and repos.
// - createProvider(identity, record, firehose) → { identity, repo }
// - createModel(providerRepo, modelIdentity, record, firehose) → { identity }
// - listModels(providerDid) → IntelligenceModel[]
// - resolveModelDid(slug) → string  (DID lookup by slug)

interface IntelligenceBootstrapResult {
  providers: {
    githubModels: { identity: AgentIdentity; repo: AgentRepository };
    ollama: { identity: AgentIdentity; repo: AgentRepository };
  };
  models: {
    claudeSonnet4: AgentIdentity;
    claudeHaiku4: AgentIdentity;
    gpt4: AgentIdentity;
    phi4: AgentIdentity;
    llama3: AgentIdentity;
    codellama: AgentIdentity;
  };
}
```

The `bootstrapIntelligence()` function is called **after** the Firehose exists and Mayor's subscription is active. See [Bootstrap Sequence in IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md#bootstrap-sequence).

---

## Capability Tag Vocabulary

All capability tags are **kebab-case, lowercase, exact match**. The MVP uses a **closed vocabulary** — no tags outside this list are valid. Tag matching in the orchestrator is string equality only (`===`).

### Model Capability Tags (used in `intelligence.model.capabilities[]`)

| Tag | Meaning |
|-----|---------|
| `code-generation` | Writing new code |
| `code-review` | Reviewing and critiquing existing code |
| `code-completion` | Completing partial code (fill-in-the-middle style) |
| `architecture-design` | Designing system architecture and interfaces |
| `security-analysis` | Identifying and fixing security vulnerabilities |
| `analysis` | Analyzing systems, code, or data |
| `reasoning` | Multi-step logical and chain-of-thought reasoning |
| `fast-inference` | Low-latency response generation |
| `summarization` | Condensing information into shorter form |
| `conversation` | Natural language dialogue |
| `instruction-following` | Executing structured instructions precisely |
| `scripting` | Writing shell scripts and automation |
| `general-purpose` | Broad non-specialized capability |
| `local-first` | Runs without external API (privacy-preserving) |

### Agent Capability Tags (used in `agent.capability.tags[]` and `task.posting.requiredCapabilities[].tags[]`)

| Tag | Meaning |
|-----|---------|
| `react` | React components and hooks |
| `typescript` | TypeScript / type-safety patterns |
| `css` | CSS, layouts, theming |
| `accessibility` | WCAG/a11y compliance |
| `responsive-design` | Mobile-first / responsive layouts |
| `node-js` | Node.js server-side development |
| `api-design` | REST/GraphQL API design |
| `authentication` | Auth flows (JWT, OAuth, sessions) |
| `encryption` | Cryptographic operations |
| `vulnerability-assessment` | Security auditing and pen testing |
| `database-design` | Database schema, queries, migrations |
| `docker` | Docker containers and Compose |
| `ci-cd` | CI/CD pipelines (GitHub Actions, etc.) |
| `monitoring` | Observability, logging, alerting |
| `deployment` | Deploying to staging/production |
| `unit-testing` | Unit tests (vitest, jest) |
| `integration-testing` | Integration and API tests |
| `e2e-testing` | End-to-end tests (Playwright, Cypress) |
| `websocket` | WebSocket / SSE real-time streams |
| `components` | UI component library |
| `hooks` | React hooks patterns |
| `frontend` | General frontend development |
| `backend` | General backend development |
| `security` | General security practice |
| `devops` | General infrastructure operations |
| `testing` | General testing practice |

**Tag overlap scoring** (used in capability matching algorithm):
```typescript
tagOverlap = intersect(matchingCap.tags, requiredCap.tags).length / requiredCap.tags.length
// Returns 0.0 to 1.0. A value of 0 disqualifies the agent (shouldClaim returns false).
// Example: requiredCap.tags = ["react", "typescript"]
//          agent.tags = ["react", "typescript", "css"]
//          tagOverlap = 2/2 = 1.0 (perfect match)
```

---

## Demo Agent Capability Records

The following capability slugs (rkeys) are written to each agent's repository at bootstrap. They are referenced by the task decomposition template to match tasks to agents.

| Agent | Capability rkey | Domain | Tags | Proficiency |
|-------|----------------|--------|------|-------------|
| atlas | `react-development` | frontend | `react`, `typescript`, `components` | `expert` |
| atlas | `css-design` | frontend | `css`, `responsive-design` | `advanced` |
| atlas | `accessibility` | frontend | `accessibility` | `expert` |
| beacon | `api-design` | backend | `api-design`, `node-js` | `expert` |
| beacon | `node-development` | backend | `node-js`, `backend` | `expert` |
| beacon | `database-design` | backend | `database-design` | `advanced` |
| cipher | `authentication` | security | `authentication`, `backend` | `expert` |
| cipher | `encryption` | security | `encryption` | `advanced` |
| cipher | `vulnerability-assessment` | security | `vulnerability-assessment`, `security` | `advanced` |
| delta | `docker-containerization` | devops | `docker`, `devops` | `expert` |
| delta | `ci-cd-pipelines` | devops | `ci-cd` | `expert` |
| delta | `monitoring` | devops | `monitoring` | `advanced` |
| echo | `unit-testing` | testing | `unit-testing`, `testing` | `expert` |
| echo | `integration-testing` | testing | `integration-testing` | `expert` |
| echo | `e2e-testing` | testing | `e2e-testing` | `advanced` |
| forge | `react-development` | frontend | `react`, `frontend` | `intermediate` |
| forge | `api-design` | backend | `api-design` | `intermediate` |
| forge | `database-design` | backend | `database-design` | `beginner` |

**Forge's explicit proficiency levels:** `react-development` = intermediate, `api-design` = intermediate, `database-design` = beginner. These are lower than specialists (who are `advanced` or `expert`), making the orchestrator rank specialists higher for matching tasks.
