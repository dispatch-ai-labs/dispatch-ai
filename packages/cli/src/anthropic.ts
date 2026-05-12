import { type AnthropicUsage, DEFAULT_MODEL, computeCostUsd } from '@dispatch-ai/shared';

export interface AnthropicJsonConfig {
  apiKey: string;
  systemPrompt: string;
  repoContext: string;
  userPrompt: string;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
  sleepMs?: (ms: number) => Promise<void>;
}

export interface AnthropicJsonResult<T> {
  value: T;
  costUsd: number;
}

type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

interface AnthropicResponse {
  content: Array<{ type: 'text'; text: string } | { type: string }>;
  usage?: AnthropicUsage;
}

export async function requestAnthropicJson<T>(
  config: AnthropicJsonConfig,
): Promise<AnthropicJsonResult<T>> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const sleepMs = config.sleepMs ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let response: Response | null = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    throwIfAborted(config.signal);
    response = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: composeSignals(AbortSignal.timeout(config.timeoutMs ?? 60_000), config.signal),
      headers: {
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'content-type': 'application/json',
        'x-api-key': config.apiKey,
      },
      body: JSON.stringify({
        model: config.model ?? DEFAULT_MODEL,
        max_tokens: 4096,
        temperature: 0,
        system: [
          { type: 'text', text: config.systemPrompt, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: config.repoContext, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: config.userPrompt }],
      }),
    });

    if (response.status === 429 && attempt < 3) {
      await sleepMs(2 ** attempt * 250);
      continue;
    }

    if (response.status >= 500 && attempt < 1) {
      await sleepMs(250);
      continue;
    }

    break;
  }

  if (!response) {
    throw new Error('Anthropic request did not return a response.');
  }

  if (response.status === 429) {
    throw new Error('Anthropic rate limit reached after 3 retries. Try again later.');
  }
  if (response.status >= 500) {
    throw new Error(
      `Anthropic server error ${response.status} after retry. Run state was preserved.`,
    );
  }
  if (!response.ok) {
    const errorBody = await response.text();
    if (isModelUpgradeError(errorBody)) {
      throw new Error(
        `Pinned Anthropic model ${config.model ?? DEFAULT_MODEL} is unavailable or deprecated. Check CHANGELOG.md for the supported model upgrade path, then rerun eval snapshots before changing the pin.`,
      );
    }
    throw new Error(`Anthropic request failed with HTTP ${response.status}.`);
  }

  const body = (await response.json()) as AnthropicResponse;
  const text = body.content.find(isAnthropicTextPart)?.text;
  if (!text) {
    throw new Error('Anthropic returned no JSON text.');
  }

  const costUsd = computeCostUsd(config.model ?? DEFAULT_MODEL, body.usage);

  try {
    return { value: JSON.parse(text) as T, costUsd };
  } catch {
    throw new Error('Anthropic returned malformed JSON. Refine the prompt or retry the step.');
  }
}

function isAnthropicTextPart(part: AnthropicResponse['content'][number]): part is {
  type: 'text';
  text: string;
} {
  return part.type === 'text' && 'text' in part;
}

function isModelUpgradeError(errorBody: string): boolean {
  const normalized = errorBody.toLowerCase();
  return (
    normalized.includes('model') &&
    (normalized.includes('deprecated') ||
      normalized.includes('not found') ||
      normalized.includes('does not exist') ||
      normalized.includes('unavailable'))
  );
}

function composeSignals(timeoutSignal: AbortSignal, userSignal: AbortSignal | undefined) {
  if (!userSignal) {
    return timeoutSignal;
  }
  throwIfAborted(userSignal);
  if ('any' in AbortSignal && typeof AbortSignal.any === 'function') {
    return AbortSignal.any([timeoutSignal, userSignal]);
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  timeoutSignal.addEventListener('abort', abort, { once: true });
  userSignal.addEventListener('abort', abort, { once: true });
  return controller.signal;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
}
