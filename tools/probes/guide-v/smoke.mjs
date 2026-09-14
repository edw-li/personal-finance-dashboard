// tools/probes/guide-v/smoke.mjs — the Guide page walk (lane V, 2026-09-14 guide spec §9 step 3;
// extended 2026-09-15 for the master–detail polish spec §7).
// Recipe: tools/probes/README.md. READ-ONLY BY CONSTRUCTION: every non-GET /api/v1 call is fenced
// and answered from memory, so nothing persists and there is nothing to sweep.
// What it proves, in both themes: the sidebar has 14 links with Guide before Settings; /guide
// renders four chapter tabs; every link the guide can render — driven out of the UI by clicking
// every selector chip and every rail row, folds opened — lands (same pathname, the ?section tab
// selected where present, the #hash target focused or in view) with a clean console; a selector
// chapter shows exactly one card, the chip names it and writes the hash, a rail row swaps the
// detail, "More tasks" opens the fold in place and a deep link selects a numbered rail row; the
// palette answers "add a card" with a Guide group; screenshots of each chapter at 1440×900 and
// 1920×1080 plus the master–detail, checklist and glossary shots.
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
// The chapter panel, and only it: `.guide-detail` is a tabpanel too since the polish, and an
// inactive chapter stays mounted behind `hidden`, so `[role=tabpanel]:not([hidden])` on its own
// would reach into both.
const PANEL = '.guide-page .local-section-panel:not([hidden])'
// The count the 2026-09-14 walk collected from the fully expanded cards. The polish turned the
// Pages chip ROW into a selector of buttons, so twelve `?section=pages#page-*` addresses stopped
// being `<a href>`s — they are added below from each chip's aria-controls, because the reader can
// still reach them and a deep link to a card must still land. Everything else only grew.
const MIN_LINKS = 74
const report = { generatedAt: new Date().toISOString(), base: BASE, themes: THEMES, checks: [], destinations: {}, links: [], consoleErrors: [], writesBlocked: [], problems: [] }
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

    // 2. Four chapter tabs. Scoped to the strip's own nav: selector chips and rail rows are
    // role="tab" too since the polish, and the first chapter renders a rail on arrival.
    const tabs = await page.$$eval('nav[aria-label="Guide chapters"] [role="tab"]', (ts) => ts.map((t) => t.textContent.trim()))
    check(theme, 'four chapter tabs', JSON.stringify(tabs) === JSON.stringify(['Start here', 'Routines', 'Pages', 'Reference']), tabs)

    // Collect every link the guide can render. A selector chapter shows ONE card and a
    // master–detail card shows ONE task's `Go →`, so scraping the rendered panel once would miss
    // most of them: drive the UI instead — every chip, then every rail row with the fold open.
    const links = new Set()
    const seen = { cards: 0, rows: 0, chips: 0 }
    const addPanelLinks = async () => {
      const hrefs = await page.$$eval(`${PANEL} a[href^="/"]`, (as) => as.map((a) => a.getAttribute('href')))
      hrefs.forEach((h) => links.add(h))
    }
    const walkCards = async () => {
      const cardIds = await page.$$eval(`${PANEL} .guide-card`, (cs) => cs.map((c) => c.id))
      for (const cardId of cardIds) {
        seen.cards += 1
        // Open the tail first, so its rows are reachable and their `Go →` links are collected.
        const more = await page.$(`#${cardId} button.guide-rail-more`)
        if (more !== null && (await more.getAttribute('aria-expanded')) !== 'true') {
          await more.click({ timeout: 10000 })
          await page.waitForSelector(`#${cardId} .guide-rail-fold[data-open="true"]`, { timeout: 10000 })
        }
        // Rows keep the task ids (polish spec §2.2), so `#<taskId>` is the handle.
        const rowIds = await page.$$eval(`#${cardId} .guide-rail [role="tab"]`, (rs) => rs.map((r) => r.id))
        for (const rowId of rowIds) {
          seen.rows += 1
          await page.click(`#${rowId}`, { timeout: 10000 })
          await page.waitForSelector(`#${cardId} .guide-detail[aria-labelledby="${rowId}"]`, { timeout: 10000 })
          const hrefs = await page.$$eval(`#${cardId} .guide-detail a[href^="/"]`, (as) => as.map((a) => a.getAttribute('href')))
          hrefs.forEach((h) => links.add(h))
        }
        await addPanelLinks() // the card's own `Open … →` and any links its body renders
      }
    }
    for (const chapter of CHAPTERS) {
      await page.goto(`${BASE}/guide?section=${chapter}`, { waitUntil: 'networkidle' })
      await sleep(200)
      // Photograph the chapter as a reader meets it — first card, first task, folds shut — before
      // the harvest below drives it.
      for (const [w, h] of [[1440, 900], [1920, 1080]]) {
        await page.setViewportSize({ width: w, height: h })
        await sleep(200)
        await page.screenshot({ path: path.join(OUT, `${theme}-${chapter}-${w}.png`), fullPage: true })
      }
      await page.setViewportSize({ width: 1440, height: 900 })
      await sleep(150)
      await addPanelLinks()
      const chips = await page.$$eval(`${PANEL} .guide-selector [role="tab"]`, (cs) => cs.map((c) => ({ id: c.id, card: c.getAttribute('aria-controls') })))
      if (chips.length === 0) {
        await walkCards() // a stacked chapter renders every card at once
      } else {
        for (const chip of chips) {
          seen.chips += 1
          // A chip is a button now, so the address it selects has no href to scrape. It is still
          // an address a reader reaches and a palette hit uses, so the walk below visits it.
          links.add(`/guide?section=${chapter}#${chip.card}`)
          await page.click(`#${chip.id}`, { timeout: 10000 })
          await page.waitForSelector(`${PANEL} .guide-card#${chip.card}`, { timeout: 10000 })
          await sleep(120)
          await addPanelLinks()
          await walkCards()
        }
      }
    }
    check(theme, `the guide renders at least ${MIN_LINKS} distinct destinations`, links.size >= MIN_LINKS, { destinations: links.size, ...seen })
    report.destinations = { ...(report.destinations ?? {}), [theme]: { ...seen, hrefs: Array.from(links).sort() } }

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
      // LocalSections ids are `${id}-section-${value}` (LocalSections.tsx:88), and the page
      // frame's own strip is the first tab in the document, above `.page-frame-body`.
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

    // 3b. Master–detail and the card selector (2026-09-15 polish spec §7).
    const readPanel = () =>
      page.evaluate((sel) => {
        const panel = document.querySelector(sel)
        const chip = panel?.querySelector('.guide-selector [role="tab"][aria-selected="true"]') ?? null
        return {
          cards: [...(panel?.querySelectorAll('.guide-card') ?? [])].map((c) => c.id),
          chipControls: chip?.getAttribute('aria-controls') ?? null,
          chipLabel: (chip?.textContent ?? '').trim() || null,
        }
      }, PANEL)

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`${BASE}/guide?section=pages`, { waitUntil: 'networkidle' })
    await sleep(500)
    const firstCard = await readPanel()
    check(theme, 'md: Pages shows exactly one card and the selected chip names it', firstCard.cards.length === 1 && firstCard.chipControls === firstCard.cards[0], firstCard)

    const chips = await page.$$eval(`${PANEL} .guide-selector [role="tab"]`, (cs) => cs.map((c) => ({ id: c.id, card: c.getAttribute('aria-controls') })))
    const second = chips[1]
    if (second === undefined) {
      check(theme, 'md: the second chip swaps the card and carries the hash', false, chips)
    } else {
      await page.click(`#${second.id}`, { timeout: 10000 })
      await page.waitForSelector(`${PANEL} .guide-card#${second.card}`, { timeout: 10000 })
      await sleep(400)
      const swapped = await readPanel()
      const hash = new URL(page.url()).hash
      check(
        theme,
        'md: the second chip swaps the card and carries the hash',
        hash === `#${second.card}` && swapped.cards.length === 1 && swapped.cards[0] === second.card && swapped.chipControls === second.card,
        { hash, ...swapped },
      )

      // A rail row swaps the detail in place, and the clicked row is the selected tab.
      const rows = await page.$$eval(`#${second.card} .guide-rail [role="tab"]`, (rs) => rs.map((r) => r.id))
      const titleBefore = ((await page.textContent(`#${second.card} .guide-detail .guide-task-title`)) ?? '').trim()
      if (rows[1] === undefined) {
        check(theme, 'md: a rail row swaps the detail', false, { card: second.card, rows })
      } else {
        await page.click(`#${rows[1]}`, { timeout: 10000 })
        await page.waitForSelector(`#${second.card} .guide-detail[aria-labelledby="${rows[1]}"]`, { timeout: 10000 })
        await sleep(300)
        const after = await page.evaluate(([cardId, rowId]) => ({
          title: (document.querySelector(`#${cardId} .guide-detail .guide-task-title`)?.textContent ?? '').trim(),
          selected: document.getElementById(rowId)?.getAttribute('aria-selected') ?? null,
        }), [second.card, rows[1]])
        check(theme, 'md: a rail row swaps the detail', after.title !== '' && after.title !== titleBefore && after.selected === 'true', { before: titleBefore, ...after })
      }

      // The tail opens in place rather than on a second page.
      const more = await page.$(`#${second.card} button.guide-rail-more`)
      if (more === null) {
        check(theme, 'md: More tasks opens the fold in place', true, `${second.card} has no folded tasks — nothing to open`)
      } else {
        await more.click({ timeout: 10000 })
        const opened = await page.waitForSelector(`#${second.card} .guide-rail-fold[data-open="true"]`, { timeout: 10000 }).then(() => true).catch(() => false)
        await sleep(400)
        const foldRows = await page.$$eval(`#${second.card} .guide-rail-fold [role="tab"]`, (rs) => rs.length)
        check(theme, 'md: More tasks opens the fold in place', opened && foldRows > 0, { opened, foldRows })
      }
    }
    await page.screenshot({ path: path.join(OUT, `${theme}-md-pages.png`) })

    // A deep link into the numbered setup checklist selects and lands on its row.
    await page.goto(`${BASE}/guide?section=start#setup-accounts`, { waitUntil: 'networkidle' })
    await sleep(600)
    const numbered = await page.evaluate(() => {
      const row = document.getElementById('setup-accounts')
      const nums = [...document.querySelectorAll('#start-setup .guide-rail-num')].map((n) => (n.textContent ?? '').trim())
      if (row === null) return { exists: false, nums }
      const r = row.getBoundingClientRect()
      return {
        exists: true,
        focused: document.activeElement === row,
        inView: r.top >= 0 && r.top < window.innerHeight,
        selected: row.getAttribute('aria-selected'),
        nums,
      }
    })
    const nums = numbered.nums ?? []
    const sequential = nums.length > 0 && nums.every((n, i) => n === String(i + 1))
    check(
      theme,
      'md: a deep link selects a row in the numbered setup rail, counted 1…n',
      numbered.exists === true && (numbered.focused === true || numbered.inView === true) && numbered.selected === 'true' && nums.length === 18 && sequential,
      { ...numbered, nums: nums.slice(0, 4).concat(nums.length > 4 ? [`…${nums.length}`] : []) },
    )
    await page.screenshot({ path: path.join(OUT, `${theme}-md-start.png`) })

    // The glossary grid is the last card of Reference, so no chapter shot reaches it.
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto(`${BASE}/guide?section=reference#ref-glossary`, { waitUntil: 'networkidle' })
    await sleep(600)
    await page.screenshot({ path: path.join(OUT, `${theme}-md-glossary.png`) })
    await page.setViewportSize({ width: 1440, height: 900 })

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
