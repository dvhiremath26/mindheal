<p align="center">
  <h1 align="center">MindHeal</h1>
  <p align="center"><strong>AI-powered auto-healing for Playwright tests</strong></p>
  <p align="center">
    <a href="https://www.npmjs.com/package/mindheal"><img src="https://img.shields.io/npm/v/mindheal.svg?style=flat-square" alt="npm version" /></a>
    <a href="https://github.com/dvhiremath26/mindheal/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/mindheal.svg?style=flat-square" alt="license" /></a>
    <img src="https://img.shields.io/badge/TypeScript-strict-blue?style=flat-square&logo=typescript" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Playwright-%3E%3D1.40-45ba4b?style=flat-square&logo=playwright" alt="Playwright" />
  </p>
</p>

---

**MindHeal** is a drop-in npm package that auto-heals broken Playwright locators at runtime. When a test step fails because an element moved, got renamed, or changed structure, MindHeal intercepts the failure, runs a pipeline of up to 10 healing strategies (including AI + RAG), and retries the action transparently — without touching your test code.

Works with **any design pattern**: Page Object Model, BDD Cucumber, Screenplay, or plain spec files.

---

## Quick Start

### 1. Install

```bash
npm install mindheal dotenv
```

### 2. Run the init command

```bash
npx mindheal init
```

An interactive prompt lets you pick your AI provider. The command then:

- Creates `tests/base.ts` (re-exports `test` and `expect` from mindheal)
- Updates all `.spec.ts` / `.test.ts` imports automatically
- Creates `.env.example` with the correct env vars for your provider
- Patches `playwright.config.ts` with `mindHealConfig()`

### 3. Add your API key

```bash
cp .env.example .env
# Then fill in your key, e.g. ANTHROPIC_API_KEY=sk-ant-...
```

> **No API key?** Strategies 1–9 (Cache → Enterprise) work without one. Only strategy 10 (AI) requires a key. Or select **Ollama** during init for free local inference.

### 4. Run your tests

```bash
npx playwright test
```

**Done. Your tests now self-heal.**

---

## How It Works

MindHeal is a **fallback-only mechanism** — zero overhead on passing tests.

```
page.locator('.submit-btn').click()
         │
    ┌────┴────┐
    │         │
  PASS      FAIL
    │         │
  Done      Healing Pipeline
            1.  Cache      — previously healed locator?
            2.  Attribute  — similar id/name/data-testid?
            3.  Text       — similar visible text?
            4.  Role       — same ARIA role?
            5.  CSS        — similar CSS selector?
            6.  XPath      — similar XPath expression?
            7.  Table      — same table row/column?
            8.  Modal      — inside a dialog/popup?
            9.  Enterprise — SAP/Salesforce dynamic IDs?
            10. AI + RAG   — LLM with project context
                 │
           First result ≥ confidence threshold
                 │
            ┌────┴────┐
            │         │
          FOUND     NOT FOUND
            │         │
          Retry     Throw original error
          action    (test fails normally)
```

MindHeal wraps `page.locator()`, `page.getByRole()`, and all 8 Playwright locator methods via an ES Proxy — no monkey-patching, no changes to your page objects.

---

## Key Features

| Feature | Details |
|---------|---------|
| **10 healing strategies** | Cache → Attribute → Text → Role → CSS → XPath → Table → Modal → Enterprise → AI |
| **RAG-enhanced AI** | AI strategy gets project context: past heals, page objects, git diffs, DOM snapshots |
| **Enterprise support** | SAP Fiori, Salesforce LWC, Workday, ServiceNow, Oracle, Dynamics 365 |
| **Shadow DOM & iFrames** | Recursively pierces shadow roots; wraps all frame access methods |
| **Dialog auto-handling** | Auto-dismisses `alert()`, `confirm()`, `prompt()`, `beforeunload` |
| **Local review dashboard** | Opens at `localhost:3000` to approve/reject/edit healed locators |
| **CI auto-PR** | Commits healed locators and creates a PR (GitHub, GitLab, Bitbucket) |
| **Healing analytics** | Strategy stats, fragile locator tracking, test stability scores |
| **Smart retry** | Network-idle wait, DOM stability wait, flaky vs broken detection |
| **Parallel safety** | File locking for shared resources across Playwright workers |
| **Visual verification** | Validates healed element is visible and in viewport (opt-in) |

---

## Configuration

Minimum config — this is all most users need:

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import { mindHealConfig } from 'mindheal';
import 'dotenv/config';

