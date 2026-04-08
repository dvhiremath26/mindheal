import { describe, it, expect, vi, afterEach } from 'vitest';
import { FileLock } from '../../src/utils/file-lock';
import type { ParallelConfig } from '../../src/types/index';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('../../src/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const config: ParallelConfig = {
  enabled: true,
  lockTimeout: 5000,
  lockRetryInterval: 10,
  staleLockThreshold: 1000,
};

const tmpFile = join(tmpdir(), `mindheal-test-${Date.now()}.json`);
const lockFile = `${tmpFile}.lock`;

afterEach(() => {
  try { if (existsSync(lockFile)) unlinkSync(lockFile); } catch {}
});

describe('FileLock', () => {
  it('should acquire and release locks', async () => {
    const lock = new FileLock(config);
    const release = await lock.acquire(tmpFile);

    expect(existsSync(lockFile)).toBe(true);
    release();
    expect(existsSync(lockFile)).toBe(false);
  });

  it('should execute withLock callback', async () => {
    const lock = new FileLock(config);
    let executed = false;

    await lock.withLock(tmpFile, () => {
      executed = true;
      expect(existsSync(lockFile)).toBe(true);
    });

    expect(executed).toBe(true);
    expect(existsSync(lockFile)).toBe(false);
  });

  it('should release lock even if callback throws', async () => {
    const lock = new FileLock(config);

    await expect(
      lock.withLock(tmpFile, () => {
        throw new Error('test error');
      }),
    ).rejects.toThrow('test error');

    expect(existsSync(lockFile)).toBe(false);
  });

  it('should return value from withLock callback', async () => {
    const lock = new FileLock(config);
    const result = await lock.withLock(tmpFile, () => 42);
    expect(result).toBe(42);
  });

  it('should be a no-op when disabled', async () => {
    const disabled = new FileLock({ ...config, enabled: false });
    const release = await disabled.acquire(tmpFile);
    expect(existsSync(lockFile)).toBe(false); // No lock created
    release(); // No-op
  });

  it('should detect stale locks and reclaim them', async () => {
    const lock = new FileLock({ ...config, staleLockThreshold: 1 }); // 1ms = immediately stale

    // Create a fake stale lock
    const { writeFileSync, mkdirSync } = require('fs');
    const { dirname } = require('path');
    try { mkdirSync(dirname(lockFile), { recursive: true }); } catch {}
    writeFileSync(lockFile, JSON.stringify({
      pid: 99999999, // Non-existent PID
      timestamp: Date.now() - 10000,
      workerId: 'old-worker',
    }));

    // Should be able to acquire despite stale lock
    const release = await lock.acquire(tmpFile);
    expect(existsSync(lockFile)).toBe(true);
    release();
  });

  it('should handle concurrent withLock calls sequentially', async () => {
    const lock = new FileLock(config);
    const order: number[] = [];

    const p1 = lock.withLock(tmpFile, async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 50));
      order.push(2);
    });

    const p2 = lock.withLock(tmpFile, async () => {
      order.push(3);
    });

    await Promise.all([p1, p2]);
    // p1 should complete before p2 starts
    expect(order[0]).toBe(1);
    expect(order[1]).toBe(2);
    expect(order[2]).toBe(3);
  });
});
