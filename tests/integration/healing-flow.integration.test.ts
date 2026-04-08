import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Healer } from '../../src/core/healer';
import { SelfHealCache } from '../../src/core/self-heal-cache';
import type {
  MindHealConfig,
  AIProvider,
  LocatorInfo,
  DOMSnapshot,
  StrategyAttempt,
} from '../../src/types/index';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/core/dom-snapshot', () => ({
  captureDOMSnapshot: vi.fn().mockResolvedValue({
    html: '<div id="app"><button data-testid="login-button">Sign In</button></div>',
    url: 'https://example.com/login',
    title: 'Login Page',
    timestamp: Date.now(),
  } satisfies DOMSnapshot),
}));

vi.mock('../../src/core/locator-strategies', () => ({
  runStrategy: vi.fn().mockResolvedValue({
    strategy: 'attribute',
    locator: null,
    confidence: 0,
    duration: 1,
  } satisfies StrategyAttempt),
}));

vi.mock('../../src/core/locator-analyzer', () => ({
  getLocatorHash: vi.fn().mockImplementation((locator: LocatorInfo, url: string) => {
    return `hash_${locator.selector}_${url}`.replace(/[^a-zA-Z0-9_]/g, '').substring(0, 16);
  }),
}));

vi.mock('../../src/utils/file-utils', () => ({
  readJsonFile: vi.fn().mockReturnValue(null),
  writeJsonFile: vi.fn(),
  fileExists: vi.fn().mockReturnValue(false),
  ensureDirectory: vi.fn(),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function createConfig(overrides?: Partial<MindHealConfig>): MindHealConfig {
  return {
    ai: { provider: 'anthropic', apiKey: 'test-key', model: 'test', maxTokens: 100, temperature: 0 },
    healing: {
      enabled: true,
      maxRetries: 3,
      strategies: ['cache', 'attribute', 'text', 'ai'],
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

function createMockPage() {
  return {
    locator: vi.fn().mockReturnValue({
      count: vi.fn().mockResolvedValue(1),
    }),
    evaluate: vi.fn().mockResolvedValue([]),
    url: vi.fn().mockReturnValue('https://example.com/login'),
  } as unknown as import('@playwright/test').Page;
}

function createMockAIProvider(response?: Partial<ReturnType<AIProvider['suggestLocator']> extends Promise<infer T> ? T : never>): AIProvider {
  return {
    name: 'mock-ai',
    suggestLocator: vi.fn().mockResolvedValue({
      selector: '[data-testid="login-button"]',
      locatorType: 'testid',
      confidence: 0.92,
      reasoning: 'Found matching test ID',
      playwrightExpression: "page.getByTestId('login-button')",
      ...response,
    }),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('healing flow integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('end-to-end healing with mocked page and AI', () => {
    it('should heal a broken locator through the AI strategy', async () => {
      const config = createConfig();
      const page = createMockPage();
      const aiProvider = createMockAIProvider();
      const cache = new SelfHealCache('.mindheal/test-cache.json');

      const healer = new Healer(config, aiProvider, cache);

      const originalLocator: LocatorInfo = {
        type: 'css',
        selector: '#login-btn',
        playwrightExpression: "page.locator('#login-btn')",
      };

      const result = await healer.heal(
        page,
        originalLocator,
        'click',
        new Error('Timeout waiting for selector "#login-btn"'),
      );

      expect(result.success).toBe(true);
      expect(result.healedLocator).not.toBeNull();
      expect(result.strategy).toBe('ai');
      expect(result.confidence).toBeGreaterThan(0.7);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should fall through strategies until one succeeds', async () => {
      const { runStrategy } = await import('../../src/core/locator-strategies');
      const mockedRunStrategy = vi.mocked(runStrategy);

      // attribute and text fail, but provide reasonable attempts
      mockedRunStrategy
        .mockResolvedValueOnce({
          strategy: 'attribute',
          locator: null,
          confidence: 0,
          duration: 5,
        })
        .mockResolvedValueOnce({
          strategy: 'text',
          locator: {
            type: 'text',
            selector: 'Sign In',
            playwrightExpression: "page.getByText('Sign In')",
          },
          confidence: 0.85,
          duration: 10,
        });

      const config = createConfig();
      const page = createMockPage();
      const cache = new SelfHealCache('.mindheal/test-cache.json');
      const healer = new Healer(config, null, cache);

      const result = await healer.heal(
        page,
        {
          type: 'css',
          selector: '#signin-btn',
          playwrightExpression: "page.locator('#signin-btn')",
        },
        'click',
        new Error('Element not found'),
      );

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('text');
      expect(result.confidence).toBe(0.85);
    });
  });

  describe('cache integration', () => {
    it('should store healed result in cache after successful healing', async () => {
      const { runStrategy } = await import('../../src/core/locator-strategies');
      vi.mocked(runStrategy).mockResolvedValueOnce({
        strategy: 'attribute',
        locator: {
          type: 'testid',
          selector: 'login-button',
          playwrightExpression: "page.getByTestId('login-button')",
        },
        confidence: 0.9,
        duration: 8,
      });

      const config = createConfig();
      const page = createMockPage();
      const cache = new SelfHealCache('.mindheal/test-cache.json');
      const cacheSpy = vi.spyOn(cache, 'set');

      const healer = new Healer(config, null, cache);

      const result = await healer.heal(
        page,
        {
          type: 'css',
          selector: '#login-btn',
          playwrightExpression: "page.locator('#login-btn')",
        },
        'click',
        new Error('Element not found'),
      );

      expect(result.success).toBe(true);
      expect(cacheSpy).toHaveBeenCalledTimes(1);

      const [hash, entry] = cacheSpy.mock.calls[0];
      expect(typeof hash).toBe('string');
      expect(entry.healedSelector).toBe('login-button');
      expect(entry.healedType).toBe('testid');
      expect(entry.confidence).toBe(0.9);
      expect(entry.strategy).toBe('attribute');
    });

    it('should retrieve from cache on second heal attempt', async () => {
      const config = createConfig();
      const page = createMockPage();
      const cache = new SelfHealCache('.mindheal/test-cache.json');

      // Pre-populate the cache
      const { getLocatorHash } = await import('../../src/core/locator-analyzer');
      const locator: LocatorInfo = {
        type: 'css',
        selector: '#login-btn',
        playwrightExpression: "page.locator('#login-btn')",
      };
      const hash = getLocatorHash(locator, 'https://example.com/login');

      cache.set(hash, {
        originalSelector: '#login-btn',
        originalType: 'css',
        healedSelector: 'login-button',
        healedType: 'testid',
        healedExpression: "page.getByTestId('login-button')",
        pageUrlPattern: 'https://example.com/login',
        confidence: 0.9,
        strategy: 'attribute',
        createdAt: Date.now(),
        usageCount: 1,
        lastUsed: Date.now(),
      });

      const healer = new Healer(config, null, cache);

      const result = await healer.heal(
        page,
        locator,
        'click',
        new Error('Element not found'),
      );

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('cache');
      expect(result.healedLocator?.selector).toBe('login-button');
    });
  });

  describe('graceful degradation', () => {
    it('should return failure without throwing when AI is unavailable', async () => {
      const { runStrategy } = await import('../../src/core/locator-strategies');
      vi.mocked(runStrategy).mockResolvedValue({
        strategy: 'attribute',
        locator: null,
        confidence: 0,
        duration: 1,
      });

      const config = createConfig();
      const page = createMockPage();
      const cache = new SelfHealCache('.mindheal/test-cache.json');

      // No AI provider
      const healer = new Healer(config, null, cache);

      const result = await healer.heal(
        page,
        {
          type: 'css',
          selector: '#missing-element',
          playwrightExpression: "page.locator('#missing-element')",
        },
        'click',
        new Error('Timeout'),
      );

      expect(result.success).toBe(false);
      expect(result.healedLocator).toBeNull();
      // Should have attempted all non-AI strategies
      expect(result.attempts.length).toBeGreaterThan(0);
    });

    it('should gracefully handle AI provider throwing an error', async () => {
      const { runStrategy } = await import('../../src/core/locator-strategies');
      vi.mocked(runStrategy).mockResolvedValue({
        strategy: 'attribute',
        locator: null,
        confidence: 0,
        duration: 1,
      });

      const config = createConfig();
      const page = createMockPage();
      const cache = new SelfHealCache('.mindheal/test-cache.json');

      const failingAI: AIProvider = {
        name: 'failing-ai',
        suggestLocator: vi.fn().mockRejectedValue(new Error('Service unavailable')),
      };

      const healer = new Healer(config, failingAI, cache);

      const result = await healer.heal(
        page,
        {
          type: 'css',
          selector: '#broken',
          playwrightExpression: "page.locator('#broken')",
        },
        'click',
        new Error('Timeout'),
      );

      // Should not throw, and should report AI error in attempts
      expect(result.success).toBe(false);
      const aiAttempt = result.attempts.find((a) => a.strategy === 'ai');
      expect(aiAttempt).toBeDefined();
      expect(aiAttempt?.error).toContain('Service unavailable');
    });

    it('should not attempt healing strategies when healing is disabled', async () => {
      const config = createConfig({
        healing: {
          enabled: true,
          maxRetries: 3,
          strategies: [],
          confidenceThreshold: 0.7,
          cacheHeals: false,
          excludePatterns: [],
          domSnapshotDepth: 3,
        },
      });

      const page = createMockPage();
      const cache = new SelfHealCache('.mindheal/test-cache.json');
      const healer = new Healer(config, null, cache);

      const result = await healer.heal(
        page,
        {
          type: 'css',
          selector: '#test',
          playwrightExpression: "page.locator('#test')",
        },
        'click',
        new Error('Timeout'),
      );

      expect(result.success).toBe(false);
      expect(result.attempts).toHaveLength(0);
    });
  });
});
