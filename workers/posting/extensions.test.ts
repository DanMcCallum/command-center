import { test } from 'node:test'
import * as assert from 'node:assert'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  KNOWN_EXTENSIONS,
  defaultProfileSearchRoots,
  extensionLaunchArgs,
  findInstalledExtension,
  parseExtensionSpec,
  resolveExtensionDirs,
  stageExtension,
} from './extensions'

const PROTON = KNOWN_EXTENSIONS['proton-pass']

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'poster-ext-'))
}

/** Lay out <root>/<profile>/Extensions/<id>/<version>/ the way Chrome does. */
function installFake(root: string, profile: string, id: string, version: string, withMetadata = true): string {
  const dir = path.join(root, profile, 'Extensions', id, version)
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ name: 'fake', version: version.split('_')[0] }))
  fs.writeFileSync(path.join(dir, 'assets', 'app.js'), '// js')
  if (withMetadata) {
    fs.mkdirSync(path.join(dir, '_metadata'))
    fs.writeFileSync(path.join(dir, '_metadata', 'verified_contents.json'), '[]')
  }
  return dir
}

test('parseExtensionSpec splits on commas and drops blanks', () => {
  assert.deepStrictEqual(parseExtensionSpec(undefined), [])
  assert.deepStrictEqual(parseExtensionSpec(''), [])
  assert.deepStrictEqual(parseExtensionSpec(' proton-pass , /x/y,, '), ['proton-pass', '/x/y'])
})

test('extensionLaunchArgs builds the two Chromium flags, nothing for no dirs', () => {
  assert.deepStrictEqual(extensionLaunchArgs([]), [])
  assert.deepStrictEqual(extensionLaunchArgs(['/a', '/b']), [
    '--disable-extensions-except=/a,/b',
    '--load-extension=/a,/b',
  ])
})

test('defaultProfileSearchRoots covers Linux, flatpak and macOS Chrome-family dirs', () => {
  const roots = defaultProfileSearchRoots('/home/op')
  assert.ok(roots.includes('/home/op/.config/google-chrome'))
  assert.ok(roots.includes('/home/op/.config/chromium'))
  assert.ok(roots.includes('/home/op/.var/app/com.google.Chrome/config/google-chrome'))
  assert.ok(roots.includes('/home/op/Library/Application Support/Google/Chrome'))
})

test('findInstalledExtension picks the newest version across profiles and roots', () => {
  const root1 = tmp()
  const root2 = tmp()
  installFake(root1, 'Default', PROTON, '1.20.1_0')
  installFake(root1, 'Profile 1', PROTON, '1.9.9_0')
  const newest = installFake(root2, 'Default', PROTON, '1.21.0_0')
  // A version dir without a manifest is ignored.
  fs.mkdirSync(path.join(root2, 'Default', 'Extensions', PROTON, '9.0.0_0'), { recursive: true })
  assert.strictEqual(findInstalledExtension(PROTON, [root1, root2, '/nonexistent/root']), newest)
  assert.strictEqual(findInstalledExtension('a'.repeat(32), [root1, root2]), null)
})

test('stageExtension copies the extension without _metadata and reuses a staged copy', () => {
  const root = tmp()
  const stage = tmp()
  const installed = installFake(root, 'Default', PROTON, '1.21.0_0')
  const staged = stageExtension(PROTON, installed, stage)
  assert.strictEqual(staged, path.join(stage, PROTON, '1.21.0_0'))
  assert.ok(fs.existsSync(path.join(staged, 'manifest.json')))
  assert.ok(fs.existsSync(path.join(staged, 'assets', 'app.js')))
  assert.ok(!fs.existsSync(path.join(staged, '_metadata')), '_metadata must not be staged')
  // Second call leaves the staged copy alone (marker file survives).
  fs.writeFileSync(path.join(staged, 'marker'), '')
  assert.strictEqual(stageExtension(PROTON, installed, stage), staged)
  assert.ok(fs.existsSync(path.join(staged, 'marker')))
})

test('resolveExtensionDirs handles alias, raw id and unpacked dir entries', () => {
  const root = tmp()
  const stage = tmp()
  installFake(root, 'Default', PROTON, '1.21.0_0')
  const unpacked = path.join(tmp(), 'my-ext')
  fs.mkdirSync(unpacked)
  fs.writeFileSync(path.join(unpacked, 'manifest.json'), '{}')
  const logs: string[] = []
  const dirs = resolveExtensionDirs(`Proton-Pass, ${unpacked}`, { searchRoots: [root], stageDir: stage, log: (m) => logs.push(m) })
  assert.deepStrictEqual(dirs, [path.join(stage, PROTON, '1.21.0_0'), unpacked])
  assert.strictEqual(logs.length, 2)
  // The raw id resolves to the same staged dir.
  assert.deepStrictEqual(resolveExtensionDirs(PROTON, { searchRoots: [root], stageDir: stage }), [dirs[0]])
  assert.deepStrictEqual(resolveExtensionDirs(undefined, { searchRoots: [root], stageDir: stage }), [])
})

test('resolveExtensionDirs fails loudly on a missing install or a bad path', () => {
  const root = tmp()
  const stage = tmp()
  assert.throws(
    () => resolveExtensionDirs('proton-pass', { searchRoots: [root], stageDir: stage }),
    /proton-pass \(ghmbeldphafepmbegfdlkpapadhbakde\) is not installed/
  )
  assert.throws(
    () => resolveExtensionDirs('/no/such/dir', { searchRoots: [root], stageDir: stage }),
    /neither an extension id nor a directory with a manifest.json/
  )
})
