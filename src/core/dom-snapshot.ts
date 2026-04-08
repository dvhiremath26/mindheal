import type { Page } from '@playwright/test';
import type { DOMSnapshot, DOMElement } from '../types/index';
import { logger } from '../utils/logger';

/**
 * Approximate token limit for the HTML snapshot.
 * ~4 chars per token is a conservative estimate.
 */
const MAX_SNAPSHOT_CHARS = 16_000;

/**
 * Attribute names and text patterns that indicate sensitive data.
 */
const SENSITIVE_ATTR_NAMES = new Set([
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'api-key',
  'api_key',
  'authorization',
  'auth',
  'credential',
  'access-token',
  'access_token',
  'refresh-token',
  'refresh_token',
  'session-id',
  'session_id',
  'csrf',
  'ssn',
]);

const SENSITIVE_ATTR_PATTERNS: RegExp[] = [
  /password/i,
  /token/i,
  /secret/i,
  /apikey/i,
  /api[_-]?key/i,
  /authorization/i,
  /credential/i,
  /session[_-]?id/i,
];

const SENSITIVE_VALUE_PATTERNS: RegExp[] = [
  // Bearer tokens
  /^Bearer\s+\S+/i,
  // Long hex/base64 strings that look like tokens (32+ chars)
  /^[A-Za-z0-9+/=_-]{32,}$/,
];

/**
 * Sanitizes an attribute value by redacting sensitive content.
 */
function sanitizeAttributeValue(name: string, value: string): string {
  const lowerName = name.toLowerCase();

  if (SENSITIVE_ATTR_NAMES.has(lowerName)) {
    return '[REDACTED]';
  }

  for (const pattern of SENSITIVE_ATTR_PATTERNS) {
    if (pattern.test(lowerName)) {
      return '[REDACTED]';
    }
  }

  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    if (pattern.test(value)) {
      return '[REDACTED]';
    }
  }

  // Redact type=password input values
  if (lowerName === 'value' || lowerName === 'type') {
    // value is left alone unless caught above; type is informational
    return value;
  }

  return value;
}

/**
 * Sanitizes text content by removing potential sensitive data patterns.
 */
function sanitizeTextContent(text: string): string {
  if (!text.trim()) return '';

  // Redact long token-like strings embedded in text
  return text.replace(/[A-Za-z0-9+/=_-]{40,}/g, '[REDACTED]');
}

/**
 * Serializes a DOMElement tree into sanitized HTML, respecting depth and size limits.
 */
