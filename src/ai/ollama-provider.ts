import type { AIConfig, AIProvider, AIHealingRequest, AIHealingResponse } from '../types/index';
import { buildHealingPrompt, parseHealingResponse } from './prompt-templates';
import { logger } from '../utils/logger';

const DEFAULT_HOST = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3';
const DEFAULT_TEMPERATURE = 0.1;
const REQUEST_TIMEOUT_MS = 30_000;

interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OllamaSuccessResponse {
  model: string;
  message: { role: string; content: string };
  done: boolean;
  total_duration?: number;
  eval_count?: number;
  prompt_eval_count?: number;
}

interface OllamaErrorResponse {
  error: string;
}

export class OllamaProvider implements AIProvider {
  public readonly name = 'ollama';

  private readonly host: string;
  private readonly model: string;
  private readonly temperature: number;

  constructor(config: AIConfig) {
    this.host = config.ollamaHost ?? config.baseUrl ?? DEFAULT_HOST;
    this.model = config.model ?? DEFAULT_MODEL;
    this.temperature = config.temperature ?? DEFAULT_TEMPERATURE;

    // Strip trailing slash for consistency
    if (this.host.endsWith('/')) {
      this.host = this.host.slice(0, -1);
    }

    logger.debug('OllamaProvider initialized', {
      host: this.host,
      model: this.model,
    });
  }

  async suggestLocator(request: AIHealingRequest): Promise<AIHealingResponse> {
    const fullPrompt = buildHealingPrompt(request);
    const startTime = Date.now();

    logger.debug('Ollama API: sending healing request', {
      model: this.model,
      host: this.host,
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

    const messages: OllamaChatMessage[] = [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent },
    ];

    const body = JSON.stringify({
      model: this.model,
      messages,
      stream: false,
      options: {
        temperature: this.temperature,
      },
    });

    const url = `${this.host}/api/chat`;
    let responseData: OllamaSuccessResponse | OllamaErrorResponse;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 5;
        logger.warn(`Ollama API: rate limited, retrying after ${waitSeconds}s`);
        await sleep(waitSeconds * 1000);
        return this.suggestLocator(request);
      }

      responseData = (await response.json()) as OllamaSuccessResponse | OllamaErrorResponse;

      if (!response.ok) {
        const errorResp = responseData as OllamaErrorResponse;
        throw new Error(
          `Ollama API error (${response.status}): ${errorResp.error ?? response.statusText}`
        );
      }
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(
          `[MindHeal] Ollama API request timed out after ${REQUEST_TIMEOUT_MS}ms`
        );
      }
      if (error instanceof Error && error.message.startsWith('Ollama API error')) {
        throw new Error(`[MindHeal] ${error.message}`);
      }
      // Ollama is local — provide a helpful connection error message
      if (error instanceof TypeError && (error.message.includes('fetch') || error.message.includes('ECONNREFUSED'))) {
        throw new Error(
          `[MindHeal] Cannot connect to Ollama at ${this.host}. Ensure Ollama is running locally (https://ollama.com).`
        );
      }
      throw new Error(
        `[MindHeal] Ollama API request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const successResp = responseData as OllamaSuccessResponse;
    const content = successResp.message?.content;

    if (!content) {
      throw new Error('[MindHeal] Ollama API returned empty response');
    }

    const duration = Date.now() - startTime;
    logger.debug('Ollama API: received response', {
      model: successResp.model,
      duration: `${duration}ms`,
      evalCount: successResp.eval_count,
      promptEvalCount: successResp.prompt_eval_count,
    });

    try {
      return parseHealingResponse(content);
    } catch (parseError: unknown) {
      logger.error('Ollama API: failed to parse response', {
        rawText: content.slice(0, 500),
        error: parseError instanceof Error ? parseError.message : String(parseError),
      });
      throw parseError;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
