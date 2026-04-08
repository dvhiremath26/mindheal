import type { Page } from '@playwright/test';
import type {
  MindHealConfig,
  AIProvider,
  LocatorInfo,
  HealingResult,
  StrategyAttempt,
  HealingStrategyName,
  DOMSnapshot,
  RAGContextChunk,
} from '../types/index';
import { SelfHealCache } from './self-heal-cache';
import { captureDOMSnapshot } from './dom-snapshot';
import { runStrategy } from './locator-strategies';
import { getLocatorHash } from './locator-analyzer';
import { logger } from '../utils/logger';
import { ContextRetriever } from '../rag/context-retriever';
import { SmartRetry } from './smart-retry';
import { VisualVerifier } from './visual-verification';
import { HealingAnalytics } from '../analytics/healing-analytics';

/**
 * Generates a unique event ID using a timestamp and random hex suffix.
 */
function generateEventId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `heal_${timestamp}_${random}`;
}

/**
 * The healing engine that orchestrates locator recovery.
 *
 * Executes strategies in the order defined by the configuration and stops
 * on the first result whose confidence meets or exceeds the configured threshold.
 *
 * Pipeline order: cache -> attribute -> text -> role -> css -> xpath -> ai
 */
export class Healer {
  private readonly config: MindHealConfig;
  private readonly aiProvider: AIProvider | null;
  private readonly cache: SelfHealCache;
  private readonly contextRetriever: ContextRetriever | null;
  private readonly smartRetry: SmartRetry | null;
  private readonly visualVerifier: VisualVerifier | null;
  private readonly analytics: HealingAnalytics | null;

  constructor(
    config: MindHealConfig,
    aiProvider: AIProvider | null,
    cache: SelfHealCache,
    contextRetriever?: ContextRetriever | null,
    smartRetry?: SmartRetry | null,
    visualVerifier?: VisualVerifier | null,
    analytics?: HealingAnalytics | null,
  ) {
    this.config = config;
    this.aiProvider = aiProvider;
    this.cache = cache;
    this.contextRetriever = contextRetriever ?? null;
    this.smartRetry = smartRetry ?? null;
    this.visualVerifier = visualVerifier ?? null;
    this.analytics = analytics ?? null;
  }

