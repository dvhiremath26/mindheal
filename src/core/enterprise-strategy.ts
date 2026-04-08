/**
 * Enterprise Application Healing Strategy
 *
 * Specialized healing for complex enterprise web applications:
 * - SAP Fiori / SAP GUI for HTML / UI5
 * - Salesforce Lightning / Classic / LWC
 * - Oracle ERP / NetSuite
 * - Workday
 * - ServiceNow
 * - Microsoft Dynamics 365
 *
 * These platforms share common challenges:
 * 1. Dynamically generated IDs that change on every render
 * 2. Deep Shadow DOM nesting (Lightning Web Components)
 * 3. Deeply nested iframes (SAP GUI, Classic Salesforce)
 * 4. Custom web components with proprietary tag names
 * 5. Virtual scrolling / lazy-loaded grids with thousands of rows
 * 6. Complex multi-level menus and navigation trees
 * 7. Hashed/obfuscated CSS class names
 * 8. Heavy async data loading with skeleton/shimmer screens
 */

import type { Page } from '@playwright/test';
import type {
  LocatorInfo,
  LocatorType,
  DOMSnapshot,
  StrategyAttempt,
  HealingStrategyName,
} from '../types/index';
import { logger } from '../utils/logger';

// ─── Dynamic ID Patterns ────────────────────────────────────────────────────

/**
 * Patterns that match dynamically generated IDs across enterprise platforms.
 * When a selector contains one of these patterns, the ID portion is volatile
 * and should be stripped/replaced during healing.
 */
const DYNAMIC_ID_PATTERNS: ReadonlyArray<{
  platform: string;
  pattern: RegExp;
  description: string;
}> = [
  // SAP UI5 / Fiori
  { platform: 'sap', pattern: /^__xmlview\d+--/, description: 'SAP XML View prefix' },
  { platform: 'sap', pattern: /^__component\d+---/, description: 'SAP Component prefix' },
  { platform: 'sap', pattern: /^__control\d+-/, description: 'SAP Control ID' },
  { platform: 'sap', pattern: /^__field\d+-/, description: 'SAP Field ID' },
  { platform: 'sap', pattern: /^__item\d+-/, description: 'SAP Item ID' },
  { platform: 'sap', pattern: /^__table\d+-/, description: 'SAP Table ID' },
  { platform: 'sap', pattern: /^__dialog\d+-/, description: 'SAP Dialog ID' },
  { platform: 'sap', pattern: /-__clone\d+$/, description: 'SAP Clone suffix' },
  { platform: 'sap', pattern: /^sap-ui-blocklayer-/, description: 'SAP Block layer' },

  // Salesforce Lightning / Aura / LWC
  { platform: 'salesforce', pattern: /^globalId_\d+/, description: 'Salesforce Global ID' },
  { platform: 'salesforce', pattern: /^auraId_\d+/, description: 'Salesforce Aura ID' },
  { platform: 'salesforce', pattern: /;\d+;[a-z]$/, description: 'Salesforce Aura locator suffix' },
  { platform: 'salesforce', pattern: /^cmp[A-Za-z0-9]{10,}/, description: 'Salesforce component hash' },
  { platform: 'salesforce', pattern: /^[0-9]+:[0-9]+;a$/, description: 'Salesforce numeric locator' },

  // Oracle / NetSuite
  { platform: 'oracle', pattern: /^pt\d+_\d+_/, description: 'Oracle PeopleSoft prefix' },
  { platform: 'oracle', pattern: /^N\d{5,}/, description: 'Oracle Forms numeric ID' },
  { platform: 'oracle', pattern: /^_fox[A-Z0-9]+/, description: 'Oracle ADF Faces prefix' },

  // Workday
  { platform: 'workday', pattern: /^wd-[A-Za-z0-9]{8,}-/, description: 'Workday widget prefix' },
  { platform: 'workday', pattern: /^TABSTRIP_\d+_/, description: 'Workday tab strip ID' },

  // ServiceNow
  { platform: 'servicenow', pattern: /^sys_[a-f0-9]{32}/, description: 'ServiceNow SysID' },
  { platform: 'servicenow', pattern: /^x_[a-z]+_[a-z]+_/, description: 'ServiceNow scoped app prefix' },

  // Microsoft Dynamics 365
  { platform: 'dynamics', pattern: /^MscrmControls\./, description: 'Dynamics CRM control' },
  { platform: 'dynamics', pattern: /^id-[a-f0-9]{8}-[a-f0-9]{4}/, description: 'Dynamics GUID prefix' },

  // Generic patterns (shared across platforms)
  { platform: 'generic', pattern: /^ember\d+/, description: 'Ember auto-generated ID' },
  { platform: 'generic', pattern: /^react-select-\d+-/, description: 'React Select ID' },
  { platform: 'generic', pattern: /^ext-gen\d+/, description: 'ExtJS auto-generated ID' },
  { platform: 'generic', pattern: /^gwt-uid-\d+/, description: 'GWT auto-generated ID' },
  { platform: 'generic', pattern: /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/, description: 'UUID v4' },
  { platform: 'generic', pattern: /^[a-f0-9]{24,}$/, description: 'Long hex hash' },
  { platform: 'generic', pattern: /_\d{10,}$/, description: 'Timestamp suffix' },
];

