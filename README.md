<p align="center">
  <h1 align="center">MindHeal</h1>
  <p align="center"><strong>AI-powered auto-healing for Playwright tests</strong></p>
  <p align="center">
    <a href="https://www.npmjs.com/package/mindheal"><img src="https://img.shields.io/npm/v/mindheal.svg?style=flat-square" alt="npm version" /></a>
    <a href="https://github.com/nicholasgriffintn/mindheal/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/mindheal.svg?style=flat-square" alt="license" /></a>
    <img src="https://img.shields.io/badge/TypeScript-strict-blue?style=flat-square&logo=typescript" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Playwright-%3E%3D1.40-45ba4b?style=flat-square&logo=playwright" alt="Playwright" />
  </p>
</p>

---

**MindHeal** is a drop-in npm package that auto-heals broken Playwright locators at runtime. When a test step fails because an element moved, got renamed, or changed structure, MindHeal intercepts the failure, finds the correct replacement using a pipeline of 9 healing strategies (including AI), and retries the action transparently. Your tests keep running instead of breaking.

It works with **any design pattern** -- Page Object Model, BDD Cucumber, Screenplay, or plain test files. Zero changes to your existing test code required.

## Table of Contents

- [Why MindHeal?](#why-mindheal)
- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Works With Any Design Pattern](#works-with-any-design-pattern)
- [Real-World Use Cases](#real-world-use-cases)
- [All Supported Locator Types](#all-supported-locator-types)
- [Healing Strategies](#healing-strategies)
- [Browser Dialog Auto-Handling](#browser-dialog-auto-handling)
- [Shadow DOM & iFrame Support](#shadow-dom--iframe-support)
- [RAG-Enhanced AI Healing](#rag-enhanced-ai-healing)
- [Enterprise Applications (SAP, Salesforce, etc.)](#enterprise-applications-sap-salesforce-etc)
- [Healing Analytics & Metrics](#healing-analytics--metrics)
- [Smart Retry Intelligence](#smart-retry-intelligence)
- [Parallel Execution Safety](#parallel-execution-safety)
- [Visual Verification](#visual-verification)
- [Configuration Reference](#configuration-reference)
- [AI Providers](#ai-providers)
- [CI/CD Setup](#cicd-setup)
- [Local Review Dashboard](#local-review-dashboard)
- [API Reference](#api-reference)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Contributing](#contributing)
- [Reporting Bugs](#reporting-bugs)
- [Feature Requests](#feature-requests)
- [Security](#security)
- [License](#license)

---

## Why MindHeal?

| Problem | Without MindHeal | With MindHeal |
|---------|-----------------|---------------|
| UI redesign changes 50 locators | 50 test failures. Manual fix takes 2-3 days. | Tests self-heal on first run. PR auto-created with fixes. |
| Button renamed from "Log In" to "Sign In" | Test fails, blocks CI pipeline. | Role strategy finds the renamed button, test continues. |
| Table column header renamed | Data extraction tests break silently. | Table strategy correlates by column index and header similarity. |
| Modal popup structure changed | Element-not-found error inside dialog. | Modal strategy scopes healing to the open dialog. |
| Third-party iframe updates | Cross-frame locators fail. | Frame proxy intercepts and heals inside iframes. |
| Shadow DOM component restructured | Standard selectors can't pierce shadow roots. | MindHeal traverses shadow DOM recursively to find elements. |
| Browser alert blocks test execution | Test hangs on unhandled dialog. | Dialog handler auto-dismisses alerts and accepts confirms. |
| SAP/Salesforce dynamic IDs change every render | `__xmlview0--loginBtn` breaks on next deploy. | Enterprise strategy strips dynamic prefixes, matches by stable ID suffix. |
| Salesforce LWC deep Shadow DOM | Standard selectors can't reach elements inside `lightning-*` components. | Enterprise candidate extractor recursively pierces shadow roots. |

---

## Quick Start

### Step 1: Install

```bash
npm install mindheal dotenv
```

### Step 2: Run the Init Command

```bash
npx mindheal init
```

An interactive prompt appears — use **arrow keys** to select your AI provider and press **Enter**:

```
  MindHeal — Auto-Healing Setup
  ─────────────────────────────────────

  Select your AI Provider: (use arrow keys, press Enter to select)

   > Anthropic (Claude)            — recommended
     OpenAI                        — widely used, fast
     Azure OpenAI                  — enterprise Azure
     Google Gemini                 — Google ecosystem
     Ollama (Local)                — free, air-gapped, no API key
     AWS Bedrock                   — enterprise AWS, SigV4 auth
     DeepSeek                      — cost-effective, strong coding
     Groq                          — extremely fast inference
     Qwen (Alibaba Cloud)          — DashScope
     Meta (Llama via Together.ai)  — open-source models
     Perplexity                    — search-augmented AI

  Selected: anthropic

  ─────────────────────────────────────

  Test directory: tests

  created tests/base.ts

  Found 12 test file(s)

  updated tests/login.spec.ts
  updated tests/dashboard.spec.ts
  updated tests/checkout.spec.ts
  ...

  created .env.example (anthropic)
  updated playwright.config.ts (anthropic + git)

  ─────────────────────────────────────
  Done! 12 file(s) updated, 0 skipped

  Next steps:
    1. Copy .env.example to .env and add your ANTHROPIC_API_KEY key
    2. Run npx playwright test
```

Based on your selection, the init command automatically:

| What It Does | Details |
|-------------|---------|
| Asks you to pick an AI provider | Interactive selector with all 11 providers |
| Creates `tests/base.ts` | A 2-line file that re-exports `test` and `expect` from mindheal |
| Updates all spec file imports | Changes `from '@playwright/test'` to `from './base'` in every `.spec.ts` / `.test.ts` file |
| Creates `.env.example` | Pre-filled with the selected provider's env vars |
| Updates `playwright.config.ts` | Adds `mindHealConfig()` with the selected provider + git config for CI auto-PR |

> **Safe to run multiple times** — skips files already configured. Page objects are never touched.

### Step 3: Add Your API Key

```bash
cp .env.example .env
```

Open `.env` and add your actual key (the init command pre-fills the correct env var for your selected provider):

```env
# If you selected Anthropic:
ANTHROPIC_API_KEY=sk-ant-your-actual-key-here

# If you selected Ollama — no key needed, just start the server:
# ollama pull llama3 && ollama serve
```

> **No API key?** That's fine. Strategies 1-8 (Cache, Attribute, Text, Role, CSS, XPath, Table, Modal) work without any key. Only strategy 9 (AI) needs one. Or select [Ollama](#ollama-locally-hosted-llms) during init for free local AI.

### Step 4: Run Your Tests

```bash
npx playwright test
```

**Done. 4 steps. Your tests now self-heal.**

### What Happens After Setup

| Scenario | What MindHeal Does |
|----------|-------------------|
| All locators work | Nothing. Tests pass normally. Zero overhead. |
| A locator breaks | Catches the failure, finds a replacement, retries. Test continues. |
| Healing can't find a match | Original error thrown. Test fails the same way as without MindHeal. |
| Running locally | Review dashboard opens at `localhost:3000` to approve/reject/edit healed locators |
| Running in CI | Auto-creates a PR with healed locators (git config is included by default) |
| Want to disable MindHeal | Change one line in `tests/base.ts` — switch import to `'@playwright/test'` |
| Want to uninstall | `npm uninstall mindheal` and revert `tests/base.ts` |

### How `base.ts` Works

All test files import from `tests/base.ts` instead of `@playwright/test`:

```ts
// tests/base.ts — this is the single control switch
import { test, expect } from 'mindheal';   // MindHeal ON
export { test, expect };
```

To disable healing, change one line:

```ts
import { test, expect } from '@playwright/test';  // MindHeal OFF
export { test, expect };
```

One file controls healing for your entire test suite. Page objects are never modified — they keep importing types from `@playwright/test` as usual.

### Manual Setup (Alternative)

If you prefer not to use `npx mindheal init`:

<details>
<summary>Click to expand manual setup steps</summary>

**1. Create `tests/base.ts`:**

```ts
import { test, expect } from 'mindheal';
export { test, expect };
```

**2. Create `.env`:**

```env
ANTHROPIC_API_KEY=sk-ant-...
```

**3. Update `playwright.config.ts`:**

```ts
import { defineConfig } from '@playwright/test';
import { mindHealConfig } from 'mindheal';
import 'dotenv/config';

const healConfig = mindHealConfig({
  ai: {
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: 'claude-sonnet-4-20250514',
  },

  // Git — auto-create PR with healed locators in CI/CD
  git: {
    enabled: true,
    provider: 'github',
    token: process.env.GIT_TOKEN || '',
    baseBranch: 'main',
    autoCreatePR: true,
    commitMessagePrefix: 'fix(locators):',
    prLabels: ['auto-heal', 'mindheal'],
  },
});

export default defineConfig({
  ...healConfig,
  testDir: './tests',
  use: {
    baseURL: 'http://localhost:3000',
  },
});
```

**4. Update test file imports:**

```ts
// Change this in every spec file:
import { test, expect } from '@playwright/test';
// To this:
import { test, expect } from './base';
```

Bulk-replace all at once:

```bash
find tests -name "*.spec.ts" -exec sed -i "s|from '@playwright/test'|from './base'|g" {} +
```

**5. Run tests:**

```bash
npx playwright test
```

</details>

---

## How It Works

MindHeal is a **fallback-only mechanism**. It does NOT interfere with passing tests. It only activates when a locator action fails.

```
page.locator('.submit-btn').click()
         |
         v
  Try original locator
  '.submit-btn'
         |
    +----+----+
    |         |
  PASS      FAIL (element not found / timeout)
    |         |
  Return      v
  normally   Healing Pipeline
  (zero       1. Cache     -- cached from previous heal?
  overhead)   2. Attribute -- similar id/name/data-testid?
              3. Text      -- similar visible text?
              4. Role      -- same ARIA role?
              5. CSS       -- similar CSS selector?
              6. XPath     -- similar XPath?
              7. Table     -- same table row/column?
              8. Modal     -- inside a dialog/popup?
              9. Enterprise-- SAP/Salesforce/ERP dynamic IDs?
             10. AI + RAG  -- ask LLM with project context
                    |
                    v
              First result >= confidence threshold
                    |
               +----+----+
               |         |
             FOUND     NOT FOUND
               |         |
             Retry     Throw original
             action    error (test fails
             with      normally)
             healed
             locator
```

### Step-by-Step Flow

1. **Intercept** -- MindHeal wraps every `page.locator()`, `page.getByRole()`, `page.getByText()`, and all 8 Playwright locator methods via an ES Proxy. No monkey-patching.
2. **Try Original** -- The original Playwright action runs first. If it passes, MindHeal does nothing.
3. **Catch Failure** -- Only locator-specific errors trigger healing (`TimeoutError`, `strict mode violation`, `element not found`). Other errors (network, assertion, etc.) are thrown as-is.
4. **Snapshot DOM** -- A DOM snapshot is captured, including Shadow DOM trees and iframe content.
5. **Run Strategies** -- Strategies execute in order. The first result meeting the confidence threshold wins.
6. **RAG Context** -- When the AI strategy runs, it first retrieves relevant context from the knowledge store (past heals, page objects, git diffs, etc.) and includes it in the AI prompt.
7. **Retry Action** -- The original action is retried with the healed locator.
8. **Cache, Learn & Report** -- Successful heals are cached for instant reuse. The healing result is ingested into the RAG knowledge store for future runs. Every event is logged with strategy, confidence, timing, and source location.
8. **Post-Run** -- In CI: healed locators are committed and a PR is created. Locally: a review dashboard opens for manual approval.

---

## Works With Any Design Pattern

MindHeal operates at the Playwright `page` object level. Since every design pattern ultimately calls `page.locator()` / `page.getByRole()` etc., healing works transparently everywhere. The proxy travels with the object reference, not with the test structure.

### Page Object Model (POM)

```ts
// pages/login.page.ts
import { type Page, type Locator } from '@playwright/test';

export class LoginPage {
  private readonly page: Page;
  private readonly emailInput: Locator;
  private readonly passwordInput: Locator;
  private readonly submitButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByLabel('Email');                        // Intercepted
    this.passwordInput = page.getByPlaceholder('Password');            // Intercepted
    this.submitButton = page.getByRole('button', { name: 'Log In' }); // Intercepted
  }

  async goto() {
    await this.page.goto('/login');
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);       // Heals if "Email" label changed
    await this.passwordInput.fill(password); // Heals if placeholder changed
    await this.submitButton.click();         // Heals if button name changed
  }
}

// tests/login.spec.ts
import { test, expect } from './base';  // <-- imports from base.ts, NOT @playwright/test
import { LoginPage } from '../pages/login.page';

test('user can login', async ({ page }) => {
  const loginPage = new LoginPage(page);  // Proxied page flows into POM
  await loginPage.goto();
  await loginPage.login('user@test.com', 'secret123');
});
```

### BDD Cucumber

```ts
// support/world.ts
import { type Page, chromium } from '@playwright/test';
import { createMindHealFixture, loadConfig, Healer, SelfHealCache } from 'mindheal';
import { LoginPage } from '../pages/login.page';

export class CustomWorld {
  page!: Page;
  loginPage!: LoginPage;

  async init() {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    this.page = await context.newPage();

    // Proxied page flows into Cucumber steps and page objects
    this.loginPage = new LoginPage(this.page);
  }
}

// step-definitions/login.steps.ts
import { Given, When, Then } from '@cucumber/cucumber';
import { CustomWorld } from '../support/world';

Given('I am on the login page', async function (this: CustomWorld) {
  await this.loginPage.goto();
});

When('I login with {string} and {string}', async function (
  this: CustomWorld, email: string, password: string
) {
  await this.loginPage.login(email, password);
  // If any locator inside LoginPage breaks, MindHeal heals it
});
```

### Plain Tests (No Pattern)

```ts
import { test, expect } from './base';

test('checkout flow', async ({ page }) => {
  await page.goto('/products');
  await page.getByText('Add to Cart').click();
  await page.getByRole('button', { name: 'Checkout' }).click();
  await page.getByLabel('Card number').fill('4111111111111111');
  await page.getByTestId('place-order').click();
  // Every locator above is auto-healed if it breaks
});
```

---

## Real-World Use Cases

### Use Case 1: E-Commerce -- UI Redesign Breaks 80+ Tests

**Scenario:** Frontend team ships a checkout redesign. Button classes change, form field IDs rename, the payment modal restructures, order summary table gets new columns.

```ts
// playwright.config.ts — minimum config, just set the AI provider
const healConfig = mindHealConfig({
  ai: {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
  },
});

export default defineConfig({ ...healConfig });
```

```ts
// tests/checkout.spec.ts -- NO CHANGES NEEDED (npx mindheal init already updated imports)
import { test, expect } from './base';

test('complete checkout', async ({ page }) => {
  await page.goto('/products/laptop');

  // Button class changed .add-cart -> .btn-add-to-cart
  // Attribute strategy heals it (confidence: 0.88)
  await page.locator('.add-cart').click();

  // Modal restructured with new aria roles
  // Modal strategy finds close button inside dialog context
  await page.locator('.cart-modal .proceed-btn').click();

  // Form field ID renamed #cc-number -> #card-number
  // Attribute strategy matches by name="cardNumber" (confidence: 0.91)
  await page.locator('#cc-number').fill('4111111111111111');

  // "Confirm purchase?" browser confirm() dialog
  // Dialog handler auto-accepts it
  await page.locator('#place-order').click();

  // Table column "Price" renamed to "Unit Price"
  // Table strategy matches by column index + header similarity
  const total = page.locator('table.order-summary >> td.price-col');
  await expect(total).toContainText('$1,299.00');
});
```

**Result:** 80 tests self-heal on the first run. Locally, the review dashboard opens so you approve/reject each heal. In CI (with optional `git` config), a PR is auto-created.

### Use Case 2: Banking Portal -- Shadow DOM + iFrames + Security

**Scenario:** Banking app uses Web Components (Shadow DOM), embeds a third-party payment iframe, and shows regulatory compliance popups. Ollama required because test data cannot leave the network.

```ts
// playwright.config.ts — Ollama for air-gapped environments, customized dialog handling
const healConfig = mindHealConfig({
  ai: {
    provider: 'ollama',
    apiKey: '',
    ollamaHost: 'http://localhost:11434',
    model: 'llama3.1:8b',
  },
  // Optional: customize dialog handling
  healing: {
    domSnapshotDepth: 6,
    handleDialogs: {
      dismissAlerts: true,
      acceptConfirms: false,
      logDialogs: true,
    },
  },
});

export default defineConfig({ ...healConfig });
```

```ts
import { test, expect } from './base';

test('transfer funds', async ({ page }) => {
  await page.goto('/dashboard');

  // Shadow DOM: <bank-account-card> web component changed internally
  // MindHeal pierces shadow roots, Text strategy finds "Savings Account"
  await page.locator('bank-account-card >> text=Savings Account').click();

  // Nested iframe: payment processor
  // Frame proxy wraps child locators for healing
  const paymentFrame = page.frameLocator('#payment-iframe');
  await paymentFrame.locator('#amt').fill('5000.00');

  // Regulatory alert popup -> auto-dismissed by dialog handler

  // Confirmation modal with Shadow DOM internals
  // Modal strategy + shadow DOM piercing
  await page.locator('.confirm-transfer-modal bank-button.primary').click();

  // Transaction table: column "Reference" renamed to "Ref #"
  // Table strategy matches by column index
  const refCell = page.locator('table.transactions >> td.reference-col >> nth=0');
  await expect(refCell).not.toBeEmpty();
});
```

**Result:** Tests run in a secure, air-gapped environment. Full audit trail generated. Shadow DOM, iframes, modals, and dialogs handled transparently.

---

## All Supported Locator Types

MindHeal intercepts **all 8 Playwright locator methods**, not just `page.locator()`:

| Locator Method | Example | Healed? |
|----------------|---------|---------|
| `page.locator()` | `page.locator('#submit-btn')` | Yes |
| `page.getByRole()` | `page.getByRole('button', { name: 'Submit' })` | Yes |
| `page.getByText()` | `page.getByText('Sign In')` | Yes |
| `page.getByTestId()` | `page.getByTestId('login-form')` | Yes |
| `page.getByLabel()` | `page.getByLabel('Email address')` | Yes |
| `page.getByPlaceholder()` | `page.getByPlaceholder('Enter your email')` | Yes |
| `page.getByAltText()` | `page.getByAltText('Company logo')` | Yes |
| `page.getByTitle()` | `page.getByTitle('Close dialog')` | Yes |
| Chained locators | `page.locator('.form').locator('input')` | Yes |
| Frame locators | `page.frameLocator('#iframe').locator('.btn')` | Yes |

All methods are intercepted across **three contexts**: Page, Frame, and FrameLocator.

---

## Healing Strategies

Strategies execute in the configured order. The first result meeting the confidence threshold (default: 0.7) wins.

| # | Strategy | How It Works | Best For |
|---|----------|-------------|----------|
| 1 | **Cache** | Looks up previously healed locators from the disk-backed cache using a hash of the original locator and page URL. | Repeated failures across runs. Near-instant resolution. |
| 2 | **Attribute** | Compares element attributes (`id`, `name`, `data-testid`, `aria-label`, `class`) using Levenshtein similarity against all visible candidates on the page. | Minor attribute renames, ID changes, class refactors. |
| 3 | **Text** | Matches elements by visible text content, placeholder text, and `aria-label` using string similarity scoring. | Label or button text changes, content rewording. |
| 4 | **Role** | Matches elements by ARIA role and accessible name. Combines role equality with name similarity. | Component restructuring where role semantics are preserved. |
| 5 | **CSS** | Generates CSS selectors for all candidates and compares them to the original using edit distance plus structural bonuses (tag match, class overlap). | Selector refactors, CSS class renames, structural moves. |
| 6 | **XPath** | Builds XPath expressions from element context (id, text, class) and scores against the original selector. | Legacy selectors, complex nested structures. |
| 7 | **Table** | Detects elements inside `<table>` structures. Correlates candidates by row/column index, column header text, and `tableCellSelector`. Scores by text similarity and positional matching. | Data grids, table cell locators, column-based lookups. |
| 8 | **Modal** | Identifies elements inside modal dialogs (`role="dialog"`, `aria-modal="true"`, `<dialog>`, `.modal`). Prioritizes modal candidates when the original selector suggests a modal context. Falls back to all candidates when no modal is open. | Popups, confirmation dialogs, toast notifications, overlay panels. |
| 9 | **Enterprise** | Handles dynamic IDs (SAP `__xmlview`, Salesforce `globalId_`, Workday `wd-*`), custom web components (`lightning-*`, `ui5-*`, `now-*`), enterprise stable attributes (`data-automation-id`, `data-sap-ui`, `data-field-name`), Shadow DOM piercing, and virtual scrolling in enterprise grids. Auto-detects platform. | SAP Fiori, Salesforce Lightning, Oracle ERP, Workday, ServiceNow, Dynamics 365, and similar enterprise apps. |
| 10 | **AI + RAG** | Sends the original locator, DOM snapshot, page URL, error message, and **RAG context** (past heals, page objects, git diffs, component docs) to an LLM. The model returns a replacement Playwright expression with confidence and reasoning. RAG context makes the AI smarter over time. | Novel failures, major redesigns, ambiguous elements where deterministic strategies lack context. |

### Customizing the Pipeline

Remove strategies you don't need or reorder them:

```ts
mindHealConfig({
  healing: {
    strategies: ['cache', 'attribute', 'text', 'role'],  // Skip CSS, XPath, Table, Modal, AI
  },
});
```

---

## Browser Dialog Auto-Handling

MindHeal automatically handles native browser dialogs (`alert`, `confirm`, `prompt`, `beforeunload`) so they don't block your tests. This is enabled by default.

```ts
// Disable dialog handling entirely
mindHealConfig({
  healing: {
    handleDialogs: false,
  },
});

// Fine-tune per dialog type
mindHealConfig({
  healing: {
    handleDialogs: {
      dismissAlerts: true,      // Dismiss alert() dialogs
      acceptConfirms: true,     // Accept confirm() dialogs
      promptResponse: '',       // Response text for prompt() dialogs
      logDialogs: true,         // Log dialog events to the healing session
    },
  },
});
```

Dialog events are recorded in healing reports so you can see exactly which dialogs appeared during test execution, including the dialog type, message text, and how it was handled.

---

## Shadow DOM & iFrame Support

### Shadow DOM

MindHeal recursively traverses Shadow DOM trees when scanning for candidate elements. If your app uses Web Components with shadow roots, MindHeal automatically pierces them:

- Recursively walks `el.shadowRoot` for all elements on the page
- Collects candidates from all shadow roots (nested included)
- DOM snapshots include `#shadow-root` markers for AI context
- Works with both open shadow roots and slotted content

### iFrames & Nested Frames

MindHeal wraps frame access methods so healing works inside iframes:

| Method | Wrapped? |
|--------|----------|
| `page.frame()` | Yes |
| `page.frameLocator()` | Yes |
| `page.frames()` | Yes |
| `page.mainFrame()` | Yes |
| Nested `frameLocator().frameLocator()` | Yes |

```ts
// Healing works inside iframes
const frame = page.frameLocator('#payment-iframe');
await frame.getByLabel('Card number').fill('4111...'); // Healed if label changes

// Nested frames too
const nested = page.frameLocator('#outer').frameLocator('#inner');
await nested.getByRole('button', { name: 'Pay' }).click(); // Healed
```

---

## RAG-Enhanced AI Healing

**RAG (Retrieval-Augmented Generation)** makes MindHeal's AI strategy smarter over time. Instead of relying only on the current DOM snapshot, the AI receives project-specific context from six knowledge sources:

### How It Works

```
Locator breaks
    │
    ▼
┌─────────────────────────┐
│  1. Try non-AI strategies│  (cache → attribute → text → role → css → xpath → table → modal)
│     first                │
└──────────┬──────────────┘
           │ all failed
           ▼
┌─────────────────────────┐     ┌──────────────────────────────┐
│  2. RAG Context Retriever│────▶│  Knowledge Store (.json file) │
│     searches for relevant│     │                              │
│     project context      │     │  • healing-history           │
│                          │◀────│  • page-objects              │
│  returns top N chunks    │     │  • git-changes               │
│  (TF-IDF similarity)    │     │  • dom-snapshots             │
└──────────┬──────────────┘     │  • component-docs            │
           │                     │  • test-specs                │
           ▼                     └──────────────────────────────┘
┌─────────────────────────┐
│  3. AI prompt enriched   │
│     with RAG context     │
│     → better healing     │
└──────────┬──────────────┘
           │
           ▼
     Healed locator
```

### Six Knowledge Sources

| Source | What It Stores | How It Helps |
|--------|---------------|-------------|
| `healing-history` | Previously healed locators, strategies, confidence scores | AI sees "last time `#submit-btn` broke, `getByRole('button', { name: 'Submit' })` worked" |
| `page-objects` | POM class metadata — selectors, method names, file paths | AI knows which selectors belong to your `LoginPage`, `CheckoutPage`, etc. |
| `git-changes` | Recent git diffs affecting locator-related files | AI sees "button ID was renamed from `submit-btn` to `submit-button` in last commit" |
| `dom-snapshots` | Historical DOM snapshots of pages | AI compares current vs previous DOM to identify what changed |
| `component-docs` | Design system / component library documentation | AI understands your component API (e.g., "Button accepts `variant` and `size` props") |
| `test-specs` | Test file context — describe blocks, step descriptions | AI understands the test's intent (e.g., "login flow → fill credentials → click submit") |

### Zero Setup Required

RAG is **enabled by default** and works automatically:

1. **Run 1** — MindHeal heals locators using DOM + AI. Results are stored in the knowledge store.
2. **Run 2+** — Before calling the AI, MindHeal searches the knowledge store for relevant context. The AI receives:
   - *"Previously, `#submit-btn` was healed to `getByRole('button', { name: 'Submit' })` with 95% confidence"*
   - *"Git diff shows button ID was renamed in `src/components/Button.tsx`"*
3. **Result** — AI makes faster, more accurate decisions. Confidence scores increase over time.

### Configuration

RAG config is part of your `playwright.config.ts`:

```ts
export default defineConfig({
  ...mindHealConfig({
    ai: { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY! },
    rag: {
      enabled: true,                    // default: true
      storePath: '.mindheal/knowledge.json', // default
      maxContextChunks: 5,              // max chunks sent to AI
      similarityThreshold: 0.3,         // minimum relevance score (0-1)
      sources: [                        // which sources to enable
        'healing-history',
        'page-objects',
        'git-changes',
        'dom-snapshots',
        'component-docs',
        'test-specs',
      ],
      pageObjectPaths: ['pages', 'src/pages'], // where to scan for POMs
      componentDocPaths: ['docs/components'],   // where to scan for docs
    },
  }),
});
```

### Disable RAG

If you want to disable RAG completely:

```ts
rag: { enabled: false }
```

Or disable specific sources:

```ts
rag: {
  enabled: true,
  sources: ['healing-history', 'page-objects'], // only these two
}
```

### Knowledge Store File

The knowledge store is a single JSON file (default: `.mindheal/knowledge.json`). Add it to `.gitignore` if you don't want to share across team members, or commit it to share healing knowledge across CI runners.

- **Max entries**: 2,000 (oldest evicted when full)
- **Expiry**: 90 days (stale entries auto-pruned on load)
- **No vector DB**: Uses lightweight TF-IDF similarity — works offline, no external dependencies

---

## Enterprise Applications (SAP, Salesforce, etc.)

MindHeal includes a dedicated **enterprise strategy** designed for the unique challenges of complex enterprise web applications. It runs automatically — no configuration needed.

### Supported Platforms

| Platform | Key Challenges Handled |
|----------|----------------------|
| **SAP Fiori / UI5** | Dynamic `__xmlview0--`, `__component0---` ID prefixes. Custom `ui5-*`, `sap-*` elements. SAP busy indicators. ALV grid virtual scrolling. |
| **Salesforce Lightning / LWC** | `globalId_*`, `auraId_*` generated IDs. Deep `lightning-*` Shadow DOM nesting. `force-*` custom elements. SLDS spinner handling. |
| **Oracle ERP / NetSuite** | `pt1_23_*` PeopleSoft prefixes. `_fox*` ADF Faces IDs. Oracle Forms numeric IDs. |
| **Workday** | `wd-*` widget prefixes. `data-automation-id` attributes. Loading panels. |
| **ServiceNow** | `sys_*` SysIDs. `now-*`, `sn-*` custom elements. `data-table-name`, `data-field-name` attributes. |
| **Microsoft Dynamics 365** | `MscrmControls.*` prefixes. GUID-based IDs. Fluent UI components. |

### How It Works

The enterprise strategy addresses six core problems:

#### 1. Dynamic ID Stripping

Enterprise platforms generate IDs that change on every render:

```
SAP:         __xmlview0--loginButton     → loginButton (stable part)
Salesforce:  globalId_12345              → stripped, use stable attributes instead
Workday:     wd-AbCdEfGh12-dateField    → dateField (stable part)
Oracle:      pt1_23_panelHeader          → panelHeader (stable part)
```

MindHeal recognizes **30+ dynamic ID patterns** across all platforms and automatically falls back to the stable portion using `[id$="stablePart"]` suffix matching.

#### 2. Enterprise Stable Attributes

Instead of unreliable IDs, MindHeal prioritizes **platform-specific stable attributes**:

```
SAP:          data-sap-ui, data-sap-ui-id, data-sap-ui-column
Salesforce:   data-aura-rendered-by, data-component-id, data-field, data-target-selection-name
Workday:      data-automation-id, data-uxi-element-id, data-uxi-widget-type
ServiceNow:   data-table-name, data-field-name, data-element
Dynamics:     data-id, data-lp-id, data-control-name
Generic:      data-testid, data-cy, data-qa, data-automation, data-hook
```

#### 3. Custom Web Component Handling

Enterprise platforms use proprietary custom elements:

```html
<!-- Salesforce Lightning -->
<lightning-button label="Save" variant="brand"></lightning-button>

<!-- SAP UI5 -->
<ui5-button design="Emphasized">Submit</ui5-button>

<!-- ServiceNow -->
<now-button label="Create Incident"></now-button>
```

MindHeal recognizes these custom elements and builds locators using their tag + stable attributes rather than brittle CSS paths.

#### 4. Shadow DOM Piercing

Salesforce Lightning Web Components (LWC) heavily use Shadow DOM. MindHeal's enterprise candidate extractor recursively traverses shadow roots to find elements:

```ts
// Even deeply nested LWC components are found
page.locator('lightning-input[data-field="Email"]')  // Pierces shadow boundary
```

#### 5. Loading State Awareness

Enterprise apps have extended loading times. MindHeal auto-detects and waits for platform-specific loading indicators:

```
SAP:          .sapUiLocalBusyIndicator, .sapMBusyDialog
Salesforce:   .slds-spinner_container, lightning-spinner
Workday:      .wd-LoadingPanel, [data-automation-id="loadingSpinner"]
ServiceNow:   .loading-placeholder, .sn-loading
Generic:      [aria-busy="true"], .skeleton, .shimmer
```

#### 6. Virtual Scroll Support

Enterprise data grids (SAP ALV, Salesforce report tables) virtualize rows. MindHeal can scroll virtual containers to bring elements into view before healing:

```
SAP:          .sapUiTableCCnt, .sapMListItems
Salesforce:   .slds-scrollable_y
Generic:      [role="grid"], .ag-body-viewport
```

### Configuration

Enterprise healing is **enabled by default** with auto-detection. For explicit control:

```ts
export default defineConfig({
  ...mindHealConfig({
    ai: { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY! },
    enterprise: {
      enabled: true,              // default: true
      platform: 'auto',           // auto-detect, or: 'salesforce' | 'sap' | 'oracle' | 'workday' | 'servicenow' | 'dynamics'
      waitForLoad: true,          // wait for loading indicators before healing
      loadTimeout: 15000,         // max wait for loaders (ms)
      virtualScrolling: true,     // scroll virtual containers to reveal elements
      customStableAttributes: [   // add your own stable attributes
        'data-custom-id',
        'data-page-object',
      ],
      customDynamicIdPatterns: [   // add your own dynamic ID patterns (regex)
        '^myapp-gen-\\d+',
      ],
    },
  }),
});
```

### SAP Fiori Example

```ts
// Before — breaks when view index changes
page.locator('#__xmlview0--loginButton').click();

// After MindHeal heals it — stable across renders
page.locator('[id$="loginButton"]').click();
// or
page.getByRole('button', { name: 'Login' });
```

### Salesforce Lightning Example

```ts
// Before — breaks when aura re-renders
page.locator('[data-aura-rendered-by="234:0"]').click();

// After MindHeal heals it — stable attribute
page.locator('lightning-button[data-target-selection-name="Save"]').click();
// or
page.getByRole('button', { name: 'Save' });
```

### Workday Example

```ts
// Before — breaks when widget IDs regenerate
page.locator('#wd-AbCdEfGh12-dateField').fill('2024-01-15');

// After MindHeal heals it — stable automation ID
page.locator('[data-automation-id="effectiveDate"]').fill('2024-01-15');
```

---

## Healing Analytics & Metrics

MindHeal tracks healing activity over time so you can measure ROI, identify fragile locators, and prioritize test maintenance.

### What's Tracked

| Metric | Description |
|--------|-------------|
| **Strategy Effectiveness** | Success rate, avg confidence, avg duration per strategy |
| **Most-Healed Locators** | Which locators break most often, which strategies fix them |
| **Test Stability Scores** | 0-100 score per test — tracks healing frequency and trends |
| **Degrading Tests** | Tests whose stability is getting worse over time |
| **Overall Stats** | Total heals, success rate, avg confidence, unique locators/tests |

### Querying Analytics

```ts
import { HealingAnalytics } from 'mindheal';

const analytics = new HealingAnalytics(config.analytics);
analytics.load();

// Overall summary
const stats = analytics.getOverallStats();
// → { totalHeals: 142, successRate: 0.91, avgConfidence: 0.84, ... }

// Strategy effectiveness ranking
const strategies = analytics.getStrategyStats();
// → [{ name: 'cache', successRate: 1.0 }, { name: 'role', successRate: 0.88 }, ...]

// Top 10 most-healed locators (fragile spots)
const fragile = analytics.getMostHealedLocators(10);
// → [{ expression: "page.locator('#submit')", healCount: 23, ... }]

// Tests that need attention
const unstable = analytics.getUnstableTests(10);
// → [{ testFile: 'checkout.spec.ts', stabilityScore: 42, trend: 'degrading' }]
```

### Configuration

```ts
analytics: {
  enabled: true,                       // default
  storePath: '.mindheal/analytics.json',
  trackLocators: true,
  trackStrategies: true,
  trackTestStability: true,
  maxEntries: 5000,
  retentionDays: 90,
}
```

---

## Smart Retry Intelligence

MindHeal includes intelligent retry logic that reduces false positive heals and distinguishes between genuinely broken locators and intermittent (flaky) failures.

### Features

| Feature | What It Does |
|---------|-------------|
| **Network Idle Wait** | Waits for all pending network requests to settle before healing. Prevents healing on pages that are still loading data. |
| **DOM Stability Wait** | Waits for DOM mutations to stop (500ms quiet period). Prevents healing during SPA rendering. |
| **Exponential Backoff** | Progressive delays between retry attempts with jitter to prevent thundering herd in parallel execution. |
| **Flaky Test Detection** | Tracks pass/fail patterns per locator. Locators with intermittent failures are flagged as "flaky" vs "broken". |
| **Skip Healing for Flaky** | Known flaky locators can skip the full healing pipeline — a simple retry may suffice. |

### How Flaky Detection Works

```
Locator fails → Record in flaky store → Analyze history

Pass/Fail pattern:  ✓ ✗ ✓ ✗ ✓  →  FLAKY (intermittent — retry may work)
Fail pattern:       ✗ ✗ ✗ ✗ ✗  →  BROKEN (consistent — needs healing)
Pass pattern:       ✓ ✓ ✓ ✓ ✓  →  STABLE (no issues)
```

### Configuration

```ts
smartRetry: {
  enabled: true,                  // default
  waitForNetworkIdle: true,       // wait for network before healing
  networkIdleTimeout: 5000,       // max wait for network idle (ms)
  exponentialBackoff: true,       // progressive retry delays
  backoffBaseDelay: 500,          // base delay (ms)
  backoffMaxDelay: 10000,         // max delay (ms)
  flakyDetection: true,           // track flaky vs broken
  flakyThreshold: 3,              // consecutive failures = broken
  flakyStorePath: '.mindheal/flaky-tests.json',
}
```

---

## Parallel Execution Safety

When running Playwright with `--workers=4` or `--shard`, multiple processes read/write shared files (cache, knowledge store, analytics). MindHeal uses advisory file locking to prevent corruption.

### How It Works

```
Worker 1: acquire lock → write cache.json → release lock
Worker 2: wait for lock → acquire lock → write cache.json → release lock
Worker 3: wait for lock → acquire lock → ...
```

- **Lock files**: Creates `.lock` files alongside shared resources
- **PID tracking**: Each lock records the process ID and timestamp
- **Stale detection**: Locks from dead processes are auto-reclaimed (30s threshold)
- **Timeout**: If a lock can't be acquired within 10s, proceeds without it (fail-safe)
- **Jitter**: Lock retry intervals prevent thundering herd

### Protected Resources

| File | Protected By |
|------|-------------|
| `.mindheal/cache.json` | File lock during save |
| `.mindheal/knowledge.json` | File lock during save |
| `.mindheal/analytics.json` | File lock during save |
| `.mindheal/flaky-tests.json` | File lock during save |

### Configuration

```ts
parallel: {
  enabled: true,            // default — auto-detected
  lockTimeout: 10000,       // max wait to acquire lock (ms)
  lockRetryInterval: 50,    // retry interval (ms)
  staleLockThreshold: 30000, // auto-reclaim stale locks after (ms)
}
```

---

## Visual Verification

After healing a locator, MindHeal can verify the healed element is visually correct — not just any matching element, but the **right** one. This prevents "wrong element" heals where the selector matches something in a different part of the page.

### How It Works

When a locator breaks and MindHeal finds a candidate fix, Visual Verification runs **before** accepting the heal:

```
Test runs → Locator breaks → MindHeal finds a candidate fix
                                        ↓
                              ┌─────────────────────────────┐
                              │    VISUAL VERIFICATION       │
                              │                             │
                              │  ✅ 1. Element exists?       │
                              │  ✅ 2. Element visible?      │
                              │  ✅ 3. Has size (not 0×0)?   │
                              │  ✅ 4. Inside viewport?      │
                              │  📸 5. Capture screenshot    │
                              └──────────┬──────────────────┘
                                         ↓
                              All pass? → Accept the heal
                              Any fail? → Reject, try next strategy
```

### What's Checked

| Check | What It Catches |
|-------|-----------------|
| **Element Exists** | Selector resolved to nothing (0 matches) |
| **Element Visible** | Hidden elements (`display:none`, `visibility:hidden`, `opacity:0`) |
| **Bounding Box** | Zero-size elements (0×0 pixels — collapsed or off-DOM) |
| **Viewport Position** | Element rendered way off-screen (`x: 9999`, `y: 9999`) |
| **Screenshot Capture** | Optional element + full page screenshots saved for review |

### Real-World Example

Your test has:

```ts
await page.locator('#btn-submit').click();
```

A developer renames the button to `#submit-form-btn`. MindHeal finds two candidates:

| Candidate | Visible? | Size | Location | Verified? |
|-----------|----------|------|----------|-----------|
| `#submit-form-btn` | ✅ Yes | 120×40 | In viewport | ✅ **Accepted** |
| `#hidden-submit` | ❌ No | 0×0 | Hidden | ❌ Rejected |

Without Visual Verification, MindHeal might pick `#hidden-submit` if it scored higher on text similarity. **With Visual Verification**, it rejects `#hidden-submit` (invisible, zero-size) and correctly uses `#submit-form-btn`.

### What You See in Logs

```
[Visual] Verification passed for "#submit-form-btn" (120x40 at 350,620)
```
or
```
[Visual] Verification failed for "#hidden-submit" (visible=false, box=null)
```

### When to Enable

Visual verification is **disabled by default** because it adds ~50-200ms per heal. Enable it when:

| Scenario | Recommendation |
|----------|---------------|
| Complex enterprise apps (SAP, Salesforce) | ✅ Strongly recommended — many similar elements on page |
| Nightly/weekly full regression suites | ✅ Enable — validates heals without blocking CI |
| Debugging incorrect heals | ✅ Enable with `captureElement: true` |
| Local development | ✅ Helpful — screenshots let you visually review heals |
| High-speed parallel runs | ⚠️ Optional — slight overhead per heal |
| Simple/stable apps | ❌ Can skip — deterministic strategies rarely pick wrong elements |

### Configuration

```ts
visualVerification: {
  enabled: false,                      // opt-in (disabled by default)
  screenshotDir: '.mindheal/screenshots',
  diffThreshold: 0.1,                  // pixel diff tolerance
  captureElement: true,                // save element screenshot
  captureFullPage: false,              // save full page screenshot
  keepScreenshots: true,               // retain after verification
}
```

### Screenshot Output

When enabled, screenshots are saved as:

```
.mindheal/screenshots/
  heal_abc123_element.png    ← cropped to just the healed element
  heal_abc123_page.png       ← full page context (if captureFullPage: true)
```

Each healing event also includes a `visualVerification` result in analytics/reports:

```json
{
  "verified": true,
  "elementVisible": true,
  "elementInViewport": true,
  "boundingBox": { "x": 350, "y": 620, "width": 120, "height": 40 },
  "elementScreenshotPath": ".mindheal/screenshots/heal_abc123_element.png"
}
```

---

## Configuration Reference

MindHeal merges configuration from three sources (highest priority first):

1. Inline config passed to `mindHealConfig()`
2. Config file (`mindheal.config.ts`, `.js`, `.json`, or `.mjs`)
3. Built-in defaults

### What's Required vs Optional

| Config Section | Required? | When to Add |
|---------------|-----------|-------------|
| `ai` | **Yes** | Always — tells MindHeal which AI provider to use |
| `healing` | No | Only to customize strategies, threshold, dialog handling |
| `git` | No | Only for auto-PR creation in CI/CD |
| `reviewServer` | No | Only to customize dashboard port, auto-open behavior |
| `reporting` | No | Only to change report output directory or format |
| `logging` | No | Only to change log level or write to a file |

### Minimum Config (Most Users)

```ts
// playwright.config.ts — this is all you need
const healConfig = mindHealConfig({
  ai: {
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY!,
  },
});

export default defineConfig({ ...healConfig });
```

This gives you all 9 strategies, local review dashboard, dialog handling, and HTML/JSON reports — all with sensible defaults.

### With Customized Healing (Optional)

```ts
const healConfig = mindHealConfig({
  ai: {
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY!,
  },
  // Optional: customize healing behavior
  healing: {
    strategies: ['cache', 'attribute', 'text', 'role', 'ai'],  // skip CSS, XPath, Table, Modal
    confidenceThreshold: 0.6,    // lower threshold = accept more heals
    domSnapshotDepth: 5,         // deeper DOM capture
    handleDialogs: false,        // disable dialog auto-handling
  },
});
```

### With Auto-PR in CI/CD (Optional)

```ts
const healConfig = mindHealConfig({
  ai: {
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY!,
  },
  // Optional: add ONLY if you want auto-PR creation in CI
  git: {
    enabled: true,
    provider: 'github',            // 'github' | 'gitlab' | 'bitbucket'
    token: process.env.GITHUB_TOKEN!,
    baseBranch: 'main',
    autoCreatePR: true,
  },
});
```

### Full Configuration Reference

<details>
<summary>Click to expand all options with defaults</summary>

```ts
import type { MindHealConfig } from 'mindheal';

const config: MindHealConfig = {
  // -- AI Provider (REQUIRED) --
  ai: {
    provider: 'anthropic',          // See "AI Providers" for all 11 options
    apiKey: '',                      // API key (or use env vars)
    model: 'claude-sonnet-4-20250514',  // Each provider has its own default
    maxTokens: 1024,
    temperature: 0.1,
    baseUrl: undefined,              // Custom endpoint URL

    // Azure OpenAI specific:
    // azureDeploymentName: '',
    // azureApiVersion: '2024-02-01',

    // Ollama specific:
    // ollamaHost: 'http://localhost:11434',

    // AWS Bedrock specific:
    // awsRegion: 'us-east-1',
    // awsAccessKeyId: '',
    // awsSecretAccessKey: '',
    // awsSessionToken: '',
  },

  // -- Healing Behavior (OPTIONAL — sensible defaults) --
  healing: {
    enabled: true,
    maxRetries: 3,
    strategies: ['cache', 'attribute', 'text', 'role', 'css', 'xpath', 'table', 'modal', 'enterprise', 'ai'],
    confidenceThreshold: 0.7,
    cacheHeals: true,
    cachePath: '.mindheal/cache.json',
    excludePatterns: [],
    domSnapshotDepth: 3,
    handleDialogs: true,
  },

  // -- Enterprise Applications (OPTIONAL — auto-detected) --
  enterprise: {
    enabled: true,
    platform: 'auto',              // 'auto' | 'salesforce' | 'sap' | 'oracle' | 'workday' | 'servicenow' | 'dynamics'
    waitForLoad: true,
    loadTimeout: 15000,
    virtualScrolling: true,
    customStableAttributes: [],    // Your custom stable attribute names
    customDynamicIdPatterns: [],   // Your custom dynamic ID regex patterns
  },

  // -- Healing Analytics (OPTIONAL — enabled by default) --
  analytics: {
    enabled: true,
    storePath: '.mindheal/analytics.json',
    trackLocators: true,
    trackStrategies: true,
    trackTestStability: true,
    maxEntries: 5000,
    retentionDays: 90,
  },

  // -- Smart Retry Intelligence (OPTIONAL — enabled by default) --
  smartRetry: {
    enabled: true,
    waitForNetworkIdle: true,
    networkIdleTimeout: 5000,
    exponentialBackoff: true,
    backoffBaseDelay: 500,
    backoffMaxDelay: 10000,
    flakyDetection: true,
    flakyThreshold: 3,
    flakyStorePath: '.mindheal/flaky-tests.json',
  },

  // -- Parallel Execution Safety (OPTIONAL — enabled by default) --
  parallel: {
    enabled: true,
    lockTimeout: 10000,
    lockRetryInterval: 50,
    staleLockThreshold: 30000,
  },

  // -- Visual Verification (OPTIONAL — disabled by default) --
  visualVerification: {
    enabled: false,
    screenshotDir: '.mindheal/screenshots',
    diffThreshold: 0.1,
    captureElement: true,
    captureFullPage: false,
    keepScreenshots: true,
  },

  // -- Git & PR Creation (OPTIONAL — only for CI auto-PR) --
  git: {
    enabled: true,
    provider: 'github',
    token: '',
    baseBranch: 'main',
    branchPrefix: 'mindheal/auto-fix',
    autoCreatePR: true,
    commitMessagePrefix: 'fix(locators):',
    prLabels: ['auto-heal', 'mindheal'],
    prReviewers: [],
    repoOwner: '',                   // Auto-detected from git remote
    repoName: '',                    // Auto-detected from git remote
  },

  // -- Review Server (OPTIONAL — auto-enabled locally) --
  reviewServer: {
    enabled: 'auto',                 // true | false | 'auto' (local only)
    port: 3000,
    openBrowser: true,
    autoCloseAfterReview: true,
  },

  // -- RAG (Retrieval-Augmented Generation) (OPTIONAL — enabled by default) --
  rag: {
    enabled: true,
    storePath: '.mindheal/knowledge.json',
    maxContextChunks: 5,
    similarityThreshold: 0.3,
    sources: [
      'healing-history',
      'page-objects',
      'git-changes',
      'dom-snapshots',
      'component-docs',
      'test-specs',
    ],
    pageObjectPaths: ['pages', 'src/pages', 'page-objects'],
    componentDocPaths: [],
  },

  // -- Reporting (OPTIONAL) --
  reporting: {
    outputDir: '.mindheal/reports',
    generateHTML: true,
    generateJSON: true,
  },

  // -- Logging (OPTIONAL) --
  logging: {
    level: 'info',
    file: undefined,
  },
};
```

</details>

---

## AI Providers

MindHeal supports **11 AI providers** out of the box. The AI strategy is the **last** in the default pipeline -- it only runs when all deterministic strategies fail, keeping API costs minimal.

### Anthropic (Claude)

```env
ANTHROPIC_API_KEY=sk-ant-...
```

```ts
mindHealConfig({
  ai: {
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: 'claude-sonnet-4-20250514', // default
    // Also: 'claude-opus-4-20250514', 'claude-haiku-4-5-20251001'
  },
});
```

### OpenAI

```env
OPENAI_API_KEY=sk-...
```

```ts
mindHealConfig({
  ai: {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
    model: 'gpt-4o', // default
    // Also: 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o3-mini'
  },
});
```

### Azure OpenAI

```env
AZURE_OPENAI_API_KEY=your-api-key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=gpt-4o
```

```ts
mindHealConfig({
  ai: {
    provider: 'azure-openai',
    apiKey: process.env.AZURE_OPENAI_API_KEY!,
    baseUrl: process.env.AZURE_OPENAI_ENDPOINT!,
    azureDeploymentName: process.env.AZURE_OPENAI_DEPLOYMENT!,
    azureApiVersion: '2024-02-01',
  },
});
```

### Google Gemini

```env
GEMINI_API_KEY=your-api-key
```

```ts
mindHealConfig({
  ai: {
    provider: 'gemini',
    apiKey: process.env.GEMINI_API_KEY!,
    model: 'gemini-2.0-flash', // default
    // Also: 'gemini-2.5-pro', 'gemini-2.5-flash'
  },
});
```

### Ollama (Locally Hosted LLMs)

No API key required. Just have Ollama running locally.

```env
OLLAMA_HOST=http://localhost:11434
```

```ts
mindHealConfig({
  ai: {
    provider: 'ollama',
    apiKey: '',                                     // Not needed
    ollamaHost: process.env.OLLAMA_HOST || 'http://localhost:11434',
    model: 'llama3',                                // default
    // Also: 'codellama', 'mistral', 'mixtral', 'deepseek-coder', 'qwen2.5'
  },
});
```

```bash
# Pull a model first:
ollama pull llama3
```

### AWS Bedrock

```env
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
# AWS_SESSION_TOKEN=optional-sts-token
```

```ts
mindHealConfig({
  ai: {
    provider: 'aws-bedrock',
    apiKey: '',                                     // Auth via AWS credentials
    awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    awsRegion: process.env.AWS_REGION || 'us-east-1',
    awsSessionToken: process.env.AWS_SESSION_TOKEN,
    model: 'anthropic.claude-3-haiku-20240307-v1:0',
  },
});
```

### DeepSeek

```env
DEEPSEEK_API_KEY=your-api-key
```

```ts
mindHealConfig({
  ai: {
    provider: 'deepseek',
    apiKey: process.env.DEEPSEEK_API_KEY!,
    model: 'deepseek-chat', // default
    // Also: 'deepseek-coder', 'deepseek-reasoner'
  },
});
```

### Groq

```env
GROQ_API_KEY=gsk_...
```

```ts
mindHealConfig({
  ai: {
    provider: 'groq',
    apiKey: process.env.GROQ_API_KEY!,
    model: 'llama-3.3-70b-versatile', // default
    // Also: 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'
  },
});
```

### Qwen (Alibaba Cloud)

```env
QWEN_API_KEY=your-dashscope-key
```

```ts
mindHealConfig({
  ai: {
    provider: 'qwen',
    apiKey: process.env.QWEN_API_KEY!,
    model: 'qwen-plus', // default
    // Also: 'qwen-turbo', 'qwen-max', 'qwen-long'
  },
});
```

### Meta (Llama)

Meta models are accessed via hosting providers. Default uses [Together.ai](https://together.xyz).

```env
TOGETHER_API_KEY=your-together-key
```

```ts
mindHealConfig({
  ai: {
    provider: 'meta',
    apiKey: process.env.TOGETHER_API_KEY!,
    model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', // default
    // Use baseUrl to point to another OpenAI-compatible host:
    // baseUrl: 'https://your-provider.com/v1',
  },
});
```

### Perplexity

```env
PERPLEXITY_API_KEY=pplx-...
```

```ts
mindHealConfig({
  ai: {
    provider: 'perplexity',
    apiKey: process.env.PERPLEXITY_API_KEY!,
    model: 'sonar-pro', // default
    // Also: 'sonar', 'sonar-reasoning-pro'
  },
});
```

### Provider Comparison

| Provider | Default Model | API Key Env Var | Local? | Best For |
|----------|--------------|-----------------|--------|----------|
| `anthropic` | `claude-sonnet-4-20250514` | `ANTHROPIC_API_KEY` | No | Primary recommended, strong reasoning |
| `openai` | `gpt-4o` | `OPENAI_API_KEY` | No | Widely used, fast |
| `azure-openai` | (deployment) | `AZURE_OPENAI_API_KEY` | No | Enterprise Azure environments |
| `gemini` | `gemini-2.0-flash` | `GEMINI_API_KEY` | No | Google ecosystem, fast |
| `ollama` | `llama3` | None | **Yes** | Air-gapped, free, no data leaves machine |
| `aws-bedrock` | `claude-3-haiku` | `AWS_ACCESS_KEY_ID` | No | Enterprise AWS, SigV4 auth |
| `deepseek` | `deepseek-chat` | `DEEPSEEK_API_KEY` | No | Cost-effective, strong coding |
| `groq` | `llama-3.3-70b-versatile` | `GROQ_API_KEY` | No | Extremely fast inference |
| `qwen` | `qwen-plus` | `QWEN_API_KEY` | No | Alibaba Cloud DashScope |
| `meta` | `Llama-3.3-70B-Instruct-Turbo` | `TOGETHER_API_KEY` | No | Via Together.ai (or any host) |
| `perplexity` | `sonar-pro` | `PERPLEXITY_API_KEY` | No | Online search-augmented |

---

## CI/CD Setup

MindHeal works in CI out of the box — tests self-heal and reports are generated. **Auto-PR creation is optional** and requires adding the `git` config.

### How MindHeal Behaves in CI vs Local

```
Is CI=true?
   |
 +-+---+
 |     |
 NO    YES
 |     |
 v     v
LOCAL  CI/CD
 |     |
 v     v
Open   Is git config provided?
review   |
dash-  +-+---+
board  |     |
at     NO    YES
:3000  |     |
       v     v
     Tests   Create branch
     run &   → modify source
     report  → commit
     only    → push → create PR
```

### Config Generated by `npx mindheal init`

The init command generates a config with both `ai` and `git` — ready for local and CI use:

```ts
// playwright.config.ts — generated by npx mindheal init
const healConfig = mindHealConfig({
  ai: {
    provider: 'anthropic',                   // whichever you selected during init
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: 'claude-sonnet-4-20250514',
  },
  git: {
    enabled: true,
    provider: 'github',
    token: process.env.GIT_TOKEN || '',
    baseBranch: 'main',
    autoCreatePR: true,
    commitMessagePrefix: 'fix(locators):',
    prLabels: ['auto-heal', 'mindheal'],
  },
});
```

- **Locally:** The `git` config has no effect. The review dashboard handles everything.
- **In CI:** Set `GIT_TOKEN` as a secret env var, and MindHeal auto-creates PRs with healed locators.

### GitHub Actions

```yaml
name: Playwright Tests with MindHeal
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci

      - run: npx playwright install --with-deps

      - run: npx playwright test
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}  # Only needed if git config is enabled
          CI: true

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: mindheal-reports
          path: .mindheal/reports/
```

### GitLab CI

```yaml
playwright-tests:
  image: mcr.microsoft.com/playwright:v1.44.0-jammy
  stage: test
  variables:
    ANTHROPIC_API_KEY: $ANTHROPIC_API_KEY
    CI: "true"
  script:
    - npm ci
    - npx playwright test
  artifacts:
    when: always
    paths:
      - .mindheal/reports/
    expire_in: 30 days
```

### Bitbucket Pipelines

```yaml
pipelines:
  default:
    - step:
        name: Playwright Tests with MindHeal
        image: mcr.microsoft.com/playwright:v1.44.0-jammy
        script:
          - npm ci
          - npx playwright test
        artifacts:
          - .mindheal/reports/**
```

> **Note:** Set your AI provider API key as a secret environment variable in your CI platform. The `GITHUB_TOKEN` / git provider token is only needed if you enable the `git` config for auto-PR creation.

---

## Local Review Dashboard

When running locally, MindHeal automatically opens a review dashboard in your browser after tests complete (if any locators were healed). No config needed — it happens by default.

### How It Works

```
npx playwright test
    |
    v
Tests run. MindHeal heals 5 broken locators.
    |
    v
Tests finish.
    |
    v
Browser opens http://localhost:3000
    |
    v
You review each heal:
  - Approve  → locator updated in your source file (AST-based)
  - Edit     → tweak the healed locator, then approve
  - Reject   → locator stays as-is, no changes
    |
    v
All reviewed → dashboard auto-closes
```

### What the Dashboard Shows

Each healed locator appears as a card showing:

- **File and line number** — e.g., `login.page.ts:15`
- **Strategy used** — which of the 9 strategies found the match
- **Confidence score** — how certain MindHeal is (0.0 to 1.0)
- **Original locator** — the broken expression
- **Healed locator** — the proposed replacement
- **Three action buttons** — Approve, Edit, Reject

### Batch Actions

| Button | What It Does |
|--------|-------------|
| **Approve All** | Approves every pending heal at once |
| **Reject All** | Rejects every pending heal at once |
| **Approve High Confidence** | Approves only heals with confidence > 0.9 (near-certain matches) |

### What Happens When You Click "Approve"

The healed locator is written to your source file using `ts-morph` (AST-based modification). Only the exact locator expression is replaced — formatting, comments, and surrounding code are preserved:

```ts
// pages/login.page.ts — BEFORE approve
this.emailInput = page.getByLabel('Email');            // ← line 15

// pages/login.page.ts — AFTER approve
this.emailInput = page.getByLabel('Email Address');    // ← only this changed
```

### Disabling the Review Server

```ts
mindHealConfig({
  reviewServer: { enabled: false },
});
```

---

## API Reference

### Core

| Export | Type | Description |
|--------|------|-------------|
| `mindHealConfig(config?)` | Function | Returns a partial Playwright config with MindHeal fixtures and reporter. The primary entry point. |
| `createMindHealFixture(config)` | Function | Creates a Playwright test fixture with healing-enabled `page`. For advanced setups. |
| `Healer` | Class | The healing engine. Orchestrates strategy pipeline, verifies results, manages caching. |

### Configuration

| Export | Type | Description |
|--------|------|-------------|
| `loadConfig(userConfig?)` | Function | Merges user config with file-based config and defaults. Validates and resolves settings. |
| `createConfig(userConfig)` | Function | Alias for `loadConfig`. |
| `DEFAULT_CONFIG` | Object | Built-in default configuration values. |

### AI

| Export | Type | Description |
|--------|------|-------------|
| `createAIProvider(aiConfig)` | Function | Factory that returns the correct provider instance. Supports all 11 providers. |
| `AIProvider` | Interface | Contract: `suggestLocator(request) => Promise<AIHealingResponse>`. |
| `AnthropicProvider` | Class | Anthropic Claude API provider. |
| `OpenAIProvider` | Class | OpenAI API provider. |
| `AzureOpenAIProvider` | Class | Azure OpenAI API provider. |
| `GeminiProvider` | Class | Google Gemini API provider. |
| `OllamaProvider` | Class | Ollama local LLM provider. |
| `BedrockProvider` | Class | AWS Bedrock provider (SigV4 auth). |
| `DeepSeekProvider` | Class | DeepSeek API provider. |
| `GroqProvider` | Class | Groq API provider. |
| `QwenProvider` | Class | Qwen/DashScope API provider. |
| `MetaProvider` | Class | Meta/Llama provider (via Together.ai). |
| `PerplexityProvider` | Class | Perplexity API provider. |

### Git & Code Modification

| Export | Type | Description |
|--------|------|-------------|
| `GitOperations` | Class | Manages branches, commits, and pushes via `simple-git`. |
| `PRCreator` | Class | Creates pull requests on GitHub, GitLab, or Bitbucket. |
| `CodeModifier` | Class | AST-based source code modifier using `ts-morph`. |

### Review Server

| Export | Type | Description |
|--------|------|-------------|
| `ReviewServer` | Class | Express + WebSocket server for the local review dashboard. |

### Enterprise

| Export | Type | Description |
|--------|------|-------------|
| `enterpriseStrategy` | Function | The enterprise healing strategy function. Handles dynamic IDs, custom elements, stable attributes. |
| `isDynamicId(id)` | Function | Checks if an ID matches known dynamic ID patterns (SAP, Salesforce, Oracle, etc.). |
| `detectPlatform(url, html)` | Function | Auto-detects the enterprise platform from URL or DOM content. |
| `extractStableIdPart(id)` | Function | Strips dynamic prefix/suffix from an ID and returns the stable portion. |
| `waitForEnterpriseLoad(page, timeout?)` | Function | Waits for enterprise-specific loading indicators to disappear. |
| `scrollVirtualContainer(page, selector?)` | Function | Scrolls virtual scroll containers to bring more elements into view. |

### RAG (Retrieval-Augmented Generation)

| Export | Type | Description |
|--------|------|-------------|
| `KnowledgeStore` | Class | File-backed knowledge store. Add, upsert, search entries with TF-IDF similarity. |
| `ContextRetriever` | Class | Retrieves relevant context from the knowledge store for AI healing prompts. |
| `textSimilarity(a, b)` | Function | Compute cosine similarity between two text strings using TF-IDF. |
| `tokenize(text)` | Function | Tokenize text into lowercase terms + bigrams. |
| `buildTermVector(tokens)` | Function | Build a normalized term-frequency vector from tokens. |
| `cosineSimilarity(a, b)` | Function | Compute cosine similarity between two term vectors. |

### Healing Analytics

| Export | Type | Description |
|--------|------|-------------|
| `HealingAnalytics` | Class | File-backed analytics engine. Tracks healing success rates, strategy effectiveness, per-locator frequency, and test stability scores. |
| `analytics.load()` | Method | Load analytics snapshot from disk. Auto-prunes entries older than `retentionDays`. |
| `analytics.save()` | Method | Persist analytics snapshot to disk (only if dirty). |
| `analytics.recordEvent(event)` | Method | Record a `HealingEvent` — updates strategy stats, locator stats, and test stability. |
| `analytics.getStrategyStats()` | Method | Returns all strategy stats sorted by success rate (descending). |
| `analytics.getMostHealedLocators(limit?)` | Method | Returns the most frequently healed locators. Default limit: 10. |
| `analytics.getUnstableTests(limit?)` | Method | Returns tests with lowest stability scores. Default limit: 10. |
| `analytics.getDegradingTests()` | Method | Returns tests whose trend is `'degrading'`. |
| `analytics.getOverallStats()` | Method | Returns aggregate stats: totalHeals, successRate, avgConfidence, avgDuration, uniqueLocators, uniqueTests. |
| `analytics.getSnapshot()` | Method | Returns a copy of the full analytics snapshot. |

### Smart Retry Intelligence

| Export | Type | Description |
|--------|------|-------------|
| `SmartRetry` | Class | Network idle wait, DOM stability detection, exponential backoff, and flaky test detection. |
| `smartRetry.load()` | Method | Load flaky test store from disk. Prunes entries not seen in 30 days. |
| `smartRetry.save()` | Method | Persist flaky test store to disk. |
| `smartRetry.waitForNetworkIdle(page)` | Method | Waits for `networkidle` load state before healing. |
| `smartRetry.waitForDOMStable(page, stabilityMs?)` | Method | Waits for DOM to stop mutating (uses MutationObserver). Default: 500ms. |
| `smartRetry.getBackoffDelay(attempt)` | Method | Computes exponential backoff delay with jitter for the given attempt index. |
| `smartRetry.backoff(attempt)` | Method | Sleeps for the computed backoff delay. |
| `smartRetry.recordAttempt(testFile, testTitle, locator, success)` | Method | Records a healing result for flaky detection. |
| `smartRetry.isFlaky(testFile, locator)` | Method | Returns `true` if the locator is known to be flaky (intermittent). |
| `smartRetry.getFlakyTests()` | Method | Returns all known flaky test entries, sorted by failure count. |
| `smartRetry.getBrokenLocators()` | Method | Returns consistently broken locators (not flaky, just broken). |
| `smartRetry.shouldSkipHealing(testFile, locator)` | Method | Returns `true` if healing should be skipped for a known flaky locator. |

### Parallel Execution Safety

| Export | Type | Description |
|--------|------|-------------|
| `FileLock` | Class | Advisory file locking for parallel-safe reads/writes. Uses `.lock` files with PID tracking. |
| `fileLock.acquire(filePath)` | Method | Acquires a lock on the given file. Retries with timeout. Breaks stale locks from dead processes. |
| `fileLock.release(filePath)` | Method | Releases the lock on the given file. |
| `fileLock.withLock(filePath, fn)` | Method | Executes `fn` while holding the lock, releasing it on completion or error. |

### Visual Verification

| Export | Type | Description |
|--------|------|-------------|
| `VisualVerifier` | Class | Post-heal visual verification engine. Validates healed elements are visible, sized, and in-viewport. |
| `verifier.verify(page, healedLocator, eventId)` | Method | Runs all visual checks on the healed element. Returns `VisualVerificationResult`. |
| `verifier.compareScreenshots(page, bufferA, bufferB)` | Method | Canvas-based pixel sampling comparison. Returns similarity score (0–1). |
| `verifier.cleanup()` | Method | Removes captured screenshots when `keepScreenshots` is `false`. |

### Cache & Utilities

| Export | Type | Description |
|--------|------|-------------|
| `SelfHealCache` | Class | Disk-backed cache with TTL, usage tracking, and pattern-based lookup. |
| `logger` | Object | Structured logger with `debug`, `info`, `warn`, `error` methods. |
| `configureLogger(config)` | Function | Reconfigure log level and file output at runtime. |
| `isCI()` | Function | Detects CI environments (GitHub Actions, GitLab CI, Jenkins, etc.). |
| `detectGitProvider()` | Function | Auto-detects git hosting provider from remote URLs. |
| `getRepoInfo()` | Function | Extracts owner and repo name from git remote. |

### Advanced / Core Modules

| Export | Type | Description |
|--------|------|-------------|
| `captureDOMSnapshot(page, rootSelector?, depth?)` | Function | Captures a serialized DOM snapshot for healing analysis. |
| `analyzeLocator(locatorInfo)` | Function | Extracts metadata from a locator for strategy matching. |
| `getLocatorHash(locatorInfo, pageUrl)` | Function | Generates a deterministic hash for cache keying. |
| `runStrategy(name, page, locatorInfo, domSnapshot)` | Function | Dispatches a single named healing strategy. |

---

## Troubleshooting

### API key not set

```
WARN: AI strategy is enabled but no API key provided. AI strategy will be skipped during healing.
```

**Fix:** Set the API key for your chosen provider in your `.env` file (see [AI Providers](#ai-providers)), or pass it directly in config. The AI strategy is skipped gracefully if no key is available -- deterministic strategies still run. For Ollama, no API key is needed but the server must be running.

### Low confidence heals

If heals are being rejected (confidence below threshold), try:

- Lower the threshold: `healing.confidenceThreshold: 0.5` (default is `0.7`)
- Increase DOM snapshot depth: `healing.domSnapshotDepth: 5` for more context
- Ensure the AI strategy is included in your pipeline for complex cases

### Review server port conflict

```
Error: listen EADDRINUSE :::3000
```

**Fix:** Change the port in your config:

```ts
mindHealConfig({
  reviewServer: { port: 3001 },
});
```

### Git permissions

```
WARN: Git PR creation is enabled but no token provided. PR creation will be skipped.
```

**Fix:** Provide a valid token for your git provider:

- **GitHub:** A personal access token or `GITHUB_TOKEN` in Actions with `contents: write` and `pull-requests: write` permissions.
- **GitLab:** A project access token with `api` scope.
- **Bitbucket:** An app password with `pullrequests:write` permission.

### Cache stale entries

If cached heals point to outdated locators:

```bash
# Delete the cache file to force fresh healing
rm .mindheal/cache.json
```

Or disable caching entirely:

```ts
mindHealConfig({
  healing: { cacheHeals: false },
});
```

### Healing not triggering

If MindHeal doesn't seem to activate:

1. Verify you imported `test` from `mindheal`, not from `@playwright/test`
2. Check that `healing.enabled` is not set to `false`
3. Check the logs -- set `logging.level: 'debug'` for verbose output
4. Confirm the error is a locator-resolution failure (MindHeal only heals `TimeoutError`, `strict mode violation`, `element not found` -- not assertion or network errors)

### Shadow DOM elements not found

If healing can't find elements inside shadow DOM:

- Increase `domSnapshotDepth` to capture deeper nesting: `healing.domSnapshotDepth: 6`
- Ensure the shadow root is open (MindHeal cannot pierce closed shadow roots)

---

## FAQ

**Q: Does MindHeal slow down passing tests?**
No. MindHeal only activates when a locator action fails. Passing tests hit the original Playwright action and return immediately with zero overhead.

**Q: Does it work with Page Object Model (POM)?**
Yes. The proxied `page` object flows into POM constructors. Any locator created via the proxied page is automatically healed.

**Q: Does it work with BDD/Cucumber?**
Yes. Pass the proxied `page` into your Cucumber World or step definitions. Healing follows the page reference.

**Q: Can I use it without AI?**
Yes. Remove `'ai'` from the strategies array. The 8 deterministic strategies (cache, attribute, text, role, CSS, XPath, table, modal) work without any API key.

**Q: The init command added `git` config — is that needed?**
The `git` config is included by default so auto-PR creation works out of the box in CI/CD. If you don't need it, you can remove the `git` section from `playwright.config.ts`. Without it, MindHeal still heals locators, generates reports, and shows the review dashboard locally. **Recommended by MindHeal:** Keep the `git` config. It has no effect locally (the review dashboard handles everything). In CI, it auto-creates PRs with healed locators for your team to review.

**Q: Does it modify my test files automatically?**
Only if you approve. Locally, the review dashboard lets you approve/reject/edit each heal. In CI, changes are submitted as a PR for review -- never pushed directly to main.

**Q: What happens if healing also fails?**
The original error is thrown. Your test fails with the same error message it would have without MindHeal. No silent swallowing.

**Q: Does it handle dynamic content (loading spinners, async renders)?**
MindHeal respects Playwright's built-in auto-waiting. If a locator times out after Playwright's wait period, then healing kicks in to find an alternative element.

**Q: Is my data sent to external servers?**
Only if you use a cloud AI provider (OpenAI, Anthropic, etc.) and a locator reaches the AI strategy. Use Ollama for fully local, air-gapped operation. Deterministic strategies (1-8) never make external calls.

**Q: Does MindHeal work with SAP, Salesforce, Workday, and other enterprise apps?**
Yes. MindHeal includes a dedicated enterprise strategy that auto-detects the platform and handles dynamic IDs, custom web components, deep Shadow DOM, virtual scrolling, and enterprise-specific stable attributes. It's enabled by default — zero configuration required.

**Q: My SAP/Salesforce locators use generated IDs like `__xmlview0--` or `globalId_`. Will MindHeal handle them?**
Yes. MindHeal recognizes 30+ dynamic ID patterns and automatically strips the volatile prefix/suffix to match by the stable portion (e.g., `__xmlview0--loginButton` → `[id$="loginButton"]`). It also prefers stable attributes like `data-automation-id`, `data-sap-ui`, and `data-field` over IDs.

**Q: What is RAG and do I need to configure it?**
RAG (Retrieval-Augmented Generation) enhances the AI healing strategy by providing project-specific context. It's enabled by default and requires zero configuration. As you run tests, MindHeal automatically builds a knowledge store of healing history, page objects, git changes, and more. The AI uses this context to make better decisions over time.

**Q: Does RAG require a vector database?**
No. MindHeal uses a lightweight TF-IDF similarity engine — no external infrastructure required. The knowledge store is a simple JSON file. Works fully offline (e.g., with Ollama).

**Q: Should I commit the knowledge store file?**
It depends. Committing `.mindheal/knowledge.json` shares healing knowledge across CI runners and team members (useful for large teams). Adding it to `.gitignore` keeps each environment independent. Both approaches work.

---

## Contributing

We welcome contributions from the community! Here's how to get started:

### Development Setup

1. **Fork and clone** the repository:
   ```bash
   git clone https://github.com/<your-username>/mindheal.git
   cd mindheal
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Run the type checker:**
   ```bash
   npm run typecheck
   ```

4. **Run the linter:**
   ```bash
   npm run lint
   ```

5. **Run the test suite:**
   ```bash
   npm test
   ```

6. **Build the package:**
   ```bash
   npm run build
   ```

### Project Structure

```
mindheal/
  src/
    core/           # Interceptor, healer, strategies, cache, DOM snapshot
    ai/             # All 11 AI provider implementations
    rag/            # RAG context retriever, knowledge store, TF-IDF embeddings
    config/         # Configuration loader, defaults, validation
    git/            # Git operations, PR creation, AST code modifier
    server/         # Review server (Express + WebSocket + dashboard UI)
    reporters/      # Playwright reporter, HTML/JSON report generation
    types/          # TypeScript type definitions
    utils/          # Logger, environment detection
  tests/
    unit/           # Unit tests (isolated, mocked dependencies)
    integration/    # Integration tests (multiple modules working together)
    fixtures/       # HTML pages and test specs for testing
```

### How to Contribute

#### Adding a New Healing Strategy

1. Create the strategy function in `src/core/locator-strategies.ts`
2. Add the strategy name to the `HealingStrategyName` union in `src/types/index.ts`
3. Register it in the `STRATEGY_MAP` in `src/core/locator-strategies.ts`
4. Add it to the default strategy list in `src/config/defaults.ts`
5. Write unit tests in `tests/unit/locator-strategies.test.ts`
6. Update the healing strategies table in this README

#### Adding a New AI Provider

1. Create a new file in `src/ai/` following the existing provider pattern
2. Implement the `AIProvider` interface: `suggestLocator(request) => Promise<AIHealingResponse>`
3. Register it in `src/ai/ai-provider.ts` factory
4. Add the provider name to the `AIProviderName` union in `src/types/index.ts`
5. Update the config validation in `src/config/config-loader.ts`
6. Export the class from `src/index.ts`
7. Write unit tests in `tests/unit/ai-provider.test.ts`
8. Add documentation to the AI Providers section in this README

#### Code Style

- TypeScript strict mode -- no `any` unless absolutely necessary (with `eslint-disable` comment)
- Use descriptive variable names and JSDoc comments for public APIs
- Follow existing patterns for consistency
- Format with Prettier: `npm run format`
- Lint with ESLint: `npm run lint:fix`

### Pull Request Guidelines

1. **Create a feature branch** from `main`:
   ```bash
   git checkout -b feature/my-new-feature
   ```

2. **Make your changes** with clear, focused commits

3. **Ensure all checks pass:**
   ```bash
   npm run typecheck && npm run lint && npm test
   ```

4. **Submit a pull request** with:
   - A clear title describing the change
   - A description explaining **what** and **why**
   - Reference any related issues (e.g., `Closes #42`)
   - Screenshots or test output if relevant

5. **Respond to review feedback** promptly

---

## Reporting Bugs

Found a bug? Please help us fix it by opening an issue with the following information:

### Before Reporting

1. **Search existing issues** to avoid duplicates
2. **Reproduce with the latest version** of MindHeal
3. **Check the [Troubleshooting](#troubleshooting) section** -- your issue may already have a known fix

### Bug Report Template

When creating a new issue, include:

- **MindHeal version:** (`npm list mindheal`)
- **Playwright version:** (`npm list @playwright/test`)
- **Node.js version:** (`node --version`)
- **OS:** (Windows / macOS / Linux + version)
- **AI provider used:** (e.g., anthropic, openai, ollama)

**Describe the bug:**
A clear description of what happened vs. what you expected.

**Steps to reproduce:**
1. Step 1
2. Step 2
3. ...

**Relevant config:**
```ts
// Your mindHealConfig() call (redact API keys)
```

**Error output / logs:**
```
// Paste the error message or set logging.level: 'debug' and include the log output
```

**Test code (minimal reproduction):**
```ts
// The smallest test that reproduces the issue
```

### Where to Report

- **GitHub Issues:** [github.com/mindheal/mindheal/issues](https://github.com/mindheal/mindheal/issues)
- **Security vulnerabilities:** See [Security](#security) section below

---

## Feature Requests

Have an idea for a new feature? We'd love to hear it!

1. **Search existing issues** to see if it's already been requested
2. **Open a new issue** with the `feature-request` label
3. Include:
   - **Use case:** What problem does this solve?
   - **Proposed solution:** How do you envision it working?
   - **Alternatives considered:** What other approaches did you think about?
   - **Additional context:** Screenshots, examples, links to related tools

### Commonly Requested Features

We track requested features and prioritize based on community interest. Upvote (thumbs up reaction) existing feature requests to help us prioritize.

---

## Security

If you discover a security vulnerability, please **do NOT open a public issue**. Instead:

1. Email security concerns to the maintainers privately
2. Include a detailed description of the vulnerability
3. Allow reasonable time for a fix before public disclosure

We take security seriously and will respond promptly.

---

## License

[MIT](./LICENSE)

---

<p align="center">
  Built with TypeScript. Powered by Playwright. Healed by AI.
</p>
