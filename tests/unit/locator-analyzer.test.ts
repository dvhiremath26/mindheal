import { describe, it, expect } from 'vitest';
import { analyzeLocator, getLocatorHash, parsePlaywrightExpression } from '../../src/core/locator-analyzer';

describe('analyzeLocator', () => {
  describe('CSS selectors via page.locator()', () => {
    it('should parse page.locator("#id") as css type', () => {
      const result = analyzeLocator("page.locator('#submit-btn')");
      expect(result.type).toBe('css');
      expect(result.selector).toBe('#submit-btn');
      expect(result.playwrightExpression).toContain('locator');
    });

    it('should parse page.locator(".class") as css type', () => {
      const result = analyzeLocator("page.locator('.btn-primary')");
      expect(result.type).toBe('css');
      expect(result.selector).toBe('.btn-primary');
    });

    it('should parse page.locator("div.container") as css type', () => {
      const result = analyzeLocator("page.locator('div.container')");
      expect(result.type).toBe('css');
      expect(result.selector).toBe('div.container');
    });

    it('should parse page.locator with options', () => {
      const result = analyzeLocator("page.locator('div', { hasText: 'Hello' })");
      expect(result.type).toBe('css');
      expect(result.selector).toBe('div');
      expect(result.options).toBeDefined();
    });
  });

  describe('XPath selectors via page.locator()', () => {
    it('should parse page.locator("//div") as xpath type', () => {
      const result = analyzeLocator("page.locator('//div[@class=\"main\"]')");
      expect(result.type).toBe('xpath');
      expect(result.selector).toContain('//div');
    });

    it('should parse page.locator("(//button)") as xpath type', () => {
      const result = analyzeLocator("page.locator('(//button)[1]')");
      expect(result.type).toBe('xpath');
    });
  });

  describe('Role selectors via page.getByRole()', () => {
    it('should parse page.getByRole("button", { name: "Submit" }) as role type', () => {
      const result = analyzeLocator("page.getByRole('button', { name: 'Submit' })");
      expect(result.type).toBe('role');
      expect(result.selector).toBe('button');
      expect(result.options).toEqual({ name: 'Submit' });
    });

    it('should parse page.getByRole("link") without options', () => {
      const result = analyzeLocator("page.getByRole('link')");
      expect(result.type).toBe('role');
      expect(result.selector).toBe('link');
      expect(result.options).toBeUndefined();
    });

    it('should parse page.getByRole("textbox", { name: "Email" }) with options', () => {
      const result = analyzeLocator("page.getByRole('textbox', { name: 'Email' })");
      expect(result.type).toBe('role');
      expect(result.selector).toBe('textbox');
      expect(result.options).toEqual({ name: 'Email' });
    });
  });

  describe('Text selectors via page.getByText()', () => {
    it('should parse page.getByText("Hello") as text type', () => {
      const result = analyzeLocator("page.getByText('Hello')");
      expect(result.type).toBe('text');
      expect(result.selector).toBe('Hello');
    });

    it('should parse page.getByText with double quotes', () => {
      const result = analyzeLocator('page.getByText("Welcome back")');
      expect(result.type).toBe('text');
      expect(result.selector).toBe('Welcome back');
    });
  });

  describe('TestId selectors via page.getByTestId()', () => {
    it('should parse page.getByTestId("login-btn") as testid type', () => {
      const result = analyzeLocator("page.getByTestId('login-btn')");
      expect(result.type).toBe('testid');
      expect(result.selector).toBe('login-btn');
    });

    it('should parse page.getByTestId with double quotes', () => {
      const result = analyzeLocator('page.getByTestId("error-message")');
      expect(result.type).toBe('testid');
      expect(result.selector).toBe('error-message');
    });
  });

  describe('Label selectors via page.getByLabel()', () => {
    it('should parse page.getByLabel("Email") as label type', () => {
      const result = analyzeLocator("page.getByLabel('Email')");
      expect(result.type).toBe('label');
      expect(result.selector).toBe('Email');
    });
  });

  describe('Placeholder selectors via page.getByPlaceholder()', () => {
    it('should parse page.getByPlaceholder("Enter email") as placeholder type', () => {
      const result = analyzeLocator("page.getByPlaceholder('Enter email')");
      expect(result.type).toBe('placeholder');
      expect(result.selector).toBe('Enter email');
    });
  });

  describe('edge cases', () => {
    it('should handle raw CSS selectors without page prefix', () => {
      const result = analyzeLocator('#my-button');
      expect(result.type).toBe('css');
      expect(result.selector).toBe('#my-button');
    });

    it('should handle raw XPath selectors without page prefix', () => {
      const result = analyzeLocator('//button[@type="submit"]');
      expect(result.type).toBe('xpath');
      expect(result.selector).toBe('//button[@type="submit"]');
    });

    it('should handle complex CSS selectors', () => {
      const result = analyzeLocator("page.locator('div.container > ul > li:nth-child(2)')");
      expect(result.type).toBe('css');
      expect(result.selector).toBe('div.container > ul > li:nth-child(2)');
    });

    it('should handle whitespace in expressions', () => {
      const result = analyzeLocator("  page.getByRole( 'button' , { name: 'OK' } )  ");
      expect(result.type).toBe('role');
      expect(result.selector).toBe('button');
    });

    it('should fallback to css type for unrecognized selectors', () => {
      const result = analyzeLocator('button.submit');
      expect(result.type).toBe('css');
      expect(result.selector).toBe('button.submit');
    });
  });
});

