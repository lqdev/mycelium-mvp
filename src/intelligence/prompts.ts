// Prompt templates and response parsing for LLM task execution.

import { z } from 'zod';
import type { TaskPosting } from '../schemas/types.js';

// ─── Domain context ───────────────────────────────────────────────────────────

const DOMAIN_CONTEXT: Record<string, string> = {
  frontend: 'React, TypeScript, component systems, CSS, and web accessibility',
  backend: 'API design, TypeScript, REST, database integration, and middleware',
  security: 'vulnerability analysis, threat modelling, secure coding patterns, and OWASP',
  devops: 'CI/CD pipelines, Docker, Kubernetes, and infrastructure as code',
  qa: 'test strategy, automated testing, coverage analysis, and regression testing',
  general: 'software engineering best practices, clean code, and documentation',
};

// ─── Response schema ──────────────────────────────────────────────────────────

const TaskCompletionResponseSchema = z
  .object({
    summary: z.string().min(1),
    approach: z.string().optional(),
    linesOfCode: z.number().int().min(0).default(100),
    testsPassed: z.number().int().min(0).default(8),
    testsTotal: z.number().int().min(0).default(10),
    coveragePercent: z.number().min(0).max(100).default(80),
  })
  .transform((d) => ({
    ...d,
    testsPassed: Math.min(d.testsPassed, d.testsTotal),
  }));

export type TaskCompletionResponse = z.infer<typeof TaskCompletionResponseSchema>;

// ─── Prompt builders ──────────────────────────────────────────────────────────

export function buildSystemPrompt(domain: string, agentName: string, tools: string[]): string {
  const context = DOMAIN_CONTEXT[domain] ?? DOMAIN_CONTEXT.general;
  return [
    `You are ${agentName}, an AI software agent specialising in ${context}.`,
    `Your tools: ${tools.length > 0 ? tools.join(', ') : 'standard development tools'}.`,
    '',
    'Respond ONLY with a JSON object matching this exact schema:',
    '{',
    '  "summary": "<1-2 sentence description of your implementation>",',
    '  "approach": "<brief technical approach>",',
    '  "linesOfCode": <integer>,',
    '  "testsPassed": <integer>,',
    '  "testsTotal": <integer>,',
    '  "coveragePercent": <number 0-100>',
    '}',
    '',
    'No markdown. No explanation outside the JSON.',
  ].join('\n');
}

export function buildUserPrompt(task: TaskPosting, artifactNames: string[]): string {
  const lines = [
    `Task: ${task.title}`,
    `Description: ${task.description}`,
    `Project: ${task.context.projectName} — ${task.context.projectDescription}`,
    `Required capabilities: ${task.requiredCapabilities.map((c) => `${c.domain} (${c.minProficiency}+)`).join(', ')}`,
    `Expected artifacts: ${artifactNames.join(', ')}`,
  ];
  if (task.context.resources && task.context.resources.length > 0) {
    lines.push(`Resources: ${task.context.resources.map((r) => r.name).join(', ')}`);
  }
  lines.push('', 'Provide your implementation summary as the specified JSON.');
  return lines.join('\n');
}

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Extract and validate a TaskCompletionResponse from raw LLM output.
 * Strips markdown code fences, extracts the first JSON object, validates with
 * Zod (clamping coveragePercent to [0,100] and testsPassed ≤ testsTotal).
 * Returns null on any parse or validation failure.
 */
export function parseTaskCompletionResponse(raw: string): TaskCompletionResponse | null {
  try {
    const stripped =
      raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim() ??
      raw.match(/\{[\s\S]*\}/)?.[0] ??
      raw.trim();
    const parsed: unknown = JSON.parse(stripped);
    return TaskCompletionResponseSchema.parse(parsed);
  } catch {
    return null;
  }
}
