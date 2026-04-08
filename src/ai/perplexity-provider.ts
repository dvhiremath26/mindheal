import type { AIConfig, AIProvider, AIHealingRequest, AIHealingResponse } from '../types/index';
import { buildHealingPrompt, parseHealingResponse } from './prompt-templates';
import { logger } from '../utils/logger';

const DEFAULT_MODEL = 'sonar-pro';
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TEMPERATURE = 0;
const DEFAULT_API_URL = 'https://api.perplexity.ai/chat/completions';
const REQUEST_TIMEOUT_MS = 30_000;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatChoice {
  index: number;
  message: { role: string; content: string | null };
  finish_reason: string | null;
}

interface ChatSuccessResponse {
  id: string;
  object: string;
  model: string;
  choices: ChatChoice[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface ChatErrorResponse {
  error: { message: string; type: string; code: string | null };
}

export class PerplexityProvider implements AIProvider {
  public readonly name = 'perplexity';

  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly temperature: number;
  private readonly apiUrl: string;

  constructor(config: AIConfig) {
    if (!config.apiKey) {
      throw new Error('[MindHeal] Perplexity API key is required');
    }
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.temperature = config.temperature ?? DEFAULT_TEMPERATURE;
    this.apiUrl = config.baseUrl ?? DEFAULT_API_URL;
  }

  async suggestLocator(request: AIHealingRequest): Promise<AIHealingResponse> {
    const fullPrompt = buildHealingPrompt(request);
    const startTime = Date.now();

    logger.debug('Perplexity API: sending healing request', {
      model: this.model,
      originalLocator: request.originalLocator.selector,
      pageUrl: request.pageUrl,
    });

    // Split the combined prompt into system + user messages at the separator
    const separatorIndex = fullPrompt.indexOf('\n\n---\n\n');
    let systemContent: string;
    let userContent: string;

    if (separatorIndex !== -1) {
      systemContent = fullPrompt.slice(0, separatorIndex);
      userContent = fullPrompt.slice(separatorIndex + 7); // length of '\n\n---\n\n'
    } else {
      systemContent = 'You are an expert Playwright test engineer. Respond with only valid JSON.';
      userContent = fullPrompt;
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent },
    ];

    const body = JSON.stringify({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      messages,
    });

    let responseData: ChatSuccessResponse | ChatErrorResponse;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${this.apiKey}`,
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 5;
        logger.warn(`Perplexity API: rate limited, retrying after ${waitSeconds}s`);
        await sleep(waitSeconds * 1000);
        return this.suggestLocator(request);
      }

      responseData = (await response.json()) as ChatSuccessResponse | ChatErrorResponse;

      if (!response.ok) {
        const errorResp = responseData as ChatErrorResponse;
        throw new Error(
          `Perplexity API error (${response.status}): ${errorResp.error?.message ?? response.statusText}`
        );
      }
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(
          `[MindHeal] Perplexity API request timed out after ${REQUEST_TIMEOUT_MS}ms`
        );
      }
      if (error instanceof Error && error.message.startsWith('Perplexity API error')) {
        throw new Error(`[MindHeal] ${error.message}`);
      }
      throw new Error(
        `[MindHeal] Perplexity API request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const successResp = responseData as ChatSuccessResponse;
    const choice = successResp.choices[0];

    if (!choice?.message?.content) {
      throw new Error('[MindHeal] Perplexity API returned empty response');
    }

    const duration = Date.now() - startTime;
    logger.debug('Perplexity API: received response', {
      model: successResp.model,
      duration: `${duration}ms`,
      promptTokens: successResp.usage.prompt_tokens,
      completionTokens: successResp.usage.completion_tokens,
    });

    try {
      return parseHealingResponse(choice.message.content);
    } catch (parseError: unknown) {
      logger.error('Perplexity API: failed to parse response', {
        rawText: choice.message.content.slice(0, 500),
        error: parseError instanceof Error ? parseError.message : String(parseError),
      });
      throw parseError;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
