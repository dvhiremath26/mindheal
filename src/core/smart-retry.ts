/**
 * Smart Retry Intelligence
 *
 * Provides:
 * 1. Network idle wait — waits for all pending requests to settle before healing
 * 2. Exponential backoff — progressive delays between retry attempts
 * 3. Flaky test detection — tracks intermittent failures vs genuine breakage
 * 4. Test stability scoring — scores each locator by failure frequency
 */

import type { Page } from '@playwright/test';
import type {
  SmartRetryConfig,
  FlakyTestEntry,
  FlakyTestStore,
  LocatorInfo,
} from '../types/index';
import { logger } from '../utils/logger';
import { readJsonFile, writeJsonFile, fileExists, ensureDirectory } from '../utils/file-utils';

const FLAKY_STORE_VERSION = '1';
const MAX_HISTORY_PER_ENTRY = 20;

export class SmartRetry {
  private readonly config: SmartRetryConfig;
  private flakyStore: FlakyTestStore;
  private loaded = false;

  constructor(config: SmartRetryConfig) {
    this.config = config;
    this.flakyStore = { version: FLAKY_STORE_VERSION, entries: {} };
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  load(): void {
    if (!this.config.enabled || !this.config.flakyDetection) return;
    try {
      if (!fileExists(this.config.flakyStorePath)) {
        this.loaded = true;
        return;
      }

      const data = readJsonFile<FlakyTestStore>(this.config.flakyStorePath);
      if (data && data.version === FLAKY_STORE_VERSION) {
        this.flakyStore = data;
        // Prune entries not seen in 30 days
        const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
        for (const [key, entry] of Object.entries(this.flakyStore.entries)) {
          if (entry.lastSeen < cutoff) {
            delete this.flakyStore.entries[key];
          }
        }
      }
      this.loaded = true;
      logger.debug(`[SmartRetry] Loaded ${Object.keys(this.flakyStore.entries).length} flaky test entries`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[SmartRetry] Failed to load flaky store: ${msg}`);
      this.loaded = true;
    }
  }

  save(): void {
    if (!this.config.enabled || !this.config.flakyDetection) return;
    try {
      const pathModule = require('path');
      ensureDirectory(pathModule.dirname(this.config.flakyStorePath));
      writeJsonFile(this.config.flakyStorePath, this.flakyStore);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[SmartRetry] Failed to save flaky store: ${msg}`);
    }
  }

  // ─── Network Idle Wait ──────────────────────────────────────────────────

  /**
   * Waits for network to become idle before attempting healing.
   * Prevents healing from running while the page is still loading data.
   */
  async waitForNetworkIdle(page: Page): Promise<void> {
    if (!this.config.enabled || !this.config.waitForNetworkIdle) return;

    try {
      await page.waitForLoadState('networkidle', {
        timeout: this.config.networkIdleTimeout,
      });
      logger.debug('[SmartRetry] Network idle achieved');
    } catch {
      // Timeout is fine — page may have long-polling or WebSocket connections
      logger.debug('[SmartRetry] Network idle timeout — proceeding with healing');
    }
  }

  /**
   * Additionally waits for DOM to stabilize (no mutations for 500ms).
   * Useful for SPAs that render asynchronously.
   */
  async waitForDOMStable(page: Page, stabilityMs = 500): Promise<void> {
    if (!this.config.enabled) return;

    try {
      await page.evaluate((waitMs) => {
        return new Promise<void>((resolve) => {
          let timer: ReturnType<typeof setTimeout>;
          const observer = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(() => {
              observer.disconnect();
              resolve();
            }, waitMs);
          });

          observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
          });

          // Start the timer immediately — if no mutations happen, resolve after waitMs
          timer = setTimeout(() => {
            observer.disconnect();
            resolve();
          }, waitMs);
        });
      }, stabilityMs);
      logger.debug('[SmartRetry] DOM stabilized');
    } catch {
      logger.debug('[SmartRetry] DOM stability check timed out — proceeding');
    }
  }

  // ─── Exponential Backoff ────────────────────────────────────────────────

  /**
   * Computes the delay for the given retry attempt using exponential backoff.
   * Includes jitter to prevent thundering herd in parallel execution.
   *
   * @param attempt - Zero-based attempt index (0 = first retry)
   * @returns Delay in milliseconds
   */
  getBackoffDelay(attempt: number): number {
    if (!this.config.enabled || !this.config.exponentialBackoff) return 0;

    const base = this.config.backoffBaseDelay;
    const max = this.config.backoffMaxDelay;
    const exponential = base * Math.pow(2, attempt);
    const jitter = Math.random() * base * 0.5;
    return Math.min(exponential + jitter, max);
  }

  /**
   * Sleeps for the computed backoff delay.
   */
  async backoff(attempt: number): Promise<void> {
    const delay = this.getBackoffDelay(attempt);
    if (delay > 0) {
      logger.debug(`[SmartRetry] Backoff: waiting ${delay.toFixed(0)}ms (attempt ${attempt + 1})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // ─── Flaky Test Detection ───────────────────────────────────────────────

  /**
   * Records a healing attempt result for flaky detection.
   */
  recordAttempt(
    testFile: string,
    testTitle: string,
    locator: LocatorInfo,
    success: boolean,
  ): void {
    if (!this.config.enabled || !this.config.flakyDetection) return;
    if (!this.loaded) this.load();

    const key = `${testFile}::${locator.playwrightExpression}`;
    let entry = this.flakyStore.entries[key];

    if (!entry) {
      entry = {
        testFile,
        testTitle,
        locatorExpression: locator.playwrightExpression,
        failureCount: 0,
        successCount: 0,
        consecutiveFailures: 0,
        isFlaky: false,
        lastSeen: Date.now(),
        history: [],
      };
      this.flakyStore.entries[key] = entry;
    }

    // Update counts
    if (success) {
      entry.successCount++;
      // If it was failing and now succeeded → flaky
      if (entry.consecutiveFailures > 0) {
        entry.isFlaky = true;
      }
      entry.consecutiveFailures = 0;
    } else {
      entry.failureCount++;
      entry.consecutiveFailures++;
      // If consecutive failures exceed threshold, it's broken not flaky
      if (entry.consecutiveFailures >= this.config.flakyThreshold) {
        entry.isFlaky = false; // consistently broken
      }
    }

    entry.lastSeen = Date.now();
    entry.history.push({ timestamp: Date.now(), passed: success });

    // Trim history
    if (entry.history.length > MAX_HISTORY_PER_ENTRY) {
      entry.history = entry.history.slice(-MAX_HISTORY_PER_ENTRY);
    }

    // Re-evaluate flaky status from history
    if (entry.history.length >= 5) {
      const passes = entry.history.filter((h) => h.passed).length;
      const fails = entry.history.filter((h) => !h.passed).length;
      // Flaky = both passes and fails in recent history (not all one or the other)
      entry.isFlaky = passes > 0 && fails > 0 && passes < entry.history.length;
    }
  }

  /**
   * Check if a locator in a test file is known to be flaky.
   */
  isFlaky(testFile: string, locator: LocatorInfo): boolean {
    if (!this.config.enabled || !this.config.flakyDetection) return false;
    if (!this.loaded) this.load();

    const key = `${testFile}::${locator.playwrightExpression}`;
    const entry = this.flakyStore.entries[key];
    return entry?.isFlaky ?? false;
  }

  /**
   * Returns all known flaky test entries.
   */
  getFlakyTests(): FlakyTestEntry[] {
    if (!this.loaded) this.load();
    return Object.values(this.flakyStore.entries)
      .filter((e) => e.isFlaky)
      .sort((a, b) => b.failureCount - a.failureCount);
  }

  /**
   * Returns all consistently broken entries (not flaky, just broken).
   */
  getBrokenLocators(): FlakyTestEntry[] {
    if (!this.loaded) this.load();
    return Object.values(this.flakyStore.entries)
      .filter((e) => !e.isFlaky && e.consecutiveFailures >= this.config.flakyThreshold)
      .sort((a, b) => b.consecutiveFailures - a.consecutiveFailures);
  }

  /**
   * Determines whether to skip healing for a known flaky locator and just retry.
   * If the locator is flaky (intermittent), a simple retry may be sufficient
   * without running the full healing pipeline.
   */
  shouldSkipHealing(testFile: string, locator: LocatorInfo): boolean {
    if (!this.config.enabled || !this.config.flakyDetection) return false;
    return this.isFlaky(testFile, locator);
  }
}
