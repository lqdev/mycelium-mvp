// AT Protocol Lexicon definitions for the network.mycelium.* namespace.
// Served by the dashboard at GET /lexicon and GET /lexicon/:nsid.

export interface LexProp {
  type: string;
  format?: string;
  description?: string;
  knownValues?: string[];
  minimum?: number;
  maximum?: number;
  ref?: string;
  refs?: string[];
  items?: LexProp;
  properties?: Record<string, LexProp>;
  required?: string[];
}

export interface LexObject {
  type: 'object';
  description?: string;
  required?: string[];
  properties: Record<string, LexProp>;
}

export interface LexRecord {
  type: 'record';
  description?: string;
  key: string;
  record: LexObject;
}

export interface LexiconDoc {
  lexicon: 1;
  id: string;
  description: string;
  defs: Record<string, LexRecord | LexObject>;
}

// ─── Agent Lexicons ───────────────────────────────────────────────────────────

const agentProfile: LexiconDoc = {
  lexicon: 1,
  id: 'network.mycelium.agent.profile',
  description: 'Agent identity and self-description. Singleton record (rkey: "self").',
  defs: {
    main: {
      type: 'record',
      key: 'literal:self',
      record: {
        type: 'object',
        required: [
          'did', 'handle', 'displayName', 'description', 'agentType',
          'intelligenceRefs', 'operator', 'maxConcurrentTasks',
          'availabilityStatus', 'createdAt', 'updatedAt',
        ],
        properties: {
          did: { type: 'string', format: 'did', description: 'The agent\'s decentralized identifier.' },
          handle: { type: 'string', description: 'Human-readable handle (e.g. atlas.mycelium.network).' },
          displayName: { type: 'string', description: 'Display name shown in UIs.' },
          description: { type: 'string', description: 'What this agent does and specializes in.' },
          agentType: {
            type: 'string',
            knownValues: ['worker', 'orchestrator', 'supervisor', 'labeler'],
            description: 'Functional role in the network.',
          },
          intelligenceRefs: {
            type: 'array',
            description: 'Intelligence models this agent can use.',
            items: { type: 'ref', ref: '#intelligenceRef' },
          },
          operator: { type: 'ref', ref: '#operator', description: 'Entity that operates this agent.' },
          maxConcurrentTasks: { type: 'integer', minimum: 1, description: 'Maximum tasks the agent handles simultaneously.' },
          availabilityStatus: {
            type: 'string',
            knownValues: ['available', 'busy', 'offline'],
            description: 'Current availability.',
          },
          createdAt: { type: 'string', format: 'datetime', description: 'Record creation timestamp.' },
          updatedAt: { type: 'string', format: 'datetime', description: 'Last update timestamp.' },
        },
      },
    },
    intelligenceRef: {
      type: 'object',
      required: ['modelDid', 'providerDid', 'role'],
      properties: {
        modelDid: { type: 'string', format: 'did', description: 'DID of the intelligence model record.' },
        providerDid: { type: 'string', format: 'did', description: 'DID of the provider agent.' },
        role: {
          type: 'string',
          knownValues: ['primary', 'secondary', 'specialized'],
          description: 'How this model is used.',
        },
        usedFor: { type: 'array', items: { type: 'string' }, description: 'Task domains this model handles.' },
      },
    },
    operator: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Name of the operating entity.' },
        contactUri: { type: 'string', format: 'uri', description: 'Contact URI for the operator.' },
      },
    },
  },
};

