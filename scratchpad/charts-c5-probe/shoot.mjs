// C5 Task 7 / spec §17: shoot probe.html with real Edge so the decal, markArea and
// markPoint forms are judged on a real canvas before the lane merges.
import puppeteer from 'puppeteer-core'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
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
await page.screenshot({ path: join(here, 'probe.png'), fullPage: true })
await browser.close()
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log('PROBE OK — scratchpad/charts-c5-probe/probe.png')