  /**
   * Attempts to heal a broken locator by running configured strategies in order.
   *
   * @param page       - Playwright Page instance for DOM inspection.
   * @param originalLocator - The locator that failed to resolve.
   * @param action     - The Playwright action that was attempted (e.g. "click", "fill").
   * @param error      - The original error that triggered healing.
   * @returns A HealingResult describing what happened, including all attempts.
   */
  async heal(
    page: Page,
    originalLocator: LocatorInfo,
    action: string,
    error: Error,
  ): Promise<HealingResult> {
    const eventId = generateEventId();
    const overallStart = Date.now();
    const attempts: StrategyAttempt[] = [];
    const threshold = this.config.healing.confidenceThreshold;

    logger.info(
      `[${eventId}] Healing started for "${originalLocator.playwrightExpression}" ` +
        `(action: ${action})`,
    );
    logger.debug(`[${eventId}] Original error: ${error.message}`);

    // Smart retry: wait for network idle before healing (page may still be loading)
    if (this.smartRetry) {
      await this.smartRetry.waitForNetworkIdle(page);
      await this.smartRetry.waitForDOMStable(page);
    }

    // Capture a DOM snapshot once and reuse it across strategies.
    let domSnapshot: DOMSnapshot;
    try {
      domSnapshot = await captureDOMSnapshot(
        page,
        undefined,
        this.config.healing.domSnapshotDepth ?? 3,
      );
    } catch (snapshotError) {
      const msg = snapshotError instanceof Error ? snapshotError.message : String(snapshotError);
      logger.error(`[${eventId}] DOM snapshot capture failed: ${msg}`);
      return this.buildFailureResult(originalLocator, attempts, overallStart);
    }

    const strategies = this.config.healing.strategies;

    for (const strategyName of strategies) {
      logger.debug(`[${eventId}] Trying strategy: ${strategyName}`);

      try {
        const attempt = await this.executeStrategy(
          strategyName,
          page,
          originalLocator,
          domSnapshot,
          action,
          error,
        );

        attempts.push(attempt);

        if (attempt.locator && attempt.confidence >= threshold) {
          // Verify the healed locator actually resolves on the page before accepting.
          const verified = await this.verifyLocator(page, attempt.locator);
          if (verified) {
            // Visual verification: ensure the healed element is visually correct.
            if (this.visualVerifier) {
              const visualResult = await this.visualVerifier.verify(page, attempt.locator, eventId);
              if (!visualResult.verified) {
                logger.warn(
                  `[${eventId}] Visual verification failed for strategy "${strategyName}". Continuing.`,
                );
                continue;
              }
            }

            logger.info(
              `[${eventId}] Healed by "${strategyName}" with confidence ${attempt.confidence}: ` +
                `${attempt.locator.playwrightExpression}`,
            );

            // Persist to cache for future runs.
            this.cacheResult(originalLocator, attempt.locator, strategyName, attempt.confidence, domSnapshot.url);

            return {
              success: true,
              originalLocator,
              healedLocator: attempt.locator,
              strategy: strategyName,
              confidence: attempt.confidence,
              reasoning: this.buildReasoning(strategyName, attempt, originalLocator),
              duration: Date.now() - overallStart,
              attempts,
            };
          }

          logger.debug(
            `[${eventId}] Strategy "${strategyName}" produced a locator that did not resolve. Continuing.`,
          );
        } else if (attempt.locator) {
          logger.debug(
            `[${eventId}] Strategy "${strategyName}" below threshold ` +
              `(${attempt.confidence} < ${threshold})`,
          );
        } else {
          logger.debug(`[${eventId}] Strategy "${strategyName}" found no candidate`);
        }
      } catch (strategyError) {
        const msg = strategyError instanceof Error ? strategyError.message : String(strategyError);
        logger.error(`[${eventId}] Strategy "${strategyName}" threw: ${msg}`);
        attempts.push({
          strategy: strategyName,
          locator: null,
          confidence: 0,
          duration: 0,
          error: msg,
        });
      }
    }

    logger.warn(
      `[${eventId}] All strategies exhausted. Healing failed for "${originalLocator.playwrightExpression}"`,
    );

    return this.buildFailureResult(originalLocator, attempts, overallStart);
  }

  // ── Strategy dispatch ───────────────────────────────────────────────────────

  /**
   * Executes a single named strategy and returns the attempt result.
   * The "cache" and "ai" strategies are handled specially; everything else
   * delegates to the shared `runStrategy` dispatcher.
   */
  private async executeStrategy(
    name: HealingStrategyName,
    page: Page,
    originalLocator: LocatorInfo,
    domSnapshot: DOMSnapshot,
    action: string,
    error: Error,
  ): Promise<StrategyAttempt> {
    const start = Date.now();

    if (name === 'cache') {
      return this.cacheStrategy(originalLocator, domSnapshot.url, start);
    }

    if (name === 'ai') {
      return this.aiStrategy(originalLocator, domSnapshot, action, error, start);
    }

    // All other strategies are handled by the locator-strategies module.
    return runStrategy(name, page, originalLocator, domSnapshot);
  }

  // ── Cache strategy ──────────────────────────────────────────────────────────

  private cacheStrategy(
    originalLocator: LocatorInfo,
    pageUrl: string,
    startTime: number,
  ): StrategyAttempt {
    if (!this.config.healing.cacheHeals) {
      return { strategy: 'cache', locator: null, confidence: 0, duration: Date.now() - startTime };
    }

    const hash = getLocatorHash(originalLocator, pageUrl);
    const cached = this.cache.get(hash);

    if (cached) {
      logger.debug(`Cache hit for hash ${hash}, confidence ${cached.confidence}`);
      const locator: LocatorInfo = {
        type: cached.healedType,
        selector: cached.healedSelector,
        playwrightExpression: cached.healedExpression,
      };
      return {
        strategy: 'cache',
        locator,
        confidence: cached.confidence,
        duration: Date.now() - startTime,
      };
    }

    return { strategy: 'cache', locator: null, confidence: 0, duration: Date.now() - startTime };
  }

  // ── AI strategy ─────────────────────────────────────────────────────────────

