import type { CacheEntry, HealCache } from '../types/index';
import { readJsonFile, writeJsonFile, fileExists, ensureDirectory } from '../utils/file-utils';
import { logger } from '../utils/logger';
import { dirname } from 'path';

/**
 * Default cache file path, relative to the project root.
 */
const DEFAULT_CACHE_PATH = '.mindheal/cache.json';

/**
 * Cache entries older than this are evicted on load (30 days in milliseconds).
 */
const CACHE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Current cache format version.
 */
const CACHE_VERSION = '1';

/**
 * In-memory + file-backed cache for healed locator mappings.
 *
 * Keys are hashes of (original selector + page URL pattern), generated
 * by `getLocatorHash` from the locator-analyzer module.
 *
 * The cache is loaded from disk on initialization and saved after every mutation.
 * Entries older than 30 days are pruned during load.
 */
export class SelfHealCache {
  private readonly cachePath: string;
  private entries: Map<string, CacheEntry>;
  private loaded: boolean;

  constructor(cachePath?: string) {
    this.cachePath = cachePath ?? DEFAULT_CACHE_PATH;
    this.entries = new Map();
    this.loaded = false;
  }

  /**
   * Loads the cache from disk. Prunes expired entries.
   * Safe to call multiple times; subsequent calls reload from disk.
   */
  load(): void {
    logger.debug(`Loading heal cache from: ${this.cachePath}`);

    if (!fileExists(this.cachePath)) {
      logger.debug('No existing cache file found, starting with empty cache');
      this.entries = new Map();
      this.loaded = true;
      return;
    }

    try {
      const data = readJsonFile<HealCache>(this.cachePath);

      if (!data || !data.entries) {
        logger.warn('Cache file is empty or malformed, starting with empty cache');
        this.entries = new Map();
        this.loaded = true;
        return;
      }

      // Check version compatibility
      if (data.version !== CACHE_VERSION) {
        logger.warn(
          `Cache version mismatch (found: ${data.version}, expected: ${CACHE_VERSION}). Resetting cache.`,
        );
        this.entries = new Map();
        this.loaded = true;
        this.save();
        return;
      }

      const now = Date.now();
      let pruned = 0;

      this.entries = new Map();
      for (const [hash, entry] of Object.entries(data.entries)) {
        if (now - entry.lastUsed > CACHE_EXPIRY_MS) {
          pruned++;
          continue;
        }
        this.entries.set(hash, entry);
      }

      this.loaded = true;

      if (pruned > 0) {
        logger.info(`Pruned ${pruned} expired cache entries`);
        this.save();
      }

      logger.debug(`Loaded ${this.entries.size} cache entries`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to load cache: ${message}`);
      this.entries = new Map();
      this.loaded = true;
    }
  }

  /**
   * Persists the current in-memory cache to disk.
   */
  save(): void {
    try {
      ensureDirectory(dirname(this.cachePath));

      const data: HealCache = {
        version: CACHE_VERSION,
        entries: Object.fromEntries(this.entries),
      };

      writeJsonFile(this.cachePath, data);
      logger.debug(`Saved ${this.entries.size} cache entries to disk`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to save cache: ${message}`);
    }
  }

  /**
   * Ensures the cache is loaded before any read/write operation.
   */
  private ensureLoaded(): void {
    if (!this.loaded) {
      this.load();
    }
  }

  /**
   * Retrieves a cache entry by hash. Updates usage count and timestamp on hit.
   * Returns `undefined` if not found.
   */
  get(hash: string): CacheEntry | undefined {
    this.ensureLoaded();

    const entry = this.entries.get(hash);
    if (!entry) return undefined;

    // Check if expired
    if (Date.now() - entry.lastUsed > CACHE_EXPIRY_MS) {
      this.entries.delete(hash);
      this.save();
      return undefined;
    }

    // Update usage tracking
    entry.usageCount++;
    entry.lastUsed = Date.now();
    this.entries.set(hash, entry);
    this.save();

    logger.debug(`Cache hit for hash: ${hash}, usage count: ${entry.usageCount}`);
    return entry;
  }

  /**
   * Stores or updates a cache entry.
   */
  set(hash: string, entry: CacheEntry): void {
    this.ensureLoaded();

    this.entries.set(hash, entry);
    this.save();

    logger.debug(`Cache set for hash: ${hash}`);
  }

  /**
   * Checks if a non-expired entry exists for the given hash.
   */
  has(hash: string): boolean {
    this.ensureLoaded();

    const entry = this.entries.get(hash);
    if (!entry) return false;

    if (Date.now() - entry.lastUsed > CACHE_EXPIRY_MS) {
      this.entries.delete(hash);
      this.save();
      return false;
    }

    return true;
  }

  /**
   * Removes all entries from the cache and saves the empty state to disk.
   */
  clear(): void {
    this.entries = new Map();
    this.loaded = true;
    this.save();
    logger.info('Cache cleared');
  }

  /**
   * Returns the number of entries currently in the cache.
   */
  get size(): number {
    this.ensureLoaded();
    return this.entries.size;
  }
}
