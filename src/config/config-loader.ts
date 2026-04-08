import { existsSync } from 'fs';
import { resolve } from 'path';
import type { MindHealConfig } from '../types/index';
import { DEFAULT_CONFIG } from './defaults';
import { logger, configureLogger } from '../utils/logger';
import { isCI } from '../utils/environment';

const CONFIG_FILE_NAMES = [
  'mindheal.config.ts',
  'mindheal.config.js',
  'mindheal.config.json',
  'mindheal.config.mjs',
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceVal = source[key];
    const targetVal = target[key];

    if (
      sourceVal !== undefined &&
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      typeof targetVal === 'object' &&
      targetVal !== null &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>
      ) as T[keyof T];
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal as T[keyof T];
    }
  }

  return result;
}

function validateConfig(config: MindHealConfig): void {
  const validProviders = [
    'anthropic', 'openai', 'azure-openai', 'gemini', 'ollama',
    'aws-bedrock', 'deepseek', 'groq', 'qwen', 'meta', 'perplexity',
  ];
  if (!validProviders.includes(config.ai.provider)) {
    throw new Error(
      `[MindHeal] Invalid AI provider: "${config.ai.provider}". Supported: ${validProviders.join(', ')}`
    );
  }

  if (config.healing.enabled && !config.ai.apiKey) {
    const aiStrategiesEnabled = config.healing.strategies.includes('ai');
    if (aiStrategiesEnabled) {
      logger.warn(
        'AI strategy is enabled but no API key provided. AI strategy will be skipped during healing.'
      );
    }
  }

  if (config.healing.confidenceThreshold < 0 || config.healing.confidenceThreshold > 1) {
    throw new Error(
      `[MindHeal] confidenceThreshold must be between 0 and 1, got ${config.healing.confidenceThreshold}`
    );
  }

  if (config.healing.maxRetries < 1 || config.healing.maxRetries > 10) {
    throw new Error(
      `[MindHeal] maxRetries must be between 1 and 10, got ${config.healing.maxRetries}`
    );
  }

  if (config.git.enabled && config.git.autoCreatePR && !config.git.token) {
    logger.warn('Git PR creation is enabled but no token provided. PR creation will be skipped.');
  }

  // Validate Enterprise config
  if (config.enterprise) {
    const validPlatforms = ['auto', 'salesforce', 'sap', 'oracle', 'workday', 'servicenow', 'dynamics'];
    if (!validPlatforms.includes(config.enterprise.platform)) {
      throw new Error(
        `[MindHeal] Invalid enterprise platform: "${config.enterprise.platform}". Valid: ${validPlatforms.join(', ')}`
      );
    }

    if (config.enterprise.loadTimeout < 1000 || config.enterprise.loadTimeout > 60000) {
      throw new Error(
        `[MindHeal] Enterprise loadTimeout must be between 1000 and 60000, got ${config.enterprise.loadTimeout}`
      );
    }
  }

  // Validate RAG config
  if (config.rag) {
    if (config.rag.similarityThreshold < 0 || config.rag.similarityThreshold > 1) {
      throw new Error(
        `[MindHeal] RAG similarityThreshold must be between 0 and 1, got ${config.rag.similarityThreshold}`
      );
    }

    if (config.rag.maxContextChunks < 1 || config.rag.maxContextChunks > 20) {
      throw new Error(
        `[MindHeal] RAG maxContextChunks must be between 1 and 20, got ${config.rag.maxContextChunks}`
      );
    }

    const validSources = [
      'healing-history', 'page-objects', 'git-changes',
      'dom-snapshots', 'component-docs', 'test-specs',
    ];
    for (const source of config.rag.sources) {
      if (!validSources.includes(source)) {
        throw new Error(
          `[MindHeal] Invalid RAG source: "${source}". Valid sources: ${validSources.join(', ')}`
        );
      }
    }
  }
}

function resolveAutoSettings(config: MindHealConfig): MindHealConfig {
  const resolved = { ...config };

  if (resolved.reviewServer.enabled === 'auto') {
    resolved.reviewServer = {
      ...resolved.reviewServer,
      enabled: !isCI(),
    };
  }

  return resolved;
}

export function loadConfig(userConfig?: Partial<MindHealConfig>): MindHealConfig {
  let fileConfig: Partial<MindHealConfig> = {};

  if (!userConfig) {
    for (const fileName of CONFIG_FILE_NAMES) {
      const filePath = resolve(process.cwd(), fileName);
      if (existsSync(filePath)) {
        try {
          if (fileName.endsWith('.json')) {
            const { readFileSync } = require('fs');
            fileConfig = JSON.parse(readFileSync(filePath, 'utf-8'));
          } else {
            // For TS/JS config files, require them
            const loaded = require(filePath);
            fileConfig = loaded.default || loaded;
          }
          logger.debug(`Loaded config from ${fileName}`);
          break;
        } catch (error) {
          logger.warn(`Failed to load config from ${fileName}`, error);
        }
      }
    }
  }

  const mergedConfig = deepMerge(
    DEFAULT_CONFIG,
    deepMerge(fileConfig as Record<string, unknown>, (userConfig || {}) as Record<string, unknown>) as Partial<MindHealConfig>
  );

  const resolvedConfig = resolveAutoSettings(mergedConfig);

  configureLogger(resolvedConfig.logging);

  validateConfig(resolvedConfig);

  return resolvedConfig;
}

export function createConfig(userConfig: Partial<MindHealConfig>): MindHealConfig {
  return loadConfig(userConfig);
}
