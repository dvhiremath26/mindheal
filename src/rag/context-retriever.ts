/**
 * RAG Context Retriever — collects relevant context from all knowledge sources.
 *
 * Before the AI healing strategy runs, the retriever searches the knowledge store
 * for entries that are relevant to the current broken locator. The returned
 * context chunks are injected into the AI prompt so the model can make better
 * decisions based on project-specific knowledge.
 *
 * Six knowledge sources are supported:
 *   1. healing-history  — previously healed locators for the same page/selector
 *   2. page-objects     — POM class metadata (selectors, method names, file paths)
 *   3. git-changes      — recent git diffs that may explain why a locator broke
 *   4. dom-snapshots    — historical DOM snapshots of the same page
 *   5. component-docs   — component library / design system documentation
 *   6. test-specs       — test file context (describe blocks, step descriptions)
 */

import type {
  RAGConfig,
  RAGContextChunk,
  RAGSourceName,
  LocatorInfo,
  HealingEvent,
} from '../types/index';
import { KnowledgeStore } from './knowledge-store';
import { logger } from '../utils/logger';

export class ContextRetriever {
  private readonly config: RAGConfig;
  private readonly store: KnowledgeStore;

  constructor(config: RAGConfig, store: KnowledgeStore) {
    this.config = config;
    this.store = store;
  }

