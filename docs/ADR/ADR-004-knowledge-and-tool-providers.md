# ADR-004: Knowledge Providers and Tool Providers as First-Class AT Protocol Participants

**Status:** Accepted  
**Branch:** `feat/phase-16-providers`  
**Date:** 2025-04-24

---

## Context

Mycelium MVP tracks *who* made a decision (agent DID), *which model* executed it (intelligence.model DID), and *what* the outcome was (task.completion record). One provenance dimension is missing: **what knowledge informed the decision and what tools were invoked**.

A model given wrong context gives wrong answers. Stamping the model but not the knowledge source means reputation systems can propagate trust without basis — if the knowledge base is wrong, the responsible party is invisible. The same gap exists for tool use: tool invocations are ephemeral HTTP calls with no AT Protocol identity, no audit trail, and no accumulated track record.

### Why existing approaches fall short

| Approach | Identity | Audit trail | Reputation |
|----------|----------|-------------|------------|
| RAG / vector DB | None (opaque endpoint) | None | None |
| MCP Resources | None (no DID for resource servers) | Ephemeral | None |
| LangChain/LangGraph tools | None | Opaque | None |
| Semantic Web / SPARQL | URI-based, no trust layer | Minimal | None |

**What Mycelium adds**: every knowledge base and tool provider has a DID, every query and invocation is a signed AT Protocol record on the relay, and KB/tool reputation accumulates the same way agent reputation does.

---

## Decision

Phase 16 introduces two symmetrical ecosystems of six new AT Protocol record types:

### Knowledge ecosystem

| Record type | Purpose |
|-------------|---------|
| `network.mycelium.knowledge.provider` | KB identity — DID, endpoint, capabilities, domains |
| `network.mycelium.knowledge.document` | Individual knowledge item — CID-addressable when in a PDS |
| `network.mycelium.knowledge.query` | Audit record per KB consultation, with optional `contextCids` |

### Tool ecosystem

| Record type | Purpose |
|-------------|---------|
| `network.mycelium.tool.provider` | Tool service identity — DID, endpoint |
| `network.mycelium.tool.definition` | Individual tool schema — like MCP tool discovery but on the relay |
| `network.mycelium.tool.invocation` | Audit record per tool call, references `tool.definition` AT URI |

### ReputationStamp extensions

`ReputationStamp` gains two optional fields:
- `knowledgeRefs?: Array<{ providerDid, queryHash, verificationLevel }>` — which KBs were consulted
- `toolRefs?: Array<{ toolDid, toolUri, success }>` — which tools were invoked

The Mayor passes these from `TaskCompletion` into the issued stamp, locking provenance into reputation.

---

## Verification levels

Three levels of KB verification were designed:

| Level | Name | How | Implemented |
|-------|------|-----|-------------|
| 1 | `claimed` | Agent asserts it queried a KB, no verification | ✅ Phase 16 |
| 2 | `cid` | Agent provides CIDs of `knowledge.document` records used | ✅ Phase 16 |
| 3 | `proof` | MST `verifyRecordProof()` cryptographic verification | ⏳ Phase 16b |

`verificationLevel: 'cid'` is set automatically when the KB response includes `contextCids`. Level 2 is activated when the KB endpoint returns document CIDs — the mock provider in demo mode returns AT URIs of seed `knowledge.document` records as stand-ins.

Level 3 deferred to Phase 16b: it requires running `com.atproto.sync.getRecord` to fetch a CAR file, then calling `verifyRecordProof()` against the MST root. Infrastructure cost exceeds MVP value.

---

## Why `knowledge.document` is not deferred

Without `knowledge.document`, `knowledge.provider` is just "here's an HTTP endpoint." The audit value of `knowledge.query` is limited to `verificationLevel: 'claimed'` — "I assert I called this URL." 

With `knowledge.document` published to a PDS repo, each document has a CID assigned by the MST. `contextCids` in the query record lets any participant resolve those CIDs and verify the content existed at the time of the query. This is the IPKS vision — a "trusted source of truth" primitive — implemented using AT Protocol MST natively rather than requiring new infrastructure.

AT Protocol PDS as a content-addressed store: every record in a PDS repo has a CID in the MST. Any record's existence at a point in time is provable via `verifyRecordProof()`. `knowledge.document` records leverage this property for free.

---

## Why `tool.definition` is not deferred

Tool definitions are the "inventory" of what a tool provider offers. Without them, `tool.invocation` is "I called something, somewhere" — no schema for what was called, no way to verify the invocation matches the advertised interface. With `tool.definition` records:

- Each tool has an AT URI → invocation records reference it directly
- Tool interfaces are on the relay → auditable by any participant
- This mirrors MCP tool discovery (server publishes tool list → client discovers → client invokes), but every tool has a DID and every invocation hits the relay

---

## Why `forms[]` is deferred

The Web of Things `forms[]` pattern describes multiple protocol bindings for the same capability (HTTP REST, WebSocket, AT Protocol native, MQTT). It is only valuable when a provider has more than one binding. All Phase 16 providers use HTTP REST — one binding, nothing to describe. `forms[]` is deferred to Phase 16b, when providers with multiple bindings (e.g., HTTP + PDS-native) are introduced.

---

## Architecture: Graceful degradation

All KB queries and tool invocations in `engine.ts` `executeTask()` are wrapped in individual `try/catch` blocks. A failure in one KB or tool provider never blocks:
- Other providers in the same execution
- The overall task execution
- The completion record or Mayor stamp

