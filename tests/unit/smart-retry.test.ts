import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SmartRetry } from '../../src/core/smart-retry';
import type { SmartRetryConfig, LocatorInfo } from '../../src/types/index';

vi.mock('../../src/utils/file-utils', () => ({
  readJsonFile: vi.fn().mockReturnValue(null),
  writeJsonFile: vi.fn(),
  fileExists: vi.fn().mockReturnValue(false),
  ensureDirectory: vi.fn(),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const config: SmartRetryConfig = {
  enabled: true,
  waitForNetworkIdle: true,
  networkIdleTimeout: 5000,
  exponentialBackoff: true,
  backoffBaseDelay: 100,
  backoffMaxDelay: 5000,
  flakyDetection: true,
  flakyThreshold: 3,
  flakyStorePath: '/fake/flaky.json',
};

const locator: LocatorInfo = {
  type: 'css',
  selector: '#submit',
  playwrightExpression: "page.locator('#submit')",
};

describe('SmartRetry', () => {
  let retry: SmartRetry;

  beforeEach(() => {
    retry = new SmartRetry(config);
    retry.load();
  });

  describe('Exponential Backoff', () => {
    it('should compute increasing delays', () => {
      const d0 = retry.getBackoffDelay(0);
      const d1 = retry.getBackoffDelay(1);
      const d2 = retry.getBackoffDelay(2);

      // Delays should generally increase (with jitter)
      expect(d0).toBeGreaterThan(0);
      expect(d1).toBeGreaterThan(d0 * 0.5); // Allow for jitter
      expect(d2).toBeGreaterThan(d1 * 0.5);
    });

    it('should cap at maxDelay', () => {
      const d10 = retry.getBackoffDelay(10);
      expect(d10).toBeLessThanOrEqual(config.backoffMaxDelay);
    });

    it('should return 0 when disabled', () => {
      const disabled = new SmartRetry({ ...config, enabled: false });
      expect(disabled.getBackoffDelay(5)).toBe(0);
    });

    it('should return 0 when exponentialBackoff is off', () => {
      const noBackoff = new SmartRetry({ ...config, exponentialBackoff: false });
      expect(noBackoff.getBackoffDelay(5)).toBe(0);
    });
  });

  describe('Flaky Test Detection', () => {
    it('should start with no flaky tests', () => {
      expect(retry.getFlakyTests()).toEqual([]);
      expect(retry.isFlaky('test.ts', locator)).toBe(false);
    });

    it('should detect flaky locators (pass-fail-pass pattern)', () => {
      retry.recordAttempt('test.ts', 'test', locator, true);
      retry.recordAttempt('test.ts', 'test', locator, false);
      retry.recordAttempt('test.ts', 'test', locator, true);
      retry.recordAttempt('test.ts', 'test', locator, false);
      retry.recordAttempt('test.ts', 'test', locator, true);

      expect(retry.isFlaky('test.ts', locator)).toBe(true);
    });

    it('should not mark consistently failing as flaky', () => {
      for (let i = 0; i < 5; i++) {
        retry.recordAttempt('test.ts', 'test', locator, false);
      }

      expect(retry.isFlaky('test.ts', locator)).toBe(false);
    });

    it('should list broken locators', () => {
      for (let i = 0; i < 3; i++) {
        retry.recordAttempt('test.ts', 'test', locator, false);
      }

      const broken = retry.getBrokenLocators();
      expect(broken.length).toBe(1);
      expect(broken[0].consecutiveFailures).toBe(3);
    });

    it('should reset consecutive failures on success', () => {
      retry.recordAttempt('test.ts', 'test', locator, false);
      retry.recordAttempt('test.ts', 'test', locator, false);
      retry.recordAttempt('test.ts', 'test', locator, true);

      const broken = retry.getBrokenLocators();
      expect(broken.length).toBe(0);
    });

    it('should determine shouldSkipHealing for flaky locators', () => {
      // Make it flaky
      retry.recordAttempt('test.ts', 'test', locator, true);
      retry.recordAttempt('test.ts', 'test', locator, false);
      retry.recordAttempt('test.ts', 'test', locator, true);
      retry.recordAttempt('test.ts', 'test', locator, false);
      retry.recordAttempt('test.ts', 'test', locator, true);

      expect(retry.shouldSkipHealing('test.ts', locator)).toBe(true);
    });

    it('should not skip healing when disabled', () => {
      const disabled = new SmartRetry({ ...config, enabled: false });
      expect(disabled.shouldSkipHealing('test.ts', locator)).toBe(false);
    });
  });
});
