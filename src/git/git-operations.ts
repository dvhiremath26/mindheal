import simpleGit, { SimpleGit } from 'simple-git';
import type { GitConfig } from '../types/index';
import { logger } from '../utils/logger';

export class GitOperations {
  private readonly git: SimpleGit;
  private readonly config: GitConfig;

  constructor(config: GitConfig) {
    this.config = config;
    this.git = simpleGit();
  }

  /**
   * Generate a branch name using the configured prefix and current timestamp.
   * Format: {prefix}-{YYYYMMDD}-{HHmmss}
   */
  public generateBranchName(): string {
    const prefix = this.config.branchPrefix ?? 'mindheal/auto-fix';
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    const timestamp = [
      now.getFullYear(),
      pad(now.getMonth() + 1),
      pad(now.getDate()),
      '-',
      pad(now.getHours()),
      pad(now.getMinutes()),
      pad(now.getSeconds()),
    ].join('');

    return `${prefix}-${timestamp}`;
  }

  /**
   * Create a new branch and check it out.
   */
  public async createBranch(branchName: string): Promise<void> {
    try {
      logger.info(`Creating and checking out branch: ${branchName}`);
      await this.git.checkoutLocalBranch(branchName);
      logger.info(`Branch created: ${branchName}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[MindHeal] Failed to create branch "${branchName}": ${message}`);
      throw new Error(`[MindHeal] Failed to create branch "${branchName}": ${message}`);
    }
  }

  /**
   * Stage specified files and create a commit.
   */
  public async commitChanges(files: string[], message: string): Promise<void> {
    if (files.length === 0) {
      logger.warn('[MindHeal] No files provided for commit, skipping');
      return;
    }

    try {
      const prefix = this.config.commitMessagePrefix ?? '[MindHeal]';
      const fullMessage = `${prefix} ${message}`;

      logger.info(`Staging ${files.length} file(s) for commit`);
      await this.git.add(files);

      logger.info(`Committing with message: ${fullMessage}`);
      await this.git.commit(fullMessage);
      logger.info('Commit successful');
    } catch (error) {
      const message_ = error instanceof Error ? error.message : String(error);
      logger.error(`[MindHeal] Failed to commit changes: ${message_}`);
      throw new Error(`[MindHeal] Failed to commit changes: ${message_}`);
    }
  }

  /**
   * Push a branch to the remote origin.
   */
  public async pushBranch(branchName: string): Promise<void> {
    try {
      logger.info(`Pushing branch "${branchName}" to origin`);
      await this.git.push('origin', branchName, ['--set-upstream']);
      logger.info(`Branch "${branchName}" pushed successfully`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[MindHeal] Failed to push branch "${branchName}": ${message}`);
      throw new Error(`[MindHeal] Failed to push branch "${branchName}": ${message}`);
    }
  }

  /**
   * Get the name of the currently checked-out branch.
   */
  public async getCurrentBranch(): Promise<string> {
    try {
      const branchSummary = await this.git.branchLocal();
      return branchSummary.current;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[MindHeal] Failed to get current branch: ${message}`);
      throw new Error(`[MindHeal] Failed to get current branch: ${message}`);
    }
  }

  /**
   * Switch to an existing branch.
   */
  public async switchBranch(branchName: string): Promise<void> {
    try {
      logger.info(`Switching to branch: ${branchName}`);
      await this.git.checkout(branchName);
      logger.info(`Switched to branch: ${branchName}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[MindHeal] Failed to switch to branch "${branchName}": ${message}`);
      throw new Error(`[MindHeal] Failed to switch to branch "${branchName}": ${message}`);
    }
  }

  /**
   * Stash all uncommitted changes (tracked and untracked).
   */
  public async stashChanges(): Promise<void> {
    try {
      logger.info('Stashing uncommitted changes');
      await this.git.stash(['push', '--include-untracked']);
      logger.info('Changes stashed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[MindHeal] Failed to stash changes: ${message}`);
      throw new Error(`[MindHeal] Failed to stash changes: ${message}`);
    }
  }

  /**
   * Pop the most recent stash entry.
   */
  public async popStash(): Promise<void> {
    try {
      logger.info('Popping stashed changes');
      await this.git.stash(['pop']);
      logger.info('Stash applied and dropped');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[MindHeal] Failed to pop stash: ${message}`);
      throw new Error(`[MindHeal] Failed to pop stash: ${message}`);
    }
  }
}
