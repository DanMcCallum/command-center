/**
 * Capture-server HTTP surface for self-hosted live-view login capture
 * (specs/live-view-browser.md, US-005).
 *
 * A small HTTP service on the worker machine that the dashboard drives
 * (over localhost / the Cloudflare tunnel) to run a live-view login:
 *
 *   POST /capture/start  { platform }   → { sessionId, liveViewUrl }
 *   GET  /capture/status ?sessionId=…   → { loggedIn }
 *   POST /capture/cancel { sessionId }  → { cancelled: true }
 *
 * Every request must carry `Authorization: Bearer <token>` where the token
 * is deriveApiToken(CAPTURE_STREAM_SECRET) — HMAC-SHA256 of the string
 * "capture-api" keyed with the secret. The dashboard proxy (US-006)
 * computes the same derivation from its own env; the raw secret never
 * travels over HTTP, is never logged, and never appears in a response.
 *
 * The service fails closed at startup when CAPTURE_STREAM_SECRET is absent
 * (OT-3), and start requests fail closed when the streaming deps are
 * missing (OT-1) or a capture is already in progress (single-operator,
 * one session at a time).
 */
import * as crypto from 'node:crypto'
import * as http from 'node:http'
import { checkSession } from './detect'
import { closeSession, getSession, requireLiveViewPlatform, startSession } from './session'
import { getStreamSecret, isStreamActive, startStream, stopStream } from './stream'

export const CAPTURE_PORT = Number(process.env.CAPTURE_PORT ?? 4750)
const MAX_BODY_BYTES = 16 * 1024

/** The shared API token: HMAC-SHA256("capture-api") keyed with the secret. */
export function deriveApiToken(secret: string): string {
  return crypto.createHmac('sha256', secret).update('capture-api').digest('hex')
}

function isAuthorized(req: http.IncomingMessage, expectedToken: string): boolean {
  const header = req.headers.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  const given = Buffer.from(header.slice('Bearer '.length), 'utf-8')
  const expected = Buffer.from(expectedToken, 'utf-8')
  return given.length === expected.length && crypto.timingSafeEqual(given, expected)
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('error', reject)
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8')
      if (!raw.trim()) {
        resolve({})
        return
      }
      try {
        const parsed = JSON.parse(raw)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          reject(new Error('Request body must be a JSON object'))
          return
        }
        resolve(parsed as Record<string, unknown>)
      } catch {
        reject(new Error('Request body is not valid JSON'))
      }
    })
  })
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Reads the JSON body, answering 400 (and returning null) when it is bad. */
async function readBodyOr400(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<Record<string, unknown> | null> {
  try {
    return await readJsonBody(req)
  } catch (err) {
    sendJson(res, 400, { error: errorMessage(err) })
    return null
  }
}

// The single active capture, tracked so cancel/shutdown can tear it down.
// checkSession() tears down internally on success, so status clears it too.
let currentSessionId: string | null = null

async function teardownCurrent(): Promise<void> {
  if (currentSessionId) {
    await closeSession(currentSessionId)
    currentSessionId = null
  }
  await stopStream()
}

async function handleStart(body: Record<string, unknown>, res: http.ServerResponse): Promise<void> {
  const platform = body.platform
  if (typeof platform !== 'string' || !platform) {
    sendJson(res, 400, { error: 'Missing "platform" in request body' })
    return
  }
  try {
    requireLiveViewPlatform(platform)
  } catch (err) {
    sendJson(res, 400, { error: errorMessage(err) })
    return
  }
  if (isStreamActive()) {
    sendJson(res, 409, {
      error:
        'A live-view capture is already in progress — finish or cancel it first ' +
        '(one capture session at a time)',
    })
    return
  }

  const { liveViewUrl } = await startStream()
  let sessionId: string
  try {
    ;({ sessionId } = await startSession(platform))
  } catch (err) {
    await stopStream()
    throw err
  }
  currentSessionId = sessionId
  console.log(`capture started: platform=${platform} sessionId=${sessionId}`)
  sendJson(res, 200, { sessionId, liveViewUrl })
}

async function handleStatus(url: URL, res: http.ServerResponse): Promise<void> {
  const sessionId = url.searchParams.get('sessionId')
  if (!sessionId) {
    sendJson(res, 400, { error: 'Missing "sessionId" query parameter' })
    return
  }
  if (!getSession(sessionId)) {
    sendJson(res, 404, { error: `Unknown capture session "${sessionId}" — start a new capture` })
    return
  }
  const loggedIn = await checkSession(sessionId)
  if (loggedIn && currentSessionId === sessionId) {
    // checkSession already exported storageState and tore down session+stream.
    currentSessionId = null
    console.log(`capture succeeded: sessionId=${sessionId}`)
  }
  sendJson(res, 200, { loggedIn })
}

async function handleCancel(body: Record<string, unknown>, res: http.ServerResponse): Promise<void> {
  const sessionId = body.sessionId
  if (typeof sessionId !== 'string' || !sessionId) {
    sendJson(res, 400, { error: 'Missing "sessionId" in request body' })
    return
  }
  await closeSession(sessionId)
  if (currentSessionId === sessionId) currentSessionId = null
  await stopStream()
  console.log(`capture cancelled: sessionId=${sessionId}`)
  sendJson(res, 200, { cancelled: true })
}

export function createCaptureServer(secret: string): http.Server {
  const apiToken = deriveApiToken(secret)
  return http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (!isAuthorized(req, apiToken)) {
        sendJson(res, 401, { error: 'Unauthorized' })
        return
      }
      try {
        if (req.method === 'POST' && url.pathname === '/capture/start') {
          const body = await readBodyOr400(req, res)
          if (body) await handleStart(body, res)
        } else if (req.method === 'GET' && url.pathname === '/capture/status') {
          await handleStatus(url, res)
        } else if (req.method === 'POST' && url.pathname === '/capture/cancel') {
          const body = await readBodyOr400(req, res)
          if (body) await handleCancel(body, res)
        } else {
          sendJson(res, 404, { error: 'Not found' })
        }
      } catch (err) {
        // Error messages name missing binaries / platforms / session ids —
        // never cookie values, storageState contents, or the secret.
        sendJson(res, 500, { error: errorMessage(err) })
      }
    })()
  })
}

if (require.main === module) {
  let secret: string
  try {
    secret = getStreamSecret()
  } catch (err) {
    console.error(errorMessage(err))
    process.exit(1)
  }

  const server = createCaptureServer(secret)
  server.listen(CAPTURE_PORT, '127.0.0.1', () => {
    console.log(`capture-server listening on 127.0.0.1:${CAPTURE_PORT}`)
  })

  let shuttingDown = false
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`received ${signal}, shutting down`)
    server.close()
    teardownCurrent().finally(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
