import type { Page } from '@playwright/test';
import type {
  LocatorInfo,
  LocatorType,
  DOMSnapshot,
  HealingStrategyName,
  StrategyAttempt,
} from '../types/index';
import { logger } from '../utils/logger';
import { enterpriseStrategy } from './enterprise-strategy';

// ─── String Similarity ─────────────────────────────────────────────────────────

/**
 * Computes the Levenshtein edit distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;

  if (la === 0) return lb;
  if (lb === 0) return la;

  // Use a single-row DP approach for space efficiency
  const prev = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;

  for (let i = 1; i <= la; i++) {
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= lb; j++) {
      const temp = prev[j];
      if (a[i - 1] === b[j - 1]) {
        prev[j] = prevDiag;
      } else {
        prev[j] = 1 + Math.min(prevDiag, prev[j], prev[j - 1]);
      }
      prevDiag = temp;
    }
  }

  return prev[lb];
}

/**
 * Returns a similarity score between 0 and 1 (1 = identical).
 */
function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const maxLen = Math.max(a.length, b.length);
  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  return 1 - distance / maxLen;
}

// ─── DOM Helpers ────────────────────────────────────────────────────────────────

interface CandidateElement {
  tag: string;
  id: string;
  classes: string[];
  text: string;
  attributes: Record<string, string>;
  role: string;
  ariaLabel: string;
  testId: string;
  placeholder: string;
  name: string;
  // Modal/dialog context
  isInModal: boolean;
  modalRole: string;
  // Table context
  isInTable: boolean;
  tableRow: number;
  tableCol: number;
  tableHeaderText: string;
  tableCellSelector: string;
}

/**
 * Extracts candidate elements from the DOM snapshot HTML using page evaluation.
 * This gathers all interactive or visible elements as potential healing targets.
 */
