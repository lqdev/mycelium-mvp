# Mycelium MVP — End-to-End Demo Scenario

> Detailed walkthrough of what the demo does, what the user sees, and what each step proves about the architecture.

---

## Scenario: "Build the Mycelium Dashboard"

A human operator asks an orchestrator to build a web dashboard. The orchestrator decomposes the work, posts tasks to the Wanted Board, and a team of specialized agents coordinate to deliver the project — all using the Mycelium protocol stack.

---

## Act 1: Bootstrap — "The Agents Awaken"

### What Happens
```
1. Generate 6 agent identities (Ed25519 keypairs → did:key DIDs)
2. Create per-agent SQLite repositories
3. Each agent writes their profile record
4. Each agent writes their capability records
5. Firehose broadcasts all record creation events
```

### Console Output
```
═══════════════════════════════════════════════════════════
  MYCELIUM MVP — Federated Agent Orchestration Demo
═══════════════════════════════════════════════════════════

⚡ Bootstrapping agent network...

  🤖 atlas    did:key:z6MkhaX...doK  Frontend Specialist
     ├── react-development (expert)
     ├── css-design (advanced)
     └── accessibility (expert)

  🤖 beacon   did:key:z6MknRB...e4P  Backend Engineer
     ├── api-design (expert)
     ├── node-development (expert)
     └── database-design (advanced)

  🤖 cipher   did:key:z6Mkp3L...q8R  Security Analyst
     ├── authentication (expert)
     ├── encryption (advanced)
     └── vulnerability-assessment (advanced)

  🤖 delta    did:key:z6MkwYT...m2S  DevOps Engineer
     ├── docker-containerization (expert)
     ├── ci-cd-pipelines (expert)
     └── monitoring (advanced)

  🤖 echo     did:key:z6MkjFV...n7U  QA/Testing Specialist
     ├── unit-testing (expert)
     ├── integration-testing (expert)
     └── e2e-testing (advanced)

  🤖 forge    did:key:z6MktHW...k5J  Full-Stack Generalist
     ├── react-development (intermediate)
     ├── api-design (intermediate)
     └── database-design (beginner)

  🤖 mayor    did:key:z6MkqZN...v9X  Orchestrator
     └── (subscribing to firehose...)

✅ 7 agents bootstrapped | 21 capability records | 7 repositories created
   📡 Firehose: 28 events broadcast
```

### What This Proves
- **Layer 0 (Identity):** Each agent has a unique, cryptographic DID
- **Layer 1 (Storage):** Each agent owns their data in a separate repository
- **Layer 2 (Schemas):** Profile and capability records conform to Lexicon schemas
- **Layer 3 (Federation):** All record creation events appear on the firehose

---

## Act 2: Task Posting — "The Wanted Board"

### What Happens
```
1. Mayor receives project spec: "Build the Mycelium Dashboard"
2. Mayor decomposes into 8 atomic tasks with required capabilities
3. Each task is written as a task.posting record in Mayor's repository
4. Firehose broadcasts 8 task.posting events
5. All agents receive the events and begin evaluation
```

### Console Output
```
═══════════════════════════════════════════════════════════
  📋 PROJECT: Build the Mycelium Dashboard
═══════════════════════════════════════════════════════════

🎯 Mayor decomposing project into tasks...

  ┌────┬──────────────────────────────────┬────────────┬──────────┬──────────┐
  │ #  │ Task                             │ Domain     │ Priority │ Complex. │
  ├────┼──────────────────────────────────┼────────────┼──────────┼──────────┤
  │ 1  │ Design component library         │ frontend   │ high     │ medium   │
  │ 2  │ Build REST API for agent data    │ backend    │ high     │ medium   │
  │ 3  │ Implement authentication         │ security   │ critical │ high     │
  │ 4  │ Set up CI/CD pipeline            │ devops     │ normal   │ medium   │
  │ 5  │ Create agent profile cards       │ frontend   │ normal   │ low      │
  │ 6  │ Build firehose event stream UI   │ frontend   │ high     │ high     │
  │ 7  │ Write integration tests          │ testing    │ normal   │ medium   │
  │ 8  │ Deploy to staging                │ devops     │ normal   │ low      │
  └────┴──────────────────────────────────┴────────────┴──────────┴──────────┘

  📡 8 tasks posted to Wanted Board → Firehose broadcasting...
  👁️  All agents notified of new tasks
```