/**
 * Custom element tag prefixes for enterprise platforms.
 * Maps proprietary tag prefixes to their platform.
 */
const ENTERPRISE_TAG_PREFIXES: ReadonlyArray<{
  prefix: string;
  platform: string;
  semanticRole?: string;
}> = [
  // Salesforce Lightning
  { prefix: 'lightning-', platform: 'salesforce' },
  { prefix: 'c-', platform: 'salesforce-lwc' },
  { prefix: 'force-', platform: 'salesforce' },
  { prefix: 'one-', platform: 'salesforce' },
  { prefix: 'ui-', platform: 'salesforce' },
  { prefix: 'aura-', platform: 'salesforce' },
  { prefix: 'slot-', platform: 'salesforce' },
  { prefix: 'flowruntime-', platform: 'salesforce' },

  // SAP UI5
  { prefix: 'ui5-', platform: 'sap' },
  { prefix: 'sap-', platform: 'sap' },

  // ServiceNow
  { prefix: 'sn-', platform: 'servicenow' },
  { prefix: 'now-', platform: 'servicenow' },

  // Microsoft Dynamics / Fluent UI
  { prefix: 'fluent-', platform: 'dynamics' },

  // Generic web component patterns
  { prefix: 'vaadin-', platform: 'vaadin' },
  { prefix: 'ion-', platform: 'ionic' },
  { prefix: 'mat-', platform: 'angular-material' },
  { prefix: 'mwc-', platform: 'material-web' },
];

/**
 * Stable attribute names that enterprise platforms use as data identifiers.
 * These are more reliable than generated IDs.
 */
const ENTERPRISE_STABLE_ATTRIBUTES: ReadonlyArray<string> = [
  // SAP
  'data-sap-ui', 'data-sap-ui-id', 'data-sap-ui-related', 'data-sap-ui-column',
  'data-sap-ui-rowindex', 'data-sap-ui-colindex',
  // Salesforce
  'data-aura-rendered-by', 'data-aura-class', 'data-component-id',
  'data-target-selection-name', 'data-field', 'data-field-id',
  'data-record-id', 'data-tab-name', 'data-refid',
  // Oracle
  'data-afr-rkey', 'data-afr-fgid',
  // ServiceNow
  'data-type', 'data-field-name', 'data-table-name',
  'data-sys-id', 'data-element',
  // Workday
  'data-automation-id', 'data-uxi-element-id', 'data-uxi-widget-type',
  // Dynamics 365
  'data-id', 'data-lp-id', 'data-control-name',
  // Generic stable attributes
  'data-testid', 'data-test-id', 'data-test', 'data-cy',
  'data-qa', 'data-automation', 'data-hook',
  'name', 'aria-label', 'aria-labelledby', 'aria-describedby',
  'title', 'placeholder', 'alt',
];

// ─── Helper Functions ───────────────────────────────────────────────────────

/**
 * Detects if an ID appears to be dynamically generated.
 */
export function isDynamicId(id: string): boolean {
  return DYNAMIC_ID_PATTERNS.some((p) => p.pattern.test(id));
}

/**
 * Detects the enterprise platform from page URL, DOM content, or element tags.
 */
