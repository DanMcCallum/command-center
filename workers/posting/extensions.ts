/**
 * Browser extensions for the headed login window (POSTER_EXTENSIONS).
 *
 * Playwright's bundled Chromium starts with a throwaway profile and no
 * extensions, so a password manager never shows up in the agent's login
 * popup. Chromium only loads extensions into a headed persistent context,
 * unpacked, via --load-extension. This module turns the operator's
 * POSTER_EXTENSIONS setting into the directories that flag needs:
 *
 *   POSTER_EXTENSIONS=proton-pass                       known alias
 *   POSTER_EXTENSIONS=ghmbeldphafepmbegfdlkpapadhbakde  Chrome Web Store id
 *   POSTER_EXTENSIONS=/path/to/unpacked,/path/other     unpacked dirs
 *
 * An id (or alias) is looked up in the operator's own Chrome/Chromium/Brave
 * profiles (<profile>/Extensions/<id>/<version>/) and the newest version is
 * copied into .agent-cache/extensions/<id>/<version>/ WITHOUT its _metadata
 * folder: Chrome refuses to load an unpacked extension that still carries
 * that reserved directory, which is exactly what the profile copy has.
 * Nothing under the operator's real profile is modified or read beyond the
 * extension's own files.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { PROJECT_ROOT } from './post-common'

export const KNOWN_EXTENSIONS: Record<string, string> = {
  // Proton's deploy guide lists this id for the Chrome build
  // (https://proton.me/support/deploy-browser-extension).
  'proton-pass': 'ghmbeldphafepmbegfdlkpapadhbakde',
}

export const POSTER_CACHE_DIR = path.join(PROJECT_ROOT, 'workers/posting/.agent-cache')
/** Persistent Chromium profile the extension-enabled login window runs in. */
export const POSTER_PROFILE_DIR = path.join(POSTER_CACHE_DIR, 'profile')
const EXTENSION_STAGE_DIR = path.join(POSTER_CACHE_DIR, 'extensions')

const EXTENSION_ID_RE = /^[a-p]{32}$/

/** Chrome-family user data dirs where <profile>/Extensions/<id>/ may live. */
export function defaultProfileSearchRoots(home = os.homedir()): string[] {
  return [
    // Linux (native and flatpak)
    '.config/google-chrome',
    '.config/chromium',
    '.config/BraveSoftware/Brave-Browser',
    '.var/app/com.google.Chrome/config/google-chrome',
    '.var/app/org.chromium.Chromium/config/chromium',
    '.var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser',
    // macOS
    'Library/Application Support/Google/Chrome',
    'Library/Application Support/Chromium',
    'Library/Application Support/BraveSoftware/Brave-Browser',
  ].map((p) => path.join(home, p))
}

export interface ResolveOptions {
  /** User data dirs to scan for an installed extension id. */
  searchRoots?: string[]
  /** Where id-resolved extensions are staged (default .agent-cache/extensions). */
  stageDir?: string
  log?: (message: string) => void
}

/** Split the POSTER_EXTENSIONS value into trimmed, non-empty entries. */
export function parseExtensionSpec(spec: string | undefined): string[] {
  if (!spec) return []
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function compareVersions(a: string, b: string): number {
  // Chrome versions are dotted integers; the profile dir may add a suffix
  // like "1.2.3_0" which sorts after the bare version.
  const pa = a.split(/[._]/).map((n) => Number(n) || 0)
  const pb = b.split(/[._]/).map((n) => Number(n) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * Find the newest installed copy of an extension id across the search roots.
 * Returns the <version> directory holding manifest.json, or null.
 */
export function findInstalledExtension(id: string, searchRoots: string[]): string | null {
  let best: { version: string; dir: string } | null = null
  for (const root of searchRoots) {
    if (!fs.existsSync(root)) continue
    let profiles: string[]
    try {
      profiles = fs.readdirSync(root)
    } catch {
      continue
    }
    for (const profile of profiles) {
      const extDir = path.join(root, profile, 'Extensions', id)
      if (!fs.existsSync(extDir)) continue
      for (const version of fs.readdirSync(extDir)) {
        const dir = path.join(extDir, version)
        if (!fs.existsSync(path.join(dir, 'manifest.json'))) continue
        if (best === null || compareVersions(version, best.version) > 0) best = { version, dir }
      }
    }
  }
  return best?.dir ?? null
}

function copyWithoutMetadata(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === '_metadata') continue
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) copyWithoutMetadata(from, to)
    else fs.copyFileSync(from, to)
  }
}

/**
 * Stage an installed extension for --load-extension: copy
 * <profile>/Extensions/<id>/<version>/ to <stageDir>/<id>/<version>/ minus
 * _metadata. Idempotent: an existing staged copy of the same version is reused.
 */
export function stageExtension(id: string, installedDir: string, stageDir: string): string {
  const version = path.basename(installedDir)
  const dest = path.join(stageDir, id, version)
  if (!fs.existsSync(path.join(dest, 'manifest.json'))) {
    fs.rmSync(dest, { recursive: true, force: true })
    copyWithoutMetadata(installedDir, dest)
  }
  return dest
}

/**
 * Resolve every POSTER_EXTENSIONS entry to an unpacked extension directory.
 * Throws with a one-line reason when an entry cannot be resolved, so a typo
 * fails the agent at startup instead of silently launching without the
 * password manager.
 */
export function resolveExtensionDirs(spec: string | undefined, opts: ResolveOptions = {}): string[] {
  const entries = parseExtensionSpec(spec)
  if (entries.length === 0) return []
  const searchRoots = opts.searchRoots ?? defaultProfileSearchRoots()
  const stageDir = opts.stageDir ?? EXTENSION_STAGE_DIR
  const log = opts.log ?? (() => {})
  const dirs: string[] = []
  for (const entry of entries) {
    const id = KNOWN_EXTENSIONS[entry.toLowerCase()] ?? entry
    if (EXTENSION_ID_RE.test(id)) {
      const installed = findInstalledExtension(id, searchRoots)
      if (installed === null) {
        throw new Error(
          `POSTER_EXTENSIONS: extension ${entry} (${id}) is not installed in any Chrome/Chromium/Brave profile on this machine. ` +
            `Install it in your normal browser first, or point the entry at an unpacked extension directory`
        )
      }
      const staged = stageExtension(id, installed, stageDir)
      log(`extension ${entry}: ${path.basename(installed)} from ${path.dirname(path.dirname(installed))}`)
      dirs.push(staged)
      continue
    }
    const dir = path.resolve(entry)
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
      throw new Error(`POSTER_EXTENSIONS: ${entry} is neither an extension id nor a directory with a manifest.json`)
    }
    log(`extension dir: ${dir}`)
    dirs.push(dir)
  }
  return dirs
}

/** Chromium flags that load the given unpacked extensions and nothing else. */
export function extensionLaunchArgs(dirs: string[]): string[] {
  if (dirs.length === 0) return []
  const list = dirs.join(',')
  return [`--disable-extensions-except=${list}`, `--load-extension=${list}`]
}