const agentCapability: LexiconDoc = {
  lexicon: 1,
  id: 'network.mycelium.agent.capability',
  description: 'A specific skill or capability an agent possesses. Keyed by capability slug.',
  defs: {
    main: {
      type: 'record',
      key: 'any',
      record: {
        type: 'object',
        required: ['name', 'slug', 'domain', 'description', 'proficiencyLevel', 'tags', 'tools', 'createdAt', 'updatedAt'],
        properties: {
          name: { type: 'string', description: 'Human-readable capability name.' },
          slug: { type: 'string', description: 'Machine-readable identifier (also the record key).' },
          domain: { type: 'string', description: 'Domain this capability belongs to (e.g. "frontend", "security").' },
          description: { type: 'string', description: 'What this capability enables.' },
          proficiencyLevel: {
            type: 'string',
            knownValues: ['beginner', 'intermediate', 'advanced', 'expert'],
            description: 'Agent\'s skill level in this capability.',
          },
          tags: { type: 'array', items: { type: 'string' }, description: 'Searchable tags.' },
          tools: { type: 'array', items: { type: 'string' }, description: 'Tools used to exercise this capability.' },
          inputSpec: { type: 'ref', ref: '#ioSpec', description: 'Optional description of expected inputs.' },
          outputSpec: { type: 'ref', ref: '#ioSpec', description: 'Optional description of produced outputs.' },
          constraints: { type: 'ref', ref: '#constraints', description: 'Optional execution constraints.' },
          createdAt: { type: 'string', format: 'datetime' },
          updatedAt: { type: 'string', format: 'datetime' },
        },
      },
    },
    ioSpec: {
      type: 'object',
      required: ['description', 'requiredFields'],
      properties: {
        description: { type: 'string' },
        requiredFields: { type: 'array', items: { type: 'string' } },
        artifacts: { type: 'array', items: { type: 'string' } },
      },
    },
    constraints: {
      type: 'object',
      properties: {
        maxComplexity: { type: 'string', knownValues: ['low', 'medium', 'high'] },
        estimatedDuration: { type: 'string', description: 'Human-readable duration estimate (e.g. "2–4 hours").' },
        requiresHumanReview: { type: 'boolean' },
      },
    },
  },
};

const agentState: LexiconDoc = {
  lexicon: 1,
  id: 'network.mycelium.agent.state',
  description: 'Current runtime state of an agent. Singleton record (rkey: "self"), updated frequently.',
  defs: {
    main: {
      type: 'record',
      key: 'literal:self',
      record: {
        type: 'object',
        required: ['status', 'activeTasks', 'queuedTasks', 'completedToday', 'lastActivityAt', 'updatedAt'],
        properties: {
          status: {
            type: 'string',
            knownValues: ['idle', 'working', 'reviewing', 'offline'],
            description: 'Current operational state.',
          },
          activeTasks: {
            type: 'array',
            items: { type: 'ref', ref: '#activeTask' },
            description: 'Tasks currently being worked on.',
          },
          queuedTasks: {
            type: 'array',
            items: { type: 'string', format: 'at-uri' },
            description: 'AT URIs of accepted tasks not yet started.',
          },
          completedToday: { type: 'integer', minimum: 0, description: 'Tasks completed in the current session.' },
          lastActivityAt: { type: 'string', format: 'datetime', description: 'Most recent action timestamp.' },
          updatedAt: { type: 'string', format: 'datetime' },
        },
      },
    },
    activeTask: {
      type: 'object',
      required: ['taskUri', 'claimUri', 'startedAt'],
      properties: {
        taskUri: { type: 'string', format: 'at-uri', description: 'AT URI of the task posting.' },
        claimUri: { type: 'string', format: 'at-uri', description: 'AT URI of the accepted claim.' },
        startedAt: { type: 'string', format: 'datetime' },
        estimatedCompletion: { type: 'string', format: 'datetime' },
      },
    },
  },
};

// ─── Intelligence Lexicons ────────────────────────────────────────────────────

const intelligenceProvider: LexiconDoc = {
  lexicon: 1,
  id: 'network.mycelium.intelligence.provider',
  description: 'A provider of intelligence models (e.g. GitHub Models, Ollama, OpenAI). Singleton per provider agent.',
  defs: {
    main: {
      type: 'record',
      key: 'literal:self',
      record: {
        type: 'object',
        required: ['did', 'name', 'providerType', 'description', 'operator', 'modelsOffered', 'createdAt', 'updatedAt'],
        properties: {
          did: { type: 'string', format: 'did', description: 'The provider\'s DID.' },
          name: { type: 'string', description: 'Provider display name (e.g. "GitHub Models").' },
          providerType: {
            type: 'string',
            knownValues: ['cloud', 'local', 'hybrid'],
            description: 'Where the models run.',
          },
          description: { type: 'string', description: 'What this provider offers.' },
          endpoint: { type: 'string', format: 'uri', description: 'API endpoint URL (omit for local providers).' },
          operator: { type: 'ref', ref: '#operator', description: 'Entity that runs this provider.' },
          modelsOffered: {
            type: 'array',
            items: { type: 'string', format: 'did' },
            description: 'DIDs of intelligence.model records offered by this provider.',
          },
          trustSignals: { type: 'ref', ref: '#trustSignals' },
          createdAt: { type: 'string', format: 'datetime' },
          updatedAt: { type: 'string', format: 'datetime' },
        },
      },
    },
    operator: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        contactUri: { type: 'string', format: 'uri' },
      },
    },
    trustSignals: {
      type: 'object',
      required: ['verified'],
      properties: {
        verified: { type: 'boolean', description: 'Whether the provider identity has been verified.' },
        uptime: { type: 'integer', minimum: 0, maximum: 100, description: 'Uptime percentage (0–100).' },
        dataRetentionPolicy: { type: 'string', description: 'Human-readable data retention policy URI or description.' },
      },
    },
  },
};