export function detectPlatform(url: string, html: string): string | null {
  const urlLower = url.toLowerCase();
  const htmlLower = html.toLowerCase();

  // URL-based detection
  if (urlLower.includes('.force.com') || urlLower.includes('.lightning.force') || urlLower.includes('salesforce.com')) {
    return 'salesforce';
  }
  if (urlLower.includes('.sapcloud.') || urlLower.includes('/sap/') || urlLower.includes('fiorilaunchpad')) {
    return 'sap';
  }
  if (urlLower.includes('.oraclecloud.') || urlLower.includes('netsuite.com') || urlLower.includes('oracle.com')) {
    return 'oracle';
  }
  if (urlLower.includes('workday.com') || urlLower.includes('.myworkday.')) {
    return 'workday';
  }
  if (urlLower.includes('service-now.com') || urlLower.includes('servicenow.com')) {
    return 'servicenow';
  }
  if (urlLower.includes('.dynamics.com') || urlLower.includes('crm.dynamics')) {
    return 'dynamics';
  }

  // DOM-based detection
  if (htmlLower.includes('lightning-') || htmlLower.includes('data-aura-rendered-by')) {
    return 'salesforce';
  }
  if (htmlLower.includes('sap-ui-') || htmlLower.includes('ui5-') || htmlLower.includes('data-sap-ui')) {
    return 'sap';
  }
  if (htmlLower.includes('now-') || htmlLower.includes('sn-') || htmlLower.includes('data-table-name')) {
    return 'servicenow';
  }
  if (htmlLower.includes('data-automation-id') || htmlLower.includes('data-uxi-widget-type')) {
    return 'workday';
  }

  return null;
}

/**
 * Strips dynamic ID prefixes/suffixes to extract the stable portion.
 * Example: "__xmlview0--loginButton" → "loginButton"
 */
export function extractStableIdPart(id: string): string | null {
  for (const { pattern } of DYNAMIC_ID_PATTERNS) {
    if (pattern.test(id)) {
      // Try to extract the meaningful suffix after the dynamic prefix
      const stripped = id.replace(pattern, '');
      if (stripped.length > 2) {
        return stripped;
      }
    }
  }
  return null;
}

/**
 * Levenshtein-based string similarity (0-1).
 */
function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const maxLen = Math.max(a.length, b.length);
  const la = a.length;
  const lb = b.length;
  const prev = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= lb; j++) {
      const temp = prev[j];
      if (a.toLowerCase().charCodeAt(i - 1) === b.toLowerCase().charCodeAt(j - 1)) {
        prev[j] = prevDiag;
      } else {
        prev[j] = 1 + Math.min(prevDiag, prev[j], prev[j - 1]);
      }
      prevDiag = temp;
    }
  }
  return 1 - prev[lb] / maxLen;
}

// ─── Enterprise Candidate Extraction ────────────────────────────────────────

interface EnterpriseCandidate {
  tag: string;
  id: string;
  stableId: string | null;
  classes: string[];
  text: string;
  role: string;
  ariaLabel: string;
  stableAttrs: Record<string, string>;
  placeholder: string;
  name: string;
  title: string;
  href: string;
  isInsideShadowDOM: boolean;
  iframeDepth: number;
  customElementTag: string | null;
  platform: string | null;
}

/**
 * Extracts candidate elements from the page with enterprise-specific
 * attribute collection. Pierces Shadow DOM and traverses iframes.
 */