async function extractCandidates(page: Page): Promise<CandidateElement[]> {
  try {
    return await page.evaluate(() => {
      const selectors = [
        'a', 'button', 'input', 'select', 'textarea',
        '[role]', '[data-testid]', '[data-test-id]', '[data-test]',
        '[id]', '[aria-label]', 'label', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'li', 'td', 'th', 'span', 'div', 'p',
        // Modal/dialog elements
        'dialog', '[role="dialog"]', '[role="alertdialog"]',
        '[aria-modal="true"]', '.modal', '.popup', '.overlay',
        // Table elements
        'table', 'thead', 'tbody', 'tr', 'caption',
      ];

      const seen = new Set<Element>();
      const results: Array<{
        tag: string;
        id: string;
        classes: string[];
        text: string;
        attributes: Record<string, string>;
        role: string;
        ariaLabel: string;
        testId: string;
        placeholder: string;
        name: string;
        isInModal: boolean;
        modalRole: string;
        isInTable: boolean;
        tableRow: number;
        tableCol: number;
        tableHeaderText: string;
        tableCellSelector: string;
      }> = [];

      function processElement(el: Element): void {
        if (seen.has(el) || results.length >= 500) return;
        seen.add(el);

        // Skip invisible elements
        try {
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return;
        } catch {
          // getComputedStyle may throw for disconnected elements
        }

        const attrs: Record<string, string> = {};
        for (let ai = 0; ai < el.attributes.length; ai++) {
          const attr = el.attributes[ai];
          attrs[attr.name] = attr.value;
        }

        // Direct text content (excluding child element text)
        let directText = '';
        for (let ni = 0; ni < el.childNodes.length; ni++) {
          const node = el.childNodes[ni];
          if (node.nodeType === Node.TEXT_NODE && node.textContent) {
            const trimmed = node.textContent.trim();
            if (trimmed) {
              directText += (directText ? ' ' : '') + trimmed;
            }
          }
        }
        directText = directText.substring(0, 200);

        // Detect modal/dialog context
        let isInModal = false;
        let modalRole = '';
        let ancestor: Element | null = el;
        while (ancestor) {
          const tag = ancestor.tagName.toLowerCase();
          const role = ancestor.getAttribute('role') || '';
          const ariaModal = ancestor.getAttribute('aria-modal');
          if (
            tag === 'dialog' ||
            role === 'dialog' ||
            role === 'alertdialog' ||
            ariaModal === 'true'
          ) {
            isInModal = true;
            modalRole = role || (tag === 'dialog' ? 'dialog' : '');
            break;
          }
          // Common modal class patterns
          const cls = ancestor.className && typeof ancestor.className === 'string'
            ? ancestor.className.toLowerCase()
            : '';
          if (cls.includes('modal') || cls.includes('popup') || cls.includes('overlay') || cls.includes('dialog')) {
            isInModal = true;
            modalRole = role || 'dialog';
            break;
          }
          ancestor = ancestor.parentElement;
        }

        // Detect table context
        let isInTable = false;
        let tableRow = -1;
        let tableCol = -1;
        let tableHeaderText = '';
        let tableCellSelector = '';
        const elTag = el.tagName.toLowerCase();

        if (elTag === 'td' || elTag === 'th') {
          isInTable = true;
          const cell = el as HTMLTableCellElement;
          tableCol = cell.cellIndex;
          const row = cell.parentElement as HTMLTableRowElement | null;
          if (row) {
            tableRow = row.rowIndex;
            // Try to find the corresponding header for this column
            const table = row.closest('table');
            if (table) {
              const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
              if (headerRow) {
                const headers = headerRow.querySelectorAll('th');
                if (headers.length > tableCol && tableCol >= 0) {
                  tableHeaderText = headers[tableCol].textContent?.trim().substring(0, 100) || '';
                }
              }
              // Build a table cell selector
              tableCellSelector = `table >> tr:nth-child(${tableRow + 1}) >> td:nth-child(${tableCol + 1})`;
            }
          }
        } else {
          // Check if the element is inside a table cell
          const closestCell = el.closest('td, th');
          if (closestCell) {
            isInTable = true;
            const cell = closestCell as HTMLTableCellElement;
            tableCol = cell.cellIndex;
            const row = cell.parentElement as HTMLTableRowElement | null;
            if (row) {
              tableRow = row.rowIndex;
              const table = row.closest('table');
              if (table) {
                const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
                if (headerRow) {
                  const headers = headerRow.querySelectorAll('th');
                  if (headers.length > tableCol && tableCol >= 0) {
                    tableHeaderText = headers[tableCol].textContent?.trim().substring(0, 100) || '';
                  }
                }
              }
            }
          }
        }

        results.push({
          tag: elTag,
          id: el.id || '',
          classes: el.className && typeof el.className === 'string'
            ? el.className.split(/\s+/).filter(Boolean)
            : [],
          text: directText || el.textContent?.trim().substring(0, 200) || '',
          attributes: attrs,
          role: el.getAttribute('role') || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          testId:
            el.getAttribute('data-testid') ??
            el.getAttribute('data-test-id') ??
            el.getAttribute('data-test') ??
            '',
          placeholder: el.getAttribute('placeholder') || '',
          name: el.getAttribute('name') || '',
          isInModal,
          modalRole,
          isInTable,
          tableRow,
          tableCol,
          tableHeaderText,
          tableCellSelector,
        });
      }

      /**
       * Recursively collects all shadow roots in the document tree.
       */
      function collectRoots(root: Document | ShadowRoot | Element, roots: Array<Document | ShadowRoot>): void {
        if (root instanceof Document || root instanceof ShadowRoot) {
          roots.push(root);
        }
        const children = root instanceof Document || root instanceof ShadowRoot
          ? root.querySelectorAll('*')
          : [root];
        for (let i = 0; i < children.length; i++) {
          const child = children[i];
          if (child.shadowRoot) {
            roots.push(child.shadowRoot);
            collectRoots(child.shadowRoot, roots);
          }
        }
      }

      // Collect all DOM roots (document + all shadow roots)
      const allRoots: Array<Document | ShadowRoot> = [];
      collectRoots(document, allRoots);

      // Query selectors across all roots (piercing shadow DOM)
      for (const root of allRoots) {
        if (results.length >= 500) break;
        for (const sel of selectors) {
          if (results.length >= 500) break;
          const nodeList = root.querySelectorAll(sel);
          for (let ei = 0; ei < nodeList.length; ei++) {
            if (results.length >= 500) break;
            processElement(nodeList[ei]);
          }
        }
      }

      return results;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to extract candidates from page: ${message}`);
    return [];
  }
}

/**
 * Builds a LocatorInfo from a candidate element, choosing the best locator approach.
 */
function buildLocatorInfo(candidate: CandidateElement, preferredType: LocatorType): LocatorInfo {
  switch (preferredType) {
    case 'testid':
      if (candidate.testId) {
        return {
          type: 'testid',
          selector: candidate.testId,
          playwrightExpression: `page.getByTestId('${escapeString(candidate.testId)}')`,
        };
      }
      break;

    case 'role':
      if (candidate.role || candidate.tag === 'button' || candidate.tag === 'a') {
        const role = candidate.role || inferRole(candidate.tag);
        const options: Record<string, unknown> = {};
        if (candidate.ariaLabel) options['name'] = candidate.ariaLabel;
        else if (candidate.text) options['name'] = candidate.text.substring(0, 80);
        const optStr = Object.keys(options).length > 0
          ? `, { name: '${escapeString(String(options['name']))}' }`
          : '';
        return {
          type: 'role',
          selector: role,
          options: Object.keys(options).length > 0 ? options : undefined,
          playwrightExpression: `page.getByRole('${role}'${optStr})`,
        };
      }
      break;

    case 'text':
      if (candidate.text) {
        return {
          type: 'text',
          selector: candidate.text.substring(0, 80),
          playwrightExpression: `page.getByText('${escapeString(candidate.text.substring(0, 80))}')`,
        };
      }
      break;

    case 'label':
      if (candidate.ariaLabel) {
        return {
          type: 'label',
          selector: candidate.ariaLabel,
          playwrightExpression: `page.getByLabel('${escapeString(candidate.ariaLabel)}')`,
        };
      }
      break;

    case 'placeholder':
      if (candidate.placeholder) {
        return {
          type: 'placeholder',
          selector: candidate.placeholder,
          playwrightExpression: `page.getByPlaceholder('${escapeString(candidate.placeholder)}')`,
        };
      }
      break;

    case 'css':
      return buildCssLocator(candidate);

    case 'xpath':
      return buildXpathLocator(candidate);
  }

  // Fallback: use the best available identifier
  if (candidate.testId) {
    return {
      type: 'testid',
      selector: candidate.testId,
      playwrightExpression: `page.getByTestId('${escapeString(candidate.testId)}')`,
    };
  }

  if (candidate.id) {
    return {
      type: 'css',
      selector: `#${candidate.id}`,
      playwrightExpression: `page.locator('#${escapeString(candidate.id)}')`,
    };
  }

  return buildCssLocator(candidate);
}

function buildCssLocator(candidate: CandidateElement): LocatorInfo {
  let selector: string;
  if (candidate.id) {
    selector = `#${candidate.id}`;
  } else if (candidate.classes.length > 0) {
    selector = `${candidate.tag}.${candidate.classes.slice(0, 3).join('.')}`;
  } else if (candidate.name) {
    selector = `${candidate.tag}[name="${candidate.name}"]`;
  } else {
    selector = candidate.tag;
  }

  return {
    type: 'css',
    selector,
    playwrightExpression: `page.locator('${escapeString(selector)}')`,
  };
}

function buildXpathLocator(candidate: CandidateElement): LocatorInfo {
  let xpath: string;
  if (candidate.id) {
    xpath = `//${candidate.tag}[@id="${candidate.id}"]`;
  } else if (candidate.text) {
    const text = candidate.text.substring(0, 50);
    xpath = `//${candidate.tag}[contains(text(),"${text}")]`;
  } else if (candidate.classes.length > 0) {
    xpath = `//${candidate.tag}[contains(@class,"${candidate.classes[0]}")]`;
  } else {
    xpath = `//${candidate.tag}`;
  }

  return {
    type: 'xpath',
    selector: xpath,
    playwrightExpression: `page.locator('${escapeString(xpath)}')`,
  };
}

function inferRole(tag: string): string {
  const tagRoleMap: Record<string, string> = {
    a: 'link',
    button: 'button',
    input: 'textbox',
    select: 'combobox',
    textarea: 'textbox',
    img: 'img',
    nav: 'navigation',
    main: 'main',
    header: 'banner',
    footer: 'contentinfo',
    form: 'form',
    table: 'table',
    h1: 'heading',
    h2: 'heading',
    h3: 'heading',
    h4: 'heading',
    h5: 'heading',
    h6: 'heading',
  };
  return tagRoleMap[tag] ?? 'generic';
}

function escapeString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ─── Strategy Implementations ───────────────────────────────────────────────────

/**
 * Finds elements with similar attributes (id, name, class, data-testid, aria-label).
 * Uses Levenshtein-based similarity on attribute values.
 */
async function attributeStrategy(
  page: Page,
  originalLocator: LocatorInfo,
  _domSnapshot: DOMSnapshot,
): Promise<StrategyAttempt> {
  const start = Date.now();

  try {
    const candidates = await extractCandidates(page);
    if (candidates.length === 0) {
      return makeAttempt('attribute', null, 0, start);
    }

    const selector = originalLocator.selector;
    let bestCandidate: CandidateElement | null = null;
    let bestScore = 0;

    for (const candidate of candidates) {
      let score = 0;

      // Compare id
      if (candidate.id) {
        score = Math.max(score, stringSimilarity(selector, candidate.id) * 0.9);
      }

      // Compare data-testid
      if (candidate.testId) {
        score = Math.max(score, stringSimilarity(selector, candidate.testId) * 0.95);
      }

      // Compare name attribute
      if (candidate.name) {
        score = Math.max(score, stringSimilarity(selector, candidate.name) * 0.8);
      }

      // Compare aria-label
      if (candidate.ariaLabel) {
        score = Math.max(score, stringSimilarity(selector, candidate.ariaLabel) * 0.75);
      }

      // Compare class names individually
      for (const cls of candidate.classes) {
        score = Math.max(score, stringSimilarity(selector, cls) * 0.6);
      }

      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    if (bestCandidate && bestScore >= 0.4) {
      const locator = buildLocatorInfo(bestCandidate, originalLocator.type);
      return makeAttempt('attribute', locator, bestScore, start);
    }

    return makeAttempt('attribute', null, 0, start);
  } catch (error) {
    return makeAttemptError('attribute', error, start);
  }
}

/**
 * Matches elements by visible text content or placeholder text.
 */
async function textStrategy(
  page: Page,
  originalLocator: LocatorInfo,
  _domSnapshot: DOMSnapshot,
): Promise<StrategyAttempt> {
  const start = Date.now();

  try {
    const candidates = await extractCandidates(page);
    if (candidates.length === 0) {
      return makeAttempt('text', null, 0, start);
    }

    // Extract the text we are searching for from the original locator
    let searchText = originalLocator.selector;
    if (originalLocator.options && typeof originalLocator.options['name'] === 'string') {
      searchText = originalLocator.options['name'];
    }

    let bestCandidate: CandidateElement | null = null;
    let bestScore = 0;

    for (const candidate of candidates) {
      let score = 0;

      // Compare visible text
      if (candidate.text) {
        score = Math.max(score, stringSimilarity(searchText, candidate.text));
      }

      // Compare placeholder
      if (candidate.placeholder) {
        score = Math.max(score, stringSimilarity(searchText, candidate.placeholder) * 0.85);
      }

      // Compare aria-label
      if (candidate.ariaLabel) {
        score = Math.max(score, stringSimilarity(searchText, candidate.ariaLabel) * 0.8);
      }

      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    if (bestCandidate && bestScore >= 0.5) {
      const locator = buildLocatorInfo(bestCandidate, 'text');
      return makeAttempt('text', locator, bestScore, start);
    }

    return makeAttempt('text', null, 0, start);
  } catch (error) {
    return makeAttemptError('text', error, start);
  }
}

/**
 * Matches elements by ARIA role and accessible name.
 */
async function roleStrategy(
  page: Page,
  originalLocator: LocatorInfo,
  _domSnapshot: DOMSnapshot,
): Promise<StrategyAttempt> {
  const start = Date.now();

  try {
    const candidates = await extractCandidates(page);
    if (candidates.length === 0) {
      return makeAttempt('role', null, 0, start);
    }

    // Determine what role/name to look for
    let targetRole = '';
    let targetName = '';

    if (originalLocator.type === 'role') {
      targetRole = originalLocator.selector;
      if (originalLocator.options && typeof originalLocator.options['name'] === 'string') {
        targetName = originalLocator.options['name'];
      }
    } else {
      // Try to infer from the selector
      targetName = originalLocator.selector;
    }

    let bestCandidate: CandidateElement | null = null;
    let bestScore = 0;

    for (const candidate of candidates) {
      const candidateRole = candidate.role || inferRole(candidate.tag);
      let score = 0;

      // Role matching
      if (targetRole) {
        if (candidateRole === targetRole) {
          score += 0.4;
        } else if (stringSimilarity(candidateRole, targetRole) > 0.7) {
          score += 0.2;
        } else {
          continue; // Skip candidates with completely wrong role
        }
      }

      // Name matching
      const candidateName = candidate.ariaLabel || candidate.text;
      if (targetName && candidateName) {
        score += stringSimilarity(targetName, candidateName) * 0.6;
      } else if (!targetName && candidateRole === targetRole) {
        // Role matched but no name to compare
        score += 0.1;
      }

      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    if (bestCandidate && bestScore >= 0.4) {
      const locator = buildLocatorInfo(bestCandidate, 'role');
      return makeAttempt('role', locator, Math.min(bestScore, 1), start);
    }

    return makeAttempt('role', null, 0, start);
  } catch (error) {
    return makeAttemptError('role', error, start);
  }
}

/**
 * Finds elements with similar CSS selectors using edit distance comparison.
 */
async function cssProximityStrategy(
  page: Page,
  originalLocator: LocatorInfo,
  _domSnapshot: DOMSnapshot,
): Promise<StrategyAttempt> {
  const start = Date.now();

  try {
    const candidates = await extractCandidates(page);
    if (candidates.length === 0) {
      return makeAttempt('css', null, 0, start);
    }

    const originalSelector = originalLocator.selector;
    let bestCandidate: CandidateElement | null = null;
    let bestScore = 0;

    for (const candidate of candidates) {
      // Build a CSS selector for this candidate and compare
      const candidateCss = buildCssSelector(candidate);
      const similarity = stringSimilarity(originalSelector, candidateCss);

      // Also check structural similarity (same tag, similar classes)
      let structuralBonus = 0;
      const originalTag = extractTagFromSelector(originalSelector);
      if (originalTag && candidate.tag === originalTag) {
        structuralBonus += 0.1;
      }

      const originalClasses = extractClassesFromSelector(originalSelector);
      if (originalClasses.length > 0 && candidate.classes.length > 0) {
        const overlap = originalClasses.filter((c) => candidate.classes.includes(c)).length;
        structuralBonus += (overlap / Math.max(originalClasses.length, candidate.classes.length)) * 0.3;
      }

      const totalScore = Math.min(similarity + structuralBonus, 1);

      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestCandidate = candidate;
      }
    }

    if (bestCandidate && bestScore >= 0.35) {
      const locator = buildLocatorInfo(bestCandidate, 'css');
      return makeAttempt('css', locator, bestScore, start);
    }

    return makeAttempt('css', null, 0, start);
  } catch (error) {
    return makeAttemptError('css', error, start);
  }
}

/**
 * Generates XPath-based locators using element context from the DOM snapshot.
 */
async function xpathStrategy(
  page: Page,
  originalLocator: LocatorInfo,
  _domSnapshot: DOMSnapshot,
): Promise<StrategyAttempt> {
  const start = Date.now();

  try {
    const candidates = await extractCandidates(page);
    if (candidates.length === 0) {
      return makeAttempt('xpath', null, 0, start);
    }

    const selector = originalLocator.selector;
    let bestCandidate: CandidateElement | null = null;
    let bestScore = 0;

    for (const candidate of candidates) {
      let score = 0;

      // Match by id (strongest signal)
      if (candidate.id && selector.includes(candidate.id)) {
        score = Math.max(score, 0.9);
      }

      // Match by text content
      if (candidate.text) {
        const textSim = stringSimilarity(selector, candidate.text);
        score = Math.max(score, textSim * 0.7);
      }

      // Match by any attribute value similarity
      for (const [, value] of Object.entries(candidate.attributes)) {
        if (value) {
          const attrSim = stringSimilarity(selector, value);
          score = Math.max(score, attrSim * 0.6);
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    if (bestCandidate && bestScore >= 0.35) {
      const locator = buildXpathLocator(bestCandidate);
      return makeAttempt('xpath', locator, bestScore, start);
    }

    return makeAttempt('xpath', null, 0, start);
  } catch (error) {
    return makeAttemptError('xpath', error, start);
  }
}

// ─── Table Strategy ─────────────────────────────────────────────────────────────

/**
 * Finds elements within HTML tables using row/column indexing,
 * header-to-cell correlation, and structural matching.
 */
async function tableStrategy(
  page: Page,
  originalLocator: LocatorInfo,
  _domSnapshot: DOMSnapshot,
): Promise<StrategyAttempt> {
  const start = Date.now();

  try {
    const candidates = await extractCandidates(page);
    const tableCandidates = candidates.filter((c) => c.isInTable);
    if (tableCandidates.length === 0) {
      return makeAttempt('table', null, 0, start);
    }

    const selector = originalLocator.selector;
    let bestCandidate: CandidateElement | null = null;
    let bestScore = 0;

    for (const candidate of tableCandidates) {
      let score = 0;

      // Match by text content within the cell
      if (candidate.text) {
        score = Math.max(score, stringSimilarity(selector, candidate.text) * 0.85);
      }

      // Match by data-testid
      if (candidate.testId) {
        score = Math.max(score, stringSimilarity(selector, candidate.testId) * 0.95);
      }

      // Match by column header text correlation
      if (candidate.tableHeaderText) {
        const headerSim = stringSimilarity(selector, candidate.tableHeaderText);
        score = Math.max(score, headerSim * 0.7);
      }

      // Match by id
      if (candidate.id) {
        score = Math.max(score, stringSimilarity(selector, candidate.id) * 0.9);
      }

      // Match by aria-label
      if (candidate.ariaLabel) {
        score = Math.max(score, stringSimilarity(selector, candidate.ariaLabel) * 0.8);
      }

      // Bonus for matching row/column patterns in the selector (e.g., "row-2", "col-3")
      const rowMatch = selector.match(/row[_-]?(\d+)/i);
      const colMatch = selector.match(/col(?:umn)?[_-]?(\d+)/i);
      if (rowMatch && candidate.tableRow === parseInt(rowMatch[1], 10)) {
        score += 0.1;
      }
      if (colMatch && candidate.tableCol === parseInt(colMatch[1], 10)) {
        score += 0.1;
      }

      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    if (bestCandidate && bestScore >= 0.35) {
      // Build a table-aware locator
      const locator = buildTableLocator(bestCandidate);
      return makeAttempt('table', locator, Math.min(bestScore, 1), start);
    }

    return makeAttempt('table', null, 0, start);
  } catch (error) {
    return makeAttemptError('table', error, start);
  }
}

function buildTableLocator(candidate: CandidateElement): LocatorInfo {
  // Prefer testid if available
  if (candidate.testId) {
    return {
      type: 'testid',
      selector: candidate.testId,
      playwrightExpression: `page.getByTestId('${escapeString(candidate.testId)}')`,
    };
  }

  // Use role-based locator for cells with header context
  if (candidate.tag === 'td' && candidate.tableHeaderText && candidate.text) {
    return {
      type: 'role',
      selector: 'cell',
      options: { name: candidate.text.substring(0, 80) },
      playwrightExpression: `page.getByRole('cell', { name: '${escapeString(candidate.text.substring(0, 80))}' })`,
    };
  }

  // Use nth-child table cell selector
  if (candidate.tableCellSelector) {
    return {
      type: 'css',
      selector: candidate.tableCellSelector,
      playwrightExpression: `page.locator('${escapeString(candidate.tableCellSelector)}')`,
    };
  }

  // Fallback to generic locator
  return buildLocatorInfo(candidate, candidate.tag === 'td' || candidate.tag === 'th' ? 'css' : 'text');
}

// ─── Modal Strategy ─────────────────────────────────────────────────────────────

/**
 * Finds elements within modal dialogs, popups, and overlays.
 * Prioritises candidates that are inside currently visible modals/dialogs.
 */
async function modalStrategy(
  page: Page,
  originalLocator: LocatorInfo,
  _domSnapshot: DOMSnapshot,
): Promise<StrategyAttempt> {
  const start = Date.now();

  try {
    const candidates = await extractCandidates(page);
    // First try candidates inside modals (most likely context for the failure)
    const modalCandidates = candidates.filter((c) => c.isInModal);

    // If original locator hints at modal context, prioritize modal candidates
    const isModalContext = originalLocator.selector.match(
      /modal|dialog|popup|overlay|alert/i,
    );

    const searchPool = isModalContext && modalCandidates.length > 0
      ? modalCandidates
      : candidates;

    if (searchPool.length === 0) {
      return makeAttempt('modal', null, 0, start);
    }

    const selector = originalLocator.selector;
    let bestCandidate: CandidateElement | null = null;
    let bestScore = 0;

    for (const candidate of searchPool) {
      let score = 0;

      // Match by data-testid
      if (candidate.testId) {
        score = Math.max(score, stringSimilarity(selector, candidate.testId) * 0.95);
      }

      // Match by aria-label (important for modal buttons)
      if (candidate.ariaLabel) {
        score = Math.max(score, stringSimilarity(selector, candidate.ariaLabel) * 0.9);
      }

      // Match by text (modal buttons/links often matched by text)
      if (candidate.text) {
        score = Math.max(score, stringSimilarity(selector, candidate.text) * 0.85);
      }

      // Match by id
      if (candidate.id) {
        score = Math.max(score, stringSimilarity(selector, candidate.id) * 0.9);
      }

      // Match by role
      if (candidate.role) {
        score = Math.max(score, stringSimilarity(selector, candidate.role) * 0.5);
      }

      // Bonus for being inside a modal when the original selector suggests modal context
      if (candidate.isInModal && isModalContext) {
        score += 0.1;
      }

      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    if (bestCandidate && bestScore >= 0.4) {
      const locator = buildLocatorInfo(bestCandidate, originalLocator.type);
      return makeAttempt('modal', locator, Math.min(bestScore, 1), start);
    }

    return makeAttempt('modal', null, 0, start);
  } catch (error) {
    return makeAttemptError('modal', error, start);
  }
}

// ─── CSS Selector Utilities ─────────────────────────────────────────────────────

function buildCssSelector(candidate: CandidateElement): string {
  if (candidate.id) return `#${candidate.id}`;
  if (candidate.classes.length > 0) {
    return `${candidate.tag}.${candidate.classes.slice(0, 3).join('.')}`;
  }
  if (candidate.name) return `${candidate.tag}[name="${candidate.name}"]`;
  return candidate.tag;
}

function extractTagFromSelector(selector: string): string | null {
  const match = selector.match(/^([a-zA-Z][a-zA-Z0-9]*)/);
  return match ? match[1].toLowerCase() : null;
}

function extractClassesFromSelector(selector: string): string[] {
  const matches = selector.match(/\.([a-zA-Z_-][\w-]*)/g);
  if (!matches) return [];
  return matches.map((m) => m.substring(1));
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function makeAttempt(
  strategy: HealingStrategyName,
  locator: LocatorInfo | null,
  confidence: number,
  startTime: number,
): StrategyAttempt {
  return {
    strategy,
    locator,
    confidence: Math.round(confidence * 100) / 100,
    duration: Date.now() - startTime,
  };
}

function makeAttemptError(
  strategy: HealingStrategyName,
  error: unknown,
  startTime: number,
): StrategyAttempt {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`Strategy "${strategy}" failed: ${message}`);
  return {
    strategy,
    locator: null,
    confidence: 0,
    duration: Date.now() - startTime,
    error: message,
  };
}

// ─── Strategy Registry & Dispatcher ─────────────────────────────────────────────

type StrategyFn = (
  page: Page,
  originalLocator: LocatorInfo,
  domSnapshot: DOMSnapshot,
) => Promise<StrategyAttempt>;

const STRATEGY_MAP: Record<string, StrategyFn> = {
  attribute: attributeStrategy,
  text: textStrategy,
  role: roleStrategy,
  css: cssProximityStrategy,
  xpath: xpathStrategy,
  table: tableStrategy,
  modal: modalStrategy,
  enterprise: enterpriseStrategy,
};

/**
 * Dispatches a named healing strategy and returns the result.
 *
 * @param name - The strategy name (attribute, text, role, css, xpath).
 * @param page - Playwright Page object.
 * @param originalLocator - The original failed locator information.
 * @param domSnapshot - A DOM snapshot of the page.
 * @returns The strategy attempt result.
 */
export async function runStrategy(
  name: string,
  page: Page,
  originalLocator: LocatorInfo,
  domSnapshot: DOMSnapshot,
): Promise<StrategyAttempt> {
  const strategyFn = STRATEGY_MAP[name];

  if (!strategyFn) {
    logger.warn(`Unknown strategy: ${name}`);
    return {
      strategy: name as HealingStrategyName,
      locator: null,
      confidence: 0,
      duration: 0,
      error: `Unknown strategy: ${name}`,
    };
  }

  logger.debug(`Running healing strategy: ${name}`);
  const result = await strategyFn(page, originalLocator, domSnapshot);
  logger.debug(
    `Strategy "${name}" completed: confidence=${result.confidence}, found=${result.locator !== null}`,
  );

  return result;
}

export {
  attributeStrategy,
  textStrategy,
  roleStrategy,
  cssProximityStrategy,
  xpathStrategy,
  tableStrategy,
  modalStrategy,
};