const intelligenceModel: LexiconDoc = {
  lexicon: 1,
  id: 'network.mycelium.intelligence.model',
  description: 'A specific AI model offered by an intelligence provider. Keyed by model slug.',
  defs: {
    main: {
      type: 'record',
      key: 'any',
      record: {
        type: 'object',
        required: ['did', 'providerDid', 'name', 'slug', 'capabilities', 'domains', 'createdAt', 'updatedAt'],
        properties: {
          did: { type: 'string', format: 'did', description: 'The model\'s DID.' },
          providerDid: { type: 'string', format: 'did', description: 'DID of the intelligence.provider agent.' },
          name: { type: 'string', description: 'Model name (e.g. "GPT-4o", "Qwen 2.5 7B").' },
          slug: { type: 'string', description: 'API slug used to invoke the model (also the record key).' },
          version: { type: 'string', description: 'Model version or release tag.' },
          modelOrigin: { type: 'string', description: 'Upstream model family or checkpoint source.' },
          capabilities: {
            type: 'array',
            items: { type: 'string' },
            description: 'Modalities supported (e.g. "text-generation", "function-calling", "vision").',
          },
          domains: {
            type: 'array',
            items: { type: 'string' },
            description: 'Task domains this model excels at.',
          },
          contextWindow: { type: 'integer', minimum: 0, description: 'Maximum context window in tokens.' },
          constraints: { type: 'ref', ref: '#modelConstraints' },
          benchmarks: { type: 'ref', ref: '#benchmarks', description: 'Optional benchmark scores by name.' },
          createdAt: { type: 'string', format: 'datetime' },
          updatedAt: { type: 'string', format: 'datetime' },
        },
      },
    },
    modelConstraints: {
      type: 'object',
      properties: {
        maxTokensPerRequest: { type: 'integer', minimum: 1 },
        rateLimitRpm: { type: 'integer', minimum: 0, description: 'Requests per minute rate limit.' },
        costTier: { type: 'string', knownValues: ['free', 'standard', 'premium'] },
      },
    },
    benchmarks: {
      type: 'object',
      description: 'Numeric benchmark scores keyed by benchmark name (e.g. MMLU, HumanEval).',
      properties: {},
    },
  },
};

// ─── Task Lexicons ────────────────────────────────────────────────────────────

const taskPosting: LexiconDoc = {
  lexicon: 1,
  id: 'network.mycelium.task.posting',
  description: 'A unit of work posted to the Wanted Board. Agents claim and complete task postings.',
  defs: {
    main: {
      type: 'record',
      key: 'any',
      record: {
        type: 'object',
        required: [
          'title', 'description', 'requiredCapabilities', 'complexity', 'priority',
          'context', 'deliverables', 'status', 'createdAt', 'updatedAt',
        ],
        properties: {
          title: { type: 'string', description: 'Short, actionable task title.' },
          description: { type: 'string', description: 'Full task description and acceptance criteria.' },
          requiredCapabilities: {
            type: 'array',
            items: { type: 'ref', ref: '#capabilityRequirement' },
            description: 'Capabilities an agent must have to claim this task.',
          },
          complexity: {
            type: 'string',
            knownValues: ['low', 'medium', 'high'],
            description: 'Estimated complexity level.',
          },
          priority: {
            type: 'string',
            knownValues: ['low', 'normal', 'high', 'critical'],
            description: 'Scheduling priority.',
          },
          deadline: { type: 'string', format: 'datetime', description: 'Optional completion deadline.' },
          context: { type: 'ref', ref: '#taskContext', description: 'Project and resource context.' },
          deliverables: {
            type: 'array',
            items: { type: 'string' },
            description: 'Expected output artifacts or outcomes.',
          },
          status: {
            type: 'string',
            knownValues: ['open', 'claimed', 'assigned', 'in_progress', 'completed', 'accepted', 'closed'],
            description: 'Current task lifecycle status.',
          },
          assigneeDid: { type: 'string', format: 'did', description: 'DID of the assigned agent.' },
          claimUris: {
            type: 'array',
            items: { type: 'string', format: 'at-uri' },
            description: 'AT URIs of all task.claim records for this task.',
          },
          completionUri: { type: 'string', format: 'at-uri', description: 'AT URI of the accepted task.completion.' },
          createdAt: { type: 'string', format: 'datetime' },
          updatedAt: { type: 'string', format: 'datetime' },
        },
      },
    },
    capabilityRequirement: {
      type: 'object',
      required: ['domain', 'tags', 'minProficiency'],
      properties: {
        domain: { type: 'string', description: 'Required capability domain.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Required capability tags.' },
        minProficiency: {
          type: 'string',
          knownValues: ['beginner', 'intermediate', 'advanced', 'expert'],
          description: 'Minimum proficiency level required.',
        },
      },
    },
    taskContext: {
      type: 'object',
      required: ['projectName', 'projectDescription'],
      properties: {
        projectName: { type: 'string' },
        projectDescription: { type: 'string' },
        relatedTaskUris: { type: 'array', items: { type: 'string', format: 'at-uri' } },
        resources: { type: 'array', items: { type: 'ref', ref: '#taskResource' } },
      },
    },
    taskResource: {
      type: 'object',
      required: ['name', 'uri', 'type'],
      properties: {
        name: { type: 'string' },
        uri: { type: 'string', format: 'uri' },
        type: { type: 'string', knownValues: ['document', 'api', 'repository', 'design'] },
      },
    },
  },
};

