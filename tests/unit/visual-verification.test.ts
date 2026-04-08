import { describe, it, expect, vi } from 'vitest';
import { VisualVerifier } from '../../src/core/visual-verification';
import type { VisualVerificationConfig, LocatorInfo } from '../../src/types/index';

vi.mock('../../src/utils/file-utils', () => ({
  ensureDirectory: vi.fn(),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const config: VisualVerificationConfig = {
  enabled: true,
  screenshotDir: '/fake/screenshots',
  diffThreshold: 0.1,
  captureElement: false, // Don't capture in unit tests
  captureFullPage: false,
  keepScreenshots: true,
};

const disabledConfig: VisualVerificationConfig = {
  ...config,
  enabled: false,
};

const locator: LocatorInfo = {
  type: 'css',
  selector: '#submit',
  playwrightExpression: "page.locator('#submit')",
};

// Mock Playwright page
function createMockPage(opts: {
  count?: number;
  visible?: boolean;
  box?: { x: number; y: number; width: number; height: number } | null;
  viewport?: { width: number; height: number } | null;
} = {}) {
  const { count = 1, visible = true, box = { x: 10, y: 20, width: 100, height: 40 }, viewport = { width: 1280, height: 720 } } = opts;

  const mockElement = {
    isVisible: vi.fn().mockResolvedValue(visible),
    boundingBox: vi.fn().mockResolvedValue(box),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-screenshot')),
  };

  return {
    locator: vi.fn().mockReturnValue({
      count: vi.fn().mockResolvedValue(count),
      first: vi.fn().mockReturnValue(mockElement),
    }),
    viewportSize: vi.fn().mockReturnValue(viewport),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-page-screenshot')),
  };
}

describe('VisualVerifier', () => {
  it('should skip verification when disabled', async () => {
    const verifier = new VisualVerifier(disabledConfig);
    const page = createMockPage();

    const result = await verifier.verify(page as any, locator, 'evt_1');

    expect(result.verified).toBe(true);
    expect(page.locator).not.toHaveBeenCalled();
  });

  it('should verify a visible element with bounding box', async () => {
    const verifier = new VisualVerifier(config);
    const page = createMockPage();

    const result = await verifier.verify(page as any, locator, 'evt_1');

    expect(result.verified).toBe(true);
    expect(result.elementVisible).toBe(true);
    expect(result.boundingBox).toEqual({ x: 10, y: 20, width: 100, height: 40 });
    expect(result.elementInViewport).toBe(true);
  });

  it('should fail for invisible element', async () => {
    const verifier = new VisualVerifier(config);
    const page = createMockPage({ visible: false });

    const result = await verifier.verify(page as any, locator, 'evt_1');

    expect(result.verified).toBe(false);
    expect(result.elementVisible).toBe(false);
  });

  it('should fail when no elements found', async () => {
    const verifier = new VisualVerifier(config);
    const page = createMockPage({ count: 0 });

    const result = await verifier.verify(page as any, locator, 'evt_1');

    expect(result.verified).toBe(false);
  });

  it('should fail for zero-dimension elements', async () => {
    const verifier = new VisualVerifier(config);
    const page = createMockPage({ box: { x: 0, y: 0, width: 0, height: 0 } });

    const result = await verifier.verify(page as any, locator, 'evt_1');

    expect(result.verified).toBe(false);
  });

  it('should detect element outside viewport', async () => {
    const verifier = new VisualVerifier(config);
    const page = createMockPage({
      box: { x: 2000, y: 3000, width: 100, height: 40 },
      viewport: { width: 1280, height: 720 },
    });

    const result = await verifier.verify(page as any, locator, 'evt_1');

    expect(result.verified).toBe(true); // Still verified (exists, visible)
    expect(result.elementInViewport).toBe(false);
  });

  it('should handle null bounding box gracefully', async () => {
    const verifier = new VisualVerifier(config);
    const page = createMockPage({ box: null });

    const result = await verifier.verify(page as any, locator, 'evt_1');

    // visible=true but no bounding box → not verified
    expect(result.verified).toBe(false);
    expect(result.elementVisible).toBe(true);
    expect(result.boundingBox).toBeNull();
  });

  it('should include timestamp in result', async () => {
    const verifier = new VisualVerifier(config);
    const page = createMockPage();

    const before = Date.now();
    const result = await verifier.verify(page as any, locator, 'evt_1');

    expect(result.timestamp).toBeGreaterThanOrEqual(before);
    expect(result.timestamp).toBeLessThanOrEqual(Date.now());
  });
});
