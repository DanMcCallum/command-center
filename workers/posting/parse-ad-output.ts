import * as fs from 'node:fs'
import * as path from 'node:path'

export interface ParsedAd {
  headline: string
  description: string
}

/**
 * Extracts the body text of a `## <NAME> (x/y chars)` section from the
 * generated ad Markdown. Body runs until the next heading (any `#` level)
 * or end of file, so trailing sections like "## Why this angle" are excluded.
 */
function extractSection(markdown: string, sectionName: string, filePath: string): string {
  const lines = markdown.split(/\r?\n/)
  const headingRe = new RegExp(`^##\\s+${sectionName}\\b`, 'i')
  const start = lines.findIndex((line) => headingRe.test(line))
  if (start === -1) {
    throw new Error(`Missing "## ${sectionName}" section in ${filePath}`)
  }
  const body: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) break
    body.push(lines[i])
  }
  const text = body.join('\n').trim()
  if (!text) {
    throw new Error(`"## ${sectionName}" section in ${filePath} is empty`)
  }
  return text
}

/**
 * Parses `<outputDir>/<platform>.md` produced by the ad-builder worker and
 * returns the headline and description body text (no headers, no
 * "Why this angle" section).
 */
export function parseAdOutput(outputDir: string, platform: string): ParsedAd {
  const filePath = path.join(outputDir, `${platform}.md`)
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Ad output file not found for platform "${platform}": ${filePath}. ` +
        `Was this platform selected when the ad was generated?`
    )
  }
  const markdown = fs.readFileSync(filePath, 'utf-8')
  return {
    headline: extractSection(markdown, 'HEADLINE', filePath),
    description: extractSection(markdown, 'DESCRIPTION', filePath),
  }
}
