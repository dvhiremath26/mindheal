import { describe, it, expect } from 'vitest';
import { createAIProvider } from '../../src/ai/ai-provider';
import { AnthropicProvider } from '../../src/ai/anthropic-provider';
import { OpenAIProvider } from '../../src/ai/openai-provider';
import { AzureOpenAIProvider } from '../../src/ai/azure-openai-provider';
import { GeminiProvider } from '../../src/ai/gemini-provider';
import { OllamaProvider } from '../../src/ai/ollama-provider';
import { BedrockProvider } from '../../src/ai/bedrock-provider';
import { DeepSeekProvider } from '../../src/ai/deepseek-provider';
import { GroqProvider } from '../../src/ai/groq-provider';
import { QwenProvider } from '../../src/ai/qwen-provider';
import { MetaProvider } from '../../src/ai/meta-provider';
import { PerplexityProvider } from '../../src/ai/perplexity-provider';
import type { AIConfig } from '../../src/types/index';

describe('createAIProvider', () => {
  const baseConfig: AIConfig = {
    provider: 'anthropic',
    apiKey: 'test-key',
    maxTokens: 1024,
    temperature: 0.1,
  };

  it('should create AnthropicProvider', () => {
    const provider = createAIProvider({ ...baseConfig, provider: 'anthropic' });
    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(provider.name).toBe('anthropic');
  });

  it('should create OpenAIProvider', () => {
    const provider = createAIProvider({ ...baseConfig, provider: 'openai' });
    expect(provider).toBeInstanceOf(OpenAIProvider);
    expect(provider.name).toBe('openai');
  });

  it('should create AzureOpenAIProvider', () => {
    const provider = createAIProvider({
      ...baseConfig,
      provider: 'azure-openai',
      baseUrl: 'https://test.openai.azure.com',
      azureDeploymentName: 'gpt-4o',
    });
    expect(provider).toBeInstanceOf(AzureOpenAIProvider);
    expect(provider.name).toBe('azure-openai');
  });

  it('should create GeminiProvider', () => {
    const provider = createAIProvider({ ...baseConfig, provider: 'gemini' });
    expect(provider).toBeInstanceOf(GeminiProvider);
    expect(provider.name).toBe('gemini');
  });

  it('should create OllamaProvider', () => {
    const provider = createAIProvider({ ...baseConfig, provider: 'ollama', apiKey: '' });
    expect(provider).toBeInstanceOf(OllamaProvider);
    expect(provider.name).toBe('ollama');
  });

  it('should create BedrockProvider', () => {
    const provider = createAIProvider({
      ...baseConfig,
      provider: 'aws-bedrock',
      awsAccessKeyId: 'AKIA...',
      awsSecretAccessKey: 'secret',
      awsRegion: 'us-east-1',
    });
    expect(provider).toBeInstanceOf(BedrockProvider);
    expect(provider.name).toBe('aws-bedrock');
  });

  it('should create DeepSeekProvider', () => {
    const provider = createAIProvider({ ...baseConfig, provider: 'deepseek' });
    expect(provider).toBeInstanceOf(DeepSeekProvider);
    expect(provider.name).toBe('deepseek');
  });

  it('should create GroqProvider', () => {
    const provider = createAIProvider({ ...baseConfig, provider: 'groq' });
    expect(provider).toBeInstanceOf(GroqProvider);
    expect(provider.name).toBe('groq');
  });

  it('should create QwenProvider', () => {
    const provider = createAIProvider({ ...baseConfig, provider: 'qwen' });
    expect(provider).toBeInstanceOf(QwenProvider);
    expect(provider.name).toBe('qwen');
  });

  it('should create MetaProvider', () => {
    const provider = createAIProvider({ ...baseConfig, provider: 'meta' });
    expect(provider).toBeInstanceOf(MetaProvider);
    expect(provider.name).toBe('meta');
  });

  it('should create PerplexityProvider', () => {
    const provider = createAIProvider({ ...baseConfig, provider: 'perplexity' });
    expect(provider).toBeInstanceOf(PerplexityProvider);
    expect(provider.name).toBe('perplexity');
  });

  it('should throw on unsupported provider', () => {
    expect(() =>
      createAIProvider({ ...baseConfig, provider: 'not-real' as 'anthropic' }),
    ).toThrow(/Unsupported AI provider/);
  });

  // Validation tests for providers with required fields

  it('should throw when Anthropic has no API key', () => {
    expect(() =>
      createAIProvider({ ...baseConfig, provider: 'anthropic', apiKey: '' }),
    ).toThrow(/API key is required/);
  });

  it('should throw when Azure has no baseUrl', () => {
    expect(() =>
      createAIProvider({
        ...baseConfig,
        provider: 'azure-openai',
        azureDeploymentName: 'gpt-4o',
        baseUrl: undefined,
      }),
    ).toThrow();
  });

  it('should throw when Azure has no deploymentName', () => {
    expect(() =>
      createAIProvider({
        ...baseConfig,
        provider: 'azure-openai',
        baseUrl: 'https://test.openai.azure.com',
        azureDeploymentName: undefined,
      }),
    ).toThrow();
  });

  it('should throw when Bedrock has no AWS credentials', () => {
    expect(() =>
      createAIProvider({
        ...baseConfig,
        provider: 'aws-bedrock',
        awsAccessKeyId: undefined,
        awsSecretAccessKey: undefined,
      }),
    ).toThrow();
  });

  it('should not require API key for Ollama', () => {
    const provider = createAIProvider({
      ...baseConfig,
      provider: 'ollama',
      apiKey: '',
    });
    expect(provider).toBeInstanceOf(OllamaProvider);
  });
});
