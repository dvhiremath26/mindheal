import type { AIConfig, AIProvider, AIHealingRequest, AIHealingResponse } from '../types/index';
import { buildHealingPrompt, parseHealingResponse } from './prompt-templates';
import { logger } from '../utils/logger';

const DEFAULT_MODEL = 'gemini-2.0-flash';
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TEMPERATURE = 0.1;
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const REQUEST_TIMEOUT_MS = 30_000;

interface GeminiPart {
  text: string;
}

interface GeminiContent {
  role: string;
  parts: GeminiPart[];
}

interface GeminiCandidate {
  content: { parts: GeminiPart[]; role: string };
  finishReason: string;
}

interface GeminiUsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

interface GeminiSuccessResponse {
  candidates: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
  modelVersion?: string;
}

interface GeminiErrorResponse {
  error: { code: number; message: string; status: string };
}

export class GeminiProvider implements AIProvider {
  public readonly name = 'gemini';

  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly temperature: number;
  private readonly baseUrl: string;

  constructor(config: AIConfig) {
    if (!config.apiKey) {
      throw new Error('[MindHeal] Gemini API key is required');
    }
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.temperature = config.temperature ?? DEFAULT_TEMPERATURE;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;

    // Strip trailing slash for consistency
    if (this.baseUrl.endsWith('/')) {
      this.baseUrl = this.baseUrl.slice(0, -1);
    }
  }

  async suggestLocator(request: AIHealingRequest): Promise<AIHealingResponse> {
    const fullPrompt = buildHealingPrompt(request);
    const startTime = Date.now();

    logger.debug('Gemini API: sending healing request', {
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

    const requestBody: Record<string, unknown> = {
      systemInstruction: {
        parts: [{ text: systemContent }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userContent }],
        } satisfies GeminiContent,
      ],
      generationConfig: {
        temperature: this.temperature,
        maxOutputTokens: this.maxTokens,
      },
    };

    const body = JSON.stringify(requestBody);
    const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;

    let responseData: GeminiSuccessResponse | GeminiErrorResponse;

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
        logger.warn(`Gemini API: rate limited, retrying after ${waitSeconds}s`);
        await sleep(waitSeconds * 1000);
        return this.suggestLocator(request);
      }

      responseData = (await response.json()) as GeminiSuccessResponse | GeminiErrorResponse;

      if (!response.ok) {
        const errorResp = responseData as GeminiErrorResponse;
        throw new Error(
          `Gemini API error (${response.status}): ${errorResp.error?.message ?? response.statusText}`
        );
      }
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(
          `[MindHeal] Gemini API request timed out after ${REQUEST_TIMEOUT_MS}ms`
        );
      }
      if (error instanceof Error && error.message.startsWith('Gemini API error')) {
        throw new Error(`[MindHeal] ${error.message}`);
      }
      throw new Error(
        `[MindHeal] Gemini API request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const successResp = responseData as GeminiSuccessResponse;
    const candidate = successResp.candidates?.[0];
    const content = candidate?.content?.parts?.[0]?.text;

    if (!content) {
      throw new Error('[MindHeal] Gemini API returned empty response');
    }

    const duration = Date.now() - startTime;
    logger.debug('Gemini API: received response', {
      model: this.model,
      duration: `${duration}ms`,
      promptTokens: successResp.usageMetadata?.promptTokenCount,
      completionTokens: successResp.usageMetadata?.candidatesTokenCount,
    });

    try {
      return parseHealingResponse(content);
    } catch (parseError: unknown) {
      logger.error('Gemini API: failed to parse response', {
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
