import type { LocatorInfo, LocatorType } from '../types/index';
import { createHash } from 'crypto';

/**
 * Mapping from Playwright method names to LocatorType values.
 */
const METHOD_TO_TYPE: Record<string, LocatorType> = {
  'locator': 'css',
  'getByRole': 'role',
  'getByText': 'text',
  'getByLabel': 'label',
  'getByPlaceholder': 'placeholder',
  'getByAltText': 'alttext',
  'getByTitle': 'title',
  'getByTestId': 'testid',
};

/**
 * Regex patterns for parsing Playwright locator expressions.
 * Each pattern captures the method name and arguments.
 */
const EXPRESSION_PATTERNS: Array<{
  pattern: RegExp;
  method: string;
}> = [
  { pattern: /\.getByRole\(\s*(['"])(.+?)\1(?:\s*,\s*(\{.*?\}))?\s*\)/, method: 'getByRole' },
  { pattern: /\.getByText\(\s*(?:(['"])(.+?)\1|\/(.+?)\/([gimsuy]*))\s*(?:,\s*(\{.*?\}))?\s*\)/, method: 'getByText' },
  { pattern: /\.getByLabel\(\s*(?:(['"])(.+?)\1|\/(.+?)\/([gimsuy]*))\s*(?:,\s*(\{.*?\}))?\s*\)/, method: 'getByLabel' },
  { pattern: /\.getByPlaceholder\(\s*(?:(['"])(.+?)\1|\/(.+?)\/([gimsuy]*))\s*(?:,\s*(\{.*?\}))?\s*\)/, method: 'getByPlaceholder' },
  { pattern: /\.getByAltText\(\s*(?:(['"])(.+?)\1|\/(.+?)\/([gimsuy]*))\s*(?:,\s*(\{.*?\}))?\s*\)/, method: 'getByAltText' },
  { pattern: /\.getByTitle\(\s*(?:(['"])(.+?)\1|\/(.+?)\/([gimsuy]*))\s*(?:,\s*(\{.*?\}))?\s*\)/, method: 'getByTitle' },
  { pattern: /\.getByTestId\(\s*(['"])(.+?)\1\s*\)/, method: 'getByTestId' },
  { pattern: /\.locator\(\s*(['"])(.+?)\1\s*(?:,\s*(\{.*?\}))?\s*\)/, method: 'locator' },
];

/**
 * Determines the LocatorType from a raw selector string (not a Playwright expression).
 */
function inferLocatorType(selector: string): LocatorType {
  const trimmed = selector.trim();

  if (trimmed.startsWith('//') || trimmed.startsWith('(//') || trimmed.startsWith('xpath=')) {
    return 'xpath';
  }

  if (trimmed.startsWith('role=')) return 'role';
  if (trimmed.startsWith('text=') || trimmed.startsWith('"') || trimmed.startsWith("'")) return 'text';
  if (trimmed.startsWith('data-testid=') || trimmed.startsWith('[data-testid')) return 'testid';
  if (trimmed.startsWith('label=')) return 'label';
  if (trimmed.startsWith('placeholder=')) return 'placeholder';

  // Default to CSS selector
  return 'css';
}

/**
 * Attempts to parse a JSON-like options string (e.g., `{ name: 'Submit', exact: true }`).
 * Returns an empty object if parsing fails.
 */
function parseOptionsString(optionsStr: string | undefined): Record<string, unknown> {
  if (!optionsStr) return {};

  try {
    // Normalize JS object notation to JSON:
    // - Add quotes around unquoted keys
    // - Convert single quotes to double quotes
    const normalized = optionsStr
      .replace(/(\w+)\s*:/g, '"$1":')
      .replace(/'/g, '"')
      .replace(/,\s*}/g, '}');
    return JSON.parse(normalized) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Analyzes a Playwright locator expression and extracts structured information.
 *
 * Handles both full Playwright expressions (e.g., `page.getByRole('button', { name: 'Submit' })`)
 * and raw selectors (e.g., `#submit-btn`, `//button[@type="submit"]`).
 *
 * @param expression - The locator expression string to analyze.
 * @returns Structured LocatorInfo with type, selector, options, and the original expression.
 */
export function analyzeLocator(expression: string): LocatorInfo {
  const trimmed = expression.trim();

  // Try to match Playwright method expressions
  for (const { pattern, method } of EXPRESSION_PATTERNS) {
    const match = trimmed.match(pattern);
    if (!match) continue;

    const locatorType = METHOD_TO_TYPE[method] ?? 'css';

    switch (method) {
      case 'getByRole': {
        const role = match[2];
        const options = parseOptionsString(match[3]);
        return {
          type: locatorType,
          selector: role,
          options: Object.keys(options).length > 0 ? options : undefined,
          playwrightExpression: trimmed,
        };
      }

      case 'getByText':
      case 'getByLabel':
      case 'getByPlaceholder':
      case 'getByAltText':
      case 'getByTitle': {
        // Either a quoted string (match[2]) or a regex (match[3])
        const selector = match[2] ?? `/${match[3]}/${match[4] ?? ''}`;
        const options = parseOptionsString(match[5]);
        return {
          type: locatorType,
          selector,
          options: Object.keys(options).length > 0 ? options : undefined,
          playwrightExpression: trimmed,
        };
      }

      case 'getByTestId': {
        return {
          type: 'testid',
          selector: match[2],
          playwrightExpression: trimmed,
        };
      }

      case 'locator': {
        const rawSelector = match[2];
        const options = parseOptionsString(match[3]);
        return {
          type: inferLocatorType(rawSelector),
          selector: rawSelector,
          options: Object.keys(options).length > 0 ? options : undefined,
          playwrightExpression: trimmed,
        };
      }
    }
  }

  // Fallback: treat the entire expression as a raw selector
  return {
    type: inferLocatorType(trimmed),
    selector: trimmed,
    playwrightExpression: trimmed,
  };
}

/**
 * Parses a Playwright expression into a method name and its arguments.
 *
 * @param expression - Full Playwright expression (e.g., `page.getByRole('button', { name: 'OK' })`)
 * @returns An object with the method name and parsed arguments array.
 */
export function parsePlaywrightExpression(expression: string): { method: string; args: unknown[] } {
  const trimmed = expression.trim();

  for (const { pattern, method } of EXPRESSION_PATTERNS) {
    const match = trimmed.match(pattern);
    if (!match) continue;

    switch (method) {
      case 'getByRole': {
        const args: unknown[] = [match[2]];
        const options = parseOptionsString(match[3]);
        if (Object.keys(options).length > 0) {
          args.push(options);
        }
        return { method, args };
      }

      case 'getByText':
      case 'getByLabel':
      case 'getByPlaceholder':
      case 'getByAltText':
      case 'getByTitle': {
        const value = match[2] ?? `/${match[3]}/${match[4] ?? ''}`;
        const args: unknown[] = [value];
        const options = parseOptionsString(match[5]);
        if (Object.keys(options).length > 0) {
          args.push(options);
        }
        return { method, args };
      }

      case 'getByTestId': {
        return { method, args: [match[2]] };
      }

      case 'locator': {
        const args: unknown[] = [match[2]];
        const options = parseOptionsString(match[3]);
        if (Object.keys(options).length > 0) {
          args.push(options);
        }
        return { method, args };
      }
    }
  }

  // Fallback: treat as locator() with raw selector
  return { method: 'locator', args: [trimmed] };
}

/**
 * Generates a stable hash key for a locator + page URL combination.
 * Used as the cache key in the self-heal cache.
 *
 * @param locator - The parsed locator information.
 * @param pageUrl - The page URL (the path portion is used, query params stripped).
 * @returns A hex string hash.
 */
export function getLocatorHash(locator: LocatorInfo, pageUrl: string): string {
  // Normalize URL to path only (strip query params and fragment for stability)
  let urlPattern: string;
  try {
    const parsed = new URL(pageUrl);
    urlPattern = `${parsed.origin}${parsed.pathname}`;
  } catch {
    urlPattern = pageUrl;
  }

  const input = JSON.stringify({
    type: locator.type,
    selector: locator.selector,
    options: locator.options,
    url: urlPattern,
  });

  return createHash('sha256').update(input).digest('hex').substring(0, 16);
}
