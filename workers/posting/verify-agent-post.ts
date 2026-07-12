/**
 * Verification harness for the US-005 poster refactor. NOT part of `npm test`
 * — the compiled test build runs from /tmp where playwright doesn't resolve.
 * Run from workers/posting/ (headless, no display needed):
 *
 *   npx tsx verify-agent-post.ts
 *
 * Spins up a mock marketplace whose listing form matches the landmodo /
 * land_com SELECTORS blocks and drives the refactored posters through an
 * already-authenticated page (the caller-owns-the-browser contract): happy
 * path, dry run, expired session, and missing submit button. Asserts the
 * page is never closed by the poster.
 */
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { postToLandCom } from './post-land_com'
import { postToLandmodo } from './post-landmodo'
import { PROJECT_ROOT } from './post-common'
import type { PlatformConfig, PosterTask } from './post-common'

const PORT = 4798
const BASE = `http://127.0.0.1:${PORT}`

const LANDMODO_FORM = `
  <form action="/listings" method="post" enctype="multipart/form-data">
    <input name="listing[title]">
    <textarea name="listing[description]"></textarea>
    <input name="listing[price]">
    <input name="listing[acreage]">
    <select name="listing[state]"><option></option><option>Nevada</option><option>Utah</option></select>
    <input name="listing[county]">
    <input type="file" name="photos[]" multiple>
    {SUBMIT}
  </form>`

const LAND_COM_FORM = `
  <form action="/listings" method="post" enctype="multipart/form-data">
    <input name="title">
    <textarea name="description"></textarea>
    <input name="price">
    <input name="acres">
    <select name="state"><option></option><option>Nevada</option></select>
    <input name="county">
    <input type="file" name="photos[]" multiple>
    {SUBMIT}
  </form>`

function html(title: string, body = ''): string {
  return `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`
}

/** Body of the last POST /listings, for field-value assertions. */
let lastPost = ''

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', BASE)
  const loggedIn = /(?:^|;\s*)mock_session=/.test(req.headers.cookie ?? '')
  const send = (status: number, body?: string, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'Content-Type': 'text/html', ...headers })
    res.end(body ?? '')
  }
  if (url.pathname === '/form') {
    if (!loggedIn) return send(302, undefined, { Location: '/login' })
    const template = url.searchParams.get('site') === 'land_com' ? LAND_COM_FORM : LANDMODO_FORM
    const submit = url.searchParams.has('nosubmit') ? '' : '<button type="submit">Create</button>'
    return send(200, html('New Listing', template.replace('{SUBMIT}', submit)))
  }
  if (url.pathname === '/listings' && req.method === 'POST') {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      lastPost = Buffer.concat(chunks).toString('utf-8')
      send(302, undefined, { Location: '/listings/123' })
    })
    return
  }
  if (url.pathname === '/listings/123') return send(200, html('Listing', 'Listing live'))
  if (url.pathname === '/login') return send(200, html('Mock Login', '<input type="password" name="user[password]">'))
  return send(404, html('Not Found'))
})

function mockPlatform(overrides: Partial<PlatformConfig> = {}): PlatformConfig {
  return {
    display_name: 'Mockland',
    enabled: true,
    login_url: `${BASE}/login`,
    new_listing_url: `${BASE}/form`,
    login_success: { redirect_off: '/login' },
    ...overrides,
  }
}

const TASK: PosterTask = {
  id: 'task-verify-post',
  title: 'Verify posting',
  metadata: { price_usd: 1500, acreage: 0.12, location: 'Elko County, Nevada' },
}

/** Multipart field value by name, from the last recorded POST body. */
function postedField(name: string): string {
  const re = new RegExp(`name="${name.replace(/[[\]]/g, '\\$&')}"\\r\\n\\r\\n([^\\r]*)\\r\\n`)
  return lastPost.match(re)?.[1] ?? '(missing)'
}

