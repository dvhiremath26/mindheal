import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMindHealFixture,
  mindHealConfig,
  getAllHealingSessions,
} from '../../src/core/interceptor';
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function createTestConfig(overrides?: Partial<MindHealConfig>): MindHealConfig {
  return {
    ai: { provider: 'anthropic', apiKey: '', model: 'test', maxTokens: 100, temperature: 0 },
    healing: {
      enabled: true,
      maxRetries: 3,
      strategies: ['cache', 'attribute', 'text', 'role', 'css', 'xpath'],
      confidenceThreshold: 0.7,
      cacheHeals: true,
      cachePath: '.mindheal/test-cache.json',
      excludePatterns: [],
      domSnapshotDepth: 3,
    },
    git: {
      enabled: false,
      provider: 'github',
      token: '',
      baseBranch: 'main',
      branchPrefix: 'mindheal/auto-fix',
      autoCreatePR: false,
      commitMessagePrefix: 'fix(locators):',
      prLabels: [],
      prReviewers: [],
    },
    reviewServer: { enabled: false, port: 3000, openBrowser: false, autoCloseAfterReview: false },
    reporting: { outputDir: '.mindheal/reports', generateHTML: false, generateJSON: false },
    logging: { level: 'error' },
    ...overrides,
  } as MindHealConfig;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('interceptor integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createMindHealFixture', () => {
    it('should return a valid test fixture object', () => {
      const config = createTestConfig();
      const fixture = createMindHealFixture(config);

      // The fixture should be a Playwright test instance with .extend capabilities
      expect(fixture).toBeDefined();
      expect(typeof fixture).toBe('function');
      // It should have standard Playwright test methods
      expect(typeof fixture.describe).toBe('function');
      expect(typeof fixture.extend).toBe('function');
      expect(typeof fixture.skip).toBe('function');
    });

    it('should return fixture even when healing is disabled', () => {
      const config = createTestConfig({
        healing: {
          enabled: false,
          maxRetries: 3,
          strategies: [],
          confidenceThreshold: 0.7,
          cacheHeals: false,
          excludePatterns: [],
          domSnapshotDepth: 3,
        },
      });

      const fixture = createMindHealFixture(config);
      expect(fixture).toBeDefined();
    });
  });

  describe('mindHealConfig', () => {
    it('should return a proper Playwright config shape', () => {
      const result = mindHealConfig({
        ai: { provider: 'anthropic', apiKey: '' },
      });

      expect(result).toHaveProperty('test');
      expect(result).toHaveProperty('use');
      expect(result).toHaveProperty('reporter');
      expect(result).toHaveProperty('metadata');
      expect(result.metadata).toHaveProperty('mindHealConfig');
    });

    it('should include the reporter configuration', () => {
      const result = mindHealConfig({
        ai: { provider: 'anthropic', apiKey: '' },
        reporting: { generateJSON: true },
      });

      expect(Array.isArray(result.reporter)).toBe(true);
      expect(result.reporter.length).toBeGreaterThanOrEqual(1);
    });

    it('should pass resolved config through metadata', () => {
      const result = mindHealConfig({
        ai: { provider: 'openai', apiKey: 'sk-test' },
      });

      const metaConfig = result.metadata.mindHealConfig as MindHealConfig;
      expect(metaConfig.ai.provider).toBe('openai');
      expect(metaConfig.ai.apiKey).toBe('sk-test');
    });
  });

  describe('getAllHealingSessions', () => {
    it('should return an array', () => {
      const sessions = getAllHealingSessions();
      expect(Array.isArray(sessions)).toBe(true);
    });

    it('should return sessions as an array of HealingSession objects', () => {
      const sessions = getAllHealingSessions();
      for (const session of sessions) {
        expect(session).toHaveProperty('id');
        expect(session).toHaveProperty('startTime');
        expect(session).toHaveProperty('events');
        expect(session).toHaveProperty('config');
      }
    });
  });
});
