import { promises as fs } from 'node:fs';
import path from 'node:path';

const root = process.cwd().endsWith('backend') ? path.resolve('..') : process.cwd();
const selectorFile = path.join(root, 'selectors', 'selectors.json');
export interface SelectorRecord { name: string; selector: string; url?: string; createdAt: string }

export async function saveSelector(record: Omit<SelectorRecord, 'createdAt'>) {
  await fs.mkdir(path.dirname(selectorFile), { recursive: true });
  const existing = await listSelectors();
  const next = [...existing.filter((item) => item.name !== record.name), { ...record, createdAt: new Date().toISOString() }];
  await fs.writeFile(selectorFile, JSON.stringify(next, null, 2));
  return next.at(-1);
}
export async function listSelectors(): Promise<SelectorRecord[]> {
  try { return JSON.parse(await fs.readFile(selectorFile, 'utf8')) as SelectorRecord[]; } catch { return []; }
}
