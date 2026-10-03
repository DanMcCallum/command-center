/**
 * Recon for the Landmodo listing form, run on the operator's machine where
 * auth/landmodo.json lives.
 *
 * Usage: npx tsx recon-landmodo-form.ts [url] [--headed]
 *
 * Opens the URL (default: the member dashboard) with the saved session,
 * prints the final URL, every link that looks like it leads to listings,
 * and every form field (tag, type, name, id, placeholder, label, options).
 * Saves a screenshot + HTML under .agent-cache/recon/. Never submits anything
 * and never prints cookie values.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { chromium } from 'playwright'
import { AUTH_DIR } from './post-common'

const args = process.argv.slice(2)
const headed = args.includes('--headed')
const url = args.find((a) => !a.startsWith('--')) ?? 'https://www.landmodo.com/account'
const OUT_DIR = path.resolve(__dirname, '.agent-cache/recon')

async function main(): Promise<void> {
  const authPath = path.join(AUTH_DIR, 'landmodo.json')
  if (!fs.existsSync(authPath)) throw new Error(`no saved session at ${authPath}`)
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const browser = await chromium.launch({ headless: !headed })
  try {
    const context = await browser.newContext({ storageState: authPath })
    const page = await context.newPage()
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)
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

    const stem = path.join(OUT_DIR, new URL(page.url()).pathname.replace(/[^a-z0-9]+/gi, '_') || 'root')
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