function makeOutputDir(): string {
  const dir = fs.mkdtempSync(path.join(__dirname, '.agent-cache', 'verify-post-'))
  const photosDir = path.join(dir, 'photos')
  fs.mkdirSync(photosDir)
  // Content is irrelevant to setInputFiles; two files checks multi-upload.
  fs.writeFileSync(path.join(photosDir, '00_a.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  fs.writeFileSync(path.join(photosDir, '01_b.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  return dir
}

let failures = 0
function check(name: string, cond: boolean, detail = ''): void {
  if (!cond) failures++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}: ${name}${cond || !detail ? '' : ` — ${detail}`}`)
}

async function loggedInPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext()
  await context.addCookies([{ name: 'mock_session', value: 'verify', url: BASE }])
  return { context, page: await context.newPage() }
}

async function main(): Promise<void> {
  fs.mkdirSync(path.join(__dirname, '.agent-cache'), { recursive: true })
  await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve))
  const browser = await chromium.launch()
  const cleanupDirs: string[] = []

  try {
    console.log('Scenario 1: landmodo happy path — fills, uploads, submits, screenshots')
    {
      const { context, page } = await loggedInPage(browser)
      const outputDir = makeOutputDir()
      cleanupDirs.push(outputDir)
      const result = await postToLandmodo(TASK, { headline: 'HL one', description: 'Desc one' }, {
        outputDir,
        page,
        platform: mockPlatform(),
      })
      check('listingUrl is the post-submit URL', result.listingUrl === `${BASE}/listings/123`, String(result.listingUrl))
      check('title posted', postedField('listing[title]') === 'HL one', postedField('listing[title]'))
      check('description posted', postedField('listing[description]') === 'Desc one')
      check('price posted', postedField('listing[price]') === '1500')
      check('acreage posted', postedField('listing[acreage]') === '0.12')
      check('state posted', postedField('listing[state]') === 'Nevada')
      check('county posted (no "County" suffix)', postedField('listing[county]') === 'Elko')
      check('both photos attached', (lastPost.match(/filename="/g) ?? []).length === 2)
      const shot = path.resolve(PROJECT_ROOT, result.screenshotPath)
      check('screenshot written', fs.existsSync(shot))
      check(
        'screenshot is a PNG',
        fs.existsSync(shot) && fs.readFileSync(shot).subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      )
      check('poster left the page open (caller owns browser)', !page.isClosed())
      await context.close()
    }

    console.log('Scenario 2: dry run — fills and screenshots, never submits')
    {
      const { context, page } = await loggedInPage(browser)
      const outputDir = makeOutputDir()
      cleanupDirs.push(outputDir)
      lastPost = ''
      const result = await postToLandmodo(TASK, { headline: 'HL dry', description: 'Desc dry' }, {
        outputDir,
        page,
        platform: mockPlatform(),
        dryRun: true,
      })
      check('listingUrl is null', result.listingUrl === null)
      check('no POST hit the server', lastPost === '')
      check('screenshot written', fs.existsSync(path.resolve(PROJECT_ROOT, result.screenshotPath)))
      await context.close()
    }

    console.log('Scenario 3: expired session — throws, page stays open')
    {
      const context = await browser.newContext() // no cookie
      const page = await context.newPage()
      const outputDir = makeOutputDir()
      cleanupDirs.push(outputDir)
      let error = ''
      try {
        await postToLandmodo(TASK, { headline: 'x', description: 'y' }, { outputDir, page, platform: mockPlatform() })
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
      }
      check('threw the login-expired error', /expired/.test(error), error)
      check('page stays open for the caller', !page.isClosed())
      await context.close()
    }

    console.log('Scenario 4: missing submit button — names the SELECTORS block')
    {
      const { context, page } = await loggedInPage(browser)
      const outputDir = makeOutputDir()
      cleanupDirs.push(outputDir)
      let error = ''
      try {
        await postToLandmodo(TASK, { headline: 'x', description: 'y' }, {
          outputDir,
          page,
          platform: mockPlatform({ new_listing_url: `${BASE}/form?nosubmit=1` }),
        })
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
      }
      check('names the submit selector fix', /SELECTORS block in post-landmodo\.ts/.test(error), error)
      check('page stays open for the caller', !page.isClosed())
      await context.close()
    }

    console.log('Scenario 5: land_com happy path (its own SELECTORS block)')
    {
      const { context, page } = await loggedInPage(browser)
      const outputDir = makeOutputDir()
      cleanupDirs.push(outputDir)
      const result = await postToLandCom(TASK, { headline: 'HL lc', description: 'Desc lc' }, {
        outputDir,
        page,
        platform: mockPlatform({ new_listing_url: `${BASE}/form?site=land_com` }),
      })
      check('listingUrl is the post-submit URL', result.listingUrl === `${BASE}/listings/123`, String(result.listingUrl))
      check('title posted', postedField('title') === 'HL lc', postedField('title'))
      check('acres posted', postedField('acres') === '0.12')
      check('screenshot written', fs.existsSync(path.resolve(PROJECT_ROOT, result.screenshotPath)))
      await context.close()
    }
  } finally {
    await browser.close()
    server.close()
    for (const dir of cleanupDirs) fs.rmSync(dir, { recursive: true, force: true })
  }

  console.log(failures === 0 ? '\nALL SCENARIOS PASSED' : `\n${failures} CHECK(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