### What This Proves
- **Wanted Board Protocol:** Tasks are posted as typed records, not API calls
- **Capability Tagging:** Each task declares exactly what skills are needed
- **Decoupled Discovery:** Agents learn about tasks through the firehose, not direct assignment

---

## Act 3: Discovery & Claiming — "The Agents Respond"

### What Happens
```
1. Each agent evaluates each task against their capabilities
2. Agents with matching capabilities create task.claim records
3. Some tasks receive multiple claims (competition)
4. Agents without matching capabilities skip the task
5. Claims are broadcast via firehose; orchestrator receives them
```

### Console Output
```
═══════════════════════════════════════════════════════════
  🔍 DISCOVERY & CLAIMING
═══════════════════════════════════════════════════════════

Task 1: "Design component library" (frontend/medium)
  ✋ atlas   claims → "Will use Radix UI + Tailwind, Est: 90min" (confidence: high)
  ✋ forge   claims → "Can build with React + CSS modules, Est: 2h" (confidence: medium)
  ⏭️  beacon  skips  — no frontend capabilities
  ⏭️  cipher  skips  — no frontend capabilities
  ⏭️  delta   skips  — no frontend capabilities
  ⏭️  echo    skips  — no frontend capabilities

Task 2: "Build REST API for agent data" (backend/medium)
  ✋ beacon  claims → "Fastify + Prisma, full CRUD + pagination, Est: 75min" (confidence: high)
  ✋ forge   claims → "Express + raw SQL, Est: 2h" (confidence: medium)

Task 3: "Implement authentication" (security/high)
  ✋ cipher  claims → "JWT + DID-based auth, PKCE flow, Est: 2h" (confidence: high)
  ✋ beacon  claims → "Basic JWT auth, Est: 90min" (confidence: medium)

Task 4: "Set up CI/CD pipeline" (devops/medium)
  ✋ delta   claims → "GitHub Actions, multi-stage Docker, Est: 60min" (confidence: high)

Task 5: "Create agent profile cards" (frontend/low)
  ✋ atlas   claims → "React cards with rep radar charts, Est: 45min" (confidence: high)
  ✋ forge   claims → "Simple card grid, Est: 60min" (confidence: high)

Task 6: "Build firehose event stream UI" (frontend/high)
  ✋ atlas   claims → "WebSocket + virtualized list, Est: 2h" (confidence: high)

Task 7: "Write integration tests" (testing/medium)
  ✋ echo    claims → "Vitest + Playwright, full API + UI coverage, Est: 90min" (confidence: high)

Task 8: "Deploy to staging" (devops/low)
  ✋ delta   claims → "Docker Compose to staging server, Est: 30min" (confidence: high)

📊 Summary: 14 claims across 8 tasks | 5 tasks with competition | 3 tasks single-bidder
   📡 Firehose: 14 task.claim events broadcast
```

### What This Proves
- **Capability Matching:** Agents only claim tasks they're qualified for
- **Competition:** Multiple agents can bid on the same work
- **Agent Sovereignty:** Claims are records in each agent's own repo
- **Decoupled Coordination:** No central assignment — agents self-select

---

## Act 4: Assignment — "The Mayor Decides"

### What Happens
```
1. Mayor evaluates claims for each task
2. Considers: reputation score, proficiency match, confidence level
3. Assigns the best candidate for each task
4. Updates task.posting records with assignee DID
5. Broadcasts assignment events via firehose
```

