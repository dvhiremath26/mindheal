import type { AIConfig, AIProvider } from '../types/index';
import { AnthropicProvider } from './anthropic-provider';
import { OpenAIProvider } from './openai-provider';
import { AzureOpenAIProvider } from './azure-openai-provider';
import { GeminiProvider } from './gemini-provider';
import { OllamaProvider } from './ollama-provider';
import { BedrockProvider } from './bedrock-provider';
import { DeepSeekProvider } from './deepseek-provider';
import { GroqProvider } from './groq-provider';
import { QwenProvider } from './qwen-provider';
import { MetaProvider } from './meta-provider';
import { PerplexityProvider } from './perplexity-provider';

export function createAIProvider(config: AIConfig): AIProvider {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    case 'azure-openai':
      return new AzureOpenAIProvider(config);
    case 'gemini':
      return new GeminiProvider(config);
    case 'ollama':
      return new OllamaProvider(config);
    case 'aws-bedrock':
      return new BedrockProvider(config);
    case 'deepseek':
      return new DeepSeekProvider(config);
    case 'groq':
      return new GroqProvider(config);
    case 'qwen':
      return new QwenProvider(config);
    case 'meta':
      return new MetaProvider(config);
    case 'perplexity':
      return new PerplexityProvider(config);
    default:
      throw new Error(
        `[MindHeal] Unsupported AI provider: "${config.provider}". ` +
        `Supported: anthropic, openai, azure-openai, gemini, ollama, aws-bedrock, deepseek, groq, qwen, meta, perplexity`
      );
  }
}

export type { AIProvider };
