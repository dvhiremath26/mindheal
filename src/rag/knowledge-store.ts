/**
 * File-backed knowledge store for RAG context.
 *
 * Stores healing history, page object metadata, git diffs, DOM snapshots,
 * component docs, and test specs as searchable entries. Uses lightweight
 * TF-IDF similarity for retrieval — no vector DB required.
 */

import type {
  RAGKnowledgeEntry,
  RAGKnowledgeStore,
  RAGSourceName,
  RAGContextChunk,
} from '../types/index';
import { textSimilarity, tokenize, buildTermVector, cosineSimilarity } from './embeddings';
import { logger } from '../utils/logger';
import { readJsonFile, writeJsonFile, fileExists, ensureDirectory } from '../utils/file-utils';
import { dirname } from 'path';

const STORE_VERSION = '1';
const MAX_ENTRIES = 2000;
const ENTRY_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export class KnowledgeStore {
  private readonly storePath: string;
  private entries: RAGKnowledgeEntry[];
  private loaded: boolean;

  constructor(storePath: string) {
    this.storePath = storePath;
    this.entries = [];
    this.loaded = false;
  }

  // ─── Load / Save ─────────────────────────────────────────────────────────

  load(): void {
    logger.debug(`Loading RAG knowledge store from: ${this.storePath}`);

    if (!fileExists(this.storePath)) {
      logger.debug('No existing knowledge store found, starting empty');
      this.entries = [];
      this.loaded = true;
      return;
    }

    try {
      const raw = readJsonFile(this.storePath) as RAGKnowledgeStore;
      if (raw && raw.version === STORE_VERSION && Array.isArray(raw.entries)) {
        // Prune expired entries
        const now = Date.now();
        this.entries = raw.entries.filter((e) => now - e.createdAt < ENTRY_EXPIRY_MS);

        const pruned = raw.entries.length - this.entries.length;
        if (pruned > 0) {
          logger.debug(`Pruned ${pruned} expired knowledge entries`);
        }
      } else {
        logger.debug('Knowledge store version mismatch, starting fresh');
        this.entries = [];
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Failed to load knowledge store: ${msg}. Starting fresh.`);
      this.entries = [];
    }

    this.loaded = true;
  }

  save(): void {
    try {
      ensureDirectory(dirname(this.storePath));
      const store: RAGKnowledgeStore = {
        version: STORE_VERSION,
        entries: this.entries,
      };
      writeJsonFile(this.storePath, store);
      logger.debug(`Knowledge store saved: ${this.entries.length} entries`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Failed to save knowledge store: ${msg}`);
    }
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  add(entry: Omit<RAGKnowledgeEntry, 'id' | 'createdAt' | 'updatedAt'>): RAGKnowledgeEntry {
    const now = Date.now();
    const id = `rag_${now.toString(36)}_${Math.random().toString(36).substring(2, 8)}`;

    const full: RAGKnowledgeEntry = {
      ...entry,
      id,
      createdAt: now,
      updatedAt: now,
    };

    this.entries.push(full);

    // Enforce max entries — evict oldest
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.sort((a, b) => b.updatedAt - a.updatedAt);
      this.entries = this.entries.slice(0, MAX_ENTRIES);
    }

    this.save();
    return full;
  }

  /**
   * Add or update an entry. If an entry with matching source + tags exists,
   * update it instead of creating a duplicate.
   */
  upsert(entry: Omit<RAGKnowledgeEntry, 'id' | 'createdAt' | 'updatedAt'>): RAGKnowledgeEntry {
    const existing = this.entries.find(
      (e) =>
        e.source === entry.source &&
        e.tags.length === entry.tags.length &&
        e.tags.every((t, i) => t === entry.tags[i]),
    );

    if (existing) {
      existing.content = entry.content;
      existing.metadata = entry.metadata;
      existing.updatedAt = Date.now();
      this.save();
      return existing;
    }

    return this.add(entry);
  }

  getAll(): RAGKnowledgeEntry[] {
    return [...this.entries];
  }

  getBySource(source: RAGSourceName): RAGKnowledgeEntry[] {
    return this.entries.filter((e) => e.source === source);
  }

  // ─── Search ───────────────────────────────────────────────────────────────

  /**
   * Search the knowledge store for entries relevant to the query.
   * Returns ranked results above the similarity threshold.
   */
  search(
    query: string,
    options: {
      sources?: RAGSourceName[];
      maxResults?: number;
      similarityThreshold?: number;
    } = {},
  ): RAGContextChunk[] {
    const {
      sources,
      maxResults = 5,
      similarityThreshold = 0.3,
    } = options;

    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const queryVector = buildTermVector(queryTokens);

    // Filter by source if specified
    const candidates = sources
      ? this.entries.filter((e) => sources.includes(e.source))
      : this.entries;

    // Score each entry
    const scored: Array<{ entry: RAGKnowledgeEntry; score: number }> = [];

    for (const entry of candidates) {
      // Build a combined text from content + tags for matching
      const entryText = `${entry.content} ${entry.tags.join(' ')}`;
      const entryTokens = tokenize(entryText);
      const entryVector = buildTermVector(entryTokens);

      const score = cosineSimilarity(queryVector, entryVector);

      if (score >= similarityThreshold) {
        scored.push({ entry, score });
      }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Return top results as RAGContextChunks
    return scored.slice(0, maxResults).map(({ entry, score }) => ({
      source: entry.source,
      content: entry.content,
      relevanceScore: score,
      metadata: entry.metadata,
    }));
  }

  /**
   * Get entry count.
   */
  get size(): number {
    return this.entries.length;
  }
}