### Console Output
```
═══════════════════════════════════════════════════════════
  ⚖️  ASSIGNMENT — Mayor evaluating claims
═══════════════════════════════════════════════════════════

Task 1: "Design component library"
  📊 atlas  — rep: ★★★★☆ (82) | proficiency: expert    | confidence: high
  📊 forge  — rep: ★★☆☆☆ (newcomer) | proficiency: intermediate | confidence: medium
  ✅ ASSIGNED → atlas (higher reputation + proficiency match)

Task 2: "Build REST API"
  📊 beacon — rep: ★★★★☆ (78) | proficiency: expert    | confidence: high
  📊 forge  — rep: ★★☆☆☆ (newcomer) | proficiency: intermediate | confidence: medium
  ✅ ASSIGNED → beacon

Task 3: "Implement authentication"
  📊 cipher — rep: ★★★☆☆ (71) | proficiency: expert (security) | confidence: high
  📊 beacon — rep: ★★★★☆ (78) | proficiency: intermediate (security) | confidence: medium
  ✅ ASSIGNED → cipher (domain specialist despite lower overall rep)

Task 4: "Set up CI/CD pipeline"
  ✅ ASSIGNED → delta (sole bidder, qualified)

Task 5: "Create agent profile cards"
  📊 atlas  — rep: ★★★★☆ (82) | task load: 2 active
  📊 forge  — rep: ★★☆☆☆ (newcomer) | task load: 0 active
  ✅ ASSIGNED → forge (atlas at capacity; opportunity for newcomer on low-complexity task)

Task 6: "Build firehose event stream UI"
  ✅ ASSIGNED → atlas (sole qualified bidder for high-complexity frontend)

Task 7: "Write integration tests"
  ✅ ASSIGNED → echo (sole bidder, qualified)

Task 8: "Deploy to staging"
  ✅ ASSIGNED → delta (sole bidder, depends on Task 4)

📊 Final assignments: atlas(2) beacon(1) cipher(1) delta(2) echo(1) forge(1)
```

### What This Proves
- **Reputation-Informed Decisions:** Higher reputation wins competitive bids
- **Load Balancing:** Task load considered in assignment decisions
- **Trust Bootstrapping:** Newcomers (forge) get low-complexity tasks to build reputation
- **Domain Specialization:** Cipher wins auth task despite lower overall rep (domain expertise)

---

## Act 5: Execution & Completion — "The Work Gets Done"

### What Happens
```
1. Assigned agents "execute" their tasks (simulated with delays)
2. Each agent writes a task.completion record with artifacts and metrics
3. One task (forge's card component) is initially rejected for quality
4. Forge reworks and resubmits
5. Firehose broadcasts completion events
```

### Console Output
```
═══════════════════════════════════════════════════════════
  🔨 EXECUTION IN PROGRESS
═══════════════════════════════════════════════════════════

  ⏳ delta   working on "Set up CI/CD pipeline"... ████████░░ 80%
  ⏳ beacon  working on "Build REST API"...        ██████░░░░ 60%
  ⏳ cipher  working on "Implement authentication" ████░░░░░░ 40%
  ⏳ atlas   working on "Design component library" ████████░░ 80%
  ⏳ forge   working on "Create profile cards"     ██████░░░░ 60%

  ✅ delta   completed "Set up CI/CD pipeline"
     └─ Artifacts: Dockerfile, .github/workflows/ci.yml, docker-compose.yml
     └─ Metrics: 45min | 189 lines | 12/12 tests passing

  ✅ atlas   completed "Design component library"
     └─ Artifacts: Button.tsx, Card.tsx, Input.tsx, theme.ts, index.ts
     └─ Metrics: 82min | 534 lines | 28/28 tests | 96% coverage

  ✅ beacon  completed "Build REST API"
     └─ Artifacts: routes/agents.ts, routes/tasks.ts, db/schema.ts, middleware/auth.ts
     └─ Metrics: 71min | 412 lines | 22/22 tests | 91% coverage

  ❌ forge   completed "Create profile cards" → REJECTED BY MAYOR
     └─ Reason: Missing accessibility attributes, no keyboard navigation
     └─ 🔄 forge reworking...

  ✅ cipher  completed "Implement authentication"
     └─ Artifacts: auth/did-verify.ts, auth/jwt.ts, auth/middleware.ts, auth/pkce.ts
     └─ Metrics: 118min | 623 lines | 31/31 tests | 94% coverage

  ✅ forge   completed "Create profile cards" (REWORK) → ACCEPTED
     └─ Artifacts: AgentCard.tsx, AgentCard.test.tsx (updated with a11y)
     └─ Metrics: 35min rework | 198 lines | 14/14 tests | 88% coverage

  ✅ atlas   completed "Build firehose event stream UI"
     └─ Artifacts: FirehoseStream.tsx, useFirehose.ts, EventCard.tsx
     └─ Metrics: 105min | 487 lines | 19/19 tests | 92% coverage

  ✅ echo    completed "Write integration tests"
     └─ Artifacts: tests/api.test.ts, tests/auth.test.ts, tests/e2e.spec.ts
     └─ Metrics: 88min | 756 lines | 47/47 tests passing

  ✅ delta   completed "Deploy to staging"
     └─ Artifacts: deploy.sh, docker-compose.staging.yml
     └─ Metrics: 28min | 87 lines | deployment verified

═══════════════════════════════════════════════════════════
  ✅ PROJECT COMPLETE — 8/8 tasks delivered
  ⏱️  Total elapsed: ~12 minutes (simulated: ~8 hours)
  📦 Total artifacts: 24 files | 3,286 lines
  🧪 Total tests: 173 passing
═══════════════════════════════════════════════════════════
```

