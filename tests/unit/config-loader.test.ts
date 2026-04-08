import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadConfig, createConfig } from '../../src/config/config-loader';
import { DEFAULT_CONFIG } from '../../src/config/defaults';
import { isCI } from '../../src/utils/environment';
import type { MindHealConfig } from '../../src/types/index';

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  configureLogger: vi.fn(),
}));

vi.mock('../../src/utils/environment', () => ({
  isCI: vi.fn().mockReturnValue(false),
}));

// ── Tests ────────────────────────────────────────────────────────────────────

describe('config-loader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('default config values', () => {
    it('should return valid default config when no user config is provided', () => {
      const config = loadConfig({});

      expect(config.ai.provider).toBe('anthropic');
      expect(config.healing.enabled).toBe(true);
      expect(config.healing.maxRetries).toBe(3);
      expect(config.healing.confidenceThreshold).toBe(0.7);
      expect(config.healing.cacheHeals).toBe(true);
      expect(config.healing.strategies).toContain('cache');
      expect(config.healing.strategies).toContain('ai');
      expect(config.git.provider).toBe('github');
      expect(config.reviewServer.port).toBe(3000);
      expect(config.logging.level).toBe('info');
    });

    it('should have all expected default strategy names', () => {
      const config = loadConfig({});
      expect(config.healing.strategies).toEqual([
        'cache', 'attribute', 'text', 'role', 'css', 'xpath', 'table', 'modal', 'enterprise', 'ai',
      ]);
    });
  });

  describe('merging user config with defaults', () => {
    it('should merge top-level user config', () => {
      const config = loadConfig({
        logging: { level: 'debug' },
      });

      expect(config.logging.level).toBe('debug');
      // Other sections should remain default
      expect(config.ai.provider).toBe('anthropic');
    });

    it('should merge nested config properties', () => {
      const config = loadConfig({
        ai: { provider: 'openai', apiKey: 'sk-test' },
      });

      expect(config.ai.provider).toBe('openai');
      expect(config.ai.apiKey).toBe('sk-test');
      // Default model should still be present since we deep merge
      expect(config.ai.model).toBeDefined();
    });

    it('should allow overriding healing strategies', () => {
      const config = loadConfig({
        healing: {
          strategies: ['cache', 'attribute', 'css'],
        } as Partial<MindHealConfig['healing']>,
      });

      // Arrays are replaced, not merged
      expect(config.healing.strategies).toEqual(['cache', 'attribute', 'css']);
    });

    it('should allow overriding git config', () => {
      const config = loadConfig({
        git: {
          provider: 'gitlab',
          token: 'glpat-test',
          baseBranch: 'develop',
        } as Partial<MindHealConfig['git']>,
      });

      expect(config.git.provider).toBe('gitlab');
      expect(config.git.token).toBe('glpat-test');
      expect(config.git.baseBranch).toBe('develop');
    });
  });

  describe('validation', () => {
    it('should throw on invalid AI provider', () => {
      expect(() =>
        loadConfig({
          ai: { provider: 'invalid-provider' as 'anthropic', apiKey: '' },
        }),
      ).toThrow(/Invalid AI provider/);
    });

    it.each([
      'anthropic', 'openai', 'azure-openai', 'gemini', 'ollama',
      'aws-bedrock', 'deepseek', 'groq', 'qwen', 'meta', 'perplexity',
    ] as const)('should accept valid AI provider: %s', (provider) => {
      const config = loadConfig({
        ai: { provider, apiKey: 'test-key' },
      });
      expect(config.ai.provider).toBe(provider);
    });

    it('should throw on confidenceThreshold below 0', () => {
      expect(() =>
        loadConfig({
          healing: { confidenceThreshold: -0.5 } as Partial<MindHealConfig['healing']>,
        }),
      ).toThrow(/confidenceThreshold must be between 0 and 1/);
    });

    it('should throw on confidenceThreshold above 1', () => {
      expect(() =>
        loadConfig({
          healing: { confidenceThreshold: 1.5 } as Partial<MindHealConfig['healing']>,
        }),
      ).toThrow(/confidenceThreshold must be between 0 and 1/);
    });

    it('should throw on maxRetries below 1', () => {
      expect(() =>
        loadConfig({
          healing: { maxRetries: 0 } as Partial<MindHealConfig['healing']>,
        }),
      ).toThrow(/maxRetries must be between 1 and 10/);
    });

    it('should throw on maxRetries above 10', () => {
      expect(() =>
        loadConfig({
          healing: { maxRetries: 15 } as Partial<MindHealConfig['healing']>,
        }),
      ).toThrow(/maxRetries must be between 1 and 10/);
    });

    it('should accept valid boundary values', () => {
      // confidenceThreshold = 0 and maxRetries = 1 should be valid
      const config = loadConfig({
        healing: {
          confidenceThreshold: 0,
          maxRetries: 1,
        } as Partial<MindHealConfig['healing']>,
      });

      expect(config.healing.confidenceThreshold).toBe(0);
      expect(config.healing.maxRetries).toBe(1);
    });

    it('should accept max boundary values', () => {
      const config = loadConfig({
        healing: {
          confidenceThreshold: 1,
          maxRetries: 10,
        } as Partial<MindHealConfig['healing']>,
      });

      expect(config.healing.confidenceThreshold).toBe(1);
      expect(config.healing.maxRetries).toBe(10);
    });
  });

  describe('auto-detection of review server mode', () => {
    it('should resolve "auto" to true when not in CI', () => {
      vi.mocked(isCI).mockReturnValue(false);

      const config = loadConfig({
        reviewServer: { enabled: 'auto' } as Partial<MindHealConfig['reviewServer']>,
      });

      expect(config.reviewServer.enabled).toBe(true);
    });

    it('should resolve "auto" to false when in CI', () => {
      vi.mocked(isCI).mockReturnValue(true);

      const config = loadConfig({
        reviewServer: { enabled: 'auto' } as Partial<MindHealConfig['reviewServer']>,
      });

      expect(config.reviewServer.enabled).toBe(false);
    });

    it('should preserve explicit boolean enabled values', () => {
      const configEnabled = loadConfig({
        reviewServer: { enabled: true } as Partial<MindHealConfig['reviewServer']>,
      });
      expect(configEnabled.reviewServer.enabled).toBe(true);

      const configDisabled = loadConfig({
        reviewServer: { enabled: false } as Partial<MindHealConfig['reviewServer']>,
      });
      expect(configDisabled.reviewServer.enabled).toBe(false);
    });
  });

  describe('createConfig', () => {
    it('should behave the same as loadConfig with user config', () => {
      const config = createConfig({
        ai: { provider: 'openai', apiKey: 'sk-test' },
      });

      expect(config.ai.provider).toBe('openai');
      expect(config.ai.apiKey).toBe('sk-test');
      expect(config.healing.enabled).toBe(true);
    });
  });
});