describe('parsePlaywrightExpression', () => {
  it('should parse getByRole with options into method and args', () => {
    const result = parsePlaywrightExpression("page.getByRole('button', { name: 'Submit' })");
    expect(result.method).toBe('getByRole');
    expect(result.args[0]).toBe('button');
    expect(result.args[1]).toEqual({ name: 'Submit' });
  });

  it('should parse locator with simple selector', () => {
    const result = parsePlaywrightExpression("page.locator('#my-id')");
    expect(result.method).toBe('locator');
    expect(result.args[0]).toBe('#my-id');
  });

  it('should parse getByTestId', () => {
    const result = parsePlaywrightExpression("page.getByTestId('login-form')");
    expect(result.method).toBe('getByTestId');
    expect(result.args[0]).toBe('login-form');
  });

  it('should parse getByText', () => {
    const result = parsePlaywrightExpression("page.getByText('Hello World')");
    expect(result.method).toBe('getByText');
    expect(result.args[0]).toBe('Hello World');
  });

  it('should fallback to locator for unrecognized expression', () => {
    const result = parsePlaywrightExpression('button.primary');
    expect(result.method).toBe('locator');
    expect(result.args[0]).toBe('button.primary');
  });
});

describe('getLocatorHash', () => {
  it('should generate consistent hashes for the same input', () => {
    const locator = {
      type: 'css' as const,
      selector: '#submit',
      playwrightExpression: "page.locator('#submit')",
    };
    const url = 'https://example.com/login';

    const hash1 = getLocatorHash(locator, url);
    const hash2 = getLocatorHash(locator, url);

    expect(hash1).toBe(hash2);
    expect(typeof hash1).toBe('string');
    expect(hash1.length).toBe(16);
  });

  it('should generate different hashes for different selectors', () => {
    const locator1 = {
      type: 'css' as const,
      selector: '#submit',
      playwrightExpression: "page.locator('#submit')",
    };
    const locator2 = {
      type: 'css' as const,
      selector: '#cancel',
      playwrightExpression: "page.locator('#cancel')",
    };
    const url = 'https://example.com/login';

    const hash1 = getLocatorHash(locator1, url);
    const hash2 = getLocatorHash(locator2, url);

    expect(hash1).not.toBe(hash2);
  });

  it('should generate different hashes for different URLs', () => {
    const locator = {
      type: 'css' as const,
      selector: '#submit',
      playwrightExpression: "page.locator('#submit')",
    };

    const hash1 = getLocatorHash(locator, 'https://example.com/login');
    const hash2 = getLocatorHash(locator, 'https://example.com/register');

    expect(hash1).not.toBe(hash2);
  });

  it('should strip query params from URL for stability', () => {
    const locator = {
      type: 'css' as const,
      selector: '#submit',
      playwrightExpression: "page.locator('#submit')",
    };

    const hash1 = getLocatorHash(locator, 'https://example.com/login?token=abc');
    const hash2 = getLocatorHash(locator, 'https://example.com/login?token=xyz');

    expect(hash1).toBe(hash2);
  });

  it('should handle invalid URLs gracefully', () => {
    const locator = {
      type: 'css' as const,
      selector: '#submit',
      playwrightExpression: "page.locator('#submit')",
    };

    // Should not throw
    const hash = getLocatorHash(locator, 'not-a-url');
    expect(typeof hash).toBe('string');
    expect(hash.length).toBe(16);
  });
});
