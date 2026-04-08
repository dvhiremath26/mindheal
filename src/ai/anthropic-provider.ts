import type { AIConfig, AIProvider, AIHealingRequest, AIHealingResponse } from '../types/index';
import { buildHealingPrompt, parseHealingResponse } from './prompt-templates';
import { logger } from '../utils/logger';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TEMPERATURE = 0;
const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const REQUEST_TIMEOUT_MS = 30_000;

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicResponseContent {
  type: string;
  text?: string;
}

interface AnthropicSuccessResponse {
  id: string;
  type: 'message';
  content: AnthropicResponseContent[];
  model: string;
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

interface AnthropicErrorResponse {
  type: 'error';
  error: { type: string; message: string };
}

type AnthropicResponse = AnthropicSuccessResponse | AnthropicErrorResponse;

export class AnthropicProvider implements AIProvider {
  public readonly name = 'anthropic';

  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly temperature: number;

  constructor(config: AIConfig) {
    if (!config.apiKey) {
      throw new Error('[MindHeal] Anthropic API key is required');
    }
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.temperature = config.temperature ?? DEFAULT_TEMPERATURE;
  }

  async suggestLocator(request: AIHealingRequest): Promise<AIHealingResponse> {
    const prompt = buildHealingPrompt(request);
    const startTime = Date.now();

    logger.debug('Anthropic API: sending healing request', {
      model: this.model,
      originalLocator: request.originalLocator.selector,
      pageUrl: request.pageUrl,
    });

    const messages: AnthropicMessage[] = [
      { role: 'user', content: prompt },
    ];

    const body = JSON.stringify({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      messages,
    });

    let responseData: AnthropicResponse;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 5;
        logger.warn(`Anthropic API: rate limited, retrying after ${waitSeconds}s`);
        await sleep(waitSeconds * 1000);
        return this.suggestLocator(request);
      }

      responseData = (await response.json()) as AnthropicResponse;

      if (!response.ok) {
        const errorResp = responseData as AnthropicErrorResponse;
        throw new Error(
          `Anthropic API error (${response.status}): ${errorResp.error?.message ?? response.statusText}`
        );
      }
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(
          `[MindHeal] Anthropic API request timed out after ${REQUEST_TIMEOUT_MS}ms`
        );
      }
      if (error instanceof Error && error.message.startsWith('Anthropic API error')) {
        throw new Error(`[MindHeal] ${error.message}`);
      }
      throw new Error(
        `[MindHeal] Anthropic API request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const successResp = responseData as AnthropicSuccessResponse;
    const textContent = successResp.content.find((c) => c.type === 'text');

    if (!textContent?.text) {
      throw new Error('[MindHeal] Anthropic API returned empty response');
    }

    const duration = Date.now() - startTime;
    logger.debug('Anthropic API: received response', {
      model: successResp.model,
      duration: `${duration}ms`,
      inputTokens: successResp.usage.input_tokens,
      outputTokens: successResp.usage.output_tokens,
    });

    try {
      return parseHealingResponse(textContent.text);
    } catch (parseError: unknown) {
      logger.error('Anthropic API: failed to parse response', {
        rawText: textContent.text.slice(0, 500),
        error: parseError instanceof Error ? parseError.message : String(parseError),
      });
      throw parseError;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