export default defineConfig({
  ...mindHealConfig({
    ai: {
      provider: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY!,
    },
  }),
  testDir: './tests',
});
```

<details>
<summary>Full configuration reference (all options with defaults)</summary>

```ts
import type { MindHealConfig } from 'mindheal';

const config: MindHealConfig = {
  // REQUIRED
  ai: {
    provider: 'anthropic',
    apiKey: '',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 1024,
    temperature: 0.1,
    baseUrl: undefined,
    // Azure: azureDeploymentName, azureApiVersion
    // Ollama: ollamaHost: 'http://localhost:11434'
    // Bedrock: awsRegion, awsAccessKeyId, awsSecretAccessKey, awsSessionToken
  },

  // Healing behavior
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
    // handleDialogs: { dismissAlerts, acceptConfirms, promptResponse, logDialogs }
  },

  // Enterprise apps (auto-detected)
  enterprise: {
    enabled: true,
    platform: 'auto', // 'auto' | 'salesforce' | 'sap' | 'oracle' | 'workday' | 'servicenow' | 'dynamics'
    waitForLoad: true,
    loadTimeout: 15000,
    virtualScrolling: true,
    customStableAttributes: [],
    customDynamicIdPatterns: [],
  },

  // RAG knowledge store
  rag: {
    enabled: true,
    storePath: '.mindheal/knowledge.json',
    maxContextChunks: 5,
    similarityThreshold: 0.3,
    sources: ['healing-history', 'page-objects', 'git-changes', 'dom-snapshots', 'component-docs', 'test-specs'],
    pageObjectPaths: ['pages', 'src/pages', 'page-objects'],
    componentDocPaths: [],
  },

  // Analytics
  analytics: {
    enabled: true,
    storePath: '.mindheal/analytics.json',
    trackLocators: true,
    trackStrategies: true,
    trackTestStability: true,
    maxEntries: 5000,
    retentionDays: 90,
  },

  // Smart retry
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

  // Parallel execution safety
  parallel: {
    enabled: true,
    lockTimeout: 10000,
    lockRetryInterval: 50,
    staleLockThreshold: 30000,
  },

  // Visual verification (disabled by default — adds ~50-200ms per heal)
  visualVerification: {
    enabled: false,
    screenshotDir: '.mindheal/screenshots',
    diffThreshold: 0.1,
    captureElement: true,
    captureFullPage: false,
    keepScreenshots: true,
  },

  // Git / auto-PR (only needed for CI auto-PR)
  git: {
    enabled: true,
    provider: 'github', // 'github' | 'gitlab' | 'bitbucket'
    token: '',
    baseBranch: 'main',
    branchPrefix: 'mindheal/auto-fix',
    autoCreatePR: true,
    commitMessagePrefix: 'fix(locators):',
    prLabels: ['auto-heal', 'mindheal'],
    prReviewers: [],
    repoOwner: '',  // auto-detected from git remote
    repoName: '',   // auto-detected from git remote
  },

  // Local review dashboard
  reviewServer: {
    enabled: 'auto', // true | false | 'auto' (local runs only)
    port: 3000,
    openBrowser: true,
    autoCloseAfterReview: true,
  },

  // Reporting
  reporting: {
    outputDir: '.mindheal/reports',
    generateHTML: true,
    generateJSON: true,
  },

  // Logging
  logging: {
    level: 'info',
    file: undefined,
  },
};
```

</details>

---

## AI Providers

11 providers supported. The AI strategy is the **last** in the pipeline — it only runs when all deterministic strategies fail, keeping API costs minimal.

| Provider | Default Model | Env Var | Local? |
|----------|--------------|---------|--------|
| `anthropic` | `claude-sonnet-4-20250514` | `ANTHROPIC_API_KEY` | No |
| `openai` | `gpt-4o` | `OPENAI_API_KEY` | No |
| `azure-openai` | (your deployment) | `AZURE_OPENAI_API_KEY` | No |
| `gemini` | `gemini-2.0-flash` | `GEMINI_API_KEY` | No |
| `ollama` | `llama3` | None | **Yes** |
| `aws-bedrock` | `claude-3-haiku-...` | `AWS_ACCESS_KEY_ID` | No |
| `deepseek` | `deepseek-chat` | `DEEPSEEK_API_KEY` | No |
| `groq` | `llama-3.3-70b-versatile` | `GROQ_API_KEY` | No |
| `qwen` | `qwen-plus` | `QWEN_API_KEY` | No |
| `meta` | `Llama-3.3-70B-Instruct-Turbo` | `TOGETHER_API_KEY` | No |
| `perplexity` | `sonar-pro` | `PERPLEXITY_API_KEY` | No |

**Ollama (free, air-gapped):**

```bash
ollama pull llama3 && ollama serve
```

```ts
mindHealConfig({
  ai: {
    provider: 'ollama',
    apiKey: '',
    model: 'llama3',
    ollamaHost: process.env.OLLAMA_HOST || 'http://localhost:11434',
  },
});
```

---

## CI/CD Setup

In CI (`CI=true`), the review dashboard is skipped. If `git` config is provided, healed locators are committed and a PR is created automatically.

<details>
<summary>GitHub Actions example</summary>

```yaml
- name: Run Playwright tests
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: npx playwright test
```

```ts
// playwright.config.ts
mindHealConfig({
  ai: { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY! },
  git: {
    enabled: true,
    provider: 'github',
    token: process.env.GITHUB_TOKEN!,
    baseBranch: 'main',
    autoCreatePR: true,
  },
});
```

</details>

---

## Design Pattern Compatibility

MindHeal proxies the `page` object — healing flows through any pattern that calls Playwright locators.

<details>
<summary>Page Object Model, BDD Cucumber, and plain test examples</summary>

**Page Object Model**

```ts
// pages/login.page.ts — no changes needed
import { type Page } from '@playwright/test';

