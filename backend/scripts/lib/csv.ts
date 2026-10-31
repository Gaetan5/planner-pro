import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';

/**
 * Sérialisation CSV des rapports de reprise (S28). Toutes les cellules sont entre guillemets ;
 * une cellule commençant par = + - @ est préfixée d'une apostrophe pour neutraliser les formules
 * (les e-mails des comptes compromis peuvent être choisis par un attaquant).
 */
function escapeCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.join(','), ...rows.map((row) => row.map(escapeCell).join(','))];
  return `${lines.join('\n')}\n`;
}

/**
 * Écrit le rapport CSV (droits 600 : il contient des adresses e-mail) et renvoie son chemin.
 */
export function writeCsvReport(path: string, headers: string[], rows: unknown[][]): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, toCsv(headers, rows), { mode: 0o600 });
  return path;
}

export function defaultReportPath(scriptName: string, apply: boolean): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `reprise-phase0/${scriptName}-${apply ? 'apply' : 'rapport'}-${stamp}.csv`;
}

export function parseArgs(argv: string[]): { apply: boolean; csvPath?: string } {
  const csvArg = argv.find((arg) => arg.startsWith('--csv='));
  return { apply: argv.includes('--apply'), csvPath: csvArg?.slice('--csv='.length) };
}
