import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitOperations } from '../../src/git/git-operations';
import { CodeModifier } from '../../src/git/code-modifier';
import { PRCreator } from '../../src/git/pr-creator';
import type { GitConfig, PRDetails, CodeModification, HealingEvent } from '../../src/types/index';

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('simple-git', () => {
  const mockGit = {
    checkoutLocalBranch: vi.fn().mockResolvedValue(undefined),
    checkout: vi.fn().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(undefined),
    branchLocal: vi.fn().mockResolvedValue({ current: 'main' }),
    stash: vi.fn().mockResolvedValue(undefined),
  };
  return { default: vi.fn(() => mockGit) };
});

vi.mock('../../src/utils/environment', () => ({
  isCI: vi.fn().mockReturnValue(false),
  getRepoInfo: vi.fn().mockReturnValue({ owner: 'test-owner', name: 'test-repo' }),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function createGitConfig(overrides?: Partial<GitConfig>): GitConfig {
  return {
    enabled: true,
    provider: 'github',
    token: 'ghp_test_token',
    baseBranch: 'main',
    branchPrefix: 'mindheal/auto-fix',
    autoCreatePR: true,
    commitMessagePrefix: 'fix(locators):',
    prLabels: ['auto-heal', 'mindheal'],
    prReviewers: ['reviewer1'],
    repoOwner: 'test-owner',
    repoName: 'test-repo',
    ...overrides,
  };
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
      type: 'testid',
      selector: 'login-button',
      playwrightExpression: "page.getByTestId('login-button')",
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

describe('GitOperations', () => {
  describe('generateBranchName', () => {
    it('should use configured prefix', () => {
      const gitOps = new GitOperations(createGitConfig());
      const branchName = gitOps.generateBranchName();

      expect(branchName).toMatch(/^mindheal\/auto-fix-\d{8}-\d{6}$/);
    });

    it('should use custom prefix when configured', () => {
      const gitOps = new GitOperations(createGitConfig({ branchPrefix: 'fix/healed' }));
      const branchName = gitOps.generateBranchName();

      expect(branchName).toMatch(/^fix\/healed-\d{8}-\d{6}$/);
    });

    it('should generate unique branch names for different timestamps', () => {
      const gitOps = new GitOperations(createGitConfig());
      const name1 = gitOps.generateBranchName();

      // Advance time slightly
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 1000);
      const name2 = gitOps.generateBranchName();
      vi.useRealTimers();

      // They should be different due to timestamp
      expect(name1).not.toBe(name2);
    });

    it('should include date in YYYYMMDD format', () => {
      const gitOps = new GitOperations(createGitConfig());
      const branchName = gitOps.generateBranchName();

      // Extract the date portion and verify it matches today's date format
      const dateMatch = branchName.match(/(\d{8})/);
      expect(dateMatch).not.toBeNull();
      const dateStr = dateMatch![1];
      const year = parseInt(dateStr.substring(0, 4));
      const month = parseInt(dateStr.substring(4, 6));
      const day = parseInt(dateStr.substring(6, 8));

      expect(year).toBeGreaterThan(2020);
      expect(month).toBeGreaterThanOrEqual(1);
      expect(month).toBeLessThanOrEqual(12);
      expect(day).toBeGreaterThanOrEqual(1);
      expect(day).toBeLessThanOrEqual(31);
    });
  });
});

describe('CodeModifier diff generation', () => {
  it('should generate proper unified diff format', () => {
    const modifier = new CodeModifier();

    const modification: CodeModification = {
      filePath: 'tests/e2e/login.spec.ts',
      line: 8,
      column: 6,
      originalCode: "page.locator('#username')",
      modifiedCode: "page.getByTestId('username-input')",
      healingEvent: createMockHealingEvent(),
    };

    const diff = modifier.generateDiff(modification);

    expect(diff).toContain('--- a/tests/e2e/login.spec.ts');
    expect(diff).toContain('+++ b/tests/e2e/login.spec.ts');
    expect(diff).toContain('@@ -8,1 +8,1 @@');
    expect(diff).toContain("- page.locator('#username')");
    expect(diff).toContain("+ page.getByTestId('username-input')");
  });

  it('should generate diffs for multiple modifications', () => {
    const modifier = new CodeModifier();

    const modifications: CodeModification[] = [
      {
        filePath: 'tests/login.spec.ts',
        line: 5,
        column: 8,
        originalCode: "page.locator('#username')",
        modifiedCode: "page.getByTestId('username-input')",
        healingEvent: createMockHealingEvent(),
      },
      {
        filePath: 'tests/login.spec.ts',
        line: 6,
        column: 8,
        originalCode: "page.locator('#password')",
        modifiedCode: "page.getByTestId('password-input')",
        healingEvent: createMockHealingEvent(),
      },
    ];

    const diffs = modifications.map((m) => modifier.generateDiff(m));

    expect(diffs).toHaveLength(2);
    expect(diffs[0]).toContain('@@ -5,1 +5,1 @@');
    expect(diffs[1]).toContain('@@ -6,1 +6,1 @@');
  });
});

describe('PRCreator', () => {
  describe('PR body formatting', () => {
    it('should format PR body with MindHeal header and footer', async () => {
      // Mock fetch globally for this test
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          html_url: 'https://github.com/test-owner/test-repo/pull/42',
          number: 42,
        }),
      };
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

      const creator = new PRCreator(createGitConfig());

      const prDetails: PRDetails = {
        title: 'fix(locators): Auto-heal broken selectors in login.spec.ts',
        body: '### Changes\n- Updated `#username` to `[data-testid="username-input"]`\n- Updated `#password` to `[data-testid="password-input"]`',
        sourceBranch: 'mindheal/auto-fix-20240101-120000',
        targetBranch: 'main',
        labels: ['auto-heal', 'mindheal'],
        reviewers: ['reviewer1'],
      };

      const result = await creator.createPR(prDetails);

      expect(result.url).toBe('https://github.com/test-owner/test-repo/pull/42');
      expect(result.number).toBe(42);
      expect(result.provider).toBe('github');

      // Verify the body sent to the API contains MindHeal branding
      const fetchCall = fetchSpy.mock.calls[0];
      const sentBody = JSON.parse(fetchCall[1]!.body as string);
      expect(sentBody.body).toContain('MindHeal');
      expect(sentBody.body).toContain('Automated Locator Fix');
      expect(sentBody.title).toBe(prDetails.title);
      expect(sentBody.head).toBe(prDetails.sourceBranch);
      expect(sentBody.base).toBe(prDetails.targetBranch);

      fetchSpy.mockRestore();
    });

    it('should handle GitHub API errors gracefully', async () => {
      const mockResponse = {
        ok: false,
        status: 422,
        json: vi.fn().mockResolvedValue({
          message: 'Validation Failed',
          errors: [{ message: 'A pull request already exists' }],
        }),
      };
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

      const creator = new PRCreator(createGitConfig());

      const prDetails: PRDetails = {
        title: 'fix(locators): duplicate PR',
        body: 'Test body',
        sourceBranch: 'mindheal/auto-fix-20240101-120000',
        targetBranch: 'main',
        labels: [],
        reviewers: [],
      };

      await expect(creator.createPR(prDetails)).rejects.toThrow(/GitHub PR creation failed/);

      fetchSpy.mockRestore();
    });

    it('should handle network errors', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

      const creator = new PRCreator(createGitConfig());

      const prDetails: PRDetails = {
        title: 'fix(locators): test',
        body: 'Test body',
        sourceBranch: 'mindheal/test',
        targetBranch: 'main',
        labels: [],
        reviewers: [],
      };

      await expect(creator.createPR(prDetails)).rejects.toThrow(/HTTP request.*failed/);

      fetchSpy.mockRestore();
    });
  });

  describe('provider-specific PR creation', () => {
    it('should use GitHub API endpoint for github provider', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ html_url: 'https://github.com/o/r/pull/1', number: 1 }),
      };
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

      const creator = new PRCreator(createGitConfig({ provider: 'github' }));

      await creator.createPR({
        title: 'test',
        body: 'body',
        sourceBranch: 'fix',
        targetBranch: 'main',
        labels: [],
        reviewers: [],
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('api.github.com'),
        expect.any(Object),
      );

      fetchSpy.mockRestore();
    });

    it('should use GitLab API endpoint for gitlab provider', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ web_url: 'https://gitlab.com/o/r/-/merge_requests/1', iid: 1 }),
      };
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

      const creator = new PRCreator(createGitConfig({ provider: 'gitlab' }));

      await creator.createPR({
        title: 'test',
        body: 'body',
        sourceBranch: 'fix',
        targetBranch: 'main',
        labels: [],
        reviewers: [],
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('gitlab.com/api/v4'),
        expect.any(Object),
      );

      fetchSpy.mockRestore();
    });

    it('should use Bitbucket API endpoint for bitbucket provider', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ links: { html: { href: 'https://bitbucket.org/o/r/pull/1' } }, id: 1 }),
      };
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

      const creator = new PRCreator(createGitConfig({ provider: 'bitbucket' }));

      await creator.createPR({
        title: 'test',
        body: 'body',
        sourceBranch: 'fix',
        targetBranch: 'main',
        labels: [],
        reviewers: [],
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('api.bitbucket.org'),
        expect.any(Object),
      );

      fetchSpy.mockRestore();
    });
  });
});