If no providers are configured or all fail, the task executes as if Phase 16 does not exist. The `knowledgeRefs` and `toolRefs` fields in the completion and stamp are simply absent.

---

## Architecture: Mock vs. live mode

| Env var | Effect |
|---------|--------|
| (none) | Mock KB provider with 3 seed documents; mock tool provider with 3 tool definitions |
| `KB_ENDPOINT=https://...` | Live HTTP queries to `/api/ask`; fetch document index from `/api/documents` |
| `TOOL_ENDPOINT=https://...` | Live HTTP invocations to `/api/invoke`; fetch tool list from `/api/tools` |

Mock mode always provides something queryable (seed documents, always-succeeding tools) so the demo shows real knowledge.query and tool.invocation events even without external infrastructure.

---

## Content-addressing taxonomy

AT Protocol MST is one of several content-addressing systems. Context for Phase 16b decisions:

| System | CID type | Verification | Notes |
|--------|----------|-------------|-------|
| Git | SHA-1/SHA-256 blob hash | Direct hash check | Mutable refs (branches) over immutable content |
| IPFS/IPLD | CIDv1 (multihash) | Merkle DAG traversal | Global addressability, no identity layer |
| AT Protocol MST | CIDv1 (sha2-256) | `verifyRecordProof()` | Per-repo Merkle tree, DID-anchored |
| Ceramic | CIDv1 (dag-jose) | DID-signed streams | Mutable streams with verifiable history |
| IPKS | CIDv1 | MST-backed | Knowledge-specific AT Protocol extension |
| Perkeep | SHA-224 (blobref) | Content hash | Personal storage, not federated |

AT Protocol is the right choice for Mycelium: it combines content-addressing (MST CIDs) with DID-anchored identity and a relay for discoverability — the three things RAG/MCP/LangChain lack.

---

## Alignment with IPKS

[IPKS](https://github.com/lqdev/IPKS) and [markdown-ld-kb](https://github.com/lqdev/markdown-ld-kb) explore knowledge graphs as AT Protocol records. Phase 16's `knowledge.document` is the minimal version of this vision: a document published to a PDS repo gets a CID from the MST, the CID can be referenced in `contextCids`, and verification is possible via `verifyRecordProof()`. Phase 16b could integrate a PDS-backed KB node as a Docker service that serves documents queryable via `KB_ENDPOINT`.

---

## Phase 16b backlog

- **PDS-backed KB node**: third Docker service in `docker-compose.federation.yml`; agents push `knowledge.document` records to PDS-C; CIDs from MST populate `contextCids` automatically
- **Level 3 proof verification**: `com.atproto.sync.getRecord` → CAR + MST proof → `verifyRecordProof()` per document CID
- **`forms[]` bindings**: WoT-style multi-binding descriptions when providers support both HTTP and AT Protocol native access
- **Complex tool orchestration**: cancel, retry, state callbacks for long-running tool executions
- **KB reputation**: aggregate `knowledge.query` results per KB DID → surface in dashboard + affect task routing (avoid KBs with poor track records)

---

## Consequences

**Positive:**
- Every agent decision is now fully auditable: WHO (agent DID) + WHICH MODEL (intelligence.model DID) + WHAT KNOWLEDGE (knowledge.query → knowledge.document CIDs) + WHICH TOOLS (tool.invocation → tool.definition AT URI)
- Mayor stamps lock all provenance into reputation — bad knowledge source → bad outcome → KB reputation falls
- Graceful degradation means Phase 16 adds zero risk to existing task execution
- Mock mode provides demo-ready providers with zero external dependencies
- The schema supports Level 1, 2, and 3 verification — Level 3 infrastructure is the only remaining piece

**Negative / trade-offs:**
- 6 new record types increases schema surface (9 → 15); each adds a Zod schema, lexicon doc, and TypeScript interface
- KB queries add latency before the LLM call (5s timeout per provider; fails silently)
- Tool invocations add latency after the LLM call (5s timeout per provider; fails silently)
- Knowledge.document records are currently populated only from seed data or `/api/documents` index fetch — not from live document writes during agent execution

---

## Files changed

| File | Change |
|------|--------|
| `src/schemas/types.ts` | 6 new interfaces; `ReputationStamp` extended |
| `src/schemas/index.ts` | 6 Zod schemas; count 9 → 15 |
| `src/lexicon/index.ts` | 6 lexicon docs; count 9 → 15 |
| `src/knowledge/index.ts` | New module: bootstrap + query |
| `src/tools/index.ts` | New module: bootstrap + invocation + selectTool |
| `src/agents/engine.ts` | 4-phase executeTask: KB query → LLM → tool invocation → completion |
| `src/orchestrator/wanted-board.ts` | `CompletionResults` extended with optional KB/tool refs |
| `src/reputation/index.ts` | `createStamp()` accepts `knowledgeRefs` + `toolRefs` |
| `src/orchestrator/mayor.ts` | Both stamp calls pass KB/tool refs from completion |
| `src/demo/dashboard/server.ts` | Bootstrap KB/tool providers; wire into runners; expose in `/api/status` |
| `src/demo/dashboard/public/app.js` | `classifyCollection` + `describeEvent` for 6 new types |
| `src/demo/dashboard/public/style.css` | CSS rules for `.event-type.knowledge` and `.event-type.tool` |
| `src/knowledge/knowledge.test.ts` | New: 17 tests |
| `src/tools/tools.test.ts` | New: 16 tests |
