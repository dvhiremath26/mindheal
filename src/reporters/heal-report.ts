import type { HealReport, HealingEvent, HealingStrategyName } from '../types/index';
import { writeFileContent, ensureDirectory } from '../utils/file-utils';
import { logger } from '../utils/logger';
import { resolve } from 'path';

/**
 * Generates HTML and JSON healing reports summarizing all healing events
 * from a test run.
 */
export class HealReportGenerator {
  /**
   * Serialize a HealReport to a formatted JSON string.
   */
  public generateJSON(report: HealReport): string {
    return JSON.stringify(report, null, 2);
  }

  /**
   * Generate a self-contained HTML report with inline styles.
   */
  public generateHTML(report: HealReport): string {
    const stats = this.computeStats(report);
    const strategyBreakdown = this.computeStrategyBreakdown(report.events);
    const maxStrategyCount = Math.max(...Object.values(strategyBreakdown), 1);

    const eventsRows = report.events
      .map((event) => this.renderEventRow(event))
      .join('\n');

    const strategyBars = Object.entries(strategyBreakdown)
      .sort(([, a], [, b]) => b - a)
      .map(
        ([strategy, count]) =>
          `<div style="display:flex;align-items:center;margin-bottom:6px;">
            <span style="width:90px;font-size:13px;color:#475569;">${this.escapeHTML(strategy)}</span>
            <div style="flex:1;background:#e2e8f0;border-radius:4px;height:22px;overflow:hidden;">
              <div style="width:${(count / maxStrategyCount) * 100}%;background:${this.strategyColor(strategy as HealingStrategyName)};height:100%;border-radius:4px;transition:width .3s;"></div>
            </div>
            <span style="width:40px;text-align:right;font-size:13px;font-weight:600;color:#334155;">${count}</span>
          </div>`,
      )
      .join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MindHeal Report</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background:#f8fafc;color:#1e293b;line-height:1.6;padding:24px}
  .container{max-width:1200px;margin:0 auto}
  h1{font-size:28px;font-weight:700;margin-bottom:4px}
  .subtitle{color:#64748b;font-size:14px;margin-bottom:32px}
  .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:32px}
  .stat-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;text-align:center}
  .stat-value{font-size:32px;font-weight:700}
  .stat-label{font-size:13px;color:#64748b;margin-top:4px}
  .stat-healed .stat-value{color:#16a34a}
  .stat-failed .stat-value{color:#dc2626}
  .stat-total .stat-value{color:#2563eb}
  .stat-rate .stat-value{color:#7c3aed}
  .section{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin-bottom:24px}
  .section-title{font-size:18px;font-weight:600;margin-bottom:16px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{background:#f1f5f9;text-align:left;padding:10px 12px;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0}
  td{padding:10px 12px;border-bottom:1px solid #f1f5f9;vertical-align:top}
  tr:hover td{background:#f8fafc}
  .badge{display:inline-block;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;text-transform:uppercase}
  .badge-healed{background:#dcfce7;color:#166534}
  .badge-failed{background:#fee2e2;color:#991b1b}
  .confidence-bar{display:inline-block;width:60px;height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden;vertical-align:middle;margin-right:6px}
  .confidence-fill{height:100%;border-radius:4px}
  .locator-code{font-family:'SF Mono',SFMono-Regular,Consolas,'Liberation Mono',Menlo,monospace;font-size:12px;background:#f1f5f9;padding:3px 6px;border-radius:4px;word-break:break-all;display:inline-block;max-width:280px}
  .timing{color:#64748b;font-size:12px}
  @media print{body{background:#fff;padding:0}.stat-card,.section{break-inside:avoid}}
  @media(max-width:768px){.stats-grid{grid-template-columns:1fr 1fr}table{font-size:12px}td,th{padding:8px 6px}}
</style>
</head>
<body>
<div class="container">
  <h1>MindHeal Healing Report</h1>
  <p class="subtitle">
    Session <strong>${this.escapeHTML(report.sessionId)}</strong> &mdash;
    ${this.formatDate(report.startTime)} to ${this.formatDate(report.endTime)}
    (${this.formatDuration(report.endTime - report.startTime)})
  </p>

  <div class="stats-grid">
    <div class="stat-card stat-total">
      <div class="stat-value">${stats.totalHeals}</div>
      <div class="stat-label">Total Healing Attempts</div>
    </div>
    <div class="stat-card stat-healed">
      <div class="stat-value">${stats.successfulHeals}</div>
      <div class="stat-label">Successfully Healed</div>
    </div>
    <div class="stat-card stat-failed">
      <div class="stat-value">${stats.failedHeals}</div>
      <div class="stat-label">Failed</div>
    </div>
    <div class="stat-card stat-rate">
      <div class="stat-value">${stats.successRate}%</div>
      <div class="stat-label">Success Rate</div>
    </div>
  </div>

  ${
    Object.keys(strategyBreakdown).length > 0
      ? `<div class="section">
    <div class="section-title">Strategy Breakdown</div>
    ${strategyBars}
  </div>`
      : ''
  }

  <div class="section">
    <div class="section-title">Healing Events (${report.events.length})</div>
    ${
      report.events.length > 0
        ? `<div style="overflow-x:auto;">
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Test</th>
            <th>Action</th>
            <th>Original Locator</th>
            <th>Healed Locator</th>
            <th>Strategy</th>
            <th>Confidence</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          ${eventsRows}
        </tbody>
      </table>
    </div>`
        : '<p style="color:#94a3b8;text-align:center;padding:32px 0;">No healing events recorded.</p>'
    }
  </div>

  <p style="text-align:center;color:#94a3b8;font-size:12px;margin-top:16px;">
    Generated by MindHeal &mdash; ${this.formatDate(Date.now())}
  </p>
</div>
</body>
</html>`;
  }

  /**
   * Persist the report to disk in JSON and/or HTML format.
   */
  public async saveReport(
    report: HealReport,
    outputDir: string,
    generateHTML: boolean,
    generateJSON: boolean,
  ): Promise<void> {
    ensureDirectory(outputDir);

    const timestamp = new Date(report.startTime)
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .slice(0, 19);

    if (generateJSON) {
      const jsonPath = resolve(outputDir, `heal-report-${timestamp}.json`);
      try {
        const jsonContent = this.generateJSON(report);
        writeFileContent(jsonPath, jsonContent);
        logger.info(`JSON report saved to ${jsonPath}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to save JSON report: ${message}`);
      }
    }

    if (generateHTML) {
      const htmlPath = resolve(outputDir, `heal-report-${timestamp}.html`);
      try {
        const htmlContent = this.generateHTML(report);
        writeFileContent(htmlPath, htmlContent);
        logger.info(`HTML report saved to ${htmlPath}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to save HTML report: ${message}`);
      }
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private computeStats(report: HealReport) {
    const totalHeals = report.totalHeals;
    const successfulHeals = report.successfulHeals;
    const failedHeals = report.failedHeals;
    const successRate =
      totalHeals > 0 ? Math.round((successfulHeals / totalHeals) * 100) : 0;

    return { totalHeals, successfulHeals, failedHeals, successRate };
  }

  private computeStrategyBreakdown(
    events: HealingEvent[],
  ): Record<string, number> {
    const breakdown: Record<string, number> = {};
    for (const event of events) {
      if (event.strategy) {
        breakdown[event.strategy] = (breakdown[event.strategy] ?? 0) + 1;
      }
    }
    return breakdown;
  }

  private renderEventRow(event: HealingEvent): string {
    const statusBadge =
      event.status === 'healed'
        ? '<span class="badge badge-healed">Healed</span>'
        : '<span class="badge badge-failed">Failed</span>';

    const confidencePercent = Math.round(event.confidence * 100);
    const confidenceColor = this.confidenceColor(event.confidence);

    const healedLocatorDisplay = event.healedLocator
      ? `<span class="locator-code">${this.escapeHTML(event.healedLocator.playwrightExpression)}</span>`
      : '<span style="color:#94a3b8;">N/A</span>';

    const sourceInfo = event.sourceLocation
      ? `${this.escapeHTML(this.shortenPath(event.sourceLocation.filePath))}:${event.sourceLocation.line}`
      : this.escapeHTML(event.testFile || 'unknown');

    return `<tr>
      <td>${statusBadge}</td>
      <td>
        <div style="font-weight:500;">${this.escapeHTML(event.testTitle || 'Unnamed test')}</div>
        <div class="timing">${this.escapeHTML(sourceInfo)}</div>
      </td>
      <td>${this.escapeHTML(event.action)}</td>
      <td><span class="locator-code">${this.escapeHTML(event.originalLocator.playwrightExpression)}</span></td>
      <td>${healedLocatorDisplay}</td>
      <td>${event.strategy ? this.escapeHTML(event.strategy) : '<span style="color:#94a3b8;">N/A</span>'}</td>
      <td>
        <div class="confidence-bar"><div class="confidence-fill" style="width:${confidencePercent}%;background:${confidenceColor};"></div></div>
        <span style="font-size:12px;font-weight:600;color:${confidenceColor};">${confidencePercent}%</span>
      </td>
      <td class="timing">${event.duration}ms</td>
    </tr>`;
  }

  private confidenceColor(confidence: number): string {
    if (confidence >= 0.8) return '#16a34a';
    if (confidence >= 0.5) return '#ca8a04';
    return '#dc2626';
  }

  private strategyColor(strategy: HealingStrategyName): string {
    const colors: Record<string, string> = {
      cache: '#6366f1',
      attribute: '#2563eb',
      text: '#0891b2',
      role: '#059669',
      css: '#ca8a04',
      xpath: '#ea580c',
      ai: '#7c3aed',
    };
    return colors[strategy] ?? '#64748b';
  }

  private escapeHTML(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }

  private shortenPath(filePath: string): string {
    const parts = filePath.replace(/\\/g, '/').split('/');
    if (parts.length <= 3) return parts.join('/');
    return `.../${parts.slice(-3).join('/')}`;
  }
}