export class LoginPage {
  constructor(private page: Page) {}

  async login(email: string, password: string) {
    await this.page.getByLabel('Email').fill(email);
    await this.page.getByLabel('Password').fill(password);
    await this.page.getByRole('button', { name: 'Log In' }).click();
    // All locators above are auto-healed if they break
  }
}

// tests/login.spec.ts
import { test } from './base'; // <-- only change needed
import { LoginPage } from '../pages/login.page';

test('user can login', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.login('user@test.com', 'secret');
});
```

**BDD Cucumber**

```ts
// support/world.ts
import { chromium } from '@playwright/test';
import { LoginPage } from '../pages/login.page';

export class CustomWorld {
  async init() {
    const browser = await chromium.launch();
    this.page = await (await browser.newContext()).newPage();
    this.loginPage = new LoginPage(this.page); // healed page flows through
  }
}
```

**Plain tests**

```ts
import { test } from './base';

test('checkout flow', async ({ page }) => {
  await page.goto('/products');
  await page.getByText('Add to Cart').click();
  await page.getByRole('button', { name: 'Checkout' }).click();
});
```

</details>

---

## Supported Locator Methods

All 8 Playwright locator methods are intercepted across Page, Frame, and FrameLocator contexts:

`page.locator()` · `page.getByRole()` · `page.getByText()` · `page.getByTestId()` · `page.getByLabel()` · `page.getByPlaceholder()` · `page.getByAltText()` · `page.getByTitle()`

Chained locators and `frameLocator().locator()` are also supported.

---

## Healing Analytics

```ts
import { HealingAnalytics } from 'mindheal';

const analytics = new HealingAnalytics(config.analytics);
analytics.load();

analytics.getOverallStats();         // { totalHeals, successRate, avgConfidence, ... }
analytics.getStrategyStats();        // ranked by success rate
analytics.getMostHealedLocators(10); // fragile locator hotspots
analytics.getUnstableTests(10);      // tests with degrading stability scores
```

---

## Disabling MindHeal

Change one line in `tests/base.ts`:

```ts
// MindHeal ON
import { test, expect } from 'mindheal';

// MindHeal OFF
import { test, expect } from '@playwright/test';

export { test, expect };
```

To uninstall: `npm uninstall mindheal` and revert `tests/base.ts`.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Cannot find module 'mindheal'` | Run `npm install mindheal` |
| Healing never triggers | Check `confidenceThreshold` — try lowering to `0.5` |
| AI strategy not running | Verify your API key is set and the `ai` config is correct |
| Review dashboard not opening | Check `reviewServer.port` is not in use; set `openBrowser: true` |
| Healed locator is wrong element | Enable `visualVerification: { enabled: true }` |
| Parallel workers corrupting cache | `parallel.enabled` defaults to `true` — verify no custom file locking conflicts |
| Ollama connection refused | Run `ollama serve` before tests; check `ollamaHost` matches |

---

## Contributing

Issues and pull requests are welcome at [dvhiremath26/mindheal](https://github.com/dvhiremath26/mindheal).

- Bug reports: [github.com/dvhiremath26/mindheal/issues](https://github.com/dvhiremath26/mindheal/issues)
- Security vulnerabilities: please open a private security advisory on GitHub rather than a public issue.

---

## License

MIT © [Deepak Hiremath](https://www.linkedin.com/in/deepak-hiremath-0017937a)