  private async aiStrategy(
    originalLocator: LocatorInfo,
    domSnapshot: DOMSnapshot,
    action: string,
    error: Error,
    startTime: number,
  ): Promise<StrategyAttempt> {
    if (!this.aiProvider) {
      logger.debug('AI strategy skipped: no AI provider configured');
      return { strategy: 'ai', locator: null, confidence: 0, duration: Date.now() - startTime };
    }

    try {
      // Retrieve RAG context to enhance the AI prompt
      let ragContext: RAGContextChunk[] | undefined;
      if (this.contextRetriever) {
        ragContext = this.contextRetriever.retrieve(
          originalLocator,
          domSnapshot.url,
          action,
          error.message,
        );
        if (ragContext.length > 0) {
          logger.debug(
            `AI strategy enriched with ${ragContext.length} RAG context chunk(s)`,
          );
        }
      }

      const response = await this.aiProvider.suggestLocator({
        originalLocator,
        domSnapshot: domSnapshot.html,
        pageUrl: domSnapshot.url,
        action,
        errorMessage: error.message,
        ragContext,
      });

      const locator: LocatorInfo = {
        type: response.locatorType,
        selector: response.selector,
        playwrightExpression: response.playwrightExpression,
      };

      return {
        strategy: 'ai',
        locator,
        confidence: response.confidence,
        duration: Date.now() - startTime,
      };
    } catch (aiError) {
      const msg = aiError instanceof Error ? aiError.message : String(aiError);
      logger.error(`AI strategy failed: ${msg}`);
      return {
        strategy: 'ai',
        locator: null,
        confidence: 0,
        duration: Date.now() - startTime,
        error: msg,
      };
    }
  }

  // ── Locator verification ────────────────────────────────────────────────────

  /**
   * Verifies that a proposed healed locator actually resolves to at least one
   * element on the page. Uses a short timeout to avoid blocking.
   */
  private async verifyLocator(page: Page, locator: LocatorInfo): Promise<boolean> {
    try {
      const resolved = page.locator(locator.selector);
      const count = await resolved.count();
      if (count === 0) {
        logger.debug(`Verification failed: "${locator.selector}" resolved 0 elements`);
        return false;
      }
      if (count > 1) {
        logger.debug(
          `Verification warning: "${locator.selector}" resolved ${count} elements (using first)`,
        );
      }
      return true;
    } catch {
      return false;
    }
  }

  // ── Cache persistence ───────────────────────────────────────────────────────

  private cacheResult(
    original: LocatorInfo,
    healed: LocatorInfo,
    strategy: HealingStrategyName,
    confidence: number,
    pageUrl: string,
  ): void {
    if (!this.config.healing.cacheHeals) return;

    const hash = getLocatorHash(original, pageUrl);

    let urlPattern: string;
    try {
      const parsed = new URL(pageUrl);
      urlPattern = `${parsed.origin}${parsed.pathname}`;
    } catch {
      urlPattern = pageUrl;
    }

    this.cache.set(hash, {
      originalSelector: original.selector,
      originalType: original.type,
      healedSelector: healed.selector,
      healedType: healed.type,
      healedExpression: healed.playwrightExpression,
      pageUrlPattern: urlPattern,
      confidence,
      strategy,
      createdAt: Date.now(),
      usageCount: 1,
      lastUsed: Date.now(),
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private buildReasoning(
    strategy: HealingStrategyName,
    attempt: StrategyAttempt,
    original: LocatorInfo,
  ): string {
    const healed = attempt.locator;
    if (!healed) return 'No healed locator produced.';

    return (
      `Strategy "${strategy}" healed "${original.playwrightExpression}" -> ` +
      `"${healed.playwrightExpression}" with confidence ${attempt.confidence}.`
    );
  }

  private buildFailureResult(
    originalLocator: LocatorInfo,
    attempts: StrategyAttempt[],
    overallStart: number,
  ): HealingResult {
    return {
      success: false,
      originalLocator,
      healedLocator: null,
      strategy: null,
      confidence: 0,
      reasoning: 'All healing strategies failed to find a suitable replacement locator.',
      duration: Date.now() - overallStart,
      attempts,
    };
  }
}
