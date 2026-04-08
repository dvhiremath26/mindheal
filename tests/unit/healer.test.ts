import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Healer } from '../../src/core/healer';
import type {
  MindHealConfig,
  AIProvider,
  LocatorInfo,
  DOMSnapshot,
  CacheEntry,
  StrategyAttempt,
} from '../../src/types/index';
import { SelfHealCache } from '../../src/core/self-heal-cache';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../src/core/dom-snapshot', () => ({
  captureDOMSnapshot: vi.fn().mockResolvedValue({
    html: '<div id="app"><button id="submit">Submit</button></div>',
    url: 'https://example.com/page',
    title: 'Test Page',
    timestamp: Date.now(),
  } satisfies DOMSnapshot),
}));

vi.mock('../../src/core/locator-strategies', () => ({
  runStrategy: vi.fn().mockResolvedValue({
    strategy: 'attribute',
    locator: null,
    confidence: 0,
    duration: 5,
  } satisfies StrategyAttempt),
}));

vi.mock('../../src/core/locator-analyzer', () => ({
  getLocatorHash: vi.fn().mockReturnValue('mock_hash_abc123'),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function createMockConfig(overrides?: Partial<MindHealConfig>): MindHealConfig {
  return {
    ai: { provider: 'anthropic', apiKey: 'test-key', model: 'test', maxTokens: 100, temperature: 0 },
    healing: {
      enabled: true,
      maxRetries: 3,
      strategies: ['cache', 'attribute', 'text', 'role', 'css', 'xpath', 'ai'],
      confidenceThreshold: 0.7,
      cacheHeals: true,
      cachePath: '.mindheal/cache.json',
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

function createMockLocatorInfo(overrides?: Partial<LocatorInfo>): LocatorInfo {
  return {
    type: 'css',
    selector: '#submit-btn',
    playwrightExpression: "page.locator('#submit-btn')",
    ...overrides,
  };
}

function createMockPage() {
  return {
    locator: vi.fn().mockReturnValue({
      count: vi.fn().mockResolvedValue(1),
    }),
    evaluate: vi.fn(),
    url: vi.fn().mockReturnValue('https://example.com/page'),
  } as unknown as import('@playwright/test').Page;
}

function createMockCache(): SelfHealCache {
  const cache = {
    get: vi.fn().mockReturnValue(undefined),
    set: vi.fn(),
    has: vi.fn().mockReturnValue(false),
    load: vi.fn(),
    save: vi.fn(),
    clear: vi.fn(),
    size: 0,
  };
  return cache as unknown as SelfHealCache;
}

function createMockAIProvider(): AIProvider {
  return {
    name: 'mock-ai',
    suggestLocator: vi.fn().mockResolvedValue({
      selector: '[data-testid="submit"]',
      locatorType: 'testid',
      confidence: 0.95,
      reasoning: 'Found matching test id',
      playwrightExpression: "page.getByTestId('submit')",
    }),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Healer', () => {
  let config: MindHealConfig;
  let page: import('@playwright/test').Page;
  let cache: SelfHealCache;
  let aiProvider: AIProvider;
  let healer: Healer;

  beforeEach(() => {
    vi.clearAllMocks();
    config = createMockConfig();
    page = createMockPage();
    cache = createMockCache();
    aiProvider = createMockAIProvider();
    healer = new Healer(config, aiProvider, cache);
  });

  describe('healing pipeline', () => {
    it('should execute strategies in order defined by config', async () => {
      const { runStrategy } = await import('../../src/core/locator-strategies');
      const mockedRunStrategy = vi.mocked(runStrategy);

      // All strategies return no result to exercise the full pipeline
      mockedRunStrategy.mockResolvedValue({
        strategy: 'attribute',
        locator: null,
        confidence: 0,
        duration: 1,
      });

      const locator = createMockLocatorInfo();
      const error = new Error('Element not found');

      await healer.heal(page, locator, 'click', error);

      // Strategies excluding 'cache' and 'ai' (handled internally) should be
      // dispatched through runStrategy in config order.
      const calls = mockedRunStrategy.mock.calls;
      const strategiesDispatched = calls.map((c) => c[0]);
      expect(strategiesDispatched).toEqual(['attribute', 'text', 'role', 'css', 'xpath']);
    });

    it('should stop on first successful strategy above threshold', async () => {
      const { runStrategy } = await import('../../src/core/locator-strategies');
      const mockedRunStrategy = vi.mocked(runStrategy);

      const healedLocator: LocatorInfo = {
        type: 'css',
        selector: '#new-submit',
        playwrightExpression: "page.locator('#new-submit')",
      };

      // First dispatched strategy ('attribute') returns above threshold
      mockedRunStrategy.mockResolvedValueOnce({
        strategy: 'attribute',
        locator: healedLocator,
        confidence: 0.85,
        duration: 10,
      });

      const locator = createMockLocatorInfo();
      const error = new Error('Element not found');

      const result = await healer.heal(page, locator, 'click', error);

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('attribute');
      expect(result.confidence).toBe(0.85);
      expect(result.healedLocator).toEqual(healedLocator);

      // Should NOT have called runStrategy again for subsequent strategies
      expect(mockedRunStrategy).toHaveBeenCalledTimes(1);
    });

    it('should return failure when no strategy succeeds', async () => {
      const { runStrategy } = await import('../../src/core/locator-strategies');
      const mockedRunStrategy = vi.mocked(runStrategy);

      mockedRunStrategy.mockResolvedValue({
        strategy: 'attribute',
        locator: null,
        confidence: 0,
        duration: 1,
      });

      // AI provider also returns low confidence
      vi.mocked(aiProvider.suggestLocator).mockResolvedValue({
        selector: '#maybe',
        locatorType: 'css',
        confidence: 0.3,
        reasoning: 'Low confidence guess',
        playwrightExpression: "page.locator('#maybe')",
      });

      const locator = createMockLocatorInfo();
      const error = new Error('Element not found');

      const result = await healer.heal(page, locator, 'click', error);

      expect(result.success).toBe(false);
      expect(result.healedLocator).toBeNull();
      expect(result.strategy).toBeNull();
      expect(result.attempts.length).toBeGreaterThan(0);
    });

    it('should track timing for each attempt', async () => {
      const { runStrategy } = await import('../../src/core/locator-strategies');
      const mockedRunStrategy = vi.mocked(runStrategy);

      mockedRunStrategy.mockResolvedValue({
        strategy: 'attribute',
        locator: null,
        confidence: 0,
        duration: 15,
      });

      const locator = createMockLocatorInfo();
      const error = new Error('Element not found');

      const result = await healer.heal(page, locator, 'click', error);

      expect(result.duration).toBeGreaterThanOrEqual(0);
      for (const attempt of result.attempts) {
        expect(typeof attempt.duration).toBe('number');
        expect(attempt.duration).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('cache strategy', () => {
    it('should try cache lookup first when cacheHeals is enabled', async () => {
      const mockCacheEntry: CacheEntry = {
        originalSelector: '#submit-btn',
        originalType: 'css',
        healedSelector: '#new-submit-btn',
        healedType: 'css',
        healedExpression: "page.locator('#new-submit-btn')",
        pageUrlPattern: 'https://example.com/page',
        confidence: 0.9,
        strategy: 'attribute',
        createdAt: Date.now(),
        usageCount: 3,
        lastUsed: Date.now(),
      };

      vi.mocked(cache.get).mockReturnValue(mockCacheEntry);

      const locator = createMockLocatorInfo();
      const error = new Error('Element not found');

      const result = await healer.heal(page, locator, 'click', error);

      expect(cache.get).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.strategy).toBe('cache');
      expect(result.healedLocator?.selector).toBe('#new-submit-btn');
    });

    it('should skip cache when cacheHeals is disabled', async () => {
      config = createMockConfig({
        healing: {
          ...config.healing,
          cacheHeals: false,
        },
      });
      healer = new Healer(config, aiProvider, cache);

      const { runStrategy } = await import('../../src/core/locator-strategies');
      vi.mocked(runStrategy).mockResolvedValue({
        strategy: 'attribute',
        locator: null,
        confidence: 0,
        duration: 1,
      });

      const locator = createMockLocatorInfo();
      const error = new Error('Element not found');

      await healer.heal(page, locator, 'click', error);

      // Cache.get should not have been called for a cache lookup
      expect(cache.get).not.toHaveBeenCalled();
    });
  });

  describe('AI strategy', () => {
    it('should skip AI strategy when no provider is configured', async () => {
      const healerNoAI = new Healer(config, null, cache);

      const { runStrategy } = await import('../../src/core/locator-strategies');
      vi.mocked(runStrategy).mockResolvedValue({
        strategy: 'attribute',
        locator: null,
        confidence: 0,
        duration: 1,
      });

      const locator = createMockLocatorInfo();
      const error = new Error('Element not found');

      const result = await healerNoAI.heal(page, locator, 'click', error);

      expect(result.success).toBe(false);
      expect(aiProvider.suggestLocator).not.toHaveBeenCalled();
    });

    it('should handle AI provider errors gracefully', async () => {
      vi.mocked(aiProvider.suggestLocator).mockRejectedValue(new Error('API rate limited'));

      const { runStrategy } = await import('../../src/core/locator-strategies');
      vi.mocked(runStrategy).mockResolvedValue({
        strategy: 'attribute',
        locator: null,
        confidence: 0,
        duration: 1,
      });

      const locator = createMockLocatorInfo();
      const error = new Error('Element not found');

      const result = await healer.heal(page, locator, 'click', error);

      // Should not throw, should return failure
      expect(result.success).toBe(false);
      const aiAttempt = result.attempts.find((a) => a.strategy === 'ai');
      expect(aiAttempt).toBeDefined();
      expect(aiAttempt?.error).toContain('API rate limited');
    });
  });

  describe('locator verification', () => {
    it('should reject healed locator that resolves zero elements', async () => {
      const { runStrategy } = await import('../../src/core/locator-strategies');
      const mockedRunStrategy = vi.mocked(runStrategy);

      const healedLocator: LocatorInfo = {
        type: 'css',
        selector: '#nonexistent',
        playwrightExpression: "page.locator('#nonexistent')",
      };

      mockedRunStrategy.mockResolvedValueOnce({
        strategy: 'attribute',
        locator: healedLocator,
        confidence: 0.9,
        duration: 5,
      });

      // Make the verification fail - locator resolves 0 elements
      vi.mocked(page.locator).mockReturnValue({
        count: vi.fn().mockResolvedValue(0),
      } as unknown as import('@playwright/test').Locator);

      // All other strategies also fail
      mockedRunStrategy.mockResolvedValue({
        strategy: 'text',
        locator: null,
        confidence: 0,
        duration: 1,
      });

      const locator = createMockLocatorInfo();
      const error = new Error('Element not found');

      const result = await healer.heal(page, locator, 'click', error);

      // The first strategy's result should have been rejected, so healing continues
      expect(result.success).toBe(false);
    });
  });

  describe('DOM snapshot failure', () => {
    it('should return failure when DOM snapshot capture fails', async () => {
      const { captureDOMSnapshot } = await import('../../src/core/dom-snapshot');
      vi.mocked(captureDOMSnapshot).mockRejectedValueOnce(new Error('Page disconnected'));

      const locator = createMockLocatorInfo();
      const error = new Error('Element not found');

      const result = await healer.heal(page, locator, 'click', error);

      expect(result.success).toBe(false);
      expect(result.attempts).toEqual([]);
    });
  });
});
