import type { AIConfig, AIProvider, AIHealingRequest, AIHealingResponse } from '../types/index';
import { buildHealingPrompt, parseHealingResponse } from './prompt-templates';
import { logger } from '../utils/logger';
import { createHmac, createHash } from 'crypto';

const DEFAULT_MODEL = 'anthropic.claude-3-haiku-20240307-v1:0';
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TEMPERATURE = 0.1;
const DEFAULT_REGION = 'us-east-1';
const BEDROCK_SERVICE = 'bedrock-runtime';
const ANTHROPIC_BEDROCK_VERSION = 'bedrock-2023-05-31';
const REQUEST_TIMEOUT_MS = 30_000;

interface BedrockResponseContent {
  type: string;
  text?: string;
}

interface BedrockSuccessResponse {
  content: BedrockResponseContent[];
  model: string;
  stop_reason: string | null;
  usage?: { input_tokens: number; output_tokens: number };
}

interface BedrockErrorResponse {
  message?: string;
  Message?: string;
  __type?: string;
}

// ─── Minimal AWS Signature V4 Implementation ──────────────────────────────────

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function getSigningKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, 'aws4_request');
  return kSigning;
}

function buildAwsV4Headers(params: {
  method: string;
  host: string;
  path: string;
  body: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}): Record<string, string> {
  const { method, host, path, body, region, service, accessKeyId, secretAccessKey, sessionToken } =
    params;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = sha256(body);

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'host': host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
  };

  if (sessionToken) {
    headers['x-amz-security-token'] = sessionToken;
  }

  // Canonical headers — must be sorted by lowercase header name
  const signedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderKeys.map((k) => `${k}:${headers[k]}\n`).join('');
  const signedHeaders = signedHeaderKeys.join(';');

  // Canonical request
  const canonicalRequest = [
    method,
    path,
    '', // query string (empty)
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  // String to sign
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256(canonicalRequest)].join(
    '\n',
  );

  // Signing key and signature
  const signingKey = getSigningKey(secretAccessKey, dateStamp, region, service);
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  // Authorization header
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    ...headers,
    'authorization': authorization,
  };
}

// ─── Bedrock Provider ─────────────────────────────────────────────────────────

export class BedrockProvider implements AIProvider {
  public readonly name = 'aws-bedrock';

  private readonly region: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly sessionToken: string | undefined;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly temperature: number;

  constructor(config: AIConfig) {
    if (!config.awsAccessKeyId) {
      throw new Error('[MindHeal] AWS access key ID is required for Bedrock provider');
    }
    if (!config.awsSecretAccessKey) {
      throw new Error('[MindHeal] AWS secret access key is required for Bedrock provider');
    }
    this.region = config.awsRegion ?? DEFAULT_REGION;
    this.accessKeyId = config.awsAccessKeyId;
    this.secretAccessKey = config.awsSecretAccessKey;
    this.sessionToken = config.awsSessionToken;
    this.model = config.model ?? DEFAULT_MODEL;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.temperature = config.temperature ?? DEFAULT_TEMPERATURE;
  }

  async suggestLocator(request: AIHealingRequest): Promise<AIHealingResponse> {
    const fullPrompt = buildHealingPrompt(request);
    const startTime = Date.now();

    logger.debug('Bedrock API: sending healing request', {
      model: this.model,
      region: this.region,
      originalLocator: request.originalLocator.selector,
      pageUrl: request.pageUrl,
    });

    // Bedrock Anthropic models accept a single user message with the combined prompt.
    // We do not split into system/user here because the Bedrock Anthropic invoke API
    // uses the messages format where system is a top-level field, and keeping it
    // simple with one user message is the most portable approach.
    const requestBody = JSON.stringify({
      anthropic_version: ANTHROPIC_BEDROCK_VERSION,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      messages: [{ role: 'user', content: fullPrompt }],
    });

    const host = `${BEDROCK_SERVICE}.${this.region}.amazonaws.com`;
    const path = `/model/${encodeURIComponent(this.model)}/invoke`;
    const url = `https://${host}${path}`;

    const headers = buildAwsV4Headers({
      method: 'POST',
      host,
      path,
      body: requestBody,
      region: this.region,
      service: BEDROCK_SERVICE,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      sessionToken: this.sessionToken,
    });

    let responseData: BedrockSuccessResponse | BedrockErrorResponse;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: requestBody,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 5;
        logger.warn(`Bedrock API: rate limited, retrying after ${waitSeconds}s`);
        await sleep(waitSeconds * 1000);
        return this.suggestLocator(request);
      }

      responseData = (await response.json()) as BedrockSuccessResponse | BedrockErrorResponse;

      if (!response.ok) {
        const errorResp = responseData as BedrockErrorResponse;
        const errorMessage = errorResp.message ?? errorResp.Message ?? response.statusText;
        throw new Error(`Bedrock API error (${response.status}): ${errorMessage}`);
      }
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(
          `[MindHeal] Bedrock API request timed out after ${REQUEST_TIMEOUT_MS}ms`,
        );
      }
      if (error instanceof Error && error.message.startsWith('Bedrock API error')) {
        throw new Error(`[MindHeal] ${error.message}`);
      }
      throw new Error(
        `[MindHeal] Bedrock API request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const successResp = responseData as BedrockSuccessResponse;
    const textContent = successResp.content?.find((c) => c.type === 'text');

    if (!textContent?.text) {
      throw new Error('[MindHeal] Bedrock API returned empty response');
    }

    const duration = Date.now() - startTime;
    logger.debug('Bedrock API: received response', {
      model: this.model,
      duration: `${duration}ms`,
      inputTokens: successResp.usage?.input_tokens,
      outputTokens: successResp.usage?.output_tokens,
    });

    try {
      return parseHealingResponse(textContent.text);
    } catch (parseError: unknown) {
      logger.error('Bedrock API: failed to parse response', {
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
