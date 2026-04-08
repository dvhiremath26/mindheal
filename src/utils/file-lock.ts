/**
 * Parallel Execution Safety — File Locking
 *
 * Provides advisory file locking for shared resources (cache, knowledge store,
 * analytics) when Playwright tests run with multiple workers or shards.
 *
 * Uses .lock files with PID + timestamp to detect stale locks.
 * Cross-platform (Windows + macOS + Linux).
 */

import {
  writeFileSync,
  readFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
} from 'fs';
import { dirname } from 'path';
import type { ParallelConfig } from '../types/index';
import { logger } from './logger';

interface LockInfo {
  pid: number;
  timestamp: number;
  workerId: string;
}

export class FileLock {
  private readonly config: ParallelConfig;

  constructor(config: ParallelConfig) {
    this.config = config;
  }

  /**
   * Acquires an advisory lock on the given file path.
   * Returns a release function that MUST be called when done.
   *
   * @param filePath - The file to lock (a .lock file is created alongside it)
   * @returns A function to release the lock
   * @throws If the lock cannot be acquired within the timeout
   */
  async acquire(filePath: string): Promise<() => void> {
    if (!this.config.enabled) {
      return () => {}; // No-op release
    }

    const lockPath = `${filePath}.lock`;
    const startTime = Date.now();
    const workerId = `${process.pid}-${Math.random().toString(36).substring(2, 8)}`;

    while (Date.now() - startTime < this.config.lockTimeout) {
      // Check for existing lock
      if (existsSync(lockPath)) {
        const isStale = this.isLockStale(lockPath);
        if (isStale) {
          logger.debug(`[FileLock] Removing stale lock: ${lockPath}`);
          this.removeLock(lockPath);
        } else {
          // Wait and retry
          await new Promise((resolve) =>
            setTimeout(resolve, this.config.lockRetryInterval),
          );
          continue;
        }
      }

      // Try to create the lock
      try {
        const dir = dirname(lockPath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }

        const lockInfo: LockInfo = {
          pid: process.pid,
          timestamp: Date.now(),
          workerId,
        };

        // Write lock file atomically-ish (best effort)
        writeFileSync(lockPath, JSON.stringify(lockInfo), { flag: 'wx' });

        logger.debug(`[FileLock] Acquired lock: ${lockPath} (worker: ${workerId})`);

        // Return release function
        return () => {
          this.removeLock(lockPath);
          logger.debug(`[FileLock] Released lock: ${lockPath}`);
        };
      } catch (err) {
        // File already exists (another process beat us) — retry
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
          await new Promise((resolve) =>
            setTimeout(resolve, this.config.lockRetryInterval),
          );
          continue;
        }
        throw err;
      }
    }

    throw new Error(
      `[MindHeal] Could not acquire file lock for ${filePath} within ${this.config.lockTimeout}ms`,
    );
  }

  /**
   * Executes a function while holding a file lock.
   * Automatically acquires and releases the lock.
   */
  async withLock<T>(filePath: string, fn: () => T | Promise<T>): Promise<T> {
    if (!this.config.enabled) {
      return fn();
    }

    const release = await this.acquire(filePath);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Checks if a lock file is stale (process dead or too old).
   */
  private isLockStale(lockPath: string): boolean {
    try {
      const content = readFileSync(lockPath, 'utf-8');
      const info: LockInfo = JSON.parse(content);

      // Check timestamp
      if (Date.now() - info.timestamp > this.config.staleLockThreshold) {
        return true;
      }

      // Check if PID is still alive
      try {
        process.kill(info.pid, 0); // Signal 0 = check if process exists
        return false; // Process is alive
      } catch {
        return true; // Process is dead
      }
    } catch {
      return true; // Can't read lock — treat as stale
    }
  }

  /**
   * Safely removes a lock file.
   */
  private removeLock(lockPath: string): void {
    try {
      if (existsSync(lockPath)) {
        unlinkSync(lockPath);
      }
    } catch {
      // Ignore — another process may have removed it
    }
  }
}
