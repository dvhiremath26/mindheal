import type { AIHealingRequest, AIHealingResponse, LocatorType, RAGContextChunk } from '../types/index';

const VALID_LOCATOR_TYPES: ReadonlySet<LocatorType> = new Set([
  'css', 'xpath', 'role', 'text', 'testid', 'label', 'placeholder', 'alttext', 'title',
]);

/**
 * Builds a complete prompt for the AI provider to suggest a healed locator.
 */
export function buildHealingPrompt(request: AIHealingRequest): string {
  const systemPrompt = `You are an expert Playwright test engineer specializing in locator strategies.
Your task is to analyze a broken Playwright locator and suggest a healed replacement based on the current DOM snapshot.

LOCATOR BEST PRACTICES (follow in priority order):
1. Prefer \`getByRole\` with accessible name — most resilient to DOM changes
2. Prefer \`getByTestId\` when a data-testid attribute is present
3. Prefer \`getByLabel\` for form inputs with associated labels
4. Prefer \`getByPlaceholder\` for inputs with placeholder text
5. Prefer \`getByText\` for elements with unique, stable visible text
6. Prefer \`getByAltText\` for images with alt attributes
7. Prefer \`getByTitle\` when title attribute is the best identifier
8. Use CSS selectors only as a last resort
9. Avoid XPath unless no other strategy is viable

SPECIAL CONTEXTS:
- MODALS/DIALOGS: If the element is inside a modal, dialog, popup, or overlay (look for \`dialog\`, \`role="dialog"\`, \`role="alertdialog"\`, \`aria-modal="true"\`, or classes like \`.modal\`), scope your locator to the modal context. Use \`page.getByRole('dialog').getByRole(...)\` or similar chaining to avoid matching elements behind the modal.
- WEB TABLES: If the element is inside a \`<table>\`, consider using:
  - \`page.getByRole('cell', { name: '...' })\` for specific cell content
  - \`page.getByRole('row', { name: '...' }).getByRole('cell')\` for row+cell targeting
  - \`page.locator('table >> tr:nth-child(N) >> td:nth-child(M)')\` for index-based access
  - Column header text can help identify the right column
- SHADOW DOM: If elements are inside shadow roots (\`#shadow-root\` markers in the snapshot), Playwright can pierce shadow DOM with CSS selectors or via \`page.locator('host-element').locator('inner-selector')\`
- ENTERPRISE APPLICATIONS: If the DOM contains SAP (ui5-*, sap-*), Salesforce (lightning-*, force-*), ServiceNow (now-*, sn-*), or similar enterprise elements:
  - NEVER rely on dynamically generated IDs (e.g., \`__xmlview0--\`, \`globalId_\`, \`auraId_\`). Use \`[id$="stablePart"]\` suffix matching instead.
  - Prefer \`data-automation-id\`, \`data-testid\`, \`data-field\`, \`data-field-name\`, \`data-component-id\`, or \`data-control-name\` attributes.
  - For SAP UI5, use \`[data-sap-ui]\` or \`[data-sap-ui-id]\` attributes.
  - For Salesforce Lightning, prefer \`lightning-*\` custom element selectors with stable attributes.
  - For ServiceNow, use \`[data-table-name]\`, \`[data-field-name]\`, or \`[data-element]\` attributes.

IMPORTANT:
- The playwrightExpression must be a valid Playwright locator call (e.g., \`page.getByRole('button', { name: 'Submit' })\`)
- Confidence should be between 0 and 1 (1 = certainty, 0.5 = moderate guess)
- Provide clear reasoning explaining why you chose this locator

You MUST respond with ONLY a JSON object in this exact format (no markdown, no code fences):
{
  "selector": "<the selector value>",
  "locatorType": "<one of: css, xpath, role, text, testid, label, placeholder, alttext, title>",
  "confidence": <number between 0 and 1>,
  "reasoning": "<brief explanation of why this locator was chosen>",
  "playwrightExpression": "<full Playwright locator expression starting with page.>"
}`;

  const userPrompt = `A Playwright locator has broken. Please analyze the DOM and suggest a healed locator.

BROKEN LOCATOR:
- Type: ${request.originalLocator.type}
- Selector: ${request.originalLocator.selector}
- Playwright expression: ${request.originalLocator.playwrightExpression}

ERROR MESSAGE:
${request.errorMessage}

PAGE URL: ${request.pageUrl}
ACTION ATTEMPTED: ${request.action}

CURRENT DOM SNAPSHOT:
${request.domSnapshot}${request.nearbyElements ? `

NEARBY ELEMENTS:
${request.nearbyElements}` : ''}${request.ragContext && request.ragContext.length > 0 ? `

PROJECT CONTEXT (from RAG knowledge base):
${formatRAGContext(request.ragContext)}

Use the above project context to make a more informed decision. For example:
- If healing history shows a previous fix for a similar locator, prefer that pattern.
- If page object metadata lists known selectors, use them.
- If git changes show a recent rename, the new name is likely correct.
- If component docs describe the expected structure, align with it.` : ''}

Respond with ONLY the JSON object — no extra text.`;

  return `${systemPrompt}\n\n---\n\n${userPrompt}`;
}

