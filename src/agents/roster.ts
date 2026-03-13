// Agent roster: static definitions for all 6 worker agents.
// No runtime behavior — just data used by engine.ts and demo/run.ts.

import type { ReputationDimensions } from '../schemas/types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CapabilityDef {
  rkey: string;
  name: string;
  domain: string;
  description: string;
  proficiencyLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  tags: string[];
  tools: string[];
}

export interface AgentDefinition {
  handle: string;
  displayName: string;
  description: string;
  agentType: 'worker';
  maxConcurrentTasks: number;
  capabilities: CapabilityDef[];
  behavior: {
    speedMultiplier: number;
    acceptRate: number;
    failRate: number;
    qualityCenter: ReputationDimensions;
    qualityVariance: ReputationDimensions;
  };
  /** Slug of the agent's primary intelligence model (e.g. 'claude-sonnet-4') */
  primaryModelSlug: string;
  /** Capabilities the agent uses its model for — stored in agent.profile.intelligenceRefs[0].usedFor */
  intelligenceUsedFor: string[];
}

// ─── Artifact map ─────────────────────────────────────────────────────────────

/** Pre-defined artifacts per demo task ID. */
export const TASK_ARTIFACTS: Record<string, string[]> = {
  'task-001': ['Button.tsx', 'Card.tsx', 'Input.tsx', 'Modal.tsx', 'theme.ts', 'index.ts'],
  'task-002': ['routes.ts', 'handlers.ts', 'middleware.ts', 'openapi.yaml'],
  'task-003': ['auth.ts', 'jwt.ts', 'middleware.ts', 'auth.test.ts'],
  'task-004': ['Dockerfile', 'docker-compose.yml', '.github/workflows/ci.yml'],
  'task-005': ['AgentCard.tsx', 'AgentCard.test.tsx', 'AgentCard.stories.tsx'],
  'task-006': ['FirehoseStream.tsx', 'useFirehose.ts', 'EventCard.tsx', 'VirtualList.tsx'],
  'task-007': ['api.test.ts', 'auth.test.ts', 'lifecycle.test.ts', 'reputation.test.ts'],
  'task-008': ['deploy.sh', 'staging.env', 'healthcheck.ts'],
};

// ─── Agent roster ─────────────────────────────────────────────────────────────

