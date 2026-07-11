/**
 * Streaming bridge for self-hosted live-view login capture
 * (specs/live-view-browser.md, US-003).
 *
 * Pipes the capture session's headed Chromium into the operator's browser:
 * Xvfb renders a virtual display, x11vnc serves that display over VNC,
 * websockify bridges VNC to a WebSocket and serves the noVNC static client,
 * and the returned live-view URL carries a short-lived HMAC token signed
 * with CAPTURE_STREAM_SECRET.
 *
 * Single active capture session at a time (single-operator constraint):
 * the display and both ports are fixed, startStream() claims the one slot,
 * and a concurrent start fails closed with "already in progress".
 *
 * startStream() sets process.env.DISPLAY to the Xvfb display, so a
 * subsequent startSession() (capture/session.ts) launches its headed
 * Chromium onto the streamed display. stopStream() restores the previous
 * DISPLAY and tears down all three processes — no orphans.
 */
import { ChildProcess, spawn } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as path from 'node:path'
import { PROJECT_ROOT } from '../post-common'

// Fixed single-session plumbing: one Xvfb display and one port pair,
// reused for every capture (generalize only if concurrent capture ever
// becomes a goal — it is a PRD non-goal today).
export const CAPTURE_DISPLAY = ':99'
const SCREEN_GEOMETRY = '1280x800x24'
const VNC_PORT = 5901
export const WS_PORT = Number(process.env.CAPTURE_WS_PORT ?? 6080)
const TOKEN_TTL_MS = 10 * 60 * 1000
const READY_TIMEOUT_MS = 10_000

const NOVNC_ROOT_CANDIDATES = [
  process.env.NOVNC_ROOT,
  '/usr/share/novnc',
  '/usr/share/webapps/novnc',
  '/usr/local/share/novnc',
]

export interface StreamHandle {
  display: string
  liveViewUrl: string
}

interface Spawned {
  name: string
  proc: ChildProcess
  exit: { code: number | null; signal: string | null } | null
  stderrTail: string
}

interface ActiveStream {
  procs: Spawned[]
  prevDisplay: string | undefined
  handle: StreamHandle
}

// The single-session slot. 'starting' claims it for the duration of
// startStream() so a concurrent call fails closed instead of racing.
let active: ActiveStream | 'starting' | null = null

export function isStreamActive(): boolean {
  return active !== null
}

/**
 * The signing secret for live-view URL tokens. Read from the environment,
 * falling back to the project-root .env.local (same file the Dialpad keys
 * live in). The value is never logged and never appears in error messages.
 */
export function getStreamSecret(): string {
  const fromEnv = process.env.CAPTURE_STREAM_SECRET
  if (fromEnv) return fromEnv
  const envPath = path.join(PROJECT_ROOT, '.env.local')
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const m = line.match(/^(?:export\s+)?CAPTURE_STREAM_SECRET=(.*)$/)
      if (m) {
        const value = m[1].trim().replace(/^(["'])(.*)\1$/, '$2')
        if (value) return value
      }
    }
  }
  throw new Error(
    'CAPTURE_STREAM_SECRET is not set — generate a random secret in .env.local ' +
      '(specs/live-view-browser.md, OT-3)'
  )
}

/** Signs a short-lived live-view token: "<expiryEpochMs>.<hmacSha256Hex>". */
export function signStreamToken(secret: string, ttlMs: number = TOKEN_TTL_MS): string {
  const exp = Date.now() + ttlMs
  const sig = crypto.createHmac('sha256', secret).update(`live-view:${exp}`).digest('hex')
  return `${exp}.${sig}`
}

/** True if the token's signature checks out and it has not expired. */
export function verifyStreamToken(token: string, secret: string): boolean {
  const dot = token.indexOf('.')
  if (dot === -1) return false
  const exp = Number(token.slice(0, dot))
  const sig = token.slice(dot + 1)
  if (!Number.isFinite(exp) || Date.now() > exp) return false
  const expected = crypto.createHmac('sha256', secret).update(`live-view:${exp}`).digest('hex')
  if (sig.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(sig, 'utf-8'), Buffer.from(expected, 'utf-8'))
}

function requireBinary(name: string): void {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue
    try {
      fs.accessSync(path.join(dir, name), fs.constants.X_OK)
      return
    } catch {
      // keep scanning PATH
    }
  }
  throw new Error(
    `Missing streaming dependency "${name}" — install it on the worker machine ` +
      '(specs/live-view-browser.md, OT-1: apt-get install xvfb x11vnc websockify novnc)'
  )
}

function findNovncRoot(): string {
  for (const dir of NOVNC_ROOT_CANDIDATES) {
    if (dir && fs.existsSync(path.join(dir, 'vnc.html'))) return dir
  }
  throw new Error(
    'Missing streaming dependency "noVNC" (no vnc.html under ' +
      `${NOVNC_ROOT_CANDIDATES.filter(Boolean).join(', ')}) — install it on the ` +
      'worker machine or set NOVNC_ROOT (specs/live-view-browser.md, OT-1)'
  )
}

