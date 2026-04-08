import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult,
} from '@playwright/test/reporter';
import type {
  MindHealConfig,
  HealingEvent,
  HealReport,
  CodeModification,
} from '../types/index';
import { getAllHealingSessions } from '../core/interceptor';
import { HealReportGenerator } from './heal-report';
import { GitOperations } from '../git/git-operations';
import { PRCreator } from '../git/pr-creator';
import { CodeModifier } from '../git/code-modifier';
import { ReviewServer } from '../server/review-server';
import { loadConfig } from '../config/config-loader';
import { isCI } from '../utils/environment';
import { logger } from '../utils/logger';

/**
 * Custom Playwright reporter that hooks into the test lifecycle to collect
 * healing events, generate reports, and optionally create PRs or launch the
 * interactive review server.
 *
 * Usage in `playwright.config.ts`:
 * ```ts
 * reporter: [['mindheal/reporter', { ai: { provider: 'anthropic', apiKey: '...' } }]]
 * ```
 */
export default class HealReporter implements Reporter {
  private config: MindHealConfig;
  private startTime: number = 0;
  private totalTests: number = 0;
  private reportGenerator: HealReportGenerator;

  constructor(options: Partial<MindHealConfig> = {}) {
    this.config = loadConfig(options);
    this.reportGenerator = new HealReportGenerator();
  }

  /**
   * Called once before tests start running.
   */
  onBegin(config: FullConfig, suite: Suite): void {
    this.startTime = Date.now();
    this.totalTests = suite.allTests().length;

    logger.info(
      `MindHeal reporter initialized. Running ${this.totalTests} test(s) with healing ${this.config.healing.enabled ? 'enabled' : 'disabled'}.`,
    );
  }

  /**
   * Called after each test finishes. Used to tag healing events with the
   * test title so the report is more informative.
   */
  onTestEnd(test: TestCase, result: TestResult): void {
    // Healing events are collected globally by the interceptor. We enrich
    // them with the test title here since the interceptor does not have
    // access to the TestCase object.
    const sessions = getAllHealingSessions();
    for (const session of sessions) {
      for (const event of session.events) {
        if (!event.testTitle && event.timestamp >= this.startTime) {
          event.testTitle = test.title;
          event.testFile = event.testFile || test.location.file;
        }
      }
    }
  }

  /**
   * Called once after all tests have completed. Drives report generation,
   * git operations, and the review server workflow.
   */
  async onEnd(result: FullResult): Promise<void> {
    const endTime = Date.now();

    // Collect all healing events from every session.
    const sessions = getAllHealingSessions();
    const allEvents: HealingEvent[] = [];
    for (const session of sessions) {
      allEvents.push(...session.events);
    }

    if (allEvents.length === 0) {
      logger.info('No healing events recorded during this run.');
      return;
    }

    const successfulHeals = allEvents.filter((e) => e.status === 'healed').length;
    const failedHeals = allEvents.filter((e) => e.status === 'failed').length;

    logger.info(
      `Healing summary: ${successfulHeals} healed, ${failedHeals} failed out of ${allEvents.length} total events.`,
    );

    // Build the report data structure.
    const report: HealReport = {
      sessionId: sessions[0]?.id ?? `report_${Date.now().toString(36)}`,
      startTime: this.startTime,
      endTime,
      totalTests: this.totalTests,
      totalHeals: allEvents.length,
      successfulHeals,
      failedHeals,
      events: allEvents,
      config: {
        healing: this.config.healing,
        reporting: this.config.reporting,
        git: { ...this.config.git, token: '***' },
        ai: { ...this.config.ai, apiKey: '***' },
      },
    };

    // Generate reports.
    const outputDir = this.config.reporting.outputDir ?? '.mindheal/reports';
    try {
      await this.reportGenerator.saveReport(
        report,
        outputDir,
        this.config.reporting.generateHTML,
        this.config.reporting.generateJSON,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to save report: ${message}`);
    }

    // Only process healed events for code modification.
    const healedEvents = allEvents.filter((e) => e.status === 'healed');
    if (healedEvents.length === 0) {
      logger.info('No successful heals to apply. Done.');
      return;
    }

    // Determine the workflow based on environment.
    if (isCI() && this.config.git.enabled) {
      await this.handleCIWorkflow(healedEvents);
    } else if (!isCI() && this.config.reviewServer.enabled) {
      await this.handleLocalWorkflow(healedEvents);
    } else {
      // Fallback: apply approved modifications directly (auto-approve all).
      logger.info(
        'Neither CI/git nor review server enabled. Auto-approving all healed locators.',
      );
      for (const event of healedEvents) {
        event.reviewStatus = 'approved';
      }
      await this.applyApprovedModifications(healedEvents);
    }

    logger.info('MindHeal reporter finished.');
  }

  // ── CI/CD workflow: branch + commit + PR ─────────────────────────────────────

  private async handleCIWorkflow(healedEvents: HealingEvent[]): Promise<void> {
    logger.info('CI environment detected with git enabled. Creating branch and PR...');

    const gitOps = new GitOperations(this.config.git);
    const prCreator = new PRCreator(this.config.git);
    const codeModifier = new CodeModifier();

    let originalBranch: string | undefined;

    try {
      // Remember the current branch so we can switch back on failure.
      originalBranch = await gitOps.getCurrentBranch();

      // Create a dedicated branch for the fixes.
      const branchName = gitOps.generateBranchName();
      await gitOps.createBranch(branchName);

      // Auto-approve all events in CI mode (no interactive review).
      for (const event of healedEvents) {
        event.reviewStatus = 'approved';
      }

      // Apply code modifications.
      const modifications = this.buildModifications(healedEvents);
      if (modifications.length === 0) {
        logger.warn('No source locations available for code modifications. Skipping PR.');
        await gitOps.switchBranch(originalBranch);
        return;
      }

      await codeModifier.applyAllModifications(modifications);

      // Commit and push.
      const modifiedFiles = [...new Set(modifications.map((m) => m.filePath))];
      await gitOps.commitChanges(
        modifiedFiles,
        `Fix ${modifications.length} broken locator(s) via auto-healing`,
      );
      await gitOps.pushBranch(branchName);

      // Create PR if configured.
      if (this.config.git.autoCreatePR && this.config.git.token) {
        const prBody = this.buildPRBody(modifications);
        const prResult = await prCreator.createPR({
          title: `[MindHeal] Fix ${modifications.length} broken locator(s)`,
          body: prBody,
          sourceBranch: branchName,
          targetBranch: this.config.git.baseBranch ?? 'main',
          labels: this.config.git.prLabels ?? ['auto-heal', 'mindheal'],
          reviewers: this.config.git.prReviewers ?? [],
        });

        logger.info(`Pull request created: ${prResult.url}`);
      }

      // Switch back to the original branch.
      await gitOps.switchBranch(originalBranch);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`CI workflow failed: ${message}`);

      // Best-effort: switch back to the original branch.
      if (originalBranch) {
        try {
          await gitOps.switchBranch(originalBranch);
        } catch {
          logger.warn('Failed to switch back to the original branch after CI workflow error.');
        }
      }
    }
  }

  // ── Local workflow: review server ────────────────────────────────────────────

  private async handleLocalWorkflow(healedEvents: HealingEvent[]): Promise<void> {
    logger.info('Local environment detected with review server enabled. Starting review server...');

    const reviewServerConfig =
      typeof this.config.reviewServer.enabled === 'boolean'
        ? this.config.reviewServer
        : { ...this.config.reviewServer, enabled: true as const };

    const server = new ReviewServer(
      reviewServerConfig as { enabled: boolean; port: number; openBrowser: boolean; autoCloseAfterReview: boolean },
      healedEvents,
    );

    try {
      await server.start();

      logger.info(
        `Review server running on port ${this.config.reviewServer.port}. Waiting for reviews...`,
      );

      // Block until all events have been reviewed.
      const reviewedEvents = await server.waitForReview();

      // Stop the server if it hasn't auto-closed.
      await server.stop();

      // Apply only approved modifications.
      const approved = reviewedEvents.filter((e) => e.reviewStatus === 'approved');
      if (approved.length > 0) {
        logger.info(`Applying ${approved.length} approved modification(s)...`);
        await this.applyApprovedModifications(approved);
      } else {
        logger.info('No modifications were approved.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Local review workflow failed: ${message}`);

      // Best-effort: stop the server.
      try {
        await server.stop();
      } catch {
        // Ignore stop errors during cleanup.
      }
    }
  }

