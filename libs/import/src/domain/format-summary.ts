import type { ImportSummary } from './types.js';

/** A short human summary for the terminal and the job log. */
export function formatSummary(summary: ImportSummary): string {
  const lines = [
    `Import ${summary.status} (${summary.file})`,
    `  rows read ${summary.rowsRead}, valid products ${summary.valid}`,
    `  created ${summary.created}, updated ${summary.updated}, unchanged ${summary.unchanged}`,
    `  rejected ${summary.rejected}, duplicates ${summary.duplicates}, marked missing ${summary.markedMissing}`,
  ];
  if (summary.message) {
    lines.push(`  ${summary.message}`);
  }
  if (summary.issues.length > 0) {
    lines.push(`Issues (${summary.issues.length}):`);
    for (const issue of summary.issues) {
      const sku = issue.sku ? ` ${issue.sku}` : '';
      lines.push(`  line ${issue.line}${sku} [${issue.level}] ${issue.message}`);
    }
  }
  return lines.join('\n');
}