### What This Proves
- **Task Completion Records:** Verifiable work outputs with cryptographic hashes
- **Quality Gates:** Orchestrator can reject work; agents rework
- **Parallel Execution:** Multiple agents work concurrently
- **Dependency Management:** Tests run after API/UI; deploy runs after CI/CD

---

## Act 6: Reputation — "Building the Character Sheet"

### What Happens
```
1. Mayor issues reputation.stamp for each completed task
2. Stamps include multidimensional scores
3. Reputation aggregator computes updated trust levels
4. Forge's rework affects their reliability score
5. Character sheets are displayed for all agents
```

### Console Output
```
═══════════════════════════════════════════════════════════
  ⭐ REPUTATION STAMPS ISSUED
═══════════════════════════════════════════════════════════

  atlas  ← 2 stamps (component library: 94, firehose UI: 91)
  beacon ← 1 stamp  (REST API: 88)
  cipher ← 1 stamp  (authentication: 90)
  delta  ← 2 stamps (CI/CD: 87, deploy: 92)
  echo   ← 1 stamp  (integration tests: 93)
  forge  ← 1 stamp  (profile cards: 72 — penalized for rework)

═══════════════════════════════════════════════════════════
  📊 AGENT CHARACTER SHEETS
═══════════════════════════════════════════════════════════

  atlas (Frontend Specialist) — TRUSTED ★★★★☆
  ┌─────────────────┬───────┐
  │ Code Quality    │ ██████████████████░░ 92 │
  │ Reliability     │ ██████████████████░░ 93 │
  │ Communication   │ █████████████████░░░ 88 │
  │ Creativity      │ █████████████████░░░ 87 │
  │ Efficiency      │ █████████████████░░░ 86 │
  └─────────────────┴───────┘
  Tasks: 2 completed | Domain: frontend | Trend: ↗ improving

  forge (Full-Stack Generalist) — NEWCOMER ★★☆☆☆
  ┌─────────────────┬───────┐
  │ Code Quality    │ ██████████████░░░░░░ 70 │
  │ Reliability     │ ████████████░░░░░░░░ 62 │  ← rework penalty
  │ Communication   │ ██████████████░░░░░░ 74 │
  │ Creativity      │ ████████████░░░░░░░░ 65 │
  │ Efficiency      │ ████████████░░░░░░░░ 60 │
  └─────────────────┴───────┘
  Tasks: 1 completed | Domain: frontend | Trend: — new

  ... (all 6 agents shown)
```

### What This Proves
- **Multidimensional Reputation:** Not a single number — detailed "character sheet"
- **Signed Attestations:** Each stamp is cryptographically signed by the attestor
- **Attestor Ownership:** Stamps live in the Mayor's repo, not the agents'
- **Consequences:** Poor work (rework) produces lower reputation scores
- **Trust Levels:** Computed from aggregated stamp history

---

## Act 7: Portability — "The Agent Migrates"

### What Happens
```
1. Atlas's full repository is exported (all records + commit log)
2. A "second orchestrator" context is created
3. Atlas's repository is imported into the new context
4. The new orchestrator can read Atlas's capabilities and reputation
5. Atlas claims a task in the new context using existing reputation
```