/**
 * Parses the AI provider's raw text response into a structured AIHealingResponse.
 * Handles malformed responses gracefully by attempting multiple extraction strategies.
 */
export function parseHealingResponse(response: string): AIHealingResponse {
  const trimmed = response.trim();

  // Strategy 1: Try direct JSON parse
  const directParsed = tryParseJSON(trimmed);
  if (directParsed) {
    return validateAndNormalize(directParsed);
  }

  // Strategy 2: Extract JSON from markdown code fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    const fenceParsed = tryParseJSON(fenceMatch[1].trim());
    if (fenceParsed) {
      return validateAndNormalize(fenceParsed);
    }
  }

  // Strategy 3: Find first { ... } block in the response
  const braceStart = trimmed.indexOf('{');
  const braceEnd = trimmed.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    const extracted = trimmed.slice(braceStart, braceEnd + 1);
    const extractedParsed = tryParseJSON(extracted);
    if (extractedParsed) {
      return validateAndNormalize(extractedParsed);
    }
  }

  throw new Error(
    `[MindHeal] Failed to parse AI healing response. Raw response: ${trimmed.slice(0, 500)}`
  );
}

function tryParseJSON(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function validateAndNormalize(data: Record<string, unknown>): AIHealingResponse {
  const selector = extractString(data, 'selector');
  if (!selector) {
    throw new Error('[MindHeal] AI response missing required field: selector');
  }

  const playwrightExpression = extractString(data, 'playwrightExpression');
  if (!playwrightExpression) {
    throw new Error('[MindHeal] AI response missing required field: playwrightExpression');
  }

  const rawLocatorType = extractString(data, 'locatorType') ?? 'css';
  const locatorType: LocatorType = VALID_LOCATOR_TYPES.has(rawLocatorType as LocatorType)
    ? (rawLocatorType as LocatorType)
    : 'css';

  const rawConfidence = typeof data['confidence'] === 'number' ? data['confidence'] : 0.5;
  const confidence = Math.max(0, Math.min(1, rawConfidence));

  const reasoning = extractString(data, 'reasoning') ?? 'No reasoning provided by AI';

  return {
    selector,
    locatorType,
    confidence,
    reasoning,
    playwrightExpression,
  };
}

function extractString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return undefined;
}

/**
 * Formats RAG context chunks into a readable section for the AI prompt.
 */
function formatRAGContext(chunks: RAGContextChunk[]): string {
  return chunks
    .map((chunk, i) => {
      const header = `[${i + 1}] Source: ${chunk.source} (relevance: ${chunk.relevanceScore.toFixed(2)})`;
      const meta = Object.entries(chunk.metadata)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n');
      return `${header}\n${meta ? meta + '\n' : ''}${chunk.content}`;
    })
    .join('\n\n---\n\n');
}