  /**
   * Retrieve relevant context for a broken locator.
   *
   * Builds a search query from the locator info + page URL, queries the
   * knowledge store, and returns ranked context chunks that meet the
   * similarity threshold.
   */
  retrieve(
    originalLocator: LocatorInfo,
    pageUrl: string,
    action: string,
    errorMessage: string,
  ): RAGContextChunk[] {
    if (!this.config.enabled) {
      return [];
    }

    try {
      // Build a rich query from the healing context
      const query = this.buildQuery(originalLocator, pageUrl, action, errorMessage);

      logger.debug(`[RAG] Searching knowledge store with query: "${query.slice(0, 120)}..."`);

      const chunks = this.store.search(query, {
        sources: this.config.sources.length > 0 ? this.config.sources : undefined,
        maxResults: this.config.maxContextChunks,
        similarityThreshold: this.config.similarityThreshold,
      });

      if (chunks.length > 0) {
        logger.info(`[RAG] Retrieved ${chunks.length} context chunk(s) for healing`);
        for (const chunk of chunks) {
          logger.debug(
            `[RAG]   - ${chunk.source} (score: ${chunk.relevanceScore.toFixed(3)})`,
          );
        }
      } else {
        logger.debug('[RAG] No relevant context found in knowledge store');
      }

      return chunks;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[RAG] Context retrieval failed: ${msg}. Continuing without RAG context.`);
      return [];
    }
  }

  // ─── Knowledge Ingestion ──────────────────────────────────────────────────

  /**
   * Ingest a completed healing event into the knowledge store so future
   * healings can learn from it.
   */
  ingestHealingEvent(event: HealingEvent): void {
    if (!this.config.enabled) return;
    if (!this.config.sources.includes('healing-history')) return;

    try {
      const content = [
        `Page: ${event.pageUrl}`,
        `Action: ${event.action}`,
        `Original: ${event.originalLocator.playwrightExpression}`,
        event.healedLocator
          ? `Healed: ${event.healedLocator.playwrightExpression}`
          : 'Healing failed',
        `Strategy: ${event.strategy ?? 'none'}`,
        `Confidence: ${event.confidence}`,
        `Status: ${event.status}`,
      ].join('\n');

      this.store.upsert({
        source: 'healing-history',
        content,
        tags: [
          event.originalLocator.selector,
          event.originalLocator.type,
          event.pageUrl,
          event.action,
        ],
        metadata: {
          testFile: event.testFile,
          testTitle: event.testTitle,
          strategy: event.strategy ?? 'none',
          status: event.status,
        },
      });

      logger.debug(`[RAG] Ingested healing event: ${event.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[RAG] Failed to ingest healing event: ${msg}`);
    }
  }

  /**
   * Ingest page object metadata into the knowledge store.
   * Call this when scanning page object files during initialization.
   */
  ingestPageObject(filePath: string, selectors: string[], className: string): void {
    if (!this.config.enabled) return;
    if (!this.config.sources.includes('page-objects')) return;

    try {
      const content = [
        `Page Object: ${className}`,
        `File: ${filePath}`,
        `Selectors:`,
        ...selectors.map((s) => `  - ${s}`),
      ].join('\n');

      this.store.upsert({
        source: 'page-objects',
        content,
        tags: [className, filePath, ...selectors.slice(0, 10)],
        metadata: {
          className,
          filePath,
          selectorCount: String(selectors.length),
        },
      });

      logger.debug(`[RAG] Ingested page object: ${className} (${selectors.length} selectors)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[RAG] Failed to ingest page object: ${msg}`);
    }
  }

  /**
   * Ingest git diff context into the knowledge store.
   * Call this when a git change is detected that might affect locators.
   */
  ingestGitChange(filePath: string, diff: string, commitMessage: string): void {
    if (!this.config.enabled) return;
    if (!this.config.sources.includes('git-changes')) return;

    try {
      const content = [
        `File: ${filePath}`,
        `Commit: ${commitMessage}`,
        `Diff:`,
        diff.slice(0, 2000), // Truncate large diffs
      ].join('\n');

      this.store.upsert({
        source: 'git-changes',
        content,
        tags: [filePath, commitMessage.slice(0, 50)],
        metadata: {
          filePath,
          commitMessage: commitMessage.slice(0, 200),
        },
      });

      logger.debug(`[RAG] Ingested git change: ${filePath}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[RAG] Failed to ingest git change: ${msg}`);
    }
  }

  /**
   * Ingest a DOM snapshot into the knowledge store.
   * Stores a condensed version for future reference.
   */
  ingestDOMSnapshot(pageUrl: string, html: string, title: string): void {
    if (!this.config.enabled) return;
    if (!this.config.sources.includes('dom-snapshots')) return;

    try {
      const content = [
        `Page: ${pageUrl}`,
        `Title: ${title}`,
        `DOM (condensed):`,
        html.slice(0, 3000), // Store condensed version
      ].join('\n');

      this.store.upsert({
        source: 'dom-snapshots',
        content,
        tags: [pageUrl, title],
        metadata: {
          pageUrl,
          title,
          snapshotSize: String(html.length),
        },
      });

      logger.debug(`[RAG] Ingested DOM snapshot: ${pageUrl}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[RAG] Failed to ingest DOM snapshot: ${msg}`);
    }
  }

  /**
   * Ingest component/design-system documentation.
   */
  ingestComponentDoc(componentName: string, doc: string, filePath: string): void {
    if (!this.config.enabled) return;
    if (!this.config.sources.includes('component-docs')) return;

    try {
      this.store.upsert({
        source: 'component-docs',
        content: doc.slice(0, 3000),
        tags: [componentName, filePath],
        metadata: {
          componentName,
          filePath,
        },
      });

      logger.debug(`[RAG] Ingested component doc: ${componentName}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[RAG] Failed to ingest component doc: ${msg}`);
    }
  }

  /**
   * Ingest test spec context (describe blocks, test titles, step descriptions).
   */
  ingestTestSpec(testFile: string, testTitle: string, steps: string[]): void {
    if (!this.config.enabled) return;
    if (!this.config.sources.includes('test-specs')) return;

    try {
      const content = [
        `Test File: ${testFile}`,
        `Test: ${testTitle}`,
        `Steps:`,
        ...steps.map((s, i) => `  ${i + 1}. ${s}`),
      ].join('\n');

      this.store.upsert({
        source: 'test-specs',
        content,
        tags: [testFile, testTitle, ...steps.slice(0, 5)],
        metadata: {
          testFile,
          testTitle,
          stepCount: String(steps.length),
        },
      });

      logger.debug(`[RAG] Ingested test spec: ${testTitle}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[RAG] Failed to ingest test spec: ${msg}`);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Build a rich search query from the healing context.
   * Combines locator info, URL, action, and error for best TF-IDF matching.
   */
  private buildQuery(
    locator: LocatorInfo,
    pageUrl: string,
    action: string,
    errorMessage: string,
  ): string {
    const parts = [
      locator.selector,
      locator.type,
      locator.playwrightExpression,
      pageUrl,
      action,
      // Include first line of error for context
      errorMessage.split('\n')[0],
    ];

    return parts.filter(Boolean).join(' ');
  }

  /**
   * Get the knowledge store instance (for direct access / testing).
   */
  getStore(): KnowledgeStore {
    return this.store;
  }
}
