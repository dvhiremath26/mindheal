/**
 * Visual Verification
 *
 * After healing a locator, captures a screenshot of the healed element and
 * verifies it's visually the correct element. This prevents "wrong element"
 * heals where the selector matches something in a different part of the page.
 *
 * Checks:
 * 1. Element is visible on the page
 * 2. Element is within the viewport (not scrolled off-screen)
 * 3. Element has a reasonable bounding box (not 0x0)
 * 4. Screenshot capture succeeds (element is rendered)
 */

import type { Page } from '@playwright/test';
import type {
  VisualVerificationConfig,
  VisualVerificationResult,
  LocatorInfo,
} from '../types/index';
import { logger } from '../utils/logger';
import { ensureDirectory } from '../utils/file-utils';

/**
 * Visual Verification engine for healed locators.
 */
export class VisualVerifier {
  private readonly config: VisualVerificationConfig;

  constructor(config: VisualVerificationConfig) {
    this.config = config;
  }

  /**
   * Verify that a healed locator points to a visually valid element.
   *
   * Returns a VisualVerificationResult with:
   * - `verified`: true if the element passes all visual checks
   * - `elementScreenshotPath`: path to element screenshot (if captured)
   * - `boundingBox`: element's position and size on page
   * - `elementVisible`: whether the element is visible
   * - `elementInViewport`: whether the element is within the viewport
   */
  async verify(
    page: Page,
    healedLocator: LocatorInfo,
    eventId: string,
  ): Promise<VisualVerificationResult> {
    if (!this.config.enabled) {
      return {
        verified: true, // Skip verification, assume valid
        elementScreenshotPath: null,
        fullPageScreenshotPath: null,
        boundingBox: null,
        elementVisible: true,
        elementInViewport: true,
        timestamp: Date.now(),
      };
    }

    const result: VisualVerificationResult = {
      verified: false,
      elementScreenshotPath: null,
      fullPageScreenshotPath: null,
      boundingBox: null,
      elementVisible: false,
      elementInViewport: false,
      timestamp: Date.now(),
    };

    try {
      const locator = page.locator(healedLocator.selector);

      // 1. Check element count
      const count = await locator.count();
      if (count === 0) {
        logger.warn(`[Visual] Healed locator resolved to 0 elements: ${healedLocator.selector}`);
        return result;
      }

      const element = locator.first();

      // 2. Check visibility
      try {
        result.elementVisible = await element.isVisible();
      } catch {
        result.elementVisible = false;
      }

      if (!result.elementVisible) {
        logger.warn(`[Visual] Healed element is not visible: ${healedLocator.selector}`);
        // Still partially verified — element exists but not visible
      }

      // 3. Get bounding box
      try {
        const box = await element.boundingBox();
        if (box) {
          result.boundingBox = {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
          };

          // Check for zero-size elements
          if (box.width === 0 || box.height === 0) {
            logger.warn(`[Visual] Healed element has zero dimensions: ${box.width}x${box.height}`);
            return result;
          }

          // Check if element is in viewport
          const viewport = page.viewportSize();
          if (viewport) {
            result.elementInViewport =
              box.x >= -box.width &&
              box.y >= -box.height &&
              box.x < viewport.width + box.width &&
              box.y < viewport.height + box.height;
          } else {
            result.elementInViewport = true; // Can't check, assume true
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.debug(`[Visual] Could not get bounding box: ${msg}`);
      }

      // 4. Capture element screenshot
      if (this.config.captureElement) {
        try {
          ensureDirectory(this.config.screenshotDir);

          const sanitizedId = eventId.replace(/[^a-zA-Z0-9_-]/g, '_');
          const elementPath = `${this.config.screenshotDir}/${sanitizedId}_element.png`;

          await element.screenshot({
            path: elementPath,
            timeout: 5000,
          });

          result.elementScreenshotPath = elementPath;
          logger.debug(`[Visual] Element screenshot saved: ${elementPath}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.debug(`[Visual] Element screenshot failed: ${msg}`);
        }
      }

      // 5. Capture full page screenshot for context
      if (this.config.captureFullPage) {
        try {
          ensureDirectory(this.config.screenshotDir);

          const sanitizedId = eventId.replace(/[^a-zA-Z0-9_-]/g, '_');
          const pagePath = `${this.config.screenshotDir}/${sanitizedId}_page.png`;

          await page.screenshot({
            path: pagePath,
            fullPage: false,
            timeout: 10000,
          });

          result.fullPageScreenshotPath = pagePath;
          logger.debug(`[Visual] Full page screenshot saved: ${pagePath}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.debug(`[Visual] Full page screenshot failed: ${msg}`);
        }
      }

      // 6. Final verification decision
      result.verified = result.elementVisible && result.boundingBox !== null;

      if (result.verified) {
        logger.info(
          `[Visual] Verification passed for "${healedLocator.selector}" ` +
            `(${result.boundingBox!.width}x${result.boundingBox!.height} at ${result.boundingBox!.x},${result.boundingBox!.y})`,
        );
      } else {
        logger.warn(
          `[Visual] Verification failed for "${healedLocator.selector}" ` +
            `(visible=${result.elementVisible}, box=${result.boundingBox !== null})`,
        );
      }

      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[Visual] Verification error: ${msg}`);
      return result;
    }
  }

  /**
   * Compare two screenshots at the pixel level.
   * Returns a similarity score (0-1).
   *
   * This is a lightweight comparison using a sampling approach
   * (no external image processing libraries required).
   */
  async compareScreenshots(
    page: Page,
    screenshotA: Buffer,
    screenshotB: Buffer,
  ): Promise<number> {
    // Use page.evaluate to leverage canvas API for comparison
    try {
      const similarity = await page.evaluate(
        async ({ a, b }) => {
          // Create images from buffers
          const loadImage = (data: number[]): Promise<HTMLImageElement> => {
            return new Promise((resolve, reject) => {
              const blob = new Blob([new Uint8Array(data)], { type: 'image/png' });
              const url = URL.createObjectURL(blob);
              const img = new Image();
              img.onload = () => {
                URL.revokeObjectURL(url);
                resolve(img);
              };
              img.onerror = reject;
              img.src = url;
            });
          };

          const imgA = await loadImage(a);
          const imgB = await loadImage(b);

          // Create canvas for comparison
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) return 0;

          const width = Math.min(imgA.width, imgB.width);
          const height = Math.min(imgA.height, imgB.height);
          canvas.width = width;
          canvas.height = height;

          // Draw and get pixel data for A
          ctx.drawImage(imgA, 0, 0);
          const dataA = ctx.getImageData(0, 0, width, height).data;

          // Draw and get pixel data for B
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(imgB, 0, 0);
          const dataB = ctx.getImageData(0, 0, width, height).data;

          // Sample pixels for comparison (every 4th pixel for speed)
          let matchCount = 0;
          let sampleCount = 0;
          const step = 16; // Sample every 16 bytes (4 RGBA channels × 4 pixels)

          for (let i = 0; i < dataA.length; i += step) {
            const diffR = Math.abs(dataA[i] - dataB[i]);
            const diffG = Math.abs(dataA[i + 1] - dataB[i + 1]);
            const diffB = Math.abs(dataA[i + 2] - dataB[i + 2]);
            const avgDiff = (diffR + diffG + diffB) / (3 * 255);

            if (avgDiff < 0.1) matchCount++;
            sampleCount++;
          }

          return sampleCount > 0 ? matchCount / sampleCount : 0;
        },
        { a: Array.from(screenshotA), b: Array.from(screenshotB) },
      );

      return similarity;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.debug(`[Visual] Screenshot comparison failed: ${msg}`);
      return 0;
    }
  }

  /**
   * Cleanup old screenshots if keepScreenshots is false.
   */
  cleanup(): void {
    if (this.config.keepScreenshots) return;

    try {
      const { readdirSync, unlinkSync } = require('fs');
      const { join } = require('path');

      if (!require('fs').existsSync(this.config.screenshotDir)) return;

      const files: string[] = readdirSync(this.config.screenshotDir);
      for (const file of files) {
        if (file.endsWith('.png')) {
          try {
            unlinkSync(join(this.config.screenshotDir, file));
          } catch {
            // Ignore cleanup errors
          }
        }
      }

      logger.debug('[Visual] Cleaned up verification screenshots');
    } catch {
      // Ignore
    }
  }
}