  // ── Shared helpers ───────────────────────────────────────────────────────────

  /**
   * Apply approved code modifications using the AST-based CodeModifier.
   */
  private async applyApprovedModifications(
    approvedEvents: HealingEvent[],
  ): Promise<void> {
    const modifications = this.buildModifications(approvedEvents);
    if (modifications.length === 0) {
      logger.warn(
        'No source locations available for approved events. Cannot apply modifications.',
      );
      return;
    }

    const codeModifier = new CodeModifier();
    try {
      await codeModifier.applyAllModifications(modifications);
      logger.info(
        `Successfully applied ${modifications.length} code modification(s).`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to apply code modifications: ${message}`);
    }
  }

  /**
   * Convert healing events into CodeModification objects for the CodeModifier.
   * Events without source locations or healed locators are skipped.
   */
  private buildModifications(events: HealingEvent[]): CodeModification[] {
    const modifications: CodeModification[] = [];

    for (const event of events) {
      if (!event.sourceLocation || !event.healedLocator) {
        logger.debug(
          `Skipping event ${event.id}: missing source location or healed locator.`,
        );
        continue;
      }

      modifications.push({
        filePath: event.sourceLocation.filePath,
        line: event.sourceLocation.line,
        column: event.sourceLocation.column,
        originalCode: event.originalLocator.playwrightExpression,
        modifiedCode: event.healedLocator.playwrightExpression,
        healingEvent: event,
      });
    }

    return modifications;
  }

  /**
   * Build a markdown PR description summarizing all modifications.
   */
  private buildPRBody(modifications: CodeModification[]): string {
    const rows = modifications
      .map(
        (mod) =>
          `| \`${mod.filePath}:${mod.line}\` | \`${mod.originalCode}\` | \`${mod.modifiedCode}\` | ${Math.round(mod.healingEvent.confidence * 100)}% |`,
      )
      .join('\n');

    return [
      '### Summary',
      '',
      `This PR contains **${modifications.length}** auto-healed locator fix(es) generated by MindHeal.`,
      '',
      '### Changes',
      '',
      '| File | Original Locator | Healed Locator | Confidence |',
      '|------|-----------------|----------------|------------|',
      rows,
      '',
      '### How it works',
      '',
      'MindHeal intercepts failing Playwright locators at runtime, analyses the DOM,',
      'and suggests replacement selectors using configurable strategies (attribute,',
      'text, role, CSS, XPath, AI). Only changes that meet the confidence threshold',
      'are included in this PR.',
      '',
      'Please review each change carefully before merging.',
    ].join('\n');
  }
}
