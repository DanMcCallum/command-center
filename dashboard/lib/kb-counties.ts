/**
 * Counties the knowledge base has actually sold in, used as the grounded
 * option set for the county judgment in location.ts.
 *
 * The point of sourcing these from disk rather than hardcoding a county
 * database: the model can only pick a value that is offered, so offering the
 * counties we have real sold ads and area sheets for keeps it from inventing
 * one. Everything else comes back as not_in_list, which is a question for the
 * operator rather than a guess.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Reads `location:` from every sold ad and `area:` from every area sheet,
 * and returns the distinct "<X> County, <ST>" strings among them.
 */
export async function loadCountyCandidates(projectRoot: string): Promise<string[]> {
  const found = new Set<string>();
  const adsDir = path.join(projectRoot, 'knowledge-base', 'ads');
  const areasDir = path.join(projectRoot, 'knowledge-base', 'ebay', 'areas');

  for (const line of await frontmatterLines(adsDir, /^location:\s*(.+?)\s*$/)) {
    const value = unquote(line);
    if (/county/i.test(value)) found.add(value);
  }
  for (const line of await frontmatterLines(areasDir, /^area:\s*(.+?)\s*$/)) {
    // "Montello, Elko County, Nevada" -> "Elko County, Nevada"
    const parts = unquote(line).split(',').map(p => p.trim());
    const at = parts.findIndex(p => /county$/i.test(p));
    if (at !== -1) found.add(parts.slice(at).join(', '));
  }
  return [...found].sort();
}

async function frontmatterLines(dir: string, pattern: RegExp): Promise<string[]> {
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter(f => f.endsWith('.md'));
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    const text = await fs.readFile(path.join(dir, name), 'utf-8');
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) continue;
    for (const line of fm[1].split(/\r?\n/)) {
      const m = line.match(pattern);
      if (m) out.push(m[1]);
    }
  }
  return out;
}

function unquote(value: string): string {
  return value.replace(/^(["'])([\s\S]*)\1$/, '$2').trim();
}