async function extractEnterpriseCandidates(page: Page): Promise<EnterpriseCandidate[]> {
  const stableAttrNames = [...ENTERPRISE_STABLE_ATTRIBUTES];
  const customPrefixes = ENTERPRISE_TAG_PREFIXES.map((t) => t.prefix);

  try {
    return await page.evaluate(
      ({ stableAttrs, tagPrefixes }) => {
        const candidates: EnterpriseCandidate[] = [];
        const MAX_CANDIDATES = 800;

        function isCustomElement(tag: string): string | null {
          const lower = tag.toLowerCase();
          for (const prefix of tagPrefixes) {
            if (lower.startsWith(prefix)) return lower;
          }
          // Custom elements always contain a hyphen
          if (lower.includes('-') && !lower.startsWith('data-')) return lower;
          return null;
        }

        function collectFromRoot(
          root: Document | ShadowRoot,
          inShadow: boolean,
          iframeDepth: number,
        ): void {
          if (candidates.length >= MAX_CANDIDATES) return;

          // Broad selector for interactive + semantic elements
          const selectors = [
            'button', 'input', 'select', 'textarea', 'a[href]',
            '[role]', '[aria-label]', '[data-testid]', '[data-test-id]',
            '[data-test]', '[data-cy]', '[data-qa]', '[data-automation]',
            '[data-automation-id]', '[data-field]', '[data-field-name]',
            '[data-component-id]', '[data-control-name]', '[data-hook]',
            '[data-sap-ui]', '[data-sap-ui-id]', '[data-aura-rendered-by]',
            '[data-uxi-element-id]', '[name]',
            'h1', 'h2', 'h3', 'h4', 'label', 'th', 'td',
            'li', 'option', 'summary',
          ];

          let elements: Element[];
          try {
            elements = Array.from(root.querySelectorAll(selectors.join(',')));
          } catch {
            elements = Array.from(root.querySelectorAll('*'));
          }

          // Also collect custom elements
          try {
            const allEls = Array.from(root.querySelectorAll('*'));
            for (const el of allEls) {
              if (candidates.length >= MAX_CANDIDATES) break;
              if (isCustomElement(el.tagName) && !elements.includes(el)) {
                elements.push(el);
              }
            }
          } catch {
            // Ignore
          }

          for (const el of elements) {
            if (candidates.length >= MAX_CANDIDATES) break;

            const tag = el.tagName.toLowerCase();
            const id = el.id || '';
            const text = (el.textContent || '').trim().substring(0, 200);
            const role = el.getAttribute('role') || '';
            const ariaLabel = el.getAttribute('aria-label') || '';
            const placeholder = el.getAttribute('placeholder') || '';
            const name = el.getAttribute('name') || '';
            const title = el.getAttribute('title') || '';
            const href = el.getAttribute('href') || '';

            // Collect stable enterprise attributes
            const stableAttrMap: Record<string, string> = {};
            for (const attrName of stableAttrs) {
              const val = el.getAttribute(attrName);
              if (val) stableAttrMap[attrName] = val;
            }

            const classes = Array.from(el.classList).slice(0, 10);

            candidates.push({
              tag,
              id,
              stableId: null, // Computed post-extraction
              classes,
              text,
              role,
              ariaLabel,
              stableAttrs: stableAttrMap,
              placeholder,
              name,
              title,
              href,
              isInsideShadowDOM: inShadow,
              iframeDepth,
              customElementTag: isCustomElement(tag),
              platform: null, // Computed post-extraction
            });
          }

          // Recurse into shadow roots
          const shadowHosts = Array.from(root.querySelectorAll('*'));
          for (const el of shadowHosts) {
            if (candidates.length >= MAX_CANDIDATES) break;
            if (el.shadowRoot) {
              collectFromRoot(el.shadowRoot, true, iframeDepth);
            }
          }
        }

        collectFromRoot(document, false, 0);

        // Also try to collect from accessible iframes
        try {
          const iframes = Array.from(document.querySelectorAll('iframe'));
          for (const iframe of iframes) {
            if (candidates.length >= MAX_CANDIDATES) break;
            try {
              const iframeDoc = iframe.contentDocument;
              if (iframeDoc) {
                collectFromRoot(iframeDoc, false, 1);
              }
            } catch {
              // Cross-origin iframe — skip
            }
          }
        } catch {
          // Ignore
        }

        return candidates;
      },
      { stableAttrs: stableAttrNames, tagPrefixes: customPrefixes },
    );
  } catch (err) {
    logger.warn(`[Enterprise] Failed to extract candidates: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

// ─── Scoring Engine ─────────────────────────────────────────────────────────

/**
 * Scores a candidate against the original broken locator.
 * Uses a multi-signal approach weighting enterprise-specific attributes higher.
 */
function scoreCandidate(
  candidate: EnterpriseCandidate,
  originalLocator: LocatorInfo,
  detectedPlatform: string | null,
): { score: number; matchType: string; newSelector: string; newType: LocatorType; expression: string } | null {
  const origSelector = originalLocator.selector;
  const origExpr = originalLocator.playwrightExpression;
  const origType = originalLocator.type;

  let bestScore = 0;
  let matchType = '';
  let newSelector = '';
  let newType: LocatorType = 'css';
  let expression = '';

  // ── Signal 1: Stable ID match (dynamic ID stripped) ───────────────────
  if (candidate.id) {
    const stableId = extractStableIdPart(candidate.id);
    if (stableId) {
      candidate.stableId = stableId;

      // Check if the original selector contains the stable part
      const origStable = extractStableIdPart(origSelector.replace(/^#/, '')) ?? origSelector.replace(/^#/, '');
      const similarity = stringSimilarity(stableId, origStable);

      if (similarity > bestScore) {
        bestScore = similarity;
        matchType = 'stable-id';
        newSelector = `[id$="${stableId}"]`;
        newType = 'css';
        expression = `page.locator('[id$="${stableId}"]')`;
      }
    }
  }

  // ── Signal 2: Enterprise stable attributes ────────────────────────────
  for (const [attrName, attrValue] of Object.entries(candidate.stableAttrs)) {
    if (!attrValue) continue;

    // data-testid, data-automation-id etc. are very high confidence
    const isTestAttribute = attrName.includes('testid') || attrName.includes('test-id')
      || attrName.includes('automation') || attrName.includes('data-cy')
      || attrName.includes('data-qa') || attrName.includes('data-hook');

    // Check if original selector referenced this attribute
    const origReferencesAttr = origSelector.includes(attrName) || origSelector.includes(attrValue);

    let attrScore = 0;
    if (origReferencesAttr) {
      attrScore = 0.95;
    } else if (isTestAttribute) {
      // Test attributes on elements with similar text/role
      const textSim = stringSimilarity(candidate.text.toLowerCase(), origSelector.toLowerCase());
      attrScore = 0.7 + (textSim * 0.2);
    } else {
      // Other stable attribute — moderate match
      const valueSim = stringSimilarity(attrValue.toLowerCase(), origSelector.replace(/^[#.]/, '').toLowerCase());
      attrScore = valueSim * 0.6;
    }

    if (attrScore > bestScore) {
      bestScore = attrScore;

      if (attrName === 'data-testid' || attrName === 'data-test-id') {
        matchType = 'enterprise-testid';
        newSelector = attrValue;
        newType = 'testid';
        expression = `page.getByTestId('${attrValue}')`;
      } else if (attrName === 'aria-label') {
        matchType = 'enterprise-aria-label';
        newSelector = attrValue;
        newType = 'label';
        expression = `page.getByLabel('${attrValue}')`;
      } else if (attrName === 'placeholder') {
        matchType = 'enterprise-placeholder';
        newSelector = attrValue;
        newType = 'placeholder';
        expression = `page.getByPlaceholder('${attrValue}')`;
      } else if (attrName === 'title') {
        matchType = 'enterprise-title';
        newSelector = attrValue;
        newType = 'title';
        expression = `page.getByTitle('${attrValue}')`;
      } else {
        matchType = `enterprise-attr:${attrName}`;
        newSelector = `[${attrName}="${attrValue}"]`;
        newType = 'css';
        expression = `page.locator('[${attrName}="${attrValue}"]')`;
      }
    }
  }

  // ── Signal 3: ARIA role + name matching ───────────────────────────────
  if (candidate.role) {
    let roleScore = 0;
    const origRefRole = origExpr.includes('getByRole') || origExpr.includes(`role="${candidate.role}"`);

    if (origRefRole) {
      roleScore = 0.85;
    } else {
      roleScore = 0.4;
    }

    // Boost if aria-label matches original selector text
    if (candidate.ariaLabel) {
      const labelSim = stringSimilarity(
        candidate.ariaLabel.toLowerCase(),
        origSelector.replace(/^[#.]/, '').replace(/[-_]/g, ' ').toLowerCase(),
      );
      roleScore = Math.max(roleScore, 0.5 + labelSim * 0.4);
    }

    if (roleScore > bestScore) {
      bestScore = roleScore;
      matchType = 'enterprise-role';
      newSelector = candidate.role;
      newType = 'role';
      const nameOpt = candidate.ariaLabel ? `, { name: '${candidate.ariaLabel}' }` : '';
      expression = `page.getByRole('${candidate.role}'${nameOpt})`;
    }
  }

  // ── Signal 4: Text content matching ───────────────────────────────────
  if (candidate.text && candidate.text.length > 0 && candidate.text.length < 100) {
    const cleanText = candidate.text.replace(/\s+/g, ' ').trim();
    const origClean = origSelector.replace(/^[#.]/, '').replace(/[-_]/g, ' ').toLowerCase();

    const textSim = stringSimilarity(cleanText.toLowerCase(), origClean);

    // For text-based original locators, text matching is very relevant
    const origIsTextBased = origType === 'text' || origExpr.includes('getByText');

    const textScore = origIsTextBased
      ? textSim * 0.9
      : textSim * 0.5;

    if (textScore > bestScore && cleanText.length > 1) {
      bestScore = textScore;
      matchType = 'enterprise-text';
      newSelector = cleanText;
      newType = 'text';
      expression = `page.getByText('${cleanText.replace(/'/g, "\\'")}')`;
    }
  }

  // ── Signal 5: Custom element tag matching ─────────────────────────────
  if (candidate.customElementTag) {
    const tagSim = stringSimilarity(
      candidate.customElementTag,
      origSelector.replace(/^[#.]/, '').toLowerCase(),
    );

    // Custom elements combined with stable attributes are very reliable
    const hasStableAttr = Object.keys(candidate.stableAttrs).length > 0;
    const customScore = hasStableAttr ? 0.5 + tagSim * 0.3 : tagSim * 0.4;

    if (customScore > bestScore) {
      bestScore = customScore;
      matchType = 'enterprise-custom-element';

      // Build a selector using the custom element + best stable attribute
      const bestAttr = Object.entries(candidate.stableAttrs)[0];
      if (bestAttr) {
        newSelector = `${candidate.customElementTag}[${bestAttr[0]}="${bestAttr[1]}"]`;
      } else if (candidate.ariaLabel) {
        newSelector = `${candidate.customElementTag}[aria-label="${candidate.ariaLabel}"]`;
      } else {
        newSelector = candidate.customElementTag;
      }
      newType = 'css';
      expression = `page.locator('${newSelector}')`;
    }
  }

  // ── Signal 6: Name attribute matching ─────────────────────────────────
  if (candidate.name) {
    const nameSim = stringSimilarity(candidate.name.toLowerCase(), origSelector.replace(/^[#.]/, '').toLowerCase());
    const nameScore = nameSim * 0.7;

    if (nameScore > bestScore) {
      bestScore = nameScore;
      matchType = 'enterprise-name';
      newSelector = `[name="${candidate.name}"]`;
      newType = 'css';
      expression = `page.locator('[name="${candidate.name}"]')`;
    }
  }

  // ── Confidence adjustments ────────────────────────────────────────────

  // Boost for same-platform matches when platform is detected
  if (detectedPlatform && candidate.platform === detectedPlatform) {
    bestScore = Math.min(1, bestScore * 1.1);
  }

  // Slight penalty for shadow DOM (harder to verify)
  if (candidate.isInsideShadowDOM) {
    bestScore *= 0.95;
  }

  // Penalty for deep iframe nesting
  if (candidate.iframeDepth > 0) {
    bestScore *= 0.9;
  }

  if (bestScore < 0.35) return null;

  return {
    score: bestScore,
    matchType,
    newSelector,
    newType,
    expression,
  };
}

// ─── Main Enterprise Strategy ───────────────────────────────────────────────

/**
 * Enterprise healing strategy.
 *
 * Handles dynamic IDs, custom web components, enterprise-specific stable
 * attributes, and Shadow DOM / iframe piercing for SAP, Salesforce,
 * Oracle, Workday, ServiceNow, Dynamics 365, and similar platforms.
 */
export async function enterpriseStrategy(
  page: Page,
  originalLocator: LocatorInfo,
  domSnapshot: DOMSnapshot,
): Promise<StrategyAttempt> {
  const start = Date.now();
  const strategy: HealingStrategyName = 'enterprise';

  // Detect which platform we're dealing with
  const detectedPlatform = detectPlatform(domSnapshot.url, domSnapshot.html);
  if (detectedPlatform) {
    logger.info(`[Enterprise] Detected platform: ${detectedPlatform}`);
  }

  // Check if original selector contains a dynamic ID
  const origId = originalLocator.selector.replace(/^#/, '');
  const hasDynamicId = isDynamicId(origId);
  if (hasDynamicId) {
    const stablePart = extractStableIdPart(origId);
    logger.debug(
      `[Enterprise] Original selector has dynamic ID. Stable part: "${stablePart ?? 'none'}"`,
    );
  }

  // Extract candidates with enterprise-aware attribute collection
  const candidates = await extractEnterpriseCandidates(page);
  if (candidates.length === 0) {
    return {
      strategy,
      locator: null,
      confidence: 0,
      duration: Date.now() - start,
      error: 'No enterprise candidates found',
    };
  }

  logger.debug(`[Enterprise] Extracted ${candidates.length} candidates`);

  // Tag candidates with platform info
  for (const c of candidates) {
    if (c.customElementTag) {
      const match = ENTERPRISE_TAG_PREFIXES.find((p) => c.customElementTag!.startsWith(p.prefix));
      if (match) c.platform = match.platform;
    }
  }

  // Score all candidates
  let bestResult: {
    score: number;
    matchType: string;
    newSelector: string;
    newType: LocatorType;
    expression: string;
  } | null = null;

  for (const candidate of candidates) {
    const result = scoreCandidate(candidate, originalLocator, detectedPlatform);
    if (result && (!bestResult || result.score > bestResult.score)) {
      bestResult = result;
    }
  }

  if (!bestResult) {
    return {
      strategy,
      locator: null,
      confidence: 0,
      duration: Date.now() - start,
    };
  }

  logger.info(
    `[Enterprise] Best match: ${bestResult.matchType} → "${bestResult.expression}" ` +
      `(confidence: ${bestResult.score.toFixed(3)})`,
  );

  return {
    strategy,
    locator: {
      type: bestResult.newType,
      selector: bestResult.newSelector,
      playwrightExpression: bestResult.expression,
    },
    confidence: bestResult.score,
    duration: Date.now() - start,
  };
}

// ─── Wait Strategy for Enterprise Loading Patterns ──────────────────────────

/**
 * Enterprise applications often have extended loading times with skeleton
 * screens, spinners, and async data fetches. This helper waits for
 * enterprise-specific loading indicators to disappear.
 */
export async function waitForEnterpriseLoad(page: Page, timeout = 15000): Promise<void> {
  const loadingSelectors = [
    // SAP
    '.sapUiLocalBusyIndicator',
    '.sapMBusyDialog',
    '#sap-ui-blocklayer-popup',
    'ui5-busy-indicator[active]',

    // Salesforce
    '.slds-spinner_container',
    'lightning-spinner',
    '.forceListViewManagerLoading',
    '[role="progressbar"]',

    // ServiceNow
    '.loading-placeholder',
    '.sn-loading',

    // Workday
    '.wd-LoadingPanel',
    '[data-automation-id="loadingSpinner"]',

    // Generic
    '.skeleton',
    '.shimmer',
    '[aria-busy="true"]',
  ];

  for (const selector of loadingSelectors) {
    try {
      const locator = page.locator(selector);
      const count = await locator.count();
      if (count > 0) {
        logger.debug(`[Enterprise] Waiting for loading indicator: ${selector}`);
        await locator.first().waitFor({ state: 'hidden', timeout });
      }
    } catch {
      // Timeout or element not found — continue
    }
  }
}

/**
 * Scrolls a virtual scroll container to try to bring more elements into view.
 * Enterprise grids (SAP ALV, Salesforce report tables) often virtualize rows.
 */
export async function scrollVirtualContainer(
  page: Page,
  containerSelector?: string,
): Promise<void> {
  const defaultContainers = [
    '.sapUiTableCCnt',          // SAP UI5 Table
    '.sapMListItems',            // SAP Mobile List
    '.slds-scrollable_y',        // Salesforce SLDS
    '.virtualScrollInner',       // Generic virtual scroll
    '[role="grid"]',             // ARIA grid
    '[role="listbox"]',          // ARIA listbox
    '.ag-body-viewport',         // AG Grid
    '.dx-scrollable-container',  // DevExtreme
  ];

  const selectors = containerSelector ? [containerSelector] : defaultContainers;

  for (const selector of selectors) {
    try {
      const container = page.locator(selector).first();
      const count = await container.count();
      if (count > 0) {
        logger.debug(`[Enterprise] Scrolling virtual container: ${selector}`);
        await container.evaluate((el) => {
          el.scrollTop += 500;
        });
        // Give the virtual scroll time to render
        await page.waitForTimeout(300);
        break;
      }
    } catch {
      // Continue to next container
    }
  }
}
