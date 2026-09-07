// tools/probes/espp-v/smoke.mjs - the ESPP visuals smoke (lane V, 2026-09-07 spec §9). Recipe:
// tools/probes/README.md. READ-ONLY BY CONSTRUCTION: every non-GET /api/v1 call is fenced and
// answered from memory (PATCH /prefs included). Needs the lane's own dev stack (uvicorn 8010,
// vite 5174) started from the MERGED main — uvicorn runs without --reload.
// Env: SMOKE_OUT, TOKEN_FILE, APP_BASE, API_BASE, EDGE_PATH, PLAYWRIGHT_CORE, ONLY_THEME.
Object.defineProperty(process, 'version', { value: 'v20.19.0' })
Object.defineProperty(process.versions, 'node', { value: '20.19.0' })
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'C:/Users/edyli/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core')
const OUT = process.env.SMOKE_OUT ?? path.join(process.cwd(), 'scratchpad', 'espp-smoke')
mkdirSync(OUT, { recursive: true })
const TOKEN = readFileSync(process.env.TOKEN_FILE ?? path.join(OUT, 'token.txt'), 'utf8').trim()
const BASE = process.env.APP_BASE ?? 'http://localhost:5174'
const API = process.env.API_BASE ?? 'http://127.0.0.1:8010'
const EDGE = process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const VIEWPORT = { width: 1600, height: 1000 }
const THEMES = ['dark', 'light'].filter((t) => !process.env.ONLY_THEME || t === process.env.ONLY_THEME)
const NOISE = /favicon|DevTools|\[vite\]|@vite\/client|React DevTools|React Router Future Flag/i
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const files = []
const report = { generatedAt: new Date().toISOString(), base: BASE, themes: THEMES, checks: [], writesBlocked: [], prefsWrites: [], badResponses: [], problems: [] }
const problem = (m) => report.problems.push(m)
const check = (theme, name, ok, observed) => { report.checks.push({ theme, name, ok, observed }); if (!ok) problem(`${theme}: ${name} — observed ${JSON.stringify(observed)}`); return ok }
const note = (theme, name, observed) => report.checks.push({ theme, name, ok: null, observed })
const money = (s) => `$${Number(s).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
// vite.config.ts pins its dev proxy to 127.0.0.1:8000 — the SHARED backend, which on a lane box is
// whatever build has been running for hours, not this merged main. The page would read a stale
// envelope (no totals block, no anatomy fields) and look broken for reasons the code did not cause.
// So every same-origin /api read is re-aimed at API_BASE, the lane's own uvicorn. Fulfilling from
// the handler keeps the response same-origin, so no CORS and no proxy in the middle.
const APP_ORIGIN = new URL(BASE).origin
const toLane = (u) => (u.startsWith(`${APP_ORIGIN}/api/`) ? API + u.slice(APP_ORIGIN.length) : u)

const INIT = `(() => {
  window.__sig = (cv) => { const w = cv.width, h = cv.height; if (!w || !h) return null; let d; try { d = cv.getContext('2d').getImageData(0, 0, w, h).data } catch { return null }
    const uniq = new Set(); for (let y = 0; y < h; y += 9) for (let x = 0; x < w; x += 9) { const i = (y * w + x) * 4; uniq.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]) }
    return { colors: uniq.size, painted: uniq.size >= 4 } }
  // Cumulative layout shift, the motion smoke's instrument: every unexpected shift since load.
  // Attributed, because two shifts live here and only one is this page's business. The shell's
  // route-hold cross-fade (.xfade/.xfade-veil/.loading-dim/.loading-fallback) collapses its held
  // block at ~0.5s and books ~0.126 — intermittently, on this page and on ones this batch never
  // touched. __clsPage counts only shifts with a source OUTSIDE that overlay, i.e. the ESPP
  // content itself; __cls stays the honest total and both are reported.
  window.__cls = 0
  window.__clsPage = 0
  window.__clsShell = 0
  const SHELL = /(^|\\s)(xfade|xfade-veil|loading-dim|loading-fallback)(\\s|$|-)/
  const isShell = (n) => { for (let e = n; e && e.nodeType === 1; e = e.parentElement) { const c = e.getAttribute && e.getAttribute('class'); if (c && SHELL.test(c)) return true } return false }
  try { new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value
    const src = (e.sources || []).map((s) => s.node).filter(Boolean)
    if (src.length && src.every(isShell)) window.__clsShell += e.value; else window.__clsPage += e.value } }).observe({ type: 'layout-shift', buffered: true }) } catch {}
})()`

// The echarts handle, fetched only AFTER the cards have painted. Doing this import at page-init
// (the obvious place) makes the dev server transform the whole echarts graph while the page is
// still loading: the chart chunk lands late, the skeleton swap turns into a real layout shift and
// the probe reports a CLS the product does not have — measured 0.127 with the init import against
// 0.001 without it, same build. By the time the cards are painted the module is already in the
// page's registry, so this resolves from cache and moves nothing.
const hookEcharts = (page) => page.evaluate(async () => { try { const m = await import('/src/charts/echarts.ts'); window.__echarts = m.echarts } catch (e) { window.__hookError = String(e) } })

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'] })

async function makeContext(theme) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  await ctx.addInitScript(([t, th]) => { localStorage.setItem('finance_token', t); localStorage.setItem('finance.theme', th); localStorage.setItem('finance.chartDecals', 'off') }, [TOKEN, theme])
  await ctx.addInitScript(INIT)
  const themeEntry = { value: theme, updated_at: new Date().toISOString() }
  await ctx.route('**/api/v1/**', async (route) => { const req = route.request(); const m = req.method()
    if (/\/api\/v1\/prefs/.test(req.url())) {
      if (m === 'GET') { let body = { prefs: {} }; try { body = await (await route.fetch({ url: toLane(req.url()) })).json() } catch (e) { problem(`GET /prefs unreadable (${e.message})`) }
        body.prefs = { ...body.prefs, theme: themeEntry }; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }) }
      report.prefsWrites.push({ theme, method: m }); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ prefs: { theme: themeEntry } }) }) }
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') { const lane = toLane(req.url())
      if (lane === req.url()) return route.continue()
      try { return route.fulfill({ response: await route.fetch({ url: lane }) }) } catch (e) { problem(`${theme}: GET ${req.url()} unreachable on the lane API (${e.message})`); return route.continue() } }
    report.writesBlocked.push({ theme, method: m, url: req.url() })
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }) })
  return ctx
}

/** The ESPP lots envelope, straight from the API (a GET through page.request — outside the route fence, still a read). */
async function lotsFromApi(page) {
  const res = await page.request.get(`${API}/api/v1/espp/lots`, { headers: { authorization: `Bearer ${TOKEN}` } })
  return res.ok() ? res.json() : null
}

try {
  for (const theme of THEMES) {
    const ctx = await makeContext(theme)
    const page = await ctx.newPage()
    const errors = []
    page.on('response', (r) => { if (r.status() >= 400) report.badResponses.push({ theme, status: r.status(), method: r.request().method(), url: r.url() }) })
    page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    const drain = (step) => { if (!errors.length) return; problem(`${theme} ${step}: console — ${errors.slice(0, 4).join(' | ')}`); errors.length = 0 }
    const shot = async (name, full = false) => { const file = path.join(OUT, `${theme}-${name}.png`); await page.screenshot({ path: file, fullPage: full }); files.push(path.basename(file)) }

    await page.goto(BASE + '/espp', { waitUntil: 'networkidle' }); await sleep(3500)
    // Every chart on this page is above the fold at 1600x1000 except the modeler; scroll once so
    // the reveal timeline paints it, then come back.
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight)); await sleep(1500); await page.evaluate(() => scrollTo(0, 0)); await sleep(1200)

    // A. The strip: five tiles in the FIRST kpi-row, no lone row, no ghost left standing.
    const strip = await page.evaluate(() => { const row = document.querySelector('.page-frame-body .kpi-row'); return { lone: !!document.querySelector('.kpi-row-lone'), tiles: row ? row.querySelectorAll('.stat-tile').length : 0, ghosts: row ? row.querySelectorAll('.skeleton-tile').length : 0,
      labels: row ? [...row.querySelectorAll('.stat-label')].map((l) => l.textContent.replace(/About.*$/, '').trim()) : [], values: row ? [...row.querySelectorAll('.stat-value')].map((v) => v.textContent.trim()) : [] } })
    check(theme, 'the headline row holds five real tiles and no lone row', !strip.lone && strip.tiles === 5 && strip.ghosts === 0, strip)
    check(theme, 'the five tiles are the spec\'s, in order', strip.labels.slice(0, 4).join('|') === 'Market value|Cost basis|Unrealized gain|Shares held' && /^\$25k limit used — \d{4}$/.test(strip.labels[4] ?? ''), strip.labels)
    // …and the strip's figures are the API's own totals block, not a client sum.
    const api = await lotsFromApi(page)
    if (!api) problem(`${theme}: GET /espp/lots failed`)
    else {
      const held = api.totals?.held
      check(theme, 'the API envelope carries the totals block', !!held && !!api.totals?.sold, Object.keys(api.totals ?? {}))
      if (held) {
        const unsold = api.lots.filter((l) => !l.is_sold)
        const sumCost = unsold.reduce((s, l) => s + Number(l.cost_basis), 0).toFixed(2)
        check(theme, 'totals.held.cost_basis equals the sum of the unsold lots\' cost_basis', Number(held.cost_basis).toFixed(2) === sumCost, { held: held.cost_basis, sumCost, unsold: unsold.length })
        check(theme, 'the Cost basis tile prints totals.held.cost_basis', strip.values[1] === money(held.cost_basis), { tile: strip.values[1], api: held.cost_basis })
        check(theme, 'the Market value tile prints totals.held.market_value (or the em dash when unpriced)', held.market_value === null ? strip.values[0] === '—' : strip.values[0] === money(held.market_value), { tile: strip.values[0], api: held.market_value })
        note(theme, 'position per the API', { lots: api.lots.length, held: held.lots, sold: api.totals.sold.lots, quote: api.current_price, quoted_at: api.quoted_at })
      }
    }
    await shot('espp-top'); await shot('espp-full', true)

    // B. The grid: two chart cards, both painted, filling the row to the right edge.
    const grid = await page.evaluate(() => { const g = document.querySelector('.page-frame-body .card-grid'); if (!g) return null; const r = g.getBoundingClientRect()
      const cards = [...g.querySelectorAll(':scope > .chart-card')].map((c) => { const cv = c.querySelector('canvas'); const b = c.getBoundingClientRect(); return { title: c.querySelector('h2')?.textContent.replace(/About.*$/, '').trim(), span: [...c.classList].find((k) => k.startsWith('span-')), painted: cv ? !!(window.__sig(cv) ?? {}).painted : false, right: +((b.right - r.left) / r.width).toFixed(3), skeleton: !!c.querySelector('.chart-card-skeleton'), empty: c.querySelector('.empty-note')?.textContent ?? null } })
      return { cards, coverage: +((Math.max(...cards.map((c) => c.right * r.width)) ) / r.width).toFixed(3) } })
    check(theme, 'two chart cards sit in the grid at span-6 each', !!grid && grid.cards.length === 2 && grid.cards.every((c) => c.span === 'span-6'), grid)
    check(theme, 'the grid row is filled to its right edge', !!grid && grid.coverage >= 0.9, grid?.coverage)
    check(theme, 'the Lot anatomy card painted a canvas (no skeleton, no empty note)', !!grid && grid.cards[0]?.title === 'Lot anatomy' && grid.cards[0].painted && !grid.cards[0].skeleton, grid?.cards[0])
    // The price card may honestly be empty on a book without stored bars; painted OR the honest sentence.
    check(theme, 'the price card painted or explained itself', !!grid && (grid.cards[1]?.painted || /No stored price history|No ESPP ticker/.test(grid.cards[1]?.empty ?? '')), grid?.cards[1])
    if (grid?.cards[0]?.title === 'Lot anatomy') {
      const card = page.locator('section.chart-card').filter({ has: page.locator('h2', { hasText: 'Lot anatomy' }) }).first()
      await card.screenshot({ path: path.join(OUT, `${theme}-anatomy-dollars.png`) }); files.push(`${theme}-anatomy-dollars.png`)
      // C. The toggle swaps the series on the LIVE instance.
      await hookEcharts(page)
      const seriesOf = () => page.evaluate(() => { const c = [...document.querySelectorAll('section.chart-card')].find((x) => /Lot anatomy/.test(x.querySelector('h2')?.textContent ?? '')); const host = c?.querySelector('[_echarts_instance_]')
        const inst = host && window.__echarts ? window.__echarts.getInstanceByDom(host) : null; return inst ? inst.getOption().series.map((s) => s.name) : null })
      const before = await seriesOf()
      await card.locator('.segmented button', { hasText: /^Per share$/ }).click(); await sleep(900)
      const after = await seriesOf()
      check(theme, 'Dollars view: Paid, Bargain element, Appreciation stacked', Array.isArray(before) && before.slice(0, 3).join('|') === 'Paid|Bargain element|Appreciation', before)
      check(theme, 'Per share view: the ladder base, the dots and the subscription diamonds', Array.isArray(after) && after.includes('ladder-base') && after.includes('Price') && after.includes('Subscription price'), after)
      await card.screenshot({ path: path.join(OUT, `${theme}-anatomy-per-share.png`) }); files.push(`${theme}-anatomy-per-share.png`)
      await card.locator('.segmented button', { hasText: /^Dollars$/ }).click(); await sleep(600)
    }
    if (grid?.cards[1]?.painted) { const price = page.locator('section.chart-card').nth(1); await price.screenshot({ path: path.join(OUT, `${theme}-price.png`) }); files.push(`${theme}-price.png`) }

    // D. The lots table closes with totals rows; the modeler card has the meter, not the gauge.
    const tail = await page.evaluate(() => { const modeler = [...document.querySelectorAll('section.card')].find((c) => /Purchase modeler/.test(c.querySelector('h2')?.textContent ?? ''))
      return { totalsRows: document.querySelectorAll('tfoot tr.espp-totals').length, gauge: !!document.querySelector('.gauge'), meters: modeler ? modeler.querySelectorAll('[role="meter"]').length : -1, tiles: modeler ? modeler.querySelectorAll('.kpi-row .stat-tile').length : -1,
        chainWidth: modeler ? Math.round(modeler.querySelector('.chain-meter')?.getBoundingClientRect().width ?? 0) : -1, cardWidth: modeler ? Math.round(modeler.getBoundingClientRect().width) : -1 } })
    check(theme, 'the lots table has at least the held totals row', tail.totalsRows >= 1, tail.totalsRows)
    check(theme, 'the modeler card draws two meter rows and four tiles, and the gauge is gone', !tail.gauge && tail.meters === 2 && tail.tiles === 4, tail)
    check(theme, 'the meter spans the modeler card (no 720px cap)', tail.chainWidth > 0 && tail.cardWidth - tail.chainWidth < 80, { chainWidth: tail.chainWidth, cardWidth: tail.cardWidth })
    const modelerCard = page.locator('section.card').filter({ has: page.locator('h2', { hasText: /Purchase modeler/ }) }).first()
    if (await modelerCard.count()) { await modelerCard.scrollIntoViewIfNeeded(); await sleep(800); await modelerCard.screenshot({ path: path.join(OUT, `${theme}-modeler.png`) }); files.push(`${theme}-modeler.png`) }

    // E. Layout stability and the console.
    const cls = await page.evaluate(() => ({ total: +window.__cls.toFixed(3), page: +window.__clsPage.toFixed(3), shell: +window.__clsShell.toFixed(3) }))
    check(theme, 'the page\'s own cumulative layout shift stays under 0.1 (the motion batch\'s bar)', cls.page < 0.1, cls)
    note(theme, 'total CLS, and the shell route-hold overlay\'s share of it', cls)
    drain('espp')
    await page.close(); await ctx.close()
  }
} finally {
  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ ...report, files }, null, 1))
  await browser.close()
}
console.log(`checks ${report.checks.filter((c) => c.ok === true).length} ok, ${report.checks.filter((c) => c.ok === false).length} failed, ${report.checks.filter((c) => c.ok === null).length} noted; ${report.writesBlocked.length} writes fenced, ${report.prefsWrites.length} prefs writes stubbed`)
if (report.problems.length) { for (const p of report.problems) console.log('  PROBLEM ' + p); process.exit(1) }
console.log('ESPP SMOKE OK')
