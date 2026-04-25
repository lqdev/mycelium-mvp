---
title: "Knowledge and Tool Providers as AT Protocol Participants"
description: "Pattern for giving knowledge bases and tools sovereign DID identity with audit trails on the AT Protocol relay — closing the provenance gap in AI agent orchestration"
entry_type: reference
published_date: "2025-04-24 20:00 UTC"
last_updated_date: "2025-04-24 20:00 UTC"
tags: "at-protocol, distributed-systems, ai-collaboration, patterns, architecture"
related_skill: ""
source_project: "mycelium-mvp"
---

# Knowledge and Tool Providers as AT Protocol Participants

## Overview

AI agent orchestration systems track *who* made a decision and *what* the outcome was. Missing from every major framework (RAG, MCP, LangChain): **what knowledge informed the decision and what tools were invoked**. This pattern closes that gap by giving knowledge bases and tools sovereign DID identity, publishing their contents as AT Protocol records, and writing every query/invocation to the relay as a signed audit record.

The result: every agent decision is fully auditable — not just by the orchestrating mayor, but by any participant subscribed to the relay.

## Key Components

### Symmetrical ecosystems

Two parallel schemas with identical structure:

```
Knowledge                          Tools
─────────────────────────────      ─────────────────────────────
knowledge.provider  (identity)     tool.provider  (identity)
knowledge.document  (contents)     tool.definition (contents)
knowledge.query     (audit trail)  tool.invocation (audit trail)
```

Each ecosystem: **who the service is** (provider) + **what it offers** (document/definition) + **what was done** (query/invocation).

### DID-first design

Every knowledge base and tool provider has a `did:key` identity generated at bootstrap. This identity:
- Signs AT Protocol records
- Is referenced in `knowledge.query.providerDid` and `tool.invocation.toolDid`
- Flows into `ReputationStamp.knowledgeRefs` and `toolRefs`
- Accumulates reputation the same way agent DIDs do

### knowledge.document as content-addressed primitive

`knowledge.document` records published to a PDS repo get a CID from the MST (Merkle Search Tree). These CIDs flow into `knowledge.query.contextCids`, enabling any observer to verify which specific documents informed an agent's answer — not just "I consulted KB X" but "I used these specific document versions, here are their CIDs."

This is the IPKS vision ([github.com/lqdev/IPKS](https://github.com/lqdev/IPKS)) implemented using AT Protocol primitives natively.

### Three verification levels

| Level | Name | Meaning |
|-------|------|---------|
| 1 | `claimed` | "I assert I queried this KB" — no cryptographic verification |
| 2 | `cid` | "Here are the document CIDs I used" — resolvable via AT URIs |
| 3 | `proof` | MST `verifyRecordProof()` — cryptographic proof document existed at query time |

Levels 1 and 2 are in production. Level 3 requires `com.atproto.sync.getRecord` + CAR verification.

### Reputation lock-in via Mayor stamp

After task completion, the Mayor writes a `reputation.stamp` that includes:
```typescript
knowledgeRefs: [{ providerDid, queryHash, verificationLevel }]
toolRefs: [{ toolDid, toolUri, success }]
```

The `toolUri` is the AT URI of the specific `tool.definition` record — not a bare name. This means: given any stamp, you can resolve the exact tool interface that was used, on the relay, at any point in the future.

## Graceful Degradation Pattern

All provider calls are isolated in individual `try/catch` blocks. A single failing provider never blocks:
- Other providers in the same execution
- The overall task execution  
- The completion record or Mayor stamp

```typescript
for (const kb of kbProviders) {
  const result = await queryKnowledgeProvider(kb, question).catch(() => null);
  // null → skip this KB, write failed knowledge.query, continue
}
```

This is the right pattern for any optional capability that runs on external infrastructure.

## Mock → Live Progression

| Mode | Config | Behavior |
|------|--------|---------|
| Demo (default) | No env vars | 3 seed documents + keyword matching; 3 built-in tools; mock invocations always succeed |
| Live KB | `KB_ENDPOINT=https://...` | Real NL queries to `/api/ask`; document index from `/api/documents` |
| Live tools | `TOOL_ENDPOINT=https://...` | Real invocations to `/api/invoke`; tool discovery from `/api/tools` |

Mock mode provides enough behavior to show `knowledge.query` and `tool.invocation` events in the dashboard without any external dependencies.

## AT Protocol PDS as Content-Addressed Store

AT Protocol's MST gives every record in a PDS repo a CID automatically. No additional infrastructure needed for content addressing — `knowledge.document` records become CID-addressable by virtue of being in a PDS. Contrast:

- IPFS: global addressing, no identity layer
- Git: SHA-addressed, no DID anchor
- AT Protocol MST: CID-addressed + DID-anchored + relay-discoverable = all three properties

`verifyRecordProof()` in `@atproto/repo` can cryptographically verify that a record with a given CID existed in a repo at a given point in time — Level 3 verification without additional infrastructure.

## Dashboard Integration

Event stream shows:
- 🟣 `knowledge.query` — per-query audit events (provider DID, query hash, verification level)
- 🟠 `tool.invocation` — per-invocation audit events (tool DID, tool URI, success/failure)
- 🔵 `knowledge.document` — at bootstrap, seed document records appear
- 🔵 `tool.definition` — at bootstrap, tool definition records appear

`/api/status` exposes `knowledgeProviders` and `toolProviders` arrays with DID, name, and count.

## Comparison with Alternatives

| Approach | Identity | Audit | Reputation | Verification |
|----------|----------|-------|------------|-------------|
| RAG + vector DB | ❌ None | ❌ None | ❌ None | ❌ |
| MCP Resources | ❌ No DID | ❌ Ephemeral | ❌ None | ❌ |
| This pattern | ✅ DID per KB/tool | ✅ Relay records | ✅ Via stamp refs | ✅ L1/L2/L3 |

## Future: Phase 16b

- PDS-backed KB as a Docker node: real MST CIDs in `contextCids`
- Level 3 proof verification: `com.atproto.sync.getRecord` → `verifyRecordProof()`
- KB reputation aggregation: score KBs by completion quality of tasks they informed
- `forms[]` (WoT pattern): multi-binding providers (HTTP + AT Protocol native)
