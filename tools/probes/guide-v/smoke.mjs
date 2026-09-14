// tools/probes/guide-v/smoke.mjs — the Guide page walk (lane V, 2026-09-14 guide spec §9 step 3).
// Recipe: tools/probes/README.md. READ-ONLY BY CONSTRUCTION: every non-GET /api/v1 call is fenced
// and answered from memory, so nothing persists and there is nothing to sweep.
// What it proves, in both themes: the sidebar has 14 links with Guide before Settings; /guide
// renders four tabs; every link rendered inside the guide (Open …, Go →, body links, chip row)
// lands — same pathname, the ?section tab selected where present, the #hash target focused or in
// view — with a clean console; the palette answers "add a card" with a Guide group; screenshots of
// each chapter at 1440×900 and 1920×1080.
// Env: SMOKE_OUT, TOKEN_FILE, APP_BASE, EDGE_PATH, PLAYWRIGHT_CORE, ONLY_THEME, MAX_LINKS.
Object.defineProperty(process, 'version', { value: 'v20.19.0' })
Object.defineProperty(process.versions, 'node', { value: '20.19.0' })
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.PLAYWRIGHT_CORE ??
    'C:/Users/edyli/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core',
)
const OUT = process.env.SMOKE_OUT ?? path.join(process.cwd(), 'scratchpad', 'guide-smoke')
mkdirSync(OUT, { recursive: true })
const TOKEN = readFileSync(process.env.TOKEN_FILE ?? path.join(OUT, 'token.txt'), 'utf8').trim()
const BASE = process.env.APP_BASE ?? 'http://localhost:5173'
const EDGE = process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const THEMES = ['dark', 'light'].filter((t) => !process.env.ONLY_THEME || t === process.env.ONLY_THEME)
const MAX_LINKS = Number(process.env.MAX_LINKS ?? 0) // 0 = all
const NOISE = /favicon|DevTools|\[vite\]|@vite\/client|React DevTools|React Router Future Flag|Failed to load resource/i
const CHAPTERS = ['start', 'routines', 'pages', 'reference']
const report = { generatedAt: new Date().toISOString(), base: BASE, themes: THEMES, checks: [], links: [], consoleErrors: [], writesBlocked: [], problems: [] }
const problem = (m) => report.problems.push(m)
const check = (theme, name, ok, observed) => { report.checks.push({ theme, name, ok, observed }); if (!ok) problem(`${theme}: ${name} — ${JSON.stringify(observed)}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ executablePath: EDGE, headless: true })
try {
  for (const theme of THEMES) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    // Token + theme before first paint: index.html's inline script reads finance_token and
    // finance.theme from localStorage, and finance.theme is a BARE string ('dark' | 'light' |
    // 'system'), not JSON — prefsStore.ts's codec writes it that way.
    await context.addInitScript(([token, t]) => { localStorage.setItem('finance_token', token); localStorage.setItem('finance.theme', t) }, [TOKEN, theme])
    // Write fence: no non-GET reaches the server. /prefs is answered with the theme this pass
    // asked for, so the server's stored preference cannot flip the page after hydration.
    await context.route('**/api/v1/**', async (route) => {
      const req = route.request()
      const method = req.method()
      if (/\/api\/v1\/prefs/.test(req.url())) {
        if (method === 'GET') {
          let body = { prefs: {} }
          // An unreadable prefs feed is not this probe subject; the fixed theme still stands.
          try { body = await (await route.fetch()).json() } catch { body = { prefs: {} } }
          body.prefs = { ...body.prefs, theme: { value: theme, updated_at: new Date().toISOString() } }
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
        }
        report.writesBlocked.push(`${method} ${req.url()}`)
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ prefs: {} }) })
      }
      if (method === 'GET') return route.continue()
      report.writesBlocked.push(`${method} ${req.url()}`)
      return route.fulfill({ status: 204, body: '' })
    })
    const page = await context.newPage()
    page.on('console', (msg) => { if (msg.type() === 'error' && !NOISE.test(msg.text())) report.consoleErrors.push({ theme, url: page.url(), text: msg.text() }) })
    page.on('pageerror', (err) => report.consoleErrors.push({ theme, url: page.url(), text: String(err) }))

    // 1. Sidebar: 14 links, Guide before Settings.
    await page.goto(`${BASE}/guide`, { waitUntil: 'networkidle' })
    const navLabels = await page.$$eval('nav[aria-label="Primary"] a.nav-link', (as) => as.map((a) => a.textContent.trim()))
    check(theme, 'sidebar has 14 links with Guide before Settings', navLabels.length === 14 && navLabels[12] === 'Guide' && navLabels[13] === 'Settings', navLabels)
    check(theme, 'theme stamped', (await page.getAttribute('html', 'data-theme')) === theme, await page.getAttribute('html', 'data-theme'))

    // 2. Four tabs; collect every link rendered inside the guide across the chapters.
    const tabs = await page.$$eval('[role="tab"]', (ts) => ts.map((t) => t.textContent.trim()))
    check(theme, 'four chapter tabs', JSON.stringify(tabs) === JSON.stringify(['Start here', 'Routines', 'Pages', 'Reference']), tabs)
    const links = new Set()
    for (const chapter of CHAPTERS) {
      await page.goto(`${BASE}/guide?section=${chapter}`, { waitUntil: 'networkidle' })
      // The More disclosures are <details>: opened here so their tasks' Go links are collected
      // and photographed too. Disclosure is uncontrolled, so its toggle event carries React along.
      await page.$$eval('details.guide-more', (ds) => ds.forEach((d) => { d.open = true }))
      await sleep(150)
      const hrefs = await page.$$eval('.guide-page [role="tabpanel"]:not([hidden]) a[href^="/"]', (as) => as.map((a) => a.getAttribute('href')))
      hrefs.forEach((h) => links.add(h))
      for (const [w, h] of [[1440, 900], [1920, 1080]]) {
        await page.setViewportSize({ width: w, height: h })
        await sleep(150)
        await page.screenshot({ path: path.join(OUT, `${theme}-${chapter}-${w}.png`), fullPage: true })
      }
      await page.setViewportSize({ width: 1440, height: 900 })
    }
    check(theme, 'guide renders links', links.size > 0, links.size)

    // 3. Walk every link once.
    const list = Array.from(links).sort()
    const walk = MAX_LINKS > 0 ? list.slice(0, MAX_LINKS) : list
    for (const href of walk) {
      const url = new URL(href, BASE)
      const wantSection = url.searchParams.get('section')
      const wantHash = url.hash.slice(1)
      const before = report.consoleErrors.length
      await page.goto(url.toString(), { waitUntil: 'networkidle' })
      await sleep(400) // arrival effects (rAF + MutationObserver retry) settle
      const landed = new URL(page.url())
      const samePath = landed.pathname === url.pathname
      // The SELECTED tab must control the panel the link asked for — "some tab is selected" is
      // true of every page with a tab strip, including the chapter the reader did not ask for.
      // LocalSections ids are `${id}-section-${value}` (LocalSections.tsx:88).
      let tabSelected = true
      if (wantSection) {
        const controls = await page
          .$eval('[role="tab"][aria-selected="true"]', (t) => t.getAttribute('aria-controls') ?? '')
          .catch(() => '')
        tabSelected = controls.endsWith(`-section-${wantSection}`)
      }
      const sectionKept = wantSection ? landed.searchParams.get('section') === wantSection : true
      const target = wantHash
        ? await page.evaluate((id) => {
            const el = document.getElementById(id)
            if (!el) return { exists: false }
            const r = el.getBoundingClientRect()
            return { exists: true, focused: document.activeElement === el, inView: r.top >= 0 && r.top < window.innerHeight }
          }, wantHash)
        : { exists: true, focused: true, inView: true }
      const mainFilled = await page.$eval('#main', (m) => m.textContent.trim().length > 0).catch(() => false)
      const ok = samePath && tabSelected && sectionKept && target.exists && (target.focused || target.inView) && mainFilled && report.consoleErrors.length === before
      report.links.push({ theme, href, landed: page.url(), ok, samePath, tabSelected, sectionKept, target, mainFilled })
      if (!ok) problem(`${theme}: link ${href} → ${page.url()} ${JSON.stringify({ samePath, tabSelected, sectionKept, target, mainFilled, newErrors: report.consoleErrors.length - before })}`)
    }

    // 4. The palette answers a how-to with a Guide group. The input carries BOTH .palette-input
    // and role="combobox" (CommandPalette.tsx) — the class is the narrower handle.
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await page.keyboard.press('Control+KeyK')
    await page.fill('.palette-input', 'add a card')
    await sleep(300)
    const groups = await page.$$eval('.palette-group-title', (gs) => gs.map((g) => g.textContent.trim()))
    check(theme, 'palette shows a Guide group for "add a card"', groups.includes('Guide'), groups)
    await page.keyboard.press('Escape')

    await context.close()
  }
} finally {
  await browser.close()
}
report.consoleErrors.forEach((e) => problem(`console ${e.theme} ${e.url}: ${e.text}`))
writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
if (report.problems.length) {
  console.error(report.problems.join('\n'))
  console.error(`GUIDE SMOKE FAILED — ${report.problems.length} problem(s); report: ${path.join(OUT, 'report.json')}`)
  process.exit(1)
}
console.log(`GUIDE SMOKE OK — ${report.links.length} link visits, ${report.checks.length} checks, ${report.writesBlocked.length} writes blocked; report: ${path.join(OUT, 'report.json')}`)
