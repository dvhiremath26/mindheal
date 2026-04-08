import type { AIConfig, AIProvider, AIHealingRequest, AIHealingResponse } from '../types/index';
import { buildHealingPrompt, parseHealingResponse } from './prompt-templates';
import { logger } from '../utils/logger';

const DEFAULT_API_VERSION = '2024-02-01';
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TEMPERATURE = 0;
const REQUEST_TIMEOUT_MS = 30_000;

interface AzureChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface AzureChoice {
  index: number;
  message: { role: string; content: string | null };
  finish_reason: string | null;
}

interface AzureSuccessResponse {
  id: string;
  object: string;
  model: string;
  choices: AzureChoice[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface AzureErrorResponse {
  error: { message: string; type?: string; code?: string | null };
}

export class AzureOpenAIProvider implements AIProvider {
  public readonly name = 'azure-openai';

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly deploymentName: string;
  private readonly apiVersion: string;
  private readonly maxTokens: number;
  private readonly temperature: number;

  constructor(config: AIConfig) {
    if (!config.apiKey) {
      throw new Error('[MindHeal] Azure OpenAI API key is required');
    }
    if (!config.baseUrl) {
      throw new Error(
        '[MindHeal] Azure OpenAI baseUrl is required (e.g., https://my-resource.openai.azure.com)'
      );
    }
    if (!config.azureDeploymentName) {
      throw new Error('[MindHeal] Azure OpenAI deployment name is required');
    }

    this.apiKey = config.apiKey;
    this.deploymentName = config.azureDeploymentName;
    this.apiVersion = config.azureApiVersion ?? DEFAULT_API_VERSION;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.temperature = config.temperature ?? DEFAULT_TEMPERATURE;

    // Strip trailing slash for consistency
    let baseUrl = config.baseUrl;
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
    }
    this.baseUrl = baseUrl;
  }

  async suggestLocator(request: AIHealingRequest): Promise<AIHealingResponse> {
    const fullPrompt = buildHealingPrompt(request);
    const startTime = Date.now();

    logger.debug('Azure OpenAI API: sending healing request', {
      deploymentName: this.deploymentName,
      apiVersion: this.apiVersion,
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

    const messages: AzureChatMessage[] = [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent },
    ];

    const body = JSON.stringify({
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      messages,
    });

    const url =
      `${this.baseUrl}/openai/deployments/${this.deploymentName}/chat/completions?api-version=${this.apiVersion}`;

    let responseData: AzureSuccessResponse | AzureErrorResponse;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'api-key': this.apiKey,
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 5;
        logger.warn(`Azure OpenAI API: rate limited, retrying after ${waitSeconds}s`);
        await sleep(waitSeconds * 1000);
        return this.suggestLocator(request);
      }

      responseData = (await response.json()) as AzureSuccessResponse | AzureErrorResponse;

      if (!response.ok) {
        const errorResp = responseData as AzureErrorResponse;
        throw new Error(
          `Azure OpenAI API error (${response.status}): ${errorResp.error?.message ?? response.statusText}`
        );
      }
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(
          `[MindHeal] Azure OpenAI API request timed out after ${REQUEST_TIMEOUT_MS}ms`
        );
      }
      if (error instanceof Error && error.message.startsWith('Azure OpenAI API error')) {
        throw new Error(`[MindHeal] ${error.message}`);
      }
      throw new Error(
        `[MindHeal] Azure OpenAI API request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const successResp = responseData as AzureSuccessResponse;
    const choice = successResp.choices[0];

    if (!choice?.message?.content) {
      throw new Error('[MindHeal] Azure OpenAI API returned empty response');
    }

    const duration = Date.now() - startTime;
    logger.debug('Azure OpenAI API: received response', {
      model: successResp.model,
      duration: `${duration}ms`,
      promptTokens: successResp.usage.prompt_tokens,
      completionTokens: successResp.usage.completion_tokens,
    });

    try {
      return parseHealingResponse(choice.message.content);
    } catch (parseError: unknown) {
      logger.error('Azure OpenAI API: failed to parse response', {
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