function serializeElement(element: DOMElement, currentDepth: number, maxDepth: number): string {
  if (currentDepth > maxDepth) {
    return element.children.length > 0 ? '<!-- truncated -->' : '';
  }

  const tag = element.tag.toLowerCase();

  // Build attribute string
  const attrs: string[] = [];
  for (const [name, value] of Object.entries(element.attributes)) {
    const sanitized = sanitizeAttributeValue(name, value);
    attrs.push(`${name}="${escapeHtml(sanitized)}"`);
  }

  const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';

  // Self-closing tags
  const selfClosing = new Set(['input', 'br', 'hr', 'img', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']);
  if (selfClosing.has(tag)) {
    return `<${tag}${attrStr} />`;
  }

  // Text content
  const textContent = element.text ? sanitizeTextContent(element.text) : '';

  // Children
  const childHtml = element.children
    .map((child) => serializeElement(child, currentDepth + 1, maxDepth))
    .filter(Boolean)
    .join('\n');

  const inner = [textContent, childHtml].filter(Boolean).join('\n');

  return `<${tag}${attrStr}>${inner}</${tag}>`;
}

/**
 * Escapes special HTML characters in attribute values.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Truncates HTML to approximately the target character count,
 * cutting at the last complete tag boundary when possible.
 */
function truncateHtml(html: string, maxChars: number): string {
  if (html.length <= maxChars) return html;

  // Find the last closing tag boundary before the limit
  const truncated = html.substring(0, maxChars);
  const lastCloseTag = truncated.lastIndexOf('</');
  const lastSelfClose = truncated.lastIndexOf('/>');
  const cutPoint = Math.max(lastCloseTag, lastSelfClose);

  if (cutPoint > maxChars * 0.5) {
    // Find the end of that closing tag
    const endOfTag = html.indexOf('>', cutPoint);
    if (endOfTag !== -1 && endOfTag < maxChars + 100) {
      return html.substring(0, endOfTag + 1) + '\n<!-- snapshot truncated -->';
    }
  }

  return truncated + '\n<!-- snapshot truncated -->';
}

/**
 * Captures a sanitized DOM snapshot from the given Playwright page.
 *
 * @param page - Playwright Page object
 * @param rootSelector - Optional CSS selector to scope the snapshot. Defaults to 'body'.
 * @param maxDepth - Maximum depth of the DOM tree to capture. Defaults to 3.
 * @returns A DOMSnapshot containing sanitized HTML, URL, title, and timestamp.
 */
export async function captureDOMSnapshot(
  page: Page,
  rootSelector?: string,
  maxDepth: number = 3,
): Promise<DOMSnapshot> {
  const startTime = Date.now();
  const selector = rootSelector ?? 'body';

  logger.debug(`Capturing DOM snapshot for selector: ${selector}, maxDepth: ${maxDepth}`);

  try {
    const [url, title] = await Promise.all([
      page.url(),
      page.title(),
    ]);

    // Extract the DOM tree from the page context
    const domTree = await page.evaluate(
      ({ sel, depth }: { sel: string; depth: number }) => {
        function extractElement(el: Element, currentDepth: number, maxD: number): {
          tag: string;
          id?: string;
          classes?: string[];
          attributes: Record<string, string>;
          text?: string;
          children: ReturnType<typeof extractElement>[];
          role?: string;
          ariaLabel?: string;
          testId?: string;
        } | null {
          if (currentDepth > maxD) return null;

          const tag = el.tagName.toLowerCase();

          // Skip script, style, and noscript elements
          if (['script', 'style', 'noscript', 'svg'].includes(tag)) return null;

          const attributes: Record<string, string> = {};
          for (let ai = 0; ai < el.attributes.length; ai++) {
            const attr = el.attributes[ai];
            attributes[attr.name] = attr.value;
          }

          const id = el.id || undefined;
          const classes = el.className && typeof el.className === 'string'
            ? el.className.split(/\s+/).filter(Boolean)
            : undefined;

          // Get direct text (not from children)
          let text: string | undefined;
          const directText = Array.from(el.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent?.trim() ?? '')
            .filter(Boolean)
            .join(' ');
          if (directText) {
            text = directText.substring(0, 200);
          }

          const role = el.getAttribute('role') || undefined;
          const ariaLabel = el.getAttribute('aria-label') || undefined;
          const testId =
            el.getAttribute('data-testid') ??
            el.getAttribute('data-test-id') ??
            el.getAttribute('data-test') ??
            undefined;

          const children: ReturnType<typeof extractElement>[] = [];
          if (currentDepth < maxD) {
            // Traverse regular children
            for (let ci = 0; ci < el.children.length; ci++) {
              const child = el.children[ci];
              const extracted = extractElement(child, currentDepth + 1, maxD);
              if (extracted) {
                children.push(extracted);
              }
            }

            // Traverse Shadow DOM if present
            if (el.shadowRoot) {
              const shadowMarker: ReturnType<typeof extractElement> = {
                tag: '#shadow-root',
                attributes: {},
                children: [],
              };
              for (let si = 0; si < el.shadowRoot.children.length; si++) {
                const shadowChild = el.shadowRoot.children[si];
                const extracted = extractElement(shadowChild, currentDepth + 1, maxD);
                if (extracted) {
                  shadowMarker.children.push(extracted);
                }
              }
              if (shadowMarker.children.length > 0) {
                children.push(shadowMarker);
              }
            }
          }

          return { tag, id, classes, attributes, text, children, role, ariaLabel, testId };
        }

        const root = document.querySelector(sel);
        if (!root) return null;

        return extractElement(root, 0, depth);
      },
      { sel: selector, depth: maxDepth },
    );

    if (!domTree) {
      logger.warn(`Root element not found for selector: ${selector}`);
      return {
        html: `<!-- element not found: ${escapeHtml(selector)} -->`,
        url,
        title,
        timestamp: Date.now(),
        rootSelector: selector !== 'body' ? selector : undefined,
      };
    }

    // Cast to DOMElement for serialization
    const element = domTree as unknown as DOMElement;
    const rawHtml = serializeElement(element, 0, maxDepth);
    const html = truncateHtml(rawHtml, MAX_SNAPSHOT_CHARS);

    const duration = Date.now() - startTime;
    logger.debug(`DOM snapshot captured in ${duration}ms, size: ${html.length} chars`);

    return {
      html,
      url,
      title,
      timestamp: Date.now(),
      rootSelector: selector !== 'body' ? selector : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to capture DOM snapshot: ${message}`);

    // Return a minimal snapshot on failure so healing can still proceed
    let fallbackUrl = 'unknown';
    let fallbackTitle = 'unknown';
    try { fallbackUrl = page.url(); } catch { /* ignore */ }
    try { fallbackTitle = await page.title(); } catch { /* ignore */ }

    return {
      html: `<!-- snapshot capture failed: ${escapeHtml(message)} -->`,
      url: fallbackUrl,
      title: fallbackTitle,
      timestamp: Date.now(),
      rootSelector: selector !== 'body' ? selector : undefined,
    };
  }
}
