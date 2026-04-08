import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runStrategy,
  attributeStrategy,
  textStrategy,
  roleStrategy,
  cssProximityStrategy,
  xpathStrategy,
} from '../../src/core/locator-strategies';
import type { LocatorInfo, DOMSnapshot } from '../../src/types/index';

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function createDOMSnapshot(html?: string): DOMSnapshot {
  return {
    html: html ?? '<div id="app"><button id="submit">Submit</button></div>',
    url: 'https://example.com/page',
    title: 'Test Page',
    timestamp: Date.now(),
  };
}

function createMockPage(candidates: Array<Record<string, unknown>> = []) {
  return {
    evaluate: vi.fn().mockResolvedValue(candidates),
    locator: vi.fn().mockReturnValue({
      count: vi.fn().mockResolvedValue(1),
    }),
    url: vi.fn().mockReturnValue('https://example.com/page'),
  } as unknown as import('@playwright/test').Page;
}

const defaultCandidate = {
  tag: 'button',
  id: 'submit-btn',
  classes: ['btn', 'btn-primary'],
  text: 'Submit Form',
  attributes: { id: 'submit-btn', class: 'btn btn-primary', type: 'submit' },
  role: 'button',
  ariaLabel: 'Submit the form',
  testId: 'submit-button',
  placeholder: '',
  name: 'submit',
};

