/**
 * Form recon for any posting platform, run on the operator's machine where
 * auth/<platform>.json lives.
 *
 * Usage: npx tsx recon-form.ts <platform> [url] [--headed] [--login]
 *
 *   platform  key from config/posting-platforms.json (landmodo, land_com, ...)
 *   url       page to inspect; defaults to the platform's new_listing_url
 *   --headed  show the browser window
 *   --login   if the page lands on a login screen, wait (headed) for the
 *             operator to sign in, then save the session to auth/<platform>.json
 *
 * Prints the final URL, every link that looks like it leads to listings, and
 * every form field (tag, type, name, id, placeholder, label, options, hidden
 * values). Also lists file inputs and contenteditable editors outside forms.
 * Saves a screenshot + HTML under .agent-cache/recon/. Never submits anything
 * and never prints cookie values.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { chromium } from 'playwright'
import { AUTH_DIR, loadPlatformConfig } from './post-common'

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const positional = args.filter((a) => !a.startsWith('--'))
const platformKey = positional[0]
if (!platformKey) {
  console.error('Usage: npx tsx recon-form.ts <platform> [url] [--headed] [--login]')
  process.exit(1)
}
const platform = loadPlatformConfig(platformKey)
const url = positional[1] ?? platform.new_listing_url
const wantLogin = flags.has('--login')
const headed = flags.has('--headed') || wantLogin
const OUT_DIR = path.resolve(__dirname, '.agent-cache/recon')
const LOGIN_PATH = platform.login_success?.redirect_off ?? '/login'

/** Let a client-rendered page finish: network quiet, then a real control on screen. */
async function settle(page: import('playwright').Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  await page
    .waitForSelector('input:not([type="hidden"]), textarea, select, [contenteditable="true"], [role="combobox"]', {
      state: 'attached',
      timeout: 20_000,
    })
    .catch(() => {})
  await page.waitForTimeout(2000)
}

