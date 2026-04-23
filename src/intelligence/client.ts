// HTTP clients for GitHub Models (OpenAI-compatible) and Ollama inference.
// Inactive unless MYCELIUM_ENABLE_INFERENCE=true — safe to import in tests.
// callModel() never throws; returns null on any failure so callers fall back to simulation.

import { GITHUB_MODELS_SLUGS } from './index.js';

const GITHUB_ENDPOINT = 'https://models.github.ai/inference/chat/completions';
const GITHUB_API_VERSION = '2022-11-28';
const OLLAMA_BASE = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const CALL_TIMEOUT_MS = 30_000;

// Internal slug → GitHub Models API model ID (publisher/model format).
// Claude models aren't on the GitHub Models catalog — substituted with GPT-4.1 equivalents.
// Users who want Anthropic models should wire ANTHROPIC_API_KEY in a future phase.
const GITHUB_MODEL_IDS: Record<string, string> = {
  'claude-sonnet-4': 'openai/gpt-4.1',
  'claude-haiku-4': 'openai/gpt-4.1-mini',
  'gpt-4': 'openai/gpt-4o',
  'phi-4': 'microsoft/phi-4',
};

// Internal slug → Ollama model tag (requires `ollama pull <tag>` before use).
const OLLAMA_MODEL_IDS: Record<string, string> = {
  'llama-3-70b': 'llama3.3',
  codellama: 'codellama',
};

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Call an LLM and return the assistant's text response.
 *
 * Returns null when:
 * - MYCELIUM_ENABLE_INFERENCE is not set (default, safe for tests)
 * - GITHUB_TOKEN is missing for GitHub Models calls
 * - The API is unavailable or returns an error
 * - The call times out (30 s limit)
 *
 * Set MYCELIUM_DEBUG=true for verbose error logging.
 */
export async function callModel(
  messages: ChatMessage[],
  modelSlug: string,
  options: { maxTokens?: number } = {},
): Promise<string | null> {
  if (!process.env.MYCELIUM_ENABLE_INFERENCE) return null;

  try {
    if (GITHUB_MODELS_SLUGS.has(modelSlug)) {
      return await callGitHubModels(messages, modelSlug, options);
    }
    return await callOllama(messages, modelSlug, options);
  } catch (err) {
    if (process.env.MYCELIUM_DEBUG) {
      console.warn(
        `[intelligence] callModel failed (${modelSlug}):`,
        err instanceof Error ? err.message : String(err),
      );
    }
    return null;
  }
}

async function callGitHubModels(
  messages: ChatMessage[],
  modelSlug: string,
  options: { maxTokens?: number },
): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not set — cannot call GitHub Models');

  const modelId = GITHUB_MODEL_IDS[modelSlug] ?? 'openai/gpt-4o';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);

  try {
    const response = await fetch(GITHUB_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages,
        max_tokens: options.maxTokens ?? 1024,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`GitHub Models ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
}

async function callOllama(
  messages: ChatMessage[],
  modelSlug: string,
  options: { maxTokens?: number },
): Promise<string> {
  const modelId = OLLAMA_MODEL_IDS[modelSlug] ?? modelSlug;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);

  try {
    const response = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        messages,
        max_tokens: options.maxTokens ?? 1024,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
}
