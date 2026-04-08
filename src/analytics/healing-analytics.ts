/**
 * Healing Analytics & Metrics
 *
 * Tracks healing success rates, strategy effectiveness, per-locator healing
 * frequency, confidence trends, and test stability scores over time.
 * File-backed with auto-pruning and exportable JSON.
 */

import type {
  AnalyticsConfig,
  AnalyticsEntry,
  AnalyticsSnapshot,
  StrategyStats,
  LocatorStats,
  TestStabilityRecord,
  HealingEvent,
  HealingStrategyName,
} from '../types/index';
import { logger } from '../utils/logger';
import { readJsonFile, writeJsonFile, fileExists, ensureDirectory } from '../utils/file-utils';

const ANALYTICS_VERSION = '1';

export class HealingAnalytics {
  private readonly config: AnalyticsConfig;
  private snapshot: AnalyticsSnapshot;
  private dirty = false;

  constructor(config: AnalyticsConfig) {
    this.config = config;
    this.snapshot = this.emptySnapshot();
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  load(): void {
    if (!this.config.enabled) return;
    try {
      if (!fileExists(this.config.storePath)) {
        this.snapshot = this.emptySnapshot();
        return;
      }

      const data = readJsonFile<AnalyticsSnapshot>(this.config.storePath);
      if (!data || data.version !== ANALYTICS_VERSION) {
        this.snapshot = this.emptySnapshot();
        return;
      }

      this.snapshot = data;
      this.prune();
      logger.debug(`[Analytics] Loaded ${this.snapshot.entries.length} entries`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[Analytics] Failed to load: ${msg}`);
      this.snapshot = this.emptySnapshot();
    }
  }

  save(): void {
    if (!this.config.enabled || !this.dirty) return;
    try {
      const pathModule = require('path');
      ensureDirectory(pathModule.dirname(this.config.storePath));
      this.snapshot.lastUpdated = Date.now();
      writeJsonFile(this.config.storePath, this.snapshot);
      this.dirty = false;
      logger.debug(`[Analytics] Saved ${this.snapshot.entries.length} entries`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[Analytics] Failed to save: ${msg}`);
    }
  }

  // ─── Recording ──────────────────────────────────────────────────────────

  recordEvent(event: HealingEvent): void {
    if (!this.config.enabled) return;

    const entry: AnalyticsEntry = {
      timestamp: event.timestamp,
      testFile: event.testFile,
      testTitle: event.testTitle,
      pageUrl: event.pageUrl,
      locatorExpression: event.originalLocator.playwrightExpression,
      action: event.action,
      strategy: event.strategy,
      confidence: event.confidence,
      duration: event.duration,
      success: event.status === 'healed',
    };

    this.snapshot.entries.push(entry);
    this.dirty = true;

    // Update aggregates
    if (this.config.trackStrategies && event.strategy) {
      this.updateStrategyStats(event.strategy, entry);
    }
    if (this.config.trackLocators) {
      this.updateLocatorStats(entry);
    }
    if (this.config.trackTestStability) {
      this.updateTestStability(entry);
    }

    // Enforce max entries
    if (this.snapshot.entries.length > this.config.maxEntries) {
      this.snapshot.entries = this.snapshot.entries.slice(-this.config.maxEntries);
    }
  }

  // ─── Strategy Stats ─────────────────────────────────────────────────────

  private updateStrategyStats(strategy: HealingStrategyName, entry: AnalyticsEntry): void {
    const key = strategy;
    const existing = this.snapshot.strategyStats[key];

    if (!existing) {
      this.snapshot.strategyStats[key] = {
        name: strategy,
        totalAttempts: 1,
        successCount: entry.success ? 1 : 0,
        failCount: entry.success ? 0 : 1,
        avgConfidence: entry.confidence,
        avgDuration: entry.duration,
        successRate: entry.success ? 1 : 0,
      };
      return;
    }

    existing.totalAttempts++;
    if (entry.success) {
      existing.successCount++;
    } else {
      existing.failCount++;
    }
    existing.successRate = existing.successCount / existing.totalAttempts;
    existing.avgConfidence =
      (existing.avgConfidence * (existing.totalAttempts - 1) + entry.confidence) /
      existing.totalAttempts;
    existing.avgDuration =
      (existing.avgDuration * (existing.totalAttempts - 1) + entry.duration) /
      existing.totalAttempts;
  }

  // ─── Locator Stats ──────────────────────────────────────────────────────

  private updateLocatorStats(entry: AnalyticsEntry): void {
    const key = entry.locatorExpression;
    const existing = this.snapshot.locatorStats[key];

    if (!existing) {
      this.snapshot.locatorStats[key] = {
        expression: entry.locatorExpression,
        healCount: entry.success ? 1 : 0,
        failCount: entry.success ? 0 : 1,
        lastHealed: entry.timestamp,
        strategies: entry.strategy ? [entry.strategy] : [],
        pages: [entry.pageUrl],
      };
      return;
    }

    if (entry.success) {
      existing.healCount++;
    } else {
      existing.failCount++;
    }
    existing.lastHealed = entry.timestamp;
    if (entry.strategy && !existing.strategies.includes(entry.strategy)) {
      existing.strategies.push(entry.strategy);
    }
    if (!existing.pages.includes(entry.pageUrl)) {
      existing.pages.push(entry.pageUrl);
    }
  }

  // ─── Test Stability ─────────────────────────────────────────────────────

  private updateTestStability(entry: AnalyticsEntry): void {
    const key = `${entry.testFile}::${entry.testTitle}`;
    const existing = this.snapshot.testStability[key];

    if (!existing) {
      this.snapshot.testStability[key] = {
        testFile: entry.testFile,
        testTitle: entry.testTitle,
        totalRuns: 1,
        healsNeeded: 1,
        failedHeals: entry.success ? 0 : 1,
        stabilityScore: entry.success ? 80 : 40,
        lastRun: entry.timestamp,
        trend: 'stable',
      };
      return;
    }

    existing.totalRuns++;
    existing.healsNeeded++;
    if (!entry.success) {
      existing.failedHeals++;
    }
    existing.lastRun = entry.timestamp;

    // Compute stability score (0-100)
    // Score decreases with more healing needed and more failures
    const healRatio = existing.healsNeeded / existing.totalRuns;
    const failRatio = existing.failedHeals / existing.healsNeeded;
    existing.stabilityScore = Math.round(
      Math.max(0, 100 - healRatio * 60 - failRatio * 40),
    );

    // Compute trend from recent entries
    const recentEntries = this.snapshot.entries
      .filter((e) => e.testFile === entry.testFile && e.testTitle === entry.testTitle)
      .slice(-10);

    if (recentEntries.length >= 3) {
      const firstHalf = recentEntries.slice(0, Math.floor(recentEntries.length / 2));
      const secondHalf = recentEntries.slice(Math.floor(recentEntries.length / 2));
      const firstRate = firstHalf.filter((e) => e.success).length / firstHalf.length;
      const secondRate = secondHalf.filter((e) => e.success).length / secondHalf.length;

      if (secondRate > firstRate + 0.1) {
        existing.trend = 'improving';
      } else if (secondRate < firstRate - 0.1) {
        existing.trend = 'degrading';
      } else {
        existing.trend = 'stable';
      }
    }
  }

  // ─── Queries ────────────────────────────────────────────────────────────

  getStrategyStats(): StrategyStats[] {
    return Object.values(this.snapshot.strategyStats)
      .sort((a, b) => b.successRate - a.successRate);
  }

  getMostHealedLocators(limit = 10): LocatorStats[] {
    return Object.values(this.snapshot.locatorStats)
      .sort((a, b) => (b.healCount + b.failCount) - (a.healCount + a.failCount))
      .slice(0, limit);
  }

  getUnstableTests(limit = 10): TestStabilityRecord[] {
    return Object.values(this.snapshot.testStability)
      .sort((a, b) => a.stabilityScore - b.stabilityScore)
      .slice(0, limit);
  }

  getDegradingTests(): TestStabilityRecord[] {
    return Object.values(this.snapshot.testStability)
      .filter((t) => t.trend === 'degrading');
  }

  getOverallStats(): {
    totalHeals: number;
    successRate: number;
    avgConfidence: number;
    avgDuration: number;
    uniqueLocators: number;
    uniqueTests: number;
  } {
    const entries = this.snapshot.entries;
    const total = entries.length;
    const successful = entries.filter((e) => e.success).length;

    return {
      totalHeals: total,
      successRate: total > 0 ? successful / total : 0,
      avgConfidence: total > 0
        ? entries.reduce((sum, e) => sum + e.confidence, 0) / total
        : 0,
      avgDuration: total > 0
        ? entries.reduce((sum, e) => sum + e.duration, 0) / total
        : 0,
      uniqueLocators: Object.keys(this.snapshot.locatorStats).length,
      uniqueTests: Object.keys(this.snapshot.testStability).length,
    };
  }

  getSnapshot(): AnalyticsSnapshot {
    return { ...this.snapshot };
  }

  // ─── Maintenance ────────────────────────────────────────────────────────

  private prune(): void {
    const cutoff = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000;
    const before = this.snapshot.entries.length;
    this.snapshot.entries = this.snapshot.entries.filter((e) => e.timestamp > cutoff);

    if (this.snapshot.entries.length < before) {
      this.dirty = true;
      logger.debug(
        `[Analytics] Pruned ${before - this.snapshot.entries.length} old entries`,
      );
    }
  }

  private emptySnapshot(): AnalyticsSnapshot {
    return {
      version: ANALYTICS_VERSION,
      entries: [],
      strategyStats: {},
      locatorStats: {},
      testStability: {},
      lastUpdated: Date.now(),
    };
  }
}
