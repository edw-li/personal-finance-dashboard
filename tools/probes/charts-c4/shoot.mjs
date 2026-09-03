// Screenshot the C4 probe page with headless Edge (the paycheck-sankey-probe pattern) and
// exit non-zero on any page error. Needs puppeteer-core resolvable from the repo's
// node_modules. EDGE_PATH overrides the browser; PROBE_OUT overrides the PNG, which
// otherwise lands in the gitignored scratchpad rather than next to this script.
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../..')
const out = process.env.PROBE_OUT ?? join(repo, 'scratchpad', 'charts-c4-probe', 'probe.png')
const executablePath =
  process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'

await mkdir(dirname(out), { recursive: true })
const browser = await puppeteer.launch({
  executablePath,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
await page.setViewport({ width: 1160, height: 1400 })
await page.goto('file:///' + join(here, 'probe.html').replaceAll('\\', '/'), {
  waitUntil: 'networkidle0',
})
await new Promise((r) => setTimeout(r, 1200))
await page.screenshot({ path: out, fullPage: true })
await browser.close()
if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log('PROBE OK — ' + out)
