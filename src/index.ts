// ─── MindHeal — AI-Powered Auto-Healing for Playwright ──────────────────────
// Main entry point & public API exports

// Core public API
export { mindHealConfig, createMindHealFixture, getAllHealingSessions } from './core/interceptor';
export { autoTest as test } from './core/interceptor';
export { expect } from '@playwright/test';
export { Healer } from './core/healer';

// Configuration
export { loadConfig, createConfig } from './config/config-loader';
export { DEFAULT_CONFIG } from './config/defaults';

// AI Providers
export { createAIProvider } from './ai/ai-provider';
export type { AIProvider } from './ai/ai-provider';
export { AnthropicProvider } from './ai/anthropic-provider';
export { OpenAIProvider } from './ai/openai-provider';
export { AzureOpenAIProvider } from './ai/azure-openai-provider';
export { GeminiProvider } from './ai/gemini-provider';
export { OllamaProvider } from './ai/ollama-provider';
export { BedrockProvider } from './ai/bedrock-provider';
export { DeepSeekProvider } from './ai/deepseek-provider';
export { GroqProvider } from './ai/groq-provider';
export { QwenProvider } from './ai/qwen-provider';
export { MetaProvider } from './ai/meta-provider';
export { PerplexityProvider } from './ai/perplexity-provider';

// Git Operations
export { GitOperations } from './git/git-operations';
export { PRCreator } from './git/pr-creator';
export { CodeModifier } from './git/code-modifier';

// Review Server
export { ReviewServer } from './server/review-server';

// Reporters
export { HealReportGenerator } from './reporters/heal-report';

// Cache
export { SelfHealCache } from './core/self-heal-cache';

// RAG (Retrieval-Augmented Generation)
export { KnowledgeStore } from './rag/knowledge-store';
export { ContextRetriever } from './rag/context-retriever';
export { textSimilarity, tokenize, buildTermVector, cosineSimilarity } from './rag/embeddings';

// Analytics
export { HealingAnalytics } from './analytics/healing-analytics';

// Smart Retry
export { SmartRetry } from './core/smart-retry';

// Visual Verification
export { VisualVerifier } from './core/visual-verification';

// Parallel Safety
export { FileLock } from './utils/file-lock';

// Utilities
export { logger, configureLogger } from './utils/logger';
export { isCI, detectGitProvider, getRepoInfo } from './utils/environment';

// Enterprise Strategy
export {
  enterpriseStrategy,
  isDynamicId,
  detectPlatform,
  extractStableIdPart,
  waitForEnterpriseLoad,
  scrollVirtualContainer,
} from './core/enterprise-strategy';

// Core modules (for advanced usage)
export { captureDOMSnapshot } from './core/dom-snapshot';
export { analyzeLocator, getLocatorHash } from './core/locator-analyzer';
export { runStrategy } from './core/locator-strategies';

// Types — re-export everything
export type {
  MindHealConfig,
  AIConfig,
  AIProviderName,
  HealingConfig,
  GitConfig,
  ReviewServerConfig,
  ReportingConfig,
  LoggingConfig,
  HealingStrategyName,
  HealingResult,
  StrategyAttempt,
  LocatorInfo,
  LocatorType,
  HealingEvent,
  SourceLocation,
  DOMSnapshot,
  DOMElement,
  AIHealingRequest,
  AIHealingResponse,
  PRDetails,
  PRResult,
  CodeModification,
  ReviewAction,
  ReviewSummary,
  CacheEntry,
  HealCache,
  HealReport,
  HealingSession,
  MindHealFixtures,
  MindHealWorkerFixtures,
  EnterpriseConfig,
  EnterprisePlatform,
  RAGConfig,
  RAGSourceName,
  RAGContextChunk,
  RAGKnowledgeEntry,
  RAGKnowledgeStore,
  AnalyticsConfig,
  AnalyticsEntry,
  AnalyticsSnapshot,
  StrategyStats,
  LocatorStats,
  TestStabilityRecord,
  SmartRetryConfig,
  FlakyTestEntry,
  FlakyTestStore,
  ParallelConfig,
  VisualVerificationConfig,
  VisualVerificationResult,
} from './types/index';
