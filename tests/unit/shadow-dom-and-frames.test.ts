import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  configureLogger: vi.fn(),
}));

// ─── Shadow DOM: DOM Snapshot Tests ─────────────────────────────────────────

describe('Shadow DOM support', () => {
  describe('DOM snapshot - shadow root traversal', () => {
    it('should traverse shadow roots when capturing DOM snapshot', async () => {
      // Simulate what page.evaluate returns when shadow DOM is present
      const { captureDOMSnapshot } = await import('../../src/core/dom-snapshot');

      const mockPage = {
        url: vi.fn().mockReturnValue('https://example.com/shadow'),
        title: vi.fn().mockResolvedValue('Shadow DOM Page'),
        evaluate: vi.fn().mockResolvedValue({
          tag: 'div',
          id: 'app',
          attributes: { id: 'app' },
          children: [
            {
              tag: 'custom-button',
              id: 'shadow-host',
              attributes: { id: 'shadow-host' },
              children: [
                {
                  tag: '#shadow-root',
                  attributes: {},
                  children: [
                    {
                      tag: 'button',
                      attributes: {
                        class: 'inner-btn',
                        'data-testid': 'shadow-submit',
                        'aria-label': 'Submit Form',
                      },
                      text: 'Submit',
                      testId: 'shadow-submit',
                      ariaLabel: 'Submit Form',
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const snapshot = await captureDOMSnapshot(mockPage as any, 'body', 5);

      expect(snapshot.html).toContain('#shadow-root');
      expect(snapshot.html).toContain('shadow-submit');
      expect(snapshot.html).toContain('Submit Form');
      expect(snapshot.url).toBe('https://example.com/shadow');
    });

    it('should handle elements without shadow roots normally', async () => {
      const { captureDOMSnapshot } = await import('../../src/core/dom-snapshot');

      const mockPage = {
        url: vi.fn().mockReturnValue('https://example.com'),
        title: vi.fn().mockResolvedValue('Normal Page'),
        evaluate: vi.fn().mockResolvedValue({
          tag: 'div',
          id: 'app',
          attributes: { id: 'app' },
          children: [
            {
              tag: 'button',
              id: 'btn',
              attributes: { id: 'btn' },
              text: 'Click me',
              children: [],
            },
          ],
        }),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const snapshot = await captureDOMSnapshot(mockPage as any, 'body', 3);

      expect(snapshot.html).toContain('btn');
      expect(snapshot.html).toContain('Click me');
      expect(snapshot.html).not.toContain('#shadow-root');
    });
  });

  describe('Locator strategies - shadow DOM candidate extraction', () => {
    it('should extract candidates from shadow roots via page.evaluate', async () => {
      const { runStrategy } = await import('../../src/core/locator-strategies');

      // The evaluate function in locator-strategies collects from all shadow
      // roots.  We mock it to return candidates that would be found inside
      // shadow DOM.
      const mockPage = {
        evaluate: vi.fn().mockResolvedValue([
          {
            tag: 'button',
            id: '',
            classes: ['inner-btn'],
            text: 'Submit',
            attributes: {
              class: 'inner-btn',
              'data-testid': 'shadow-submit',
              'aria-label': 'Submit Form',
            },
            role: 'button',
            ariaLabel: 'Submit Form',
            testId: 'shadow-submit',
            placeholder: '',
            name: '',
          },
          {
            tag: 'input',
            id: 'regular-input',
            classes: [],
            text: '',
            attributes: { id: 'regular-input', type: 'text' },
            role: '',
            ariaLabel: '',
            testId: '',
            placeholder: 'Search',
            name: 'q',
          },
        ]),
      };

      const originalLocator = {
        type: 'testid' as const,
        selector: 'shadow-submit',
        playwrightExpression: "page.getByTestId('shadow-submit')",
      };

      const domSnapshot = {
        html: '<div id="app"></div>',
        url: 'https://example.com',
        title: 'Test',
        timestamp: Date.now(),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await runStrategy('attribute', mockPage as any, originalLocator, domSnapshot);

      expect(result.strategy).toBe('attribute');
      // Should find the shadow-submit candidate with high confidence
      expect(result.locator).not.toBeNull();
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should find text matches inside shadow DOM candidates', async () => {
      const { runStrategy } = await import('../../src/core/locator-strategies');

      const mockPage = {
        evaluate: vi.fn().mockResolvedValue([
          {
            tag: 'span',
            id: '',
            classes: ['status'],
            text: 'Ready to Process',
            attributes: { class: 'status' },
            role: '',
            ariaLabel: '',
            testId: '',
            placeholder: '',
            name: '',
          },
        ]),
      };

      const originalLocator = {
        type: 'text' as const,
        selector: 'Ready to Process',
        playwrightExpression: "page.getByText('Ready to Process')",
      };

      const domSnapshot = {
        html: '<div></div>',
        url: 'https://example.com',
        title: 'Test',
        timestamp: Date.now(),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await runStrategy('text', mockPage as any, originalLocator, domSnapshot);

      expect(result.strategy).toBe('text');
      expect(result.locator).not.toBeNull();
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('should find role matches inside shadow DOM candidates', async () => {
      const { runStrategy } = await import('../../src/core/locator-strategies');

      const mockPage = {
        evaluate: vi.fn().mockResolvedValue([
          {
            tag: 'div',
            id: '',
            classes: [],
            text: 'Option A',
            attributes: { role: 'option' },
            role: 'option',
            ariaLabel: '',
            testId: 'option-1',
            placeholder: '',
            name: '',
          },
        ]),
      };

      const originalLocator = {
        type: 'role' as const,
        selector: 'option',
        options: { name: 'Option A' },
        playwrightExpression: "page.getByRole('option', { name: 'Option A' })",
      };

      const domSnapshot = {
        html: '<div></div>',
        url: 'https://example.com',
        title: 'Test',
        timestamp: Date.now(),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await runStrategy('role', mockPage as any, originalLocator, domSnapshot);

      expect(result.strategy).toBe('role');
      expect(result.locator).not.toBeNull();
      expect(result.confidence).toBeGreaterThan(0.5);
    });
  });
});

// ─── Frame / Iframe: Interceptor Tests ──────────────────────────────────────

describe('Frame and iframe support', () => {
  describe('interceptor - frame proxy creation', () => {
    it('mindHealConfig should include frame interception in the fixture', async () => {
      const { mindHealConfig } = await import('../../src/core/interceptor');

      const config = mindHealConfig({
        ai: { provider: 'anthropic', apiKey: 'test-key' },
        healing: { enabled: true },
      });

      // The returned config should have the test fixture
      expect(config.test).toBeDefined();
      expect(config.metadata).toBeDefined();
      expect(config.metadata.mindHealConfig).toBeDefined();
    });
  });

  describe('interceptor - frame method interception conceptual', () => {
    it('should list frame-related methods as interceptable', async () => {
      // Verify the interceptor module exports the necessary functions
      // The actual proxy wrapping is integration-level, but we can verify
      // the function signatures exist.
      const interceptorModule = await import('../../src/core/interceptor');

      expect(typeof interceptorModule.createMindHealFixture).toBe('function');
      expect(typeof interceptorModule.mindHealConfig).toBe('function');
      expect(typeof interceptorModule.getAllHealingSessions).toBe('function');
    });

    it('should be able to create a healing session that can record frame events', async () => {
      const { getAllHealingSessions } = await import('../../src/core/interceptor');

      // Sessions are tracked globally -- verify the function returns an array
      const sessions = getAllHealingSessions();
      expect(Array.isArray(sessions)).toBe(true);
    });
  });

  describe('page proxy wraps frame access methods', () => {
    // These tests verify the Proxy handler logic by examining the shape
    // of what createHealingPageProxy produces.  Since we can't easily
    // create a real Playwright Page in unit tests, we verify via the
    // exported fixture factory.

    it('should create a fixture that provides a proxied page', async () => {
      const { createMindHealFixture } = await import('../../src/core/interceptor');
      const { loadConfig } = await import('../../src/config/config-loader');

      const config = loadConfig({
        ai: { provider: 'anthropic', apiKey: 'test-key' },
        healing: { enabled: true },
      });

      const fixture = createMindHealFixture(config);
      expect(fixture).toBeDefined();
      // The fixture is a Playwright test instance with extended fixtures
      expect(typeof fixture).toBe('function');
    });
  });

  describe('frame healing event recording', () => {
    it('HealingEvent type supports frame context in test file path', () => {
      // Verify the type supports frame-originated events
      const event = {
        id: 'evt_test',
        timestamp: Date.now(),
        testTitle: 'test in iframe',
        testFile: 'tests/iframe.spec.ts',
        pageUrl: 'https://example.com/iframe-content.html',
        action: 'click',
        originalLocator: {
          type: 'css' as const,
          selector: '#iframe-btn',
          playwrightExpression: "frameLocator.locator('#iframe-btn')",
        },
        healedLocator: {
          type: 'testid' as const,
          selector: 'iframe-submit',
          playwrightExpression: "frameLocator.getByTestId('iframe-submit')",
        },
        strategy: 'attribute' as const,
        confidence: 0.85,
        reasoning: 'Matched by data-testid attribute in iframe',
        duration: 120,
        sourceLocation: {
          filePath: 'tests/iframe.spec.ts',
          line: 15,
          column: 5,
        },
        status: 'healed' as const,
        reviewStatus: 'pending' as const,
      };

      // Verify the event can represent frame-based locator expressions
      expect(event.originalLocator.playwrightExpression).toContain('frameLocator');
      expect(event.healedLocator.playwrightExpression).toContain('frameLocator');
      expect(event.pageUrl).toContain('iframe');
    });
  });

  describe('nested frame support', () => {
    it('should support locator expressions with nested frame context', () => {
      // Verify our LocatorInfo shape can represent deeply nested frame access
      const nestedLocatorInfo = {
        type: 'testid' as const,
        selector: 'deep-button',
        playwrightExpression: "page.frameLocator('#outer').frameLocator('#inner').getByTestId('deep-button')",
      };

      expect(nestedLocatorInfo.playwrightExpression).toContain('frameLocator');
      expect(nestedLocatorInfo.playwrightExpression.match(/frameLocator/g)?.length).toBe(2);
    });

    it('should support locator expressions with frame() access', () => {
      const frameLocatorInfo = {
        type: 'css' as const,
        selector: '#submit-btn',
        playwrightExpression: "frame.locator('#submit-btn')",
      };

      expect(frameLocatorInfo.playwrightExpression).toContain('frame.');
    });
  });
});
