import { promises as fs } from 'node:fs';
import path from 'node:path';

export type LogLevel = 'info' | 'warn' | 'error';
export interface LogEntry { timestamp: string; level: LogLevel; message: string; meta?: unknown }

const root = process.cwd().endsWith('backend') ? path.resolve('..') : process.cwd();
const logDir = path.join(root, 'logs');
const logFile = path.join(logDir, 'app.log');
const entries: LogEntry[] = [];

export function maskSensitive(input: string): string {
  return input
    .replace(/(password\s*(?:is|=|:)\s*)([^\s,.]+)/gi, '$1********')
    .replace(/(pass\s*(?:is|=|:)\s*)([^\s,.]+)/gi, '$1********')
    .replace(/(token|api[_-]?key|secret)(\s*[=:]\s*)([^\s]+)/gi, '$1$2********');
}

export async function log(level: LogLevel, message: string, meta?: unknown) {
  const entry: LogEntry = { timestamp: new Date().toISOString(), level, message: maskSensitive(message), meta };
  entries.push(entry);
  if (entries.length > 500) entries.shift();
  await fs.mkdir(logDir, { recursive: true });
  await fs.appendFile(logFile, `${JSON.stringify(entry)}\n`, 'utf8');
}

export function getLogs() { return entries.slice().reverse(); }