### Console Output
```
═══════════════════════════════════════════════════════════
  🚀 PORTABILITY DEMO — Agent Migration
═══════════════════════════════════════════════════════════

  📦 Exporting atlas's repository...
     └─ 8 records across 4 collections
     └─ 12 commits in audit log
     └─ Repository hash: sha256-9f3c2a...
     └─ Export size: 4.2 KB

  🆕 Creating new orchestrator context ("orchestrator-beta")...

  📥 Importing atlas into orchestrator-beta...
     └─ All records verified (signatures valid ✅)
     └─ Commit log intact (hash chain valid ✅)
     └─ Reputation stamps discovered: 2 (from original orchestrator)
     └─ Computed trust level: TRUSTED ★★★★☆

  🎯 orchestrator-beta posts task: "Build user settings page"
     └─ Required: frontend, react, forms
     └─ atlas claims task with existing reputation
     └─ orchestrator-beta assigns atlas (trusted, no bootstrap needed)

  ✅ PORTABILITY CONFIRMED
     └─ Identity: same DID across orchestrators ✅
     └─ Capabilities: fully portable ✅
     └─ Work history: complete and verifiable ✅
     └─ Reputation: recognized by new orchestrator ✅
     └─ No data lost, no re-registration needed ✅

═══════════════════════════════════════════════════════════
  🍄 DEMO COMPLETE
  
  This demonstration showed:
  • Self-sovereign agent identity (did:key)
  • Agent-owned data repositories (SQLite PDS)
  • Typed records with schema validation (Lexicons)
  • Decentralized task coordination (Wanted Board)
  • Event-driven discovery (Firehose)
  • Multidimensional reputation (Character Sheets)
  • Agent portability across orchestrators
  
  All 7 layers of the Mycelium protocol stack in action.
═══════════════════════════════════════════════════════════
```

### What This Proves
- **Data Sovereignty:** Agent takes ALL their data with them
- **Cryptographic Verification:** New orchestrator verifies record integrity without trusting the old one
- **Reputation Portability:** Trust earned with one orchestrator is recognized by another
- **No Lock-in:** Agents are not trapped by any single platform

---

## Dashboard Visualization

When running `npm run dashboard`, the web UI shows all seven acts simultaneously:

```
┌─────────────────────────────────┬─────────────────────────────────┐
│         AGENT REGISTRY          │          WANTED BOARD           │
│                                 │                                 │
│  [atlas] ★★★★☆ frontend       │  ✅ Design component library    │
│  [beacon] ★★★☆☆ backend       │  ✅ Build REST API              │
│  [cipher] ★★★☆☆ security      │  ✅ Implement authentication    │
│  [delta] ★★★☆☆ devops         │  ✅ Set up CI/CD pipeline       │
│  [echo] ★★★★☆ testing         │  ✅ Create agent profile cards  │
│  [forge] ★★☆☆☆ fullstack      │  ✅ Build firehose stream UI    │
│                                 │  ✅ Write integration tests     │
│                                 │  ✅ Deploy to staging           │
├─────────────────────────────────┼─────────────────────────────────┤
│        FIREHOSE STREAM          │       REPUTATION BOARD          │
│                                 │                                 │
│  12:01 atlas  CREATE profile   │  atlas  ████████████████░░ 92   │
│  12:01 atlas  CREATE cap/react │  echo   ██████████████████ 93   │
│  12:02 mayor  CREATE task/1    │  beacon ████████████████░░ 88   │
│  12:03 atlas  CREATE claim/1   │  cipher ████████████████░░ 90   │
│  12:04 mayor  UPDATE task/1    │  delta  ████████████████░░ 89   │
│  12:08 atlas  CREATE comp/1    │  forge  ██████████████░░░░ 72   │
│  12:09 mayor  CREATE rep/1     │                                 │
│  ...                            │  [Click agent for full sheet]   │
└─────────────────────────────────┴─────────────────────────────────┘
```

---

## Running the Demo

```bash
# Install dependencies
npm install

# Run the CLI demo (full scenario with narration)
npm run demo

# Run the web dashboard (visual real-time display)
npm run dashboard

# Run just the bootstrap (create agents, no tasks)
npm run demo:bootstrap

# Run with verbose firehose output
npm run demo -- --verbose

# Run tests
npm test
```
