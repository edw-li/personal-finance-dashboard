// Chart-grammar probe (spec §17): shoot probe.html with real Edge so the decal, markArea
// and markPoint forms are judged on a real canvas — jsdom never draws, so a form that only
// looks right in an option literal has to be seen before it ships.
//   node tools/probes/charts-c5/shoot.mjs
// EDGE_PATH overrides the browser (a box with Edge elsewhere, or Chrome); PROBE_OUT
// overrides where the PNG lands.
import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..', '..')
// The PNG is an artifact, not source: it lands in the repo's gitignored scratchpad/ so a
// run never dirties the tree (tools/ is tracked, scratchpad/ is not).
const out = process.env.PROBE_OUT ?? join(repo, 'scratchpad', 'charts-c5-probe', 'probe.png')
mkdirSync(dirname(out), { recursive: true })
const browser = await puppeteer.launch({
  executablePath: process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
await page.setViewport({ width: 1160, height: 1300 })
await page.goto('file:///' + join(here, 'probe.html').replaceAll('\\', '/'), { waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, 1200))
await page.screenshot({ path: out, fullPage: true })
await browser.close()
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log(`PROBE OK — ${out}`)