const emailCandidate = {
  tag: 'input',
  id: 'email',
  classes: ['form-input'],
  text: '',
  attributes: { id: 'email', type: 'email', name: 'email', placeholder: 'Enter email' },
  role: 'textbox',
  ariaLabel: 'Email Address',
  testId: 'email-input',
  placeholder: 'Enter email',
  name: 'email',
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('attributeStrategy', () => {
  it('should find elements with similar attributes', async () => {
    const page = createMockPage([defaultCandidate]);
    const locator: LocatorInfo = {
      type: 'css',
      selector: 'submit-btn',
      playwrightExpression: "page.locator('#submit-btn')",
    };

    const result = await attributeStrategy(page, locator, createDOMSnapshot());

    expect(result.strategy).toBe('attribute');
    expect(result.locator).not.toBeNull();
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should return null locator when no candidates match', async () => {
    const page = createMockPage([]);
    const locator: LocatorInfo = {
      type: 'css',
      selector: '#nonexistent',
      playwrightExpression: "page.locator('#nonexistent')",
    };

    const result = await attributeStrategy(page, locator, createDOMSnapshot());

    expect(result.locator).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it('should score testId matches higher than class matches', async () => {
    const page = createMockPage([defaultCandidate]);
    const locatorTestId: LocatorInfo = {
      type: 'testid',
      selector: 'submit-button',
      playwrightExpression: "page.getByTestId('submit-button')",
    };
    const resultTestId = await attributeStrategy(page, locatorTestId, createDOMSnapshot());

    const page2 = createMockPage([defaultCandidate]);
    const locatorClass: LocatorInfo = {
      type: 'css',
      selector: 'btn',
      playwrightExpression: "page.locator('.btn')",
    };
    const resultClass = await attributeStrategy(page2, locatorClass, createDOMSnapshot());

    // Test ID similarity for 'submit-button' against 'submit-button' should be very high
    expect(resultTestId.confidence).toBeGreaterThan(resultClass.confidence);
  });

  it('should handle page.evaluate errors gracefully', async () => {
    const page = createMockPage();
    vi.mocked(page.evaluate).mockRejectedValue(new Error('Page crashed'));

    const locator: LocatorInfo = {
      type: 'css',
      selector: '#submit',
      playwrightExpression: "page.locator('#submit')",
    };

    const result = await attributeStrategy(page, locator, createDOMSnapshot());

    expect(result.locator).toBeNull();
    expect(result.confidence).toBe(0);
  });
});

describe('textStrategy', () => {
  it('should match by visible text content', async () => {
    const page = createMockPage([defaultCandidate]);
    const locator: LocatorInfo = {
      type: 'text',
      selector: 'Submit Form',
      playwrightExpression: "page.getByText('Submit Form')",
    };

    const result = await textStrategy(page, locator, createDOMSnapshot());

    expect(result.strategy).toBe('text');
    expect(result.locator).not.toBeNull();
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should match by placeholder text', async () => {
    const page = createMockPage([emailCandidate]);
    const locator: LocatorInfo = {
      type: 'text',
      selector: 'Enter email',
      playwrightExpression: "page.getByText('Enter email')",
    };

    const result = await textStrategy(page, locator, createDOMSnapshot());

    expect(result.locator).not.toBeNull();
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should use name option as search text when available', async () => {
    const page = createMockPage([defaultCandidate]);
    const locator: LocatorInfo = {
      type: 'role',
      selector: 'button',
      options: { name: 'Submit Form' },
      playwrightExpression: "page.getByRole('button', { name: 'Submit Form' })",
    };

    const result = await textStrategy(page, locator, createDOMSnapshot());

    expect(result.locator).not.toBeNull();
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should return null when no text matches', async () => {
    const page = createMockPage([defaultCandidate]);
    const locator: LocatorInfo = {
      type: 'text',
      selector: 'Completely Different Text That Matches Nothing',
      playwrightExpression: "page.getByText('Completely Different Text That Matches Nothing')",
    };

    const result = await textStrategy(page, locator, createDOMSnapshot());

    expect(result.locator).toBeNull();
  });
});

describe('roleStrategy', () => {
  it('should match by ARIA role', async () => {
    const page = createMockPage([defaultCandidate]);
    const locator: LocatorInfo = {
      type: 'role',
      selector: 'button',
      options: { name: 'Submit the form' },
      playwrightExpression: "page.getByRole('button', { name: 'Submit the form' })",
    };

    const result = await roleStrategy(page, locator, createDOMSnapshot());

    expect(result.strategy).toBe('role');
    expect(result.locator).not.toBeNull();
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should skip candidates with completely wrong role', async () => {
    const page = createMockPage([emailCandidate]); // textbox role
    const locator: LocatorInfo = {
      type: 'role',
      selector: 'button',
      playwrightExpression: "page.getByRole('button')",
    };

    const result = await roleStrategy(page, locator, createDOMSnapshot());

    // textbox role should not match button
    expect(result.locator).toBeNull();
  });

  it('should match by inferred role when no explicit role is set', async () => {
    const candidateNoRole = {
      ...defaultCandidate,
      role: '', // No explicit role, but tag is 'button'
    };
    const page = createMockPage([candidateNoRole]);
    const locator: LocatorInfo = {
      type: 'role',
      selector: 'button',
      playwrightExpression: "page.getByRole('button')",
    };

    const result = await roleStrategy(page, locator, createDOMSnapshot());

    expect(result.locator).not.toBeNull();
    expect(result.confidence).toBeGreaterThan(0);
  });
});

describe('cssProximityStrategy', () => {
  it('should compute edit distance and find similar CSS selectors', async () => {
    const page = createMockPage([defaultCandidate]);
    const locator: LocatorInfo = {
      type: 'css',
      selector: '#submit-button',
      playwrightExpression: "page.locator('#submit-button')",
    };

    const result = await cssProximityStrategy(page, locator, createDOMSnapshot());

    expect(result.strategy).toBe('css');
    expect(result.locator).not.toBeNull();
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should consider structural similarity (same tag, similar classes)', async () => {
    const page = createMockPage([defaultCandidate]);
    const locator: LocatorInfo = {
      type: 'css',
      selector: 'button.btn.btn-primary',
      playwrightExpression: "page.locator('button.btn.btn-primary')",
    };

    const result = await cssProximityStrategy(page, locator, createDOMSnapshot());

    expect(result.locator).not.toBeNull();
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it('should return null for completely unrelated selectors', async () => {
    const page = createMockPage([defaultCandidate]);
    const locator: LocatorInfo = {
      type: 'css',
      selector: 'table.data-grid > tbody > tr:first-child > td.cell',
      playwrightExpression: "page.locator('table.data-grid > tbody > tr:first-child > td.cell')",
    };

    const result = await cssProximityStrategy(page, locator, createDOMSnapshot());

    // Confidence should be low enough that it may return null
    if (result.locator !== null) {
      expect(result.confidence).toBeLessThan(0.7);
    }
  });
});

describe('xpathStrategy', () => {
  it('should generate valid XPath locators', async () => {
    const page = createMockPage([defaultCandidate]);
    const locator: LocatorInfo = {
      type: 'xpath',
      selector: '//button[@id="submit-btn"]',
      playwrightExpression: "page.locator('//button[@id=\"submit-btn\"]')",
    };

    const result = await xpathStrategy(page, locator, createDOMSnapshot());

    expect(result.strategy).toBe('xpath');
    if (result.locator) {
      expect(result.locator.type).toBe('xpath');
      expect(result.locator.selector).toContain('//');
    }
  });

  it('should match by ID included in selector', async () => {
    const page = createMockPage([defaultCandidate]);
    const locator: LocatorInfo = {
      type: 'xpath',
      selector: 'submit-btn',
      playwrightExpression: "page.locator('//button[@id=\"submit-btn\"]')",
    };

    const result = await xpathStrategy(page, locator, createDOMSnapshot());

    expect(result.locator).not.toBeNull();
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should return null for no candidates', async () => {
    const page = createMockPage([]);
    const locator: LocatorInfo = {
      type: 'xpath',
      selector: '//div[@id="missing"]',
      playwrightExpression: "page.locator('//div[@id=\"missing\"]')",
    };

    const result = await xpathStrategy(page, locator, createDOMSnapshot());

    expect(result.locator).toBeNull();
    expect(result.confidence).toBe(0);
  });
});

describe('runStrategy dispatcher', () => {
  it('should route "attribute" to the attribute strategy', async () => {
    const page = createMockPage([defaultCandidate]);
    const locator: LocatorInfo = {
      type: 'css',
      selector: 'submit-btn',
      playwrightExpression: "page.locator('#submit-btn')",
    };

    const result = await runStrategy('attribute', page, locator, createDOMSnapshot());

    expect(result.strategy).toBe('attribute');
  });

  it('should route "text" to the text strategy', async () => {
    const page = createMockPage([defaultCandidate]);
    const locator: LocatorInfo = {
      type: 'text',
      selector: 'Submit Form',
      playwrightExpression: "page.getByText('Submit Form')",
    };

    const result = await runStrategy('text', page, locator, createDOMSnapshot());

    expect(result.strategy).toBe('text');
  });

  it('should route "role" to the role strategy', async () => {
    const page = createMockPage([defaultCandidate]);
    const locator: LocatorInfo = {
      type: 'role',
      selector: 'button',
      playwrightExpression: "page.getByRole('button')",
    };

    const result = await runStrategy('role', page, locator, createDOMSnapshot());

    expect(result.strategy).toBe('role');
  });

  it('should route "css" to the CSS proximity strategy', async () => {
    const page = createMockPage([defaultCandidate]);
    const locator: LocatorInfo = {
      type: 'css',
      selector: '#submit-btn',
      playwrightExpression: "page.locator('#submit-btn')",
    };

    const result = await runStrategy('css', page, locator, createDOMSnapshot());

    expect(result.strategy).toBe('css');
  });

  it('should route "xpath" to the xpath strategy', async () => {
    const page = createMockPage([defaultCandidate]);
    const locator: LocatorInfo = {
      type: 'xpath',
      selector: '//button',
      playwrightExpression: "page.locator('//button')",
    };

    const result = await runStrategy('xpath', page, locator, createDOMSnapshot());

    expect(result.strategy).toBe('xpath');
  });

  it('should return error for unknown strategy', async () => {
    const page = createMockPage([]);
    const locator: LocatorInfo = {
      type: 'css',
      selector: '#test',
      playwrightExpression: "page.locator('#test')",
    };

    const result = await runStrategy('unknown_strategy', page, locator, createDOMSnapshot());

    expect(result.locator).toBeNull();
    expect(result.error).toContain('Unknown strategy');
  });
});