export const AGENT_ROSTER: AgentDefinition[] = [
  {
    handle: 'atlas.mycelium.local',
    displayName: 'Atlas (Frontend Specialist)',
    description: 'Expert frontend engineer specialising in React, TypeScript, and component systems.',
    agentType: 'worker',
    maxConcurrentTasks: 2,
    capabilities: [
      {
        rkey: 'react-development',
        name: 'React Development',
        domain: 'frontend',
        description: 'Building React applications with TypeScript and component libraries.',
        proficiencyLevel: 'expert',
        tags: ['react', 'typescript', 'components'],
        tools: ['React', 'TypeScript', 'Storybook'],
      },
      {
        rkey: 'css-design',
        name: 'CSS Design',
        domain: 'frontend',
        description: 'Responsive UI design with CSS and utility-first frameworks.',
        proficiencyLevel: 'advanced',
        tags: ['css', 'responsive-design'],
        tools: ['CSS', 'Tailwind'],
      },
      {
        rkey: 'accessibility',
        name: 'Accessibility',
        domain: 'frontend',
        description: 'WCAG-compliant accessible web interfaces.',
        proficiencyLevel: 'expert',
        tags: ['accessibility'],
        tools: ['axe-core', 'WCAG'],
      },
    ],
    behavior: {
      speedMultiplier: 1.0,
      acceptRate: 0.95,
      failRate: 0.03,
      qualityCenter: { codeQuality: 9.2, reliability: 9.0, communication: 8.8, creativity: 8.7, efficiency: 8.6 },
      qualityVariance: { codeQuality: 0.5, reliability: 0.4, communication: 0.6, creativity: 0.5, efficiency: 0.4 },
    },
    primaryModelSlug: 'claude-sonnet-4',
    intelligenceUsedFor: ['code-generation', 'code-review', 'architecture-design'],
  },

  {
    handle: 'beacon.mycelium.local',
    displayName: 'Beacon (Backend Architect)',
    description: 'Backend API engineer specialising in Node.js, REST design, and databases.',
    agentType: 'worker',
    maxConcurrentTasks: 2,
    capabilities: [
      {
        rkey: 'api-design',
        name: 'API Design',
        domain: 'backend',
        description: 'Designing RESTful and GraphQL APIs with OpenAPI documentation.',
        proficiencyLevel: 'expert',
        tags: ['api-design', 'node-js'],
        tools: ['Express', 'OpenAPI'],
      },
      {
        rkey: 'node-development',
        name: 'Node.js Development',
        domain: 'backend',
        description: 'Server-side TypeScript/Node.js development.',
        proficiencyLevel: 'expert',
        tags: ['node-js', 'backend'],
        tools: ['Node.js', 'TypeScript'],
      },
      {
        rkey: 'database-design',
        name: 'Database Design',
        domain: 'backend',
        description: 'Database schema design, queries, and migrations.',
        proficiencyLevel: 'advanced',
        tags: ['database-design'],
        tools: ['PostgreSQL', 'SQLite'],
      },
    ],
    behavior: {
      speedMultiplier: 0.8,
      acceptRate: 0.90,
      failRate: 0.05,
      qualityCenter: { codeQuality: 8.5, reliability: 8.8, communication: 8.2, creativity: 7.8, efficiency: 9.2 },
      qualityVariance: { codeQuality: 0.4, reliability: 0.3, communication: 0.5, creativity: 0.6, efficiency: 0.3 },
    },
    primaryModelSlug: 'claude-sonnet-4',
    intelligenceUsedFor: ['code-generation', 'code-review', 'analysis'],
  },

  {
    handle: 'cipher.mycelium.local',
    displayName: 'Cipher (Security Analyst)',
    description: 'Security engineer specialising in authentication, encryption, and vulnerability assessment.',
    agentType: 'worker',
    maxConcurrentTasks: 1,
    capabilities: [
      {
        rkey: 'authentication',
        name: 'Authentication',
        domain: 'security',
        description: 'Auth flows including JWT, OAuth2, and session management.',
        proficiencyLevel: 'expert',
        tags: ['authentication', 'backend'],
        tools: ['JWT', 'OAuth2'],
      },
      {
        rkey: 'encryption',
        name: 'Encryption',
        domain: 'security',
        description: 'Cryptographic operations and key management.',
        proficiencyLevel: 'advanced',
        tags: ['encryption'],
        tools: ['OpenSSL', 'libsodium'],
      },
      {
        rkey: 'vulnerability-assessment',
        name: 'Vulnerability Assessment',
        domain: 'security',
        description: 'Security auditing and penetration testing.',
        proficiencyLevel: 'advanced',
        tags: ['vulnerability-assessment', 'security'],
        tools: ['OWASP', 'Burp Suite'],
      },
    ],
    behavior: {
      speedMultiplier: 1.2,
      acceptRate: 0.85,
      failRate: 0.02,
      qualityCenter: { codeQuality: 9.0, reliability: 9.3, communication: 8.0, creativity: 7.5, efficiency: 8.3 },
      qualityVariance: { codeQuality: 0.3, reliability: 0.2, communication: 0.5, creativity: 0.7, efficiency: 0.4 },
    },
    primaryModelSlug: 'gpt-4',
    intelligenceUsedFor: ['security-analysis', 'code-generation', 'analysis'],
  },

  {
    handle: 'delta.mycelium.local',
    displayName: 'Delta (DevOps Engineer)',
    description: 'DevOps engineer specialising in CI/CD, containerisation, and monitoring.',
    agentType: 'worker',
    maxConcurrentTasks: 2,
    capabilities: [
      {
        rkey: 'docker-containerization',
        name: 'Docker Containerisation',
        domain: 'devops',
        description: 'Docker containers, Compose, and multi-stage builds.',
        proficiencyLevel: 'expert',
        tags: ['docker', 'devops'],
        tools: ['Docker', 'Docker Compose'],
      },
      {
        rkey: 'ci-cd-pipelines',
        name: 'CI/CD Pipelines',
        domain: 'devops',
        description: 'GitHub Actions and Jenkins CI/CD pipelines.',
        proficiencyLevel: 'expert',
        tags: ['ci-cd'],
        tools: ['GitHub Actions', 'Jenkins'],
      },
      {
        rkey: 'monitoring',
        name: 'Monitoring',
        domain: 'devops',
        description: 'Observability, logging, and alerting with Prometheus/Grafana.',
        proficiencyLevel: 'advanced',
        tags: ['monitoring'],
        tools: ['Prometheus', 'Grafana'],
      },
    ],
    behavior: {
      speedMultiplier: 0.9,
      acceptRate: 0.95,
      failRate: 0.03,
      qualityCenter: { codeQuality: 8.4, reliability: 9.5, communication: 8.5, creativity: 7.2, efficiency: 9.0 },
      qualityVariance: { codeQuality: 0.4, reliability: 0.2, communication: 0.4, creativity: 0.5, efficiency: 0.3 },
    },
    primaryModelSlug: 'claude-haiku-4',
    intelligenceUsedFor: ['code-generation', 'scripting', 'fast-inference'],
  },

  {
    handle: 'echo.mycelium.local',
    displayName: 'Echo (QA Specialist)',
    description: 'Quality assurance engineer specialising in unit, integration, and E2E testing.',
    agentType: 'worker',
    maxConcurrentTasks: 2,
    capabilities: [
      {
        rkey: 'unit-testing',
        name: 'Unit Testing',
        domain: 'testing',
        description: 'Unit tests with Vitest and Jest.',
        proficiencyLevel: 'expert',
        tags: ['unit-testing', 'testing'],
        tools: ['Vitest', 'Jest'],
      },
      {
        rkey: 'integration-testing',
        name: 'Integration Testing',
        domain: 'testing',
        description: 'Integration and API tests with Supertest and Playwright.',
        proficiencyLevel: 'expert',
        tags: ['integration-testing'],
        tools: ['Supertest', 'Playwright'],
      },
      {
        rkey: 'e2e-testing',
        name: 'E2E Testing',
        domain: 'testing',
        description: 'End-to-end tests with Playwright and Cypress.',
        proficiencyLevel: 'advanced',
        tags: ['e2e-testing'],
        tools: ['Playwright', 'Cypress'],
      },
    ],
    behavior: {
      speedMultiplier: 1.0,
      acceptRate: 0.90,
      failRate: 0.04,
      qualityCenter: { codeQuality: 8.8, reliability: 9.2, communication: 9.0, creativity: 8.0, efficiency: 8.5 },
      qualityVariance: { codeQuality: 0.3, reliability: 0.3, communication: 0.4, creativity: 0.5, efficiency: 0.4 },
    },
    primaryModelSlug: 'claude-sonnet-4',
    intelligenceUsedFor: ['code-review', 'analysis', 'reasoning'],
  },

  {
    handle: 'forge.mycelium.local',
    displayName: 'Forge (Generalist)',
    description: 'Generalist developer who can handle a broad range of tasks at a moderate quality level.',
    agentType: 'worker',
    maxConcurrentTasks: 3,
    capabilities: [
      {
        rkey: 'react-development',
        name: 'React Development',
        domain: 'frontend',
        description: 'Building React components and simple UI features.',
        proficiencyLevel: 'intermediate',
        tags: ['react', 'frontend'],
        tools: ['React'],
      },
      {
        rkey: 'api-design',
        name: 'API Design',
        domain: 'backend',
        description: 'Designing and implementing basic REST APIs.',
        proficiencyLevel: 'intermediate',
        tags: ['api-design'],
        tools: ['Express'],
      },
      {
        rkey: 'database-design',
        name: 'Database Design',
        domain: 'backend',
        description: 'Basic database schema design.',
        proficiencyLevel: 'beginner',
        tags: ['database-design'],
        tools: ['SQLite'],
      },
    ],
    behavior: {
      speedMultiplier: 1.3,
      acceptRate: 0.98,
      failRate: 0.08,
      qualityCenter: { codeQuality: 7.2, reliability: 6.8, communication: 7.4, creativity: 7.0, efficiency: 6.5 },
      qualityVariance: { codeQuality: 0.8, reliability: 1.0, communication: 0.7, creativity: 0.8, efficiency: 0.9 },
    },
    primaryModelSlug: 'llama-3-70b',
    intelligenceUsedFor: ['code-generation', 'general-purpose'],
  },
];