async function main(): Promise<void> {
  const authPath = path.join(AUTH_DIR, `${platformKey}.json`)
  const haveSession = fs.existsSync(authPath)
  if (!haveSession && !wantLogin) throw new Error(`no saved session at ${authPath} (run with --login to sign in)`)
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const browser = await chromium.launch({ headless: !headed })
  try {
    const context = await browser.newContext(haveSession ? { storageState: authPath } : {})
    const page = await context.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await settle(page)

    if (wantLogin && new URL(page.url()).pathname.includes(LOGIN_PATH)) {
      console.log(`On the login page. Sign in in the browser window (10 minutes)...`)
      const deadline = Date.now() + 10 * 60_000
      while (Date.now() < deadline && new URL(page.url()).pathname.includes(LOGIN_PATH)) {
        await page.waitForTimeout(1000)
      }
      if (new URL(page.url()).pathname.includes(LOGIN_PATH)) throw new Error('login timed out')
      await page.waitForTimeout(2000)
      await context.storageState({ path: authPath })
      fs.chmodSync(authPath, 0o600)
      console.log(`Session saved to ${authPath}`)
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      await settle(page)
    }
    console.log(`URL:   ${page.url()}`)
    console.log(`TITLE: ${await page.title()}`)

    const links = await page.$$eval('a[href]', (as) =>
      as
        .map((a) => ({ href: (a as HTMLAnchorElement).href, text: (a.textContent ?? '').trim().replace(/\s+/g, ' ') }))
        .filter((l) => /\/account|list|propert|add|post|new|submit/i.test(l.href + ' ' + l.text))
    )
    const seen = new Set<string>()
    console.log('\nLINKS:')
    for (const l of links) {
      if (seen.has(l.href)) continue
      seen.add(l.href)
      console.log(`  ${l.href}  [${l.text.slice(0, 60)}]`)
    }

    const fields = await page.$$eval('form', (forms) =>
      forms.map((form, i) => ({
        index: i,
        action: form.getAttribute('action'),
        method: form.getAttribute('method'),
        id: form.id,
        fields: Array.from(form.querySelectorAll('input, select, textarea, button')).map((el) => {
          const e = el as HTMLInputElement
          let label = ''
          if (e.id) label = document.querySelector(`label[for="${e.id}"]`)?.textContent ?? ''
          if (!label) label = e.closest('label')?.textContent ?? ''
          if (!label) label = e.closest('.form-group, .row, div')?.querySelector('label')?.textContent ?? ''
          const options =
            el.tagName === 'SELECT'
              ? Array.from((el as HTMLSelectElement).options).slice(0, 12).map((o) => `${o.value}=${o.text.trim()}`)
              : undefined
          return {
            tag: el.tagName.toLowerCase(),
            type: e.type,
            name: e.name,
            id: e.id,
            placeholder: e.placeholder,
            value: e.type === 'hidden' ? String(e.value).slice(0, 40) : undefined,
            label: label.trim().replace(/\s+/g, ' ').slice(0, 50),
            options,
            text: el.tagName === 'BUTTON' ? (el.textContent ?? '').trim().slice(0, 40) : undefined,
          }
        }),
      }))
    )
    console.log('\nFORMS:')
    for (const f of fields) {
      console.log(`  form#${f.index} id=${f.id || '-'} action=${f.action ?? '-'} method=${f.method ?? '-'}`)
      for (const x of f.fields) {
        const extra = x.options ? ` options=[${x.options.join(' | ')}]` : x.text ? ` text="${x.text}"` : ''
        console.log(`    ${x.tag}[type=${x.type}] name="${x.name}" id="${x.id}" ph="${x.placeholder}" label="${x.label}"${extra}${x.type === 'hidden' ? ` value="${x.value}"` : ''}`)
      }
    }

    // Single-page apps build their forms without a <form> element at all.
    const orphans = await page.$$eval('input, select, textarea, button, [role="combobox"], [role="button"]', (els) =>
      els
        .filter((el) => !el.closest('form'))
        .map((el) => {
          const e = el as HTMLInputElement
          let label = e.getAttribute('aria-label') ?? ''
          if (!label && e.id) label = document.querySelector(`label[for="${e.id}"]`)?.textContent ?? ''
          if (!label) label = e.closest('label')?.textContent ?? ''
          if (!label) {
            const labelled = e.getAttribute('aria-labelledby')
            if (labelled) label = document.getElementById(labelled)?.textContent ?? ''
          }
          if (!label) label = e.closest('div')?.querySelector('label, legend, h2, h3, h4')?.textContent ?? ''
          const options =
            el.tagName === 'SELECT'
              ? Array.from((el as HTMLSelectElement).options).slice(0, 12).map((o) => `${o.value}=${o.text.trim()}`)
              : undefined
          return {
            tag: el.tagName.toLowerCase(),
            type: e.type ?? el.getAttribute('role') ?? '',
            name: e.name ?? '',
            id: e.id,
            placeholder: e.placeholder ?? '',
            label: label.trim().replace(/\s+/g, ' ').slice(0, 50),
            text: el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' ? (el.textContent ?? '').trim().slice(0, 40) : '',
            testid: el.getAttribute('data-testid') ?? el.getAttribute('data-test') ?? '',
            options,
          }
        })
    )
    if (orphans.length > 0) {
      console.log('\nCONTROLS OUTSIDE ANY FORM:')
      for (const x of orphans) {
        if (x.type === 'hidden') continue
        const extra = [
          x.testid && `testid="${x.testid}"`,
          x.text && `text="${x.text}"`,
          x.options && `options=[${x.options.join(' | ')}]`,
        ]
          .filter(Boolean)
          .join(' ')
        console.log(`  ${x.tag}[type=${x.type}] name="${x.name}" id="${x.id}" ph="${x.placeholder}" label="${x.label}" ${extra}`)
      }
    }

    // Upload widgets and rich-text editors often live outside any <form>.
    const loose = await page.$$eval('input[type="file"], [contenteditable="true"], iframe', (els) =>
      els.map((el) => ({
        tag: el.tagName.toLowerCase(),
        id: el.id,
        name: (el as HTMLInputElement).name ?? '',
        cls: el.className?.toString().slice(0, 80),
        src: el.tagName === 'IFRAME' ? (el as HTMLIFrameElement).src.slice(0, 100) : undefined,
        inForm: Boolean(el.closest('form')),
      }))
    )
    if (loose.length > 0) {
      console.log('\nFILE INPUTS / EDITORS / IFRAMES:')
      for (const l of loose) {
        console.log(`  ${l.tag} id="${l.id}" name="${l.name}" class="${l.cls}"${l.src ? ` src="${l.src}"` : ''}${l.inForm ? '' : ' (outside any form)'}`)
      }
    }

    const host = new URL(page.url()).hostname.replace(/[^a-z0-9]+/gi, '_')
    const stem = path.join(OUT_DIR, `${host}${new URL(page.url()).pathname.replace(/[^a-z0-9]+/gi, '_') || '_root'}`)
    await page.screenshot({ path: `${stem}.png`, fullPage: true })
    fs.writeFileSync(`${stem}.html`, await page.content())
    console.log(`\nsaved ${stem}.png and .html`)
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
