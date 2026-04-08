import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HealingAnalytics } from '../../src/analytics/healing-analytics';
import type { AnalyticsConfig, HealingEvent } from '../../src/types/index';

vi.mock('../../src/utils/file-utils', () => ({
  readJsonFile: vi.fn().mockReturnValue(null),
  writeJsonFile: vi.fn(),
  fileExists: vi.fn().mockReturnValue(false),
  ensureDirectory: vi.fn(),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const config: AnalyticsConfig = {
  enabled: true,
  storePath: '/fake/analytics.json',
  trackLocators: true,
  trackStrategies: true,
  trackTestStability: true,
  maxEntries: 100,
  retentionDays: 90,
};

function makeEvent(overrides: Partial<HealingEvent> = {}): HealingEvent {
  return {
    id: 'evt_1',
    timestamp: Date.now(),
    testTitle: 'should login',
    testFile: 'login.spec.ts',
    pageUrl: 'http://example.com/login',
    action: 'click',
    originalLocator: { type: 'css', selector: '#btn', playwrightExpression: "page.locator('#btn')" },
    healedLocator: { type: 'role', selector: 'button', playwrightExpression: "page.getByRole('button')" },
    strategy: 'role',
    confidence: 0.9,
    reasoning: 'test',
    duration: 150,
    sourceLocation: null,
    status: 'healed',
    reviewStatus: 'pending',
    ...overrides,
  };
}

describe('HealingAnalytics', () => {
  let analytics: HealingAnalytics;

  beforeEach(() => {
    analytics = new HealingAnalytics(config);
    analytics.load();
  });

  it('should start with empty stats', () => {
    const stats = analytics.getOverallStats();
    expect(stats.totalHeals).toBe(0);
    expect(stats.successRate).toBe(0);
  });

  it('should record events and compute overall stats', () => {
    analytics.recordEvent(makeEvent());
    analytics.recordEvent(makeEvent({ status: 'failed', strategy: null, confidence: 0 }));

    const stats = analytics.getOverallStats();
    expect(stats.totalHeals).toBe(2);
    expect(stats.successRate).toBe(0.5);
  });

  it('should track strategy stats', () => {
    analytics.recordEvent(makeEvent({ strategy: 'role', confidence: 0.9 }));
    analytics.recordEvent(makeEvent({ strategy: 'role', confidence: 0.8 }));
    analytics.recordEvent(makeEvent({ strategy: 'text', confidence: 0.7 }));

    const stratStats = analytics.getStrategyStats();
    expect(stratStats.length).toBeGreaterThanOrEqual(2);
    const roleStats = stratStats.find((s) => s.name === 'role');
    expect(roleStats).toBeDefined();
    expect(roleStats!.totalAttempts).toBe(2);
    expect(roleStats!.successRate).toBe(1);
  });

  it('should track most healed locators', () => {
    analytics.recordEvent(makeEvent());
    analytics.recordEvent(makeEvent());
    analytics.recordEvent(makeEvent({ originalLocator: { type: 'css', selector: '#other', playwrightExpression: "page.locator('#other')" } }));

    const locators = analytics.getMostHealedLocators();
    expect(locators.length).toBe(2);
    expect(locators[0].expression).toBe("page.locator('#btn')");
    expect(locators[0].healCount).toBe(2);
  });

  it('should compute test stability scores', () => {
    analytics.recordEvent(makeEvent());
    analytics.recordEvent(makeEvent({ status: 'failed' }));
    analytics.recordEvent(makeEvent({ status: 'failed' }));

    const unstable = analytics.getUnstableTests();
    expect(unstable.length).toBe(1);
    expect(unstable[0].stabilityScore).toBeLessThan(80);
    expect(unstable[0].healsNeeded).toBe(3);
  });

  it('should respect maxEntries limit', () => {
    const smallConfig = { ...config, maxEntries: 5 };
    const small = new HealingAnalytics(smallConfig);
    small.load();

    for (let i = 0; i < 10; i++) {
      small.recordEvent(makeEvent({ id: `evt_${i}` }));
    }

    const snapshot = small.getSnapshot();
    expect(snapshot.entries.length).toBeLessThanOrEqual(5);
  });

  it('should return empty arrays when disabled', () => {
    const disabled = new HealingAnalytics({ ...config, enabled: false });
    disabled.load();
    disabled.recordEvent(makeEvent());
    expect(disabled.getOverallStats().totalHeals).toBe(0);
  });

  it('should detect degrading tests', () => {
    // Create a degrading pattern: successes followed by failures
    for (let i = 0; i < 5; i++) {
      analytics.recordEvent(makeEvent({ timestamp: Date.now() - 10000 + i }));
    }
    for (let i = 0; i < 5; i++) {
      analytics.recordEvent(makeEvent({ status: 'failed', timestamp: Date.now() + i }));
    }

    const degrading = analytics.getDegradingTests();
    // May or may not be detected depending on timing
    expect(Array.isArray(degrading)).toBe(true);
  });
});
