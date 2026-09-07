// ESPP visuals probe (2026-09-07 spec §9): shoot probe.html with real Edge so the per-share form
// and the stepped references are judged on a real canvas — jsdom never draws. PNG lands in the
// gitignored scratchpad/. Env: EDGE_PATH, PLAYWRIGHT_CORE, PROBE_OUT.
Object.defineProperty(process, 'version', { value: 'v20.19.0' })
Object.defineProperty(process.versions, 'node', { value: '20.19.0' })
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.PLAYWRIGHT_CORE ??
    'C:/Users/edyli/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core',
)
const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..', '..')
const out = process.env.PROBE_OUT ?? join(repo, 'scratchpad', 'espp-3-probe', 'probe.png')
mkdirSync(dirname(out), { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'],
})
const page = await browser.newPage({ viewport: { width: 1460, height: 460 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto('file:///' + join(here, 'probe.html').replaceAll('\\\\', '/'), { waitUntil: 'networkidle' })
await new Promise((r) => setTimeout(r, 1200))
// Both canvases must actually paint: sample a grid of pixels and count distinct colours.
const painted = await page.evaluate(() => [...document.querySelectorAll('canvas')].map((cv) => {
  const { width: w, height: h } = cv; const d = cv.getContext('2d').getImageData(0, 0, w, h).data; const uniq = new Set()
  for (let y = 0; y < h; y += 9) for (let x = 0; x < w; x += 9) { const i = (y * w + x) * 4; uniq.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]) }
  return uniq.size
}))
await page.screenshot({ path: out, fullPage: true })
await browser.close()
if (errors.length || painted.length !== 2 || painted.some((n) => n < 6)) {
  console.error(errors.join('\n') || `canvases painted ${JSON.stringify(painted)}`)
  process.exit(1)
}
console.log(`PROBE OK — ${out} (colours per canvas ${painted.join(', ')})`)
