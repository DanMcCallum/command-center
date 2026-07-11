/**
 * research-convert-cookies.ts — THROWAWAY research script (land-com-connect spike, US-007).
 *
 * Converts the operator's OT-B cookie export (Cookie-Editor JSON array, see
 * research/land-com-connect-spike/operator-input/README.md) into a Playwright
 * storageState file at workers/posting/auth/land_com.json (chmod 600).
 *
 * Usage:
 *   npx tsx research-convert-cookies.ts [input.json] [output.json]
 *
 * Defaults: input  ../../research/land-com-connect-spike/operator-input/land_com-cookies.json
 *           output ./auth/land_com.json
 *
 * NOT wired into any npm script or worker path. Never prints cookie VALUES —
 * only names, flags, and expiry timestamps. Delete the raw export after the
 * validation run succeeds (safety rule in the operator-input README).
 */

import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_INPUT = resolve(
  __dirname,
  '../../research/land-com-connect-spike/operator-input/land_com-cookies.json'
);
const DEFAULT_OUTPUT = resolve(__dirname, 'auth/land_com.json');

/** Cookie-Editor export entry (superset; extra fields are ignored). */
interface ExportedCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  expirationDate?: number; // float seconds since epoch; absent for session cookies
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string; // strict | lax | no_restriction | unspecified | Strict | ...
  session?: boolean;
  hostOnly?: boolean;
}

interface StorageStateCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number; // seconds since epoch, -1 for session cookies
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

function normalizeSameSite(raw: string | undefined): StorageStateCookie['sameSite'] {
  switch ((raw ?? '').toLowerCase()) {
    case 'strict':
      return 'Strict';
    case 'none':
    case 'no_restriction':
      return 'None';
    case 'lax':
    case 'unspecified':
    default:
      return 'Lax';
  }
}

function isLandComDomain(domain: string): boolean {
  const bare = domain.replace(/^\./, '');
  return bare === 'land.com' || bare.endsWith('.land.com');
}

function convert(exported: ExportedCookie[]): StorageStateCookie[] {
  return exported.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path ?? '/',
    expires:
      typeof c.expirationDate === 'number' && !c.session
        ? Math.floor(c.expirationDate)
        : -1,
    httpOnly: c.httpOnly ?? false,
    secure: c.secure ?? false,
    sameSite: normalizeSameSite(c.sameSite),
  }));
}

function main(): void {
  const inputPath = process.argv[2] ?? DEFAULT_INPUT;
  const outputPath = process.argv[3] ?? DEFAULT_OUTPUT;

  if (!existsSync(inputPath)) {
    console.error(`Input not found: ${inputPath}`);
    console.error(
      'OT-B has not landed. Export land.com cookies per ' +
        'research/land-com-connect-spike/operator-input/README.md first.'
    );
    process.exit(1);
  }

  const parsed: unknown = JSON.parse(readFileSync(inputPath, 'utf8'));
  // Cookie-Editor exports a raw array; some exporters wrap it as { cookies: [...] }.
  const raw = Array.isArray(parsed)
    ? (parsed as ExportedCookie[])
    : (parsed as { cookies?: ExportedCookie[] }).cookies;
  if (!Array.isArray(raw) || raw.length === 0) {
    console.error('Input is not a non-empty cookie array (or {cookies: [...]}).');
    process.exit(1);
  }

  const landCom = raw.filter((c) => isLandComDomain(c.domain));
  const dropped = raw.length - landCom.length;
  if (landCom.length === 0) {
    console.error('No land.com cookies in the export — wrong site or wrong file.');
    process.exit(1);
  }
  if (!landCom.some((c) => c.httpOnly)) {
    console.error(
      'No HttpOnly cookie in the export. The session cookies are HttpOnly, so this ' +
        'export was likely made without extension/DevTools privileges (e.g. a ' +
        'bookmarklet) and will NOT authenticate. Re-export per the README sanity check.'
    );
    process.exit(1);
  }

  const storageState = { cookies: convert(landCom), origins: [] as never[] };
  writeFileSync(outputPath, JSON.stringify(storageState, null, 2) + '\n', {
    mode: 0o600,
  });
  chmodSync(outputPath, 0o600); // in case the file pre-existed with wider perms

  console.log(`Wrote ${storageState.cookies.length} cookies -> ${outputPath} (chmod 600)`);
  if (dropped > 0) console.log(`Dropped ${dropped} non-land.com cookie(s) from the export.`);
  console.log('name / httpOnly / expiry (values never printed):');
  for (const c of storageState.cookies) {
    const expiry =
      c.expires === -1 ? 'session' : new Date(c.expires * 1000).toISOString();
    console.log(`  ${c.name} / ${c.httpOnly} / ${expiry}`);
  }
  console.log(
    'Next: validate from an UNBLOCKED egress (not this box), then delete the raw export.'
  );
}

main();