function launch(name: string, args: string[]): Spawned {
  const proc = spawn(name, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  const spawned: Spawned = { name, proc, exit: null, stderrTail: '' }
  proc.stderr?.on('data', (chunk: Buffer) => {
    spawned.stderrTail = (spawned.stderrTail + chunk.toString()).slice(-500)
  })
  proc.on('exit', (code, signal) => {
    spawned.exit = { code, signal }
  })
  proc.on('error', () => {
    spawned.exit = { code: -1, signal: null }
  })
  return spawned
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' })
    sock.once('connect', () => {
      sock.destroy()
      resolve(true)
    })
    sock.once('error', () => resolve(false))
  })
}

async function waitUntilReady(
  spawned: Spawned,
  what: string,
  check: () => Promise<boolean> | boolean
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (spawned.exit) {
      throw new Error(
        `${spawned.name} exited (code ${spawned.exit.code}) before ${what} was ready` +
          (spawned.stderrTail ? `: ${spawned.stderrTail.trim()}` : '')
      )
    }
    if (await check()) return
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`Timed out waiting for ${what} (${spawned.name})`)
}

async function stopProcess(spawned: Spawned): Promise<void> {
  if (spawned.exit) return
  await new Promise<void>((resolve) => {
    const forceKill = setTimeout(() => spawned.proc.kill('SIGKILL'), 3000)
    spawned.proc.once('exit', () => {
      clearTimeout(forceKill)
      resolve()
    })
    if (!spawned.proc.kill('SIGTERM')) {
      clearTimeout(forceKill)
      resolve()
    }
  })
}

/**
 * Starts the Xvfb → x11vnc → websockify chain and returns the token-guarded
 * noVNC URL. Fails closed — naming the missing piece, with nothing left
 * running — when a dependency is absent (OT-1), the secret is absent (OT-3),
 * or a capture is already in progress.
 */
export async function startStream(): Promise<StreamHandle> {
  if (active) {
    throw new Error(
      'A live-view capture is already in progress — finish or cancel it first ' +
        '(one capture session at a time)'
    )
  }
  active = 'starting'
  const procs: Spawned[] = []
  const prevDisplay = process.env.DISPLAY
  try {
    const secret = getStreamSecret()
    for (const bin of ['Xvfb', 'x11vnc', 'websockify']) requireBinary(bin)
    const novncRoot = findNovncRoot()

    const xvfb = launch('Xvfb', [CAPTURE_DISPLAY, '-screen', '0', SCREEN_GEOMETRY, '-nolisten', 'tcp'])
    procs.push(xvfb)
    const xSocket = path.join('/tmp/.X11-unix', `X${CAPTURE_DISPLAY.slice(1)}`)
    await waitUntilReady(xvfb, `Xvfb display ${CAPTURE_DISPLAY}`, () => fs.existsSync(xSocket))

    const x11vnc = launch('x11vnc', [
      '-display', CAPTURE_DISPLAY,
      '-rfbport', String(VNC_PORT),
      '-localhost',
      '-forever',
      '-shared',
      '-nopw',
      '-quiet',
    ])
    procs.push(x11vnc)
    await waitUntilReady(x11vnc, `x11vnc on port ${VNC_PORT}`, () => portOpen(VNC_PORT))

    const websockify = launch('websockify', [
      '--web', novncRoot,
      String(WS_PORT),
      `localhost:${VNC_PORT}`,
    ])
    procs.push(websockify)
    await waitUntilReady(websockify, `websockify on port ${WS_PORT}`, () => portOpen(WS_PORT))

    // The capture session's Chromium (capture/session.ts) inherits DISPLAY,
    // so from here on a startSession() renders into the streamed display.
    process.env.DISPLAY = CAPTURE_DISPLAY

    const token = signStreamToken(secret)
    const handle: StreamHandle = {
      display: CAPTURE_DISPLAY,
      liveViewUrl:
        `http://localhost:${WS_PORT}/vnc.html` +
        `?autoconnect=1&resize=scale&path=websockify&token=${token}`,
    }
    active = { procs, prevDisplay, handle }
    return handle
  } catch (err) {
    await Promise.all(procs.map(stopProcess))
    active = null
    throw err
  }
}

/**
 * Tears down the active stream: websockify, x11vnc, then Xvfb, restoring
 * the previous DISPLAY. No-op when nothing is running.
 */
export async function stopStream(): Promise<void> {
  if (!active || active === 'starting') return
  const { procs, prevDisplay } = active
  active = null
  for (const spawned of [...procs].reverse()) {
    await stopProcess(spawned)
  }
  if (prevDisplay === undefined) delete process.env.DISPLAY
  else process.env.DISPLAY = prevDisplay
}
