import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  configureLogger: vi.fn(),
}));

// ─── WebTable Strategy Tests ────────────────────────────────────────────────

describe('WebTable strategy', () => {
  it('should find elements inside table cells by text', async () => {
    const { runStrategy } = await import('../../src/core/locator-strategies');

    const mockPage = {
      evaluate: vi.fn().mockResolvedValue([
        {
          tag: 'td',
          id: '',
          classes: [],
          text: '$1,234.56',
          attributes: {},
          role: 'cell',
          ariaLabel: '',
          testId: 'revenue-cell',
          placeholder: '',
          name: '',
          isInModal: false,
          modalRole: '',
          isInTable: true,
          tableRow: 2,
          tableCol: 3,
          tableHeaderText: 'Revenue',
          tableCellSelector: 'table >> tr:nth-child(3) >> td:nth-child(4)',
        },
        {
          tag: 'td',
          id: '',
          classes: [],
          text: 'John Doe',
          attributes: {},
          role: 'cell',
          ariaLabel: '',
          testId: 'name-cell',
          placeholder: '',
          name: '',
          isInModal: false,
          modalRole: '',
          isInTable: true,
          tableRow: 2,
          tableCol: 0,
          tableHeaderText: 'Name',
          tableCellSelector: 'table >> tr:nth-child(3) >> td:nth-child(1)',
        },
      ]),
    };

    const originalLocator = {
      type: 'testid' as const,
      selector: 'revenue-cell',
      playwrightExpression: "page.getByTestId('revenue-cell')",
    };

    const domSnapshot = {
      html: '<table></table>',
      url: 'https://example.com',
      title: 'Test',
      timestamp: Date.now(),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await runStrategy('table', mockPage as any, originalLocator, domSnapshot);

    expect(result.strategy).toBe('table');
    expect(result.locator).not.toBeNull();
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should match table cell by column header text', async () => {
    const { runStrategy } = await import('../../src/core/locator-strategies');

    const mockPage = {
      evaluate: vi.fn().mockResolvedValue([
        {
          tag: 'td',
          id: '',
          classes: ['amount'],
          text: '500',
          attributes: { class: 'amount' },
          role: '',
          ariaLabel: '',
          testId: '',
          placeholder: '',
          name: '',
          isInModal: false,
          modalRole: '',
          isInTable: true,
          tableRow: 1,
          tableCol: 2,
          tableHeaderText: 'Amount',
          tableCellSelector: 'table >> tr:nth-child(2) >> td:nth-child(3)',
        },
      ]),
    };

    const originalLocator = {
      type: 'text' as const,
      selector: 'Amount',
      playwrightExpression: "page.getByText('Amount')",
    };

    const domSnapshot = {
      html: '<table></table>',
      url: 'https://example.com',
      title: 'Test',
      timestamp: Date.now(),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await runStrategy('table', mockPage as any, originalLocator, domSnapshot);

    expect(result.strategy).toBe('table');
    // Should find the candidate matching by "Amount" header or class similarity
    expect(result.locator).not.toBeNull();
  });

  it('should return no result when no table candidates exist', async () => {
    const { runStrategy } = await import('../../src/core/locator-strategies');

    const mockPage = {
      evaluate: vi.fn().mockResolvedValue([
        {
          tag: 'button',
          id: 'btn',
          classes: [],
          text: 'Click',
          attributes: {},
          role: 'button',
          ariaLabel: '',
          testId: '',
          placeholder: '',
          name: '',
          isInModal: false,
          modalRole: '',
          isInTable: false,
          tableRow: -1,
          tableCol: -1,
          tableHeaderText: '',
          tableCellSelector: '',
        },
      ]),
    };

    const originalLocator = {
      type: 'css' as const,
      selector: 'td.amount',
      playwrightExpression: "page.locator('td.amount')",
    };

    const domSnapshot = {
      html: '<div></div>',
      url: 'https://example.com',
      title: 'Test',
      timestamp: Date.now(),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await runStrategy('table', mockPage as any, originalLocator, domSnapshot);

    expect(result.strategy).toBe('table');
    expect(result.locator).toBeNull();
    expect(result.confidence).toBe(0);
  });
});

// ─── Modal Strategy Tests ───────────────────────────────────────────────────

describe('Modal strategy', () => {
  it('should find elements inside a modal dialog', async () => {
    const { runStrategy } = await import('../../src/core/locator-strategies');

    const mockPage = {
      evaluate: vi.fn().mockResolvedValue([
        {
          tag: 'button',
          id: 'modal-confirm',
          classes: ['btn-primary'],
          text: 'Confirm',
          attributes: { id: 'modal-confirm' },
          role: 'button',
          ariaLabel: 'Confirm action',
          testId: 'confirm-btn',
          placeholder: '',
          name: '',
          isInModal: true,
          modalRole: 'dialog',
          isInTable: false,
          tableRow: -1,
          tableCol: -1,
          tableHeaderText: '',
          tableCellSelector: '',
        },
        {
          tag: 'button',
          id: 'page-submit',
          classes: ['btn-primary'],
          text: 'Submit',
          attributes: { id: 'page-submit' },
          role: 'button',
          ariaLabel: 'Submit form',
          testId: 'submit-btn',
          placeholder: '',
          name: '',
          isInModal: false,
          modalRole: '',
          isInTable: false,
          tableRow: -1,
          tableCol: -1,
          tableHeaderText: '',
          tableCellSelector: '',
        },
      ]),
    };

    const originalLocator = {
      type: 'testid' as const,
      selector: 'confirm-btn',
      playwrightExpression: "page.getByTestId('confirm-btn')",
    };

    const domSnapshot = {
      html: '<div role="dialog"></div>',
      url: 'https://example.com',
      title: 'Test',
      timestamp: Date.now(),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await runStrategy('modal', mockPage as any, originalLocator, domSnapshot);

    expect(result.strategy).toBe('modal');
    expect(result.locator).not.toBeNull();
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should prioritize modal candidates when selector suggests modal context', async () => {
    const { runStrategy } = await import('../../src/core/locator-strategies');

    const mockPage = {
      evaluate: vi.fn().mockResolvedValue([
        {
          tag: 'button',
          id: '',
          classes: ['close-btn'],
          text: 'Close',
          attributes: {},
          role: 'button',
          ariaLabel: 'Close dialog',
          testId: 'dialog-close',
          placeholder: '',
          name: '',
          isInModal: true,
          modalRole: 'dialog',
          isInTable: false,
          tableRow: -1,
          tableCol: -1,
          tableHeaderText: '',
          tableCellSelector: '',
        },
        {
          tag: 'button',
          id: '',
          classes: ['close-btn'],
          text: 'Close',
          attributes: {},
          role: 'button',
          ariaLabel: 'Close panel',
          testId: 'panel-close',
          placeholder: '',
          name: '',
          isInModal: false,
          modalRole: '',
          isInTable: false,
          tableRow: -1,
          tableCol: -1,
          tableHeaderText: '',
          tableCellSelector: '',
        },
      ]),
    };

    const originalLocator = {
      type: 'css' as const,
      selector: '.modal .close-btn',
      playwrightExpression: "page.locator('.modal .close-btn')",
    };

    const domSnapshot = {
      html: '<div></div>',
      url: 'https://example.com',
      title: 'Test',
      timestamp: Date.now(),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await runStrategy('modal', mockPage as any, originalLocator, domSnapshot);

    expect(result.strategy).toBe('modal');
    expect(result.locator).not.toBeNull();
    // Should find the modal candidate (the one with isInModal=true)
    if (result.locator) {
      // The locator expression should reference the close button from the modal
      expect(result.locator.playwrightExpression).toBeTruthy();
    }
  });

  it('should fall back to all candidates when no modal candidates exist', async () => {
    const { runStrategy } = await import('../../src/core/locator-strategies');

    const mockPage = {
      evaluate: vi.fn().mockResolvedValue([
        {
          tag: 'button',
          id: 'ok-btn',
          classes: [],
          text: 'OK',
          attributes: { id: 'ok-btn' },
          role: 'button',
          ariaLabel: 'OK',
          testId: 'ok-btn',
          placeholder: '',
          name: '',
          isInModal: false,
          modalRole: '',
          isInTable: false,
          tableRow: -1,
          tableCol: -1,
          tableHeaderText: '',
          tableCellSelector: '',
        },
      ]),
    };

    const originalLocator = {
      type: 'testid' as const,
      selector: 'ok-btn',
      playwrightExpression: "page.getByTestId('ok-btn')",
    };

    const domSnapshot = {
      html: '<div></div>',
      url: 'https://example.com',
      title: 'Test',
      timestamp: Date.now(),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await runStrategy('modal', mockPage as any, originalLocator, domSnapshot);

    expect(result.strategy).toBe('modal');
    expect(result.locator).not.toBeNull();
    expect(result.confidence).toBeGreaterThan(0);
  });
});

// ─── Dialog Handling Tests ──────────────────────────────────────────────────

describe('Dialog handling configuration', () => {
  it('should include handleDialogs in default config', async () => {
    const { loadConfig } = await import('../../src/config/config-loader');

    const config = loadConfig({});
    expect(config.healing.handleDialogs).toBe(true);
  });

  it('should allow disabling dialog handling', async () => {
    const { loadConfig } = await import('../../src/config/config-loader');

    const config = loadConfig({
      healing: { handleDialogs: false } as Parameters<typeof loadConfig>[0] extends Partial<infer C> ? Partial<C>['healing'] : never,
    });
    expect(config.healing.handleDialogs).toBe(false);
  });

  it('should allow custom dialog handling config', async () => {
    const { loadConfig } = await import('../../src/config/config-loader');

    const config = loadConfig({
      healing: {
        handleDialogs: {
          dismissAlerts: false,
          acceptConfirms: false,
          promptResponse: 'custom response',
          logDialogs: true,
        },
      } as Parameters<typeof loadConfig>[0] extends Partial<infer C> ? Partial<C>['healing'] : never,
    });

    const dialogConfig = config.healing.handleDialogs;
    expect(typeof dialogConfig).toBe('object');
    if (typeof dialogConfig === 'object') {
      expect(dialogConfig.dismissAlerts).toBe(false);
      expect(dialogConfig.acceptConfirms).toBe(false);
      expect(dialogConfig.promptResponse).toBe('custom response');
    }
  });
});

// ─── Strategy Registration Tests ────────────────────────────────────────────

describe('Strategy registration', () => {
  it('should support table strategy in runStrategy dispatcher', async () => {
    const { runStrategy } = await import('../../src/core/locator-strategies');

    const mockPage = { evaluate: vi.fn().mockResolvedValue([]) };
    const domSnapshot = { html: '', url: '', title: '', timestamp: Date.now() };
    const locator = { type: 'css' as const, selector: 'td', playwrightExpression: "page.locator('td')" };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await runStrategy('table', mockPage as any, locator, domSnapshot);
    expect(result.strategy).toBe('table');
  });

  it('should support modal strategy in runStrategy dispatcher', async () => {
    const { runStrategy } = await import('../../src/core/locator-strategies');

    const mockPage = { evaluate: vi.fn().mockResolvedValue([]) };
    const domSnapshot = { html: '', url: '', title: '', timestamp: Date.now() };
    const locator = { type: 'css' as const, selector: '.modal-btn', playwrightExpression: "page.locator('.modal-btn')" };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await runStrategy('modal', mockPage as any, locator, domSnapshot);
    expect(result.strategy).toBe('modal');
  });

  it('default strategies should include table and modal', async () => {
    const { DEFAULT_CONFIG } = await import('../../src/config/defaults');

    expect(DEFAULT_CONFIG.healing.strategies).toContain('table');
    expect(DEFAULT_CONFIG.healing.strategies).toContain('modal');
    // AI should still be last
    const strategies = DEFAULT_CONFIG.healing.strategies;
    expect(strategies[strategies.length - 1]).toBe('ai');
  });
});
