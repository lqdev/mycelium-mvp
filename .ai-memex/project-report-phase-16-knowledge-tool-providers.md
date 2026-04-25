---
title: "Phase 16: Knowledge & Tool Providers as First-Class AT Protocol Participants"
description: "How Phase 16 closed the provenance gap by giving knowledge sources and tool services their own DIDs, record types, and audit trails"
entry_type: project-report
published_date: "2026-04-24 20:38 CDT"
last_updated_date: "2026-04-24 20:38 CDT"
tags: "typescript, atproto, architecture, patterns, ai-collaboration"
source_project: "mycelium-mvp"
---

# Phase 16: Knowledge & Tool Providers as First-Class AT Protocol Participants

## Objective

Close the provenance gap in the Mycelium reputation system. Phases 1–15 tracked:
- **WHO** made the decision (agent DID)
- **WHICH MODEL** was used (intelligence.model DID)
- **WHAT** the outcome was (task.completion)

But not: **WHAT KNOWLEDGE** informed the decision, or **WHICH TOOLS** were invoked.
A model given wrong context gives wrong answers — we were stamping the model but not the knowledge source.

## Approach

Treat knowledge providers and tool providers the same way we treated intelligence providers in Phase 10: **give them DIDs**, make them first-class network participants, write their records to the AT Protocol PDS, and include audit references in reputation stamps.

The pattern mirrors `src/intelligence/index.ts` exactly:

```
knowledge/index.ts  →  bootstrapKnowledgeProviders() + queryKnowledgeProvider()
tools/index.ts      →  bootstrapToolProviders() + invokeToolProvider() + selectTool()
```

Each provider gets a `knowledge.provider` or `tool.provider` record in its own repo. Individual items (documents, tool definitions) get their own records with content-hash rkeys. Every access writes an audit record (`knowledge.query` or `tool.invocation`). Reputation stamps carry `knowledgeRefs` and `toolRefs`.

## What Shipped

- **6 new record types** (9 → 15 total across 6 domains):
  - `network.mycelium.knowledge.provider`
  - `network.mycelium.knowledge.document`
  - `network.mycelium.knowledge.query`
  - `network.mycelium.tool.provider`
  - `network.mycelium.tool.definition`
  - `network.mycelium.tool.invocation`

- **`src/knowledge/index.ts`** — Bootstrap, seed documents, keyword query with graceful degradation. Mock mode: 3 seed documents (AT Protocol overview, agent capabilities, verification levels). Live mode: `KB_ENDPOINT` env var routes to HTTP endpoint.

- **`src/tools/index.ts`** — Bootstrap, 3 built-in tool definitions, invocation with graceful degradation. Mock mode: general-assistance, code-analysis, test-runner always return `{ success: true }`. Live mode: `TOOL_ENDPOINT` env var routes to HTTP endpoint.

- **Engine wiring** (`src/agents/engine.ts`) — 4-phase `executeTask()`:
  1. KB query loop (one per registered provider)
  2. LLM call with knowledge-augmented prompt
  3. Tool invocation loop
  4. Completion with `knowledgeUsed`/`toolsUsed`

- **Mayor stamp extensions** — `createStamp()` now accepts `knowledgeRefs?` and `toolRefs?`

- **Dashboard** — CSS event badges for knowledge (indigo `#8b94ff`) and tool (orange `#ffa500`) events; `/api/status` exposes provider metadata

- **31 new tests** (348 → 433 total, all passing)

- **ADR-004** (`docs/ADR/ADR-004-knowledge-and-tool-providers.md`) — Full architectural record

## Key Technical Decisions

**Verification levels:**
- `claimed` — agent asserts it queried the KB; no CIDs
- `cid` — agent provides specific `knowledge.document` AT URIs (stand-ins for real MST CIDs)

When a PDS stores `knowledge.document` records, the Merkle Search Tree assigns real CIDs automatically — enabling content-addressable verification against the MST. This future-proofs Phase 16 for Phase 16b (real CID verification).

**Content-hash rkeys:**
Document rkeys are `doc-{sha256prefix}` derived from content. This gives deduplication for free: uploading the same document twice is a no-op (same rkey → overwrite).

**Graceful degradation:**
Every KB/tool call is individually wrapped in `try/catch`. A failing provider never blocks other providers, the LLM call, or the completion record. This is critical for production readiness.

**Mock-to-live progression:**
Zero config required — mock providers run automatically. Setting `KB_ENDPOINT` / `TOOL_ENDPOINT` env vars switches to live endpoints with a 5s timeout and silent fallback to mock on failure.

## Lessons Learned

1. **DID-first for every participant** — giving knowledge sources and tools their own DIDs was the right call. It means they accumulate reputation over time, can be verified, and are auditable as first-class network participants rather than opaque services.

2. **Content-addressing aligns naturally with AT Protocol** — PDS MST gives you CIDs for free when you store records. Phase 16's `contextCids` field anticipates this; Phase 16b can upgrade verification without schema changes.

3. **Symmetric module design pays off** — mirroring `intelligence/index.ts` structure for both `knowledge/index.ts` and `tools/index.ts` made reasoning about the system much easier and kept tests consistent.

4. **Graceful degradation as a first-class requirement** — not an afterthought. Wrapping every external call individually (not just the whole KB phase) means partial failures degrade gracefully rather than catastrophically.

5. **`BootstrappedKnowledgeProvider.documentUris` is a `Map`** — access count via `.documentUris.size`, not `.documentCount`. Similarly `.provider.name` not `.name`. Type shape matters for dashboard wiring.

## Outcome

433 tests, 15 record types, full provenance chain (agent DID + model DID + knowledge provider DID + tool definition AT URI). Merged to `main`. Phase 17 will add composable trust (requester stamps, peer review, multi-attestor aggregation).