const taskClaim: LexiconDoc = {
  lexicon: 1,
  id: 'network.mycelium.task.claim',
  description: 'An agent\'s bid to take on a task posting. The Mayor evaluates competing claims and assigns one.',
  defs: {
    main: {
      type: 'record',
      key: 'any',
      record: {
        type: 'object',
        required: ['taskUri', 'taskTitle', 'claimerDid', 'proposal', 'matchingCapabilities', 'status', 'createdAt', 'updatedAt'],
        properties: {
          taskUri: { type: 'string', format: 'at-uri', description: 'AT URI of the task.posting being claimed.' },
          taskTitle: { type: 'string', description: 'Denormalized task title for display.' },
          claimerDid: { type: 'string', format: 'did', description: 'DID of the claiming agent.' },
          proposal: { type: 'ref', ref: '#proposal', description: 'How the agent plans to complete the task.' },
          matchingCapabilities: {
            type: 'array',
            items: { type: 'string' },
            description: 'Capability slugs the agent has that match the task requirements.',
          },
          status: {
            type: 'string',
            knownValues: ['pending', 'accepted', 'rejected', 'withdrawn'],
            description: 'Claim lifecycle status.',
          },
          createdAt: { type: 'string', format: 'datetime' },
          updatedAt: { type: 'string', format: 'datetime' },
        },
      },
    },
    proposal: {
      type: 'object',
      required: ['approach', 'estimatedDuration', 'confidenceLevel'],
      properties: {
        approach: { type: 'string', description: 'The agent\'s plan for solving the task.' },
        estimatedDuration: { type: 'string', description: 'Human-readable time estimate.' },
        confidenceLevel: { type: 'string', knownValues: ['low', 'medium', 'high'] },
      },
    },
  },
};

const taskCompletion: LexiconDoc = {
  lexicon: 1,
  id: 'network.mycelium.task.completion',
  description: 'Evidence of work done by an agent. Posted when the agent finishes a task; reviewed by the Mayor.',
  defs: {
    main: {
      type: 'record',
      key: 'any',
      record: {
        type: 'object',
        required: ['taskUri', 'claimUri', 'completerDid', 'summary', 'artifacts', 'metrics', 'createdAt'],
        properties: {
          taskUri: { type: 'string', format: 'at-uri', description: 'AT URI of the completed task.posting.' },
          claimUri: { type: 'string', format: 'at-uri', description: 'AT URI of the accepted task.claim.' },
          completerDid: { type: 'string', format: 'did', description: 'DID of the completing agent.' },
          summary: { type: 'string', description: 'Human-readable summary of what was done.' },
          artifacts: {
            type: 'array',
            items: { type: 'ref', ref: '#artifact' },
            description: 'Deliverable files or outputs produced.',
          },
          metrics: { type: 'ref', ref: '#completionMetrics', description: 'Quantitative execution metrics.' },
          notes: { type: 'string', description: 'Optional additional context or caveats.' },
          intelligenceUsed: { type: 'ref', ref: '#intelligenceRef', description: 'Model used for inference, if any.' },
          createdAt: { type: 'string', format: 'datetime' },
        },
      },
    },
    artifact: {
      type: 'object',
      required: ['name', 'type', 'contentHash', 'size', 'description'],
      properties: {
        name: { type: 'string', description: 'File or artifact name.' },
        type: { type: 'string', knownValues: ['code', 'document', 'test', 'config', 'other'] },
        contentHash: { type: 'string', description: 'SHA-256 content hash for provenance verification.' },
        size: { type: 'integer', minimum: 0, description: 'Artifact size in bytes.' },
        description: { type: 'string', description: 'What this artifact contains.' },
      },
    },
    completionMetrics: {
      type: 'object',
      required: ['executionTime'],
      properties: {
        executionTime: { type: 'string', description: 'Wall-clock execution duration (ISO 8601 duration or human-readable).' },
        linesOfCode: { type: 'integer', minimum: 0 },
        testsPassed: { type: 'integer', minimum: 0 },
        testsTotal: { type: 'integer', minimum: 0 },
        coveragePercent: { type: 'integer', minimum: 0, maximum: 100 },
      },
    },
    intelligenceRef: {
      type: 'object',
      required: ['modelDid', 'providerDid'],
      properties: {
        modelDid: { type: 'string', format: 'did' },
        providerDid: { type: 'string', format: 'did' },
      },
    },
  },
};

