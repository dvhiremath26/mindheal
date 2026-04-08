import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CodeModifier } from '../../src/git/code-modifier';
import type { CodeModification, HealingEvent } from '../../src/types/index';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

let testDir: string;

function setupTestDir(): string {
  const dir = join(tmpdir(), `mindheal-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeTestFile(filename: string, content: string): string {
  const filePath = join(testDir, filename);
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

function createMockHealingEvent(): HealingEvent {
  return {
    id: 'evt_test_001',
    timestamp: Date.now(),
    testTitle: 'test login',
    testFile: 'login.spec.ts',
    pageUrl: 'https://example.com/login',
    action: 'click',
    originalLocator: {
      type: 'css',
      selector: '#old-btn',
      playwrightExpression: "page.locator('#old-btn')",
    },
    healedLocator: {
      type: 'css',
      selector: '#new-btn',
      playwrightExpression: "page.locator('#new-btn')",
    },
    strategy: 'attribute',
    confidence: 0.9,
    reasoning: 'Found similar element',
    duration: 50,
    sourceLocation: { filePath: 'login.spec.ts', line: 5, column: 8 },
    status: 'healed',
    reviewStatus: 'pending',
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('CodeModifier', () => {
  let modifier: CodeModifier;

  beforeEach(() => {
    vi.clearAllMocks();
    testDir = setupTestDir();
    modifier = new CodeModifier();
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('modifyLocator', () => {
    it('should modify page.locator("old") to page.locator("new")', async () => {
      const source = `import { test, expect } from '@playwright/test';

test('example', async ({ page }) => {
  await page.goto('https://example.com');
  await page.locator('#old-btn').click();
  await expect(page.getByText('Done')).toBeVisible();
});
`;
      const filePath = writeTestFile('test1.spec.ts', source);

      const modification: CodeModification = {
        filePath,
        line: 5,
        column: 8,
        originalCode: "page.locator('#old-btn')",
        modifiedCode: "page.locator('#new-btn')",
        healingEvent: createMockHealingEvent(),
      };

      await modifier.modifyLocator(modification);

      const { readFileSync } = await import('fs');
      const updated = readFileSync(filePath, 'utf-8');
      expect(updated).toContain("page.locator('#new-btn')");
      expect(updated).not.toContain("page.locator('#old-btn')");
    });

    it('should modify page.getByRole to page.getByTestId', async () => {
      const source = `import { test, expect } from '@playwright/test';

test('example', async ({ page }) => {
  await page.goto('https://example.com');
  await page.getByRole('button', { name: 'Old' }).click();
});
`;
      const filePath = writeTestFile('test2.spec.ts', source);

      const modification: CodeModification = {
        filePath,
        line: 5,
        column: 8,
        originalCode: "page.getByRole('button', { name: 'Old' })",
        modifiedCode: "page.getByTestId('new-btn')",
        healingEvent: createMockHealingEvent(),
      };

      await modifier.modifyLocator(modification);

      const { readFileSync } = await import('fs');
      const updated = readFileSync(filePath, 'utf-8');
      expect(updated).toContain("page.getByTestId('new-btn')");
      expect(updated).not.toContain("getByRole('button', { name: 'Old' })");
    });

    it('should preserve surrounding code', async () => {
      const source = `import { test, expect } from '@playwright/test';

test('example', async ({ page }) => {
  await page.goto('https://example.com');
  await page.locator('#old-btn').click();
  await expect(page.getByText('Done')).toBeVisible();
  console.log('test completed');
});
`;
      const filePath = writeTestFile('test3.spec.ts', source);

      const modification: CodeModification = {
        filePath,
        line: 5,
        column: 8,
        originalCode: "page.locator('#old-btn')",
        modifiedCode: "page.locator('#new-btn')",
        healingEvent: createMockHealingEvent(),
      };

      await modifier.modifyLocator(modification);

      const { readFileSync } = await import('fs');
      const updated = readFileSync(filePath, 'utf-8');

      // Other lines should be untouched
      expect(updated).toContain("import { test, expect } from '@playwright/test'");
      expect(updated).toContain("page.goto('https://example.com')");
      expect(updated).toContain("page.getByText('Done')");
      expect(updated).toContain("console.log('test completed')");
    });

    it('should handle chained locators', async () => {
      const source = `import { test } from '@playwright/test';

test('example', async ({ page }) => {
  await page.locator('.container').locator('#old-item').click();
});
`;
      const filePath = writeTestFile('test4.spec.ts', source);

      const modification: CodeModification = {
        filePath,
        line: 4,
        column: 8,
        originalCode: "page.locator('.container').locator('#old-item')",
        modifiedCode: "page.locator('.container').locator('#new-item')",
        healingEvent: createMockHealingEvent(),
      };

      await modifier.modifyLocator(modification);

      const { readFileSync } = await import('fs');
      const updated = readFileSync(filePath, 'utf-8');
      expect(updated).toContain("page.locator('.container').locator('#new-item')");
    });
  });

  describe('generateDiff', () => {
    it('should produce a valid unified-diff-style string', () => {
      const modification: CodeModification = {
        filePath: 'tests/login.spec.ts',
        line: 10,
        column: 8,
        originalCode: "page.locator('#old-btn')",
        modifiedCode: "page.locator('#new-btn')",
        healingEvent: createMockHealingEvent(),
      };

      const diff = modifier.generateDiff(modification);

      expect(diff).toContain('--- a/tests/login.spec.ts');
      expect(diff).toContain('+++ b/tests/login.spec.ts');
      expect(diff).toContain('@@ -10,1 +10,1 @@');
      expect(diff).toContain("- page.locator('#old-btn')");
      expect(diff).toContain("+ page.locator('#new-btn')");
    });

    it('should include correct line numbers for different positions', () => {
      const modification: CodeModification = {
        filePath: 'tests/dashboard.spec.ts',
        line: 25,
        column: 4,
        originalCode: "page.getByText('Revenue')",
        modifiedCode: "page.getByTestId('revenue-heading')",
        healingEvent: createMockHealingEvent(),
      };

      const diff = modifier.generateDiff(modification);

      expect(diff).toContain('@@ -25,1 +25,1 @@');
      expect(diff).toContain("- page.getByText('Revenue')");
      expect(diff).toContain("+ page.getByTestId('revenue-heading')");
    });
  });

  describe('applyAllModifications', () => {
    it('should apply multiple modifications to the same file bottom-to-top', async () => {
      const source = `import { test } from '@playwright/test';

test('example', async ({ page }) => {
  await page.locator('#first').click();
  await page.locator('#second').click();
  await page.locator('#third').click();
});
`;
      const filePath = writeTestFile('test-multi.spec.ts', source);

      const modifications: CodeModification[] = [
        {
          filePath,
          line: 4,
          column: 8,
          originalCode: "page.locator('#first')",
          modifiedCode: "page.locator('#first-new')",
          healingEvent: createMockHealingEvent(),
        },
        {
          filePath,
          line: 6,
          column: 8,
          originalCode: "page.locator('#third')",
          modifiedCode: "page.locator('#third-new')",
          healingEvent: createMockHealingEvent(),
        },
      ];

      await modifier.applyAllModifications(modifications);

      const { readFileSync } = await import('fs');
      const updated = readFileSync(filePath, 'utf-8');

      expect(updated).toContain("page.locator('#first-new')");
      expect(updated).toContain("page.locator('#second')"); // Unchanged
      expect(updated).toContain("page.locator('#third-new')");
    });

    it('should handle empty modifications array', async () => {
      await modifier.applyAllModifications([]);
      // Should not throw
    });
  });
});
