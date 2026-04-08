import { Project, SyntaxKind, CallExpression } from 'ts-morph';
import type { CodeModification, HealingEvent } from '../types/index';
import { logger } from '../utils/logger';

/**
 * AST-based source code modifier that updates Playwright locators in test files.
 * Uses ts-morph to parse and manipulate TypeScript ASTs so that only the target
 * locator expression is replaced while surrounding code is fully preserved.
 */
export class CodeModifier {
  private readonly project: Project;

  constructor() {
    this.project = new Project({
      compilerOptions: { strict: true },
      useInMemoryFileSystem: false,
    });
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Modify a single locator in the source file described by `modification`.
   */
  public async modifyLocator(modification: CodeModification): Promise<void> {
    const { filePath, line, originalCode, modifiedCode } = modification;

    logger.info(`Modifying locator in ${filePath}:${line}`);
    logger.debug('Original locator', originalCode);
    logger.debug('New locator', modifiedCode);

    try {
      const sourceFile = this.getOrAddSourceFile(filePath);
      const text = sourceFile.getFullText();

      // Strategy 1: Try AST-based replacement for known Playwright patterns.
      const replaced = this.tryASTReplace(text, line, originalCode, modifiedCode);

      if (replaced !== null) {
        sourceFile.replaceWithText(replaced);
      } else {
        // Strategy 2: Fall back to direct text replacement scoped to the target line.
        const lineReplaced = this.replaceAtLine(text, line, originalCode, modifiedCode);
        sourceFile.replaceWithText(lineReplaced);
      }

      await sourceFile.save();
      logger.info(`Locator updated in ${filePath}:${line}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[MindHeal] Failed to modify locator in ${filePath}:${line}: ${message}`);
      throw new Error(`[MindHeal] Failed to modify locator in ${filePath}:${line}: ${message}`);
    }
  }

  /**
   * Generate a human-readable unified-diff-style string for a single modification.
   */
  public generateDiff(modification: CodeModification): string {
    const { filePath, line, originalCode, modifiedCode } = modification;
    const header = `--- a/${filePath}\n+++ b/${filePath}`;
    const hunk = `@@ -${line},1 +${line},1 @@`;
    const removal = `- ${originalCode}`;
    const addition = `+ ${modifiedCode}`;

    return [header, hunk, removal, addition].join('\n');
  }

  /**
   * Apply multiple modifications, grouping them by file to minimize I/O.
   * Modifications within the same file are applied from bottom to top
   * (descending line number) so that earlier line numbers stay valid.
   */
  public async applyAllModifications(modifications: CodeModification[]): Promise<void> {
    if (modifications.length === 0) {
      logger.warn('[MindHeal] No modifications to apply');
      return;
    }

    // Group by file path.
    const grouped = new Map<string, CodeModification[]>();
    for (const mod of modifications) {
      const existing = grouped.get(mod.filePath) ?? [];
      existing.push(mod);
      grouped.set(mod.filePath, existing);
    }

    logger.info(
      `Applying ${modifications.length} modification(s) across ${grouped.size} file(s)`,
    );

    for (const [filePath, fileMods] of grouped) {
      // Sort descending by line so replacements don't shift earlier positions.
      const sorted = [...fileMods].sort((a, b) => b.line - a.line);

      for (const mod of sorted) {
        try {
          await this.modifyLocator(mod);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(
            `[MindHeal] Skipping failed modification in ${filePath}:${mod.line}: ${message}`,
          );
          // Continue with remaining modifications in the same file.
        }
      }
    }

    logger.info('All modifications applied');
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Add (or retrieve) a ts-morph SourceFile for the given path.
   */
  private getOrAddSourceFile(filePath: string) {
    const existing = this.project.getSourceFile(filePath);
    if (existing) {
      // Refresh from disk in case a prior modification changed it.
      existing.refreshFromFileSystemSync();
      return existing;
    }
    return this.project.addSourceFileAtPath(filePath);
  }

  /**
   * Attempt to locate the original locator expression in the AST at the given
   * line and replace it.  Returns the new full text on success or `null` if the
   * expression could not be found via AST traversal.
   *
   * Supports Playwright patterns:
   *   page.locator('selector')
   *   page.getByRole('role', { name: 'value' })
   *   page.getByText('text')
   *   page.getByTestId('id')
   *   Chained: page.locator('parent').locator('child')
   */
  private tryASTReplace(
    fullText: string,
    targetLine: number,
    originalCode: string,
    modifiedCode: string,
  ): string | null {
    // Create a temporary in-memory source for AST analysis without side-effects.
    const tempFile = this.project.createSourceFile('__temp_analysis__.ts', fullText, {
      overwrite: true,
    });

    try {
      const calls = tempFile.getDescendantsOfKind(SyntaxKind.CallExpression);

      for (const call of calls) {
        const startLine = call.getStartLineNumber();
        if (startLine !== targetLine) continue;

        const callText = call.getText();

        // Check if this call (or its ancestor chain) matches the original code.
        if (this.normalizeWhitespace(callText) === this.normalizeWhitespace(originalCode)) {
          const start = call.getStart();
          const end = call.getEnd();
          return fullText.substring(0, start) + modifiedCode + fullText.substring(end);
        }

        // The original code might be a parent expression that contains this call
        // (e.g., chained locators).  Walk upward.
        let ancestor = call.getParent();
        while (ancestor) {
          if (
            ancestor.getStartLineNumber() === targetLine &&
            this.normalizeWhitespace(ancestor.getText()) ===
              this.normalizeWhitespace(originalCode)
          ) {
            const start = ancestor.getStart();
            const end = ancestor.getEnd();
            return fullText.substring(0, start) + modifiedCode + fullText.substring(end);
          }
          ancestor = ancestor.getParent();
        }
      }

      return null;
    } finally {
      this.project.removeSourceFile(tempFile);
    }
  }

  /**
   * Fallback: perform a direct string replacement on the specific line of `fullText`.
   * Only the first occurrence on the target line is replaced to avoid unintended changes.
   */
  private replaceAtLine(
    fullText: string,
    targetLine: number,
    originalCode: string,
    modifiedCode: string,
  ): string {
    const lines = fullText.split('\n');
    const lineIndex = targetLine - 1; // lines are 1-based

    if (lineIndex < 0 || lineIndex >= lines.length) {
      throw new Error(
        `[MindHeal] Line ${targetLine} is out of range (file has ${lines.length} lines)`,
      );
    }

    const lineText = lines[lineIndex];
    if (!lineText.includes(originalCode)) {
      throw new Error(
        `[MindHeal] Original locator not found on line ${targetLine}. ` +
          `Expected to find: ${originalCode}`,
      );
    }

    lines[lineIndex] = lineText.replace(originalCode, modifiedCode);
    return lines.join('\n');
  }

  /**
   * Collapse all whitespace to single spaces for comparison purposes.
   */
  private normalizeWhitespace(str: string): string {
    return str.replace(/\s+/g, ' ').trim();
  }
}