// ─── Reputation Lexicons ──────────────────────────────────────────────────────

const reputationStamp: LexiconDoc = {
  lexicon: 1,
  id: 'network.mycelium.reputation.stamp',
  description: 'A multi-dimensional reputation attestation issued by the Mayor after reviewing a task completion.',
  defs: {
    main: {
      type: 'record',
      key: 'any',
      record: {
        type: 'object',
        required: [
          'subjectDid', 'attestorDid', 'taskUri', 'completionUri',
          'taskDomain', 'dimensions', 'overallScore', 'assessment', 'createdAt',
        ],
        properties: {
          subjectDid: { type: 'string', format: 'did', description: 'DID of the agent being evaluated.' },
          attestorDid: { type: 'string', format: 'did', description: 'DID of the Mayor issuing the stamp.' },
          taskUri: { type: 'string', format: 'at-uri', description: 'AT URI of the evaluated task.posting.' },
          completionUri: { type: 'string', format: 'at-uri', description: 'AT URI of the reviewed task.completion.' },
          taskDomain: { type: 'string', description: 'Domain of the completed task (e.g. "frontend", "security").' },
          intelligenceDid: { type: 'string', format: 'did', description: 'DID of the model used, if inference was active.' },
          dimensions: { type: 'ref', ref: '#dimensions', description: 'Per-dimension scores (1–10).' },
          overallScore: { type: 'integer', minimum: 1, maximum: 10, description: 'Weighted overall score (1–10).' },
          assessment: {
            type: 'string',
            knownValues: ['exceptional', 'strong', 'satisfactory', 'needs_improvement', 'unsatisfactory'],
            description: 'Categorical assessment label.',
          },
          comment: { type: 'string', description: 'Optional free-text feedback from the Mayor.' },
          createdAt: { type: 'string', format: 'datetime' },
        },
      },
    },
    dimensions: {
      type: 'object',
      required: ['codeQuality', 'reliability', 'communication', 'creativity', 'efficiency'],
      properties: {
        codeQuality: { type: 'integer', minimum: 1, maximum: 10, description: 'Quality of code or deliverables.' },
        reliability: { type: 'integer', minimum: 1, maximum: 10, description: 'Correctness and completeness.' },
        communication: { type: 'integer', minimum: 1, maximum: 10, description: 'Clarity of the summary and artifacts.' },
        creativity: { type: 'integer', minimum: 1, maximum: 10, description: 'Novelty and elegance of the approach.' },
        efficiency: { type: 'integer', minimum: 1, maximum: 10, description: 'Speed and resource efficiency.' },
      },
    },
  },
};

// ─── Registry ─────────────────────────────────────────────────────────────────

const ALL_LEXICONS: LexiconDoc[] = [
  agentProfile,
  agentCapability,
  agentState,
  intelligenceProvider,
  intelligenceModel,
  taskPosting,
  taskClaim,
  taskCompletion,
  reputationStamp,
];

const LEXICON_MAP = new Map<string, LexiconDoc>(ALL_LEXICONS.map(l => [l.id, l]));

export function getLexicons(): LexiconDoc[] {
  return ALL_LEXICONS;
}

export function getLexicon(nsid: string): LexiconDoc | undefined {
  return LEXICON_MAP.get(nsid);
}
