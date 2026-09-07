// tools/probes/pace-v/smoke.mjs - the pace / settings / movers smoke (lane V, 2026-09-06 spec).
// Recipe: tools/probes/README.md. READ-ONLY BY CONSTRUCTION: every non-GET /api/v1 call is fenced and
// answered from memory (PATCH /prefs included), so no run can persist anything and there is nothing to
// sweep. Needs the dev stack with uvicorn RESTARTED after the merges (it runs without --reload).
// Env: SMOKE_OUT, TOKEN_FILE, APP_BASE, API_BASE, EDGE_PATH, PLAYWRIGHT_CORE, ONLY_THEME, ONLY_STEP.
//
// THREE DEVIATIONS from the plan's draft, each keeping the CLAIM and changing only the driving:
//   a. `__rings` is filled by a MutationObserver armed at DOCUMENT START over the whole tree and
//      keyed by element id, not by a per-id watcher installed after the navigation. The arrival
//      ring lives 1.2s and is applied imperatively; a `goto` + `evaluate` round trip can outlast
//      it, and a watcher armed after arriving would read a ring already taken off as "never rang".
//      `__watch(id)` survives as the reset, so a re-visit cannot inherit an older run's answer.
//   b. The 415(c) label is judged against `GET /paycheck/profiles` issued through `page.request`,
//      which Playwright does NOT put through `context.route` - a GET either way, so the fence's
//      claim is untouched, and the label is judged against the book rather than against memory.
//   c. The reviews' two real-pixel eyeballs are instrumented rather than left to a human: the
//      movers' outside-end bar labels are measured against the grid's own right edge (do they
//      clip?) and recorded as a `note()` — evidence, never a vote — while Settings' geometry
//      becomes hard `check()`s where it can be one (a chip landing its band below the rail at
//      the COMPACT density, every card hash landing below the rail, the Activity feed capped
//      and scrolling inside its own box) and a `note()` where it is only a reading (the
//      two-column `.system-facts` at 721 and 1400 px).
//
// TWO CONVENIENCES the plan did not ask for, neither of which changes an assertion: the `rail`
// step navigates to /settings itself when ONLY_STEP skips walk A, and the `pace` step scrolls the
// Contribution-pace card into view before shooting it — it is below the fold and the reveal
// timeline holds it dim, so an unscrolled screenshot photographs a ghost.
// The first two lines spoof the node version: this box runs node 18, playwright-core wants 20.
Object.defineProperty(process, 'version', { value: 'v20.19.0' })
Object.defineProperty(process.versions, 'node', { value: '20.19.0' })
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.PLAYWRIGHT_CORE ??
    'C:/Users/edyli/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core',
)
const OUT = process.env.SMOKE_OUT ?? path.join(process.cwd(), 'scratchpad', 'pace-smoke')
mkdirSync(OUT, { recursive: true })
const TOKEN = readFileSync(process.env.TOKEN_FILE ?? path.join(OUT, 'token.txt'), 'utf8').trim()
const BASE = process.env.APP_BASE ?? 'http://localhost:5173'
const API = process.env.API_BASE ?? 'http://127.0.0.1:8000'
const EDGE = process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const VIEWPORT = { width: 1440, height: 900 }
const SECTIONS = [['sec-household', 'Household'], ['sec-planning', 'Planning'], ['sec-account', 'Account'], ['sec-integrations', 'Integrations'], ['sec-data', 'Data']]
const RINGS = ['limits', 'calendar', 'restore', 'backups']
const ANCHORS = ['plan-assumptions', 'price-refresh']
const THEMES = ['dark', 'light'].filter((t) => !process.env.ONLY_THEME || t === process.env.ONLY_THEME)
const STEPS = ['settings', 'rows', 'rail', 'anchors', 'pace', 'movers'].filter((s) => !process.env.ONLY_STEP || s === process.env.ONLY_STEP)
const NOISE = /favicon|DevTools|\[vite\]|@vite\/client|React DevTools|React Router Future Flag/i
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const files = []
const report = { generatedAt: new Date().toISOString(), base: BASE, themes: THEMES, steps: STEPS, checks: [], writesBlocked: [], prefsWrites: [], badResponses: [], problems: [] }
const problem = (m) => report.problems.push(m)
const check = (theme, step, name, ok, observed) => { report.checks.push({ theme, step, name, ok, observed }); if (!ok) problem(`${theme} ${step}: ${name} — observed ${JSON.stringify(observed)}`); return ok }
const note = (theme, step, name, observed) => report.checks.push({ theme, step, name, ok: null, observed })


const INIT = `(() => {
  window.__sig = (cv) => { const w = cv.width, h = cv.height; if (!w || !h) return null; let d; try { d = cv.getContext('2d').getImageData(0, 0, w, h).data } catch { return null }
    const uniq = new Set(); for (let y = 0; y < h; y += 9) for (let x = 0; x < w; x += 9) { const i = (y * w + x) * 4; uniq.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]) }
    return { colors: uniq.size, painted: uniq.size >= 4 } }
  // The arrival ring lives 1.2s and is applied imperatively. WATCH the whole tree from document
  // start and key what is seen by id, so a ring can never expire between goto and evaluate.
  window.__rings = {}
  window.__watch = (id) => { delete window.__rings[id] }
  const seen = () => { for (const el of document.querySelectorAll('.is-highlighted')) if (el.id) window.__rings[el.id] = true }
  // document, not documentElement: an init script runs BEFORE the root element exists.
  new MutationObserver(seen).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] }); seen()
  ;(async () => { try { const m = await import('/src/charts/echarts.ts'); window.__echarts = m.echarts } catch (e) { window.__hookError = String(e) } })()
})()`

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'] })

async function makeContext(theme) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  await ctx.addInitScript(([t, th]) => { localStorage.setItem('finance_token', t); localStorage.setItem('finance.theme', th); localStorage.setItem('finance.chartDecals', 'off') }, [TOKEN, theme])
  await ctx.addInitScript(INIT)
  const themeEntry = { value: theme, updated_at: new Date().toISOString() }
  await ctx.route('**/api/v1/**', async (route) => { const req = route.request(); const m = req.method()
    if (/\/api\/v1\/prefs/.test(req.url())) {
      if (m === 'GET') { let body = { prefs: {} }; try { body = await (await route.fetch()).json() } catch (e) { problem(`GET /prefs unreadable (${e.message})`) }
        body.prefs = { ...body.prefs, theme: themeEntry }; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }) }
      report.prefsWrites.push({ theme, method: m }); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ prefs: { theme: themeEntry } }) }) }
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return route.continue()
    report.writesBlocked.push({ theme, method: m, url: req.url() })
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }) })
  return ctx
}

try {
  for (const theme of THEMES) {
    const ctx = await makeContext(theme)
    const page = await ctx.newPage()
    const errors = []
    // "Failed to load resource" says nothing on its own; the response log names the URL, so a
    // console complaint can be read back to the request that caused it.
    page.on('response', (r) => { if (r.status() >= 400) report.badResponses.push({ theme, status: r.status(), method: r.request().method(), url: r.url() }) })
    page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    const drain = (step, asNote = false) => {
      if (!errors.length) return
      const urls = [...new Set(report.badResponses.map((b) => `${b.status} ${b.method} ${b.url.replace(BASE, '')}`))]
      // A bare "Failed to load resource" is the browser reporting an answer the APP handled —
      // the dev book has no partner paycheck, so /paycheck/breakdown?person_id=2 is a 404 by
      // shape. Noted with its URL, never a motion problem; a real script error still is one.
      const fetchesOnly = errors.every((e) => /Failed to load resource/i.test(e))
      if (asNote || fetchesOnly) note(theme, step, fetchesOnly && !asNote ? 'the book answered 4xx/5xx for a feed this page asks for' : 'console errors (expected here)', { errors: errors.slice(0, 4), urls: urls.slice(-6) })
      else problem(`${theme} ${step}: console — ${errors.slice(0, 4).join(' | ')} — failed responses: ${urls.slice(-6).join(', ')}`)
      errors.length = 0
    }
    const shot = async (name, full = false) => { const file = path.join(OUT, `${theme}-${name}.png`); await page.screenshot({ path: file, fullPage: full }); files.push(path.basename(file)) }

    // A. Settings' shape. One scroll to the foot first: every card owns its own fetch and grows.
    if (STEPS.includes('settings') || STEPS.includes('rows')) {
      await page.goto(BASE + '/settings', { waitUntil: 'networkidle' }); await sleep(2500)
      await page.evaluate(() => scrollTo(0, document.body.scrollHeight)); await sleep(1500); await page.evaluate(() => scrollTo(0, 0)); await sleep(800)
      const shape = await page.evaluate((ids) => ({ heads: [...document.querySelectorAll('h2.settings-section')].map((h) => ({ id: h.id, text: h.textContent.trim() })),
        chips: [...document.querySelectorAll('.page-frame-scope .segmented button')].map((b) => b.textContent.trim()), retired: !!document.getElementById('app-settings'),
        anchors: ids.map((i) => { const el = document.getElementById(i); return { id: i, present: !!el, card: !!el && el.classList.contains('card') } }) }), ANCHORS)
      check(theme, 'settings', 'the five section headings are present, in spec 3.1 order', shape.heads.map((h) => h.id).join(',') === 'sec-household,sec-planning,sec-account,sec-integrations,sec-data', shape.heads)
      check(theme, 'settings', 'the sticky rail carries the five chips', shape.chips.join(',') === 'Household,Planning,Account,Integrations,Data', shape.chips)
      check(theme, 'settings', 'plan-assumptions and price-refresh are cards, app-settings is retired', shape.anchors.every((a) => a.present && a.card) && !shape.retired, shape)
      await shot('settings-top'); await shot('settings-full', true); drain('settings') }
    // B. no empty half rows: group the grid's children by row top, measure how far right the widest one
    //    reaches. A lone span-6 leaves half the grid bare (~0.48); a filled row reads ~1.0.
    if (STEPS.includes('rows')) {
      const rows = await page.evaluate(() => { const grid = document.querySelector('.settings-page .card-grid') ?? document.querySelector('.card-grid'); if (!grid) return null
        const g = grid.getBoundingClientRect(); const map = new Map()
        for (const k of [...grid.children].filter((c) => c.getClientRects().length)) { const r = k.getBoundingClientRect(); const key = Math.round(r.top)
          const cur = map.get(key) ?? { right: 0, names: [] }; cur.right = Math.max(cur.right, r.right); cur.names.push(k.id || (k.tagName.toLowerCase() + '.' + String(k.className).split(' ')[0])); map.set(key, cur) }
        return [...map.entries()].map(([top, v]) => ({ top, coverage: +((v.right - g.left) / g.width).toFixed(3), names: v.names })) })
      const thin = (rows ?? []).filter((r) => r.coverage < 0.9)
      check(theme, 'rows', 'every card-grid row is filled to the grid right edge', !!rows && thin.length === 0, { rows: rows ? rows.length : null, thin })
      // The reviews' Settings eyeball, as evidence rather than as a vote: the two-column
      // .system-facts either side of its 721px breakpoint, the Activity list's scroll cap, and
      // the same page at the compact density.
      // The cap rides the SCROLL BOX (.settings-scroll, max-height 420px), not the list inside it.
      const facts = await page.evaluate(() => { const dl = document.querySelector('.system-facts'); const box = document.querySelector('#activity .settings-scroll'); const list = document.querySelector('#activity .activity-list')
        return { factsCols: dl ? getComputedStyle(dl).gridTemplateColumns : null, factsDisplay: dl ? getComputedStyle(dl).display : null,
          activity: box ? { maxHeight: getComputedStyle(box).maxHeight, overflowY: getComputedStyle(box).overflowY, boxH: Math.round(box.getBoundingClientRect().height), scrollH: box.scrollHeight, listH: list ? Math.round(list.getBoundingClientRect().height) : null } : null,
          density: document.documentElement.dataset.density ?? null, width: innerWidth } })
      check(theme, 'rows', 'the Activity feed is capped and scrolls inside its own box', !!facts.activity && facts.activity.maxHeight === '420px' && facts.activity.overflowY === 'auto' && facts.activity.boxH <= 421, facts.activity)
      note(theme, 'rows', 'the System card facts pair up and Activity keeps its scroll cap at 1440px', facts)
      await page.setViewportSize({ width: 721, height: 900 }); await sleep(1200)
      const at721 = await page.evaluate(() => { const dl = document.querySelector('.system-facts'); return { cols: dl ? getComputedStyle(dl).gridTemplateColumns : null, display: dl ? getComputedStyle(dl).display : null, width: innerWidth } })
      await shot('settings-721')
      await page.setViewportSize({ width: 1400, height: 900 }); await sleep(1200)
      const at1400 = await page.evaluate(() => { const dl = document.querySelector('.system-facts'); return { cols: dl ? getComputedStyle(dl).gridTemplateColumns : null, display: dl ? getComputedStyle(dl).display : null, width: innerWidth } })
      note(theme, 'rows', 'the .system-facts grid at ~721px and ~1400px', { at721, at1400 })
      await page.setViewportSize(VIEWPORT); await sleep(800)
      // Compact density, then back: a chip has to land its band below the rail at BOTH.
      await page.evaluate(() => { document.documentElement.dataset.density = 'compact' }); await sleep(600)
      await page.locator('.page-frame-scope .segmented button').filter({ hasText: /^Data$/ }).click(); await sleep(1200)
      const compact = await page.evaluate(() => { const h = document.getElementById('sec-data'); const scope = document.querySelector('.page-frame-scope')
        return { density: document.documentElement.dataset.density, bandTop: h ? Math.round(h.getBoundingClientRect().top) : null, railBottom: scope ? Math.round(scope.getBoundingClientRect().bottom) : null } })
      check(theme, 'rows', 'at the compact density a chip still lands its band BELOW the sticky rail', compact.bandTop !== null && compact.railBottom !== null && compact.bandTop >= compact.railBottom - 2, compact)
      await shot('settings-compact')
      await page.evaluate(() => { delete document.documentElement.dataset.density }); await sleep(600); await page.evaluate(() => scrollTo(0, 0)); await sleep(600)
      drain('rows') }
    // C. the rail: a chip scrolls its heading under the sticky row and marks itself active; scrolling by
    //    hand hands the chip back, which is the IntersectionObserver's job rather than the click's.
    if (STEPS.includes('rail')) {
      // ONLY_STEP=rail skips walk A, which is what normally puts the page on /settings.
      if (!page.url().includes('/settings')) { await page.goto(BASE + '/settings', { waitUntil: 'networkidle' }); await sleep(2500) }
      for (const [id, label] of SECTIONS) {
        await page.locator('.page-frame-scope .segmented button').filter({ hasText: new RegExp(`^${label}$`) }).click(); await sleep(900)
        const r = await page.evaluate((i) => { const h = document.getElementById(i); const scope = document.querySelector('.page-frame-scope')
          return { top: h ? Math.round(h.getBoundingClientRect().top) : null, inset: scope ? Math.round(scope.getBoundingClientRect().bottom) : 0,
            atEnd: Math.abs(document.documentElement.scrollHeight - scrollY - innerHeight) < 4,   // the last section cannot scroll further
            active: [...document.querySelectorAll('.page-frame-scope .segmented button')].filter((b) => b.classList.contains('active') || b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim()) } }, id)
        const landed = r.top !== null && r.top >= -8 && (r.top <= r.inset + 160 || r.atEnd)
        check(theme, 'rail', `${label}: the chip scrolls its heading under the rail and marks itself active`, landed && r.active.length === 1 && r.active[0] === label, r) }
      await page.evaluate(() => { const h = document.getElementById('sec-household'); scrollTo(0, h.getBoundingClientRect().top + scrollY - 40) }); await sleep(1200)
      const follow = await page.evaluate(() => [...document.querySelectorAll('.page-frame-scope .segmented button')].filter((b) => b.classList.contains('active') || b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim()))
      check(theme, 'rail', 'scrolling back to the top hands the active chip to Household', follow.join(',') === 'Household', follow); await shot('settings-rail'); drain('rail') }
    // D. the four old card hashes still ring; the two new ones exist; a #sec- hash scrolls WITHOUT one.
    if (STEPS.includes('anchors')) {
      for (const id of [...RINGS, ...ANCHORS, 'sec-planning']) {
        await page.evaluate((i) => window.__watch(i), id)
        await page.goto(`${BASE}/settings#${id}`, { waitUntil: 'commit' }); await sleep(7000)
        const r = await page.evaluate((i) => { const el = document.getElementById(i); const scope = document.querySelector('.page-frame-scope')
          return { rang: !!window.__rings[i], top: el ? Math.round(el.getBoundingClientRect().top) : null, railBottom: scope ? Math.round(scope.getBoundingClientRect().bottom) : null } }, id)
        const wantsRing = id !== 'sec-planning'
        check(theme, 'anchors', `#${id} lands near the top and ${wantsRing ? 'rings' : 'does NOT ring'}`, r.top !== null && r.top >= -8 && r.top < 420 && r.rang === wantsRing, r)
        // Lane C gave the cards scroll-margin-top so a hash lands BELOW the sticky rail, not under it.
        check(theme, 'anchors', `#${id} lands below the sticky rail, not under it`, r.top !== null && r.railBottom !== null && r.top >= r.railBottom - 2, r) }
      await shot('settings-anchor'); drain('anchors') }
    // E. the pace strip. The 415(c) label is judged against the DATA: the profiles endpoint (a GET, so the
    //    fence lets it by) says whether an in-force profile actually carries a match policy.
    if (STEPS.includes('pace')) {
      await page.goto(BASE + '/paycheck', { waitUntil: 'networkidle' }); await sleep(3500)
      // The strip is below the fold on this page, and the reveal timeline holds it dim until it
      // is seen: scroll it into view and let it finish, or the screenshot photographs a ghost.
      await page.evaluate(() => { const c = [...document.querySelectorAll('section.card')].find((x) => /Contribution pace/i.test(x.querySelector('h2')?.textContent ?? '')); c?.scrollIntoView({ block: 'center' }) }); await sleep(1800)
      const strip = await page.evaluate(() => ({ notes: [...document.querySelectorAll('.pace-note')].map((n) => n.innerText.replace(/\s+/g, ' ').trim()),
        rows: [...document.querySelectorAll('.pace-row')].map((r) => { const tick = r.querySelector('.pace-soft-tick'); const meter = r.querySelector('.pace-meter')
          return { name: (r.querySelector('.pace-name')?.innerText ?? '').replace(/\s+/g, ' ').trim(), tick: !!tick, left: tick ? tick.style.left || getComputedStyle(tick).left : null,
            meterW: meter ? Math.round(meter.getBoundingClientRect().width) : null, valuetext: meter ? meter.getAttribute('aria-valuetext') : null,
            cta: (r.querySelector('.pace-cta')?.innerText ?? '').replace(/\s+/g, ' ').trim(),
            figures: (r.querySelector('.pace-figures')?.innerText ?? '').replace(/\s+/g, ' ').trim() } }) }))
      const espp = strip.rows.find((r) => /ESPP/i.test(r.name)); const total = strip.rows.find((r) => /415\(c\)/.test(r.name))
      // WHICH ESPP claims this book can answer is decided by the limits catalogue, not by the
      // page: with no `limit_espp_423` entered for the year the row is the CTA row BY DESIGN
      // (spec §1.4 "missing → the CTA row, no meter, as today"; §1.8 "missing limit → CTA
      // item"), and a row with no track can carry neither a soft tick nor a practical figure.
      const year = new Date().getFullYear()
      const catalogue = await (await page.request.get(`${API}/api/v1/limits?year=${year}`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()
      const esppLimit = (catalogue.items ?? []).find((i) => i.key === 'limit_espp_423')?.value ?? null
      if (!espp) note(theme, 'pace', 'the dev book shows no ESPP row (nobody enrolled across the window)', strip.rows.map((r) => r.name))
      else {
        check(theme, 'pace', 'the ESPP row names its purchase-year window beside its label', /purchase/i.test(espp.name), espp.name)
        check(theme, 'pace', 'a note line states each half and the full-purchase-year projection', strip.notes.some((n) => /(estimated|entered)/i.test(n) && /(full purchase year|not contributing now)/i.test(n)), strip.notes)
        if (esppLimit === null) note(theme, 'pace', `no limit_espp_423 is entered for ${year}, so the ESPP row is the CTA row by design (spec §1.4) — no track, hence no soft tick and no practical figure`, { esppLimit, name: espp.name, figures: espp.figures, cta: espp.cta, tick: espp.tick })
        else { const pct = !espp.left ? null : espp.left.trim().endsWith('%') ? parseFloat(espp.left) : espp.meterW ? +((parseFloat(espp.left) / espp.meterW) * 100).toFixed(1) : null
          check(theme, 'pace', 'the ESPP row carries a soft tick inside its own track', espp.tick && pct !== null && pct > 50 && pct < 100, { left: espp.left, meterW: espp.meterW, pct })
          check(theme, 'pace', 'the ESPP row names its practical cap', /practical/i.test(`${espp.figures} ${espp.valuetext ?? ''}`), espp) }
        // Whichever branch the book takes, the row has to say ONE of the two things.
        check(theme, 'pace', 'a limitless ESPP row offers the call to action instead of a bare figure', esppLimit !== null || /enter this year/i.test(espp.cta), { esppLimit, cta: espp.cta }) }
      const profiles = await (await page.request.get(`${API}/api/v1/paycheck/profiles`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()
      const inForce = (Array.isArray(profiles) ? profiles : []).filter((p) => p.in_force)
      const matched = inForce.map((p) => Number(p.match_rate_1) * Number(p.match_band_1) + Number(p.match_rate_2) * Number(p.match_band_2) > 0)
      if (!total) problem(`${theme} pace: no 415(c) row on /paycheck`)
      else if (new Set(matched).size !== 1) note(theme, 'pace', 'the in-force profiles disagree about the match, so the label cannot be judged from the API alone', { label: total.name, inForce })
      else check(theme, 'pace', `the 415(c) label says "${matched[0] ? 'incl.' : 'excludes'} employer match", as this book demands`, matched[0] ? /incl\. employer match/.test(total.name) : /excludes employer match/.test(total.name),
        { label: total.name, inForce: inForce.map((p) => ({ person_id: p.person_id, r1: p.match_rate_1, b1: p.match_band_1, r2: p.match_rate_2, b2: p.match_band_2 })) })
      await shot('paycheck-pace')
      const paceCard = page.locator('section.card').filter({ has: page.locator('h2', { hasText: /Contribution pace/i }) }).first()
      if (await paceCard.count()) { await paceCard.screenshot({ path: path.join(OUT, `${theme}-pace-card.png`) }); files.push(`${theme}-pace-card.png`) }
      drain('pace') }
    // F. "What moved": bars from a value axis, per-bar group colour, the lede, the toggle.
    if (STEPS.includes('movers')) {
      await page.goto(BASE + '/net-worth', { waitUntil: 'networkidle' }); await sleep(3500)
      const found = await page.evaluate(() => { const c = [...document.querySelectorAll('section.chart-card')].find((x) => /What moved/i.test(x.querySelector('h2')?.textContent ?? ''))
        if (!c) return false; c.dataset.paceTarget = '1'; c.scrollIntoView({ block: 'center' }); return true })   // the one-shot draws it once seen
      if (!found) problem(`${theme} movers: no "What moved" chart card on /net-worth`)
      else { await sleep(2000)
        const read = () => page.evaluate(() => { const c = document.querySelector('section.chart-card[data-pace-target]'); const host = c.querySelector('[_echarts_instance_]')
          const inst = host && window.__echarts ? window.__echarts.getInstanceByDom(host) : null; const o = inst ? inst.getOption() : null; const cv = c.querySelector('canvas')
          return { text: c.innerText.replace(/\s+/g, ' ').trim().slice(0, 260), lede: (c.querySelector('.chart-lede')?.innerText ?? '').replace(/\s+/g, ' ').trim(), buttons: [...c.querySelectorAll('.segmented button')].map((b) => b.textContent.trim()), painted: cv ? !!(window.__sig(cv) ?? {}).painted : false,
            x: o ? o.xAxis.map((a) => a.type) : null, y: o ? o.yAxis.map((a) => ({ type: a.type, inverse: !!a.inverse })) : null,
            series: o ? o.series.map((s) => ({ type: s.type, n: (s.data ?? []).length, coloured: (s.data ?? []).filter((d) => d && d.itemStyle && d.itemStyle.color).length, barMaxWidth: s.barMaxWidth })) : null } })
        const g = await read()
        check(theme, 'movers', 'horizontal bars: value x-axis, inverted category y-axis, one bar series', g.painted && g.series?.[0]?.type === 'bar' && g.x?.[0] === 'value' && g.y?.[0]?.type === 'category' && g.y?.[0]?.inverse === true, { painted: g.painted, x: g.x, y: g.y, series: g.series })
        check(theme, 'movers', 'every bar carries its own group colour', (g.series?.[0]?.coloured ?? -1) === (g.series?.[0]?.n ?? -2), g.series)
        check(theme, 'movers', 'the .chart-lede reads from -> to with both totals, the delta and the percent', /→/.test(g.lede) && (g.lede.match(/\$/g) ?? []).length >= 3 && /%/.test(g.lede), g.lede || g.text.slice(0, 180))
        check(theme, 'movers', 'the Groups and Accounts toggle is on the card', g.buttons.includes('Groups') && g.buttons.includes('Accounts'), g.buttons); await shot('networth-movers-groups')
        // The reviews' movers eyeball, as EVIDENCE: where the extreme bars end in pixels against the
        // grid's own edges, and how much room an outside-end label has before the canvas cuts it.
        const room = await page.evaluate(() => { const c = document.querySelector('section.chart-card[data-pace-target]'); const host = c.querySelector('[_echarts_instance_]')
          const inst = host && window.__echarts ? window.__echarts.getInstanceByDom(host) : null; if (!inst) return null
          const o = inst.getOption(); const data = (o.series[0].data ?? []).map((d) => (typeof d === 'object' ? d.value : d))
          const w = inst.getWidth(); const grid = o.grid[0]; const gl = grid.left, gr = w - grid.right
          const px = (v) => { try { return Math.round(inst.convertToPixel({ xAxisIndex: 0 }, v)) } catch { return null } }
          const max = Math.max(...data), min = Math.min(...data)
          const ctx = c.querySelector('canvas').getContext('2d'); ctx.save(); ctx.font = '11px sans-serif'
          const label = (v) => { const s = (v > 0 ? '+' : '') + '$' + Math.round(Math.abs(v)).toLocaleString(); return Math.ceil(ctx.measureText(s).width) }
          const out = { width: w, gridLeft: gl, gridRight: gr, max, min, maxEndPx: px(max), minEndPx: px(min), maxLabelPx: label(max), minLabelPx: label(min) }
          ctx.restore()
          out.rightRoom = out.maxEndPx === null ? null : gr + grid.right - out.maxEndPx - 5 - out.maxLabelPx   // canvas edge - (bar end + 5px offset + label)
          out.leftRoom = out.minEndPx === null ? null : out.minEndPx - 5 - out.minLabelPx
          return out })
        note(theme, 'movers', 'outside-end bar labels: room left before the canvas edge (negative = clipped)', room)
        await page.locator('section.chart-card[data-pace-target] .segmented button').filter({ hasText: /^Accounts$/ }).click(); await sleep(1600); const a = await read()
        check(theme, 'movers', 'Accounts mode redraws with at most eleven rows (ten plus Other accounts)', a.painted && (a.series?.[0]?.n ?? 0) >= 1 && a.series[0].n <= 11, a.series)
        await shot('networth-movers-accounts')
        const card = page.locator('section.chart-card[data-pace-target]')
        await card.screenshot({ path: path.join(OUT, `${theme}-movers-card.png`) }); files.push(`${theme}-movers-card.png`)
        drain('movers') } }
    await page.close(); await ctx.close()
  }
} finally {
  // No sweep: the fence answered every write from memory, so there is nothing to undo. A future
  // edit that opens a hole shows up as a fenced write with no owner in writesBlocked.
  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ ...report, files }, null, 1))
  await browser.close()
}
console.log(`checks ${report.checks.filter((c) => c.ok === true).length} ok, ${report.checks.filter((c) => c.ok === false).length} failed, ${report.checks.filter((c) => c.ok === null).length} noted; ${report.writesBlocked.length} writes fenced, ${report.prefsWrites.length} prefs writes stubbed`)
if (report.problems.length) { for (const p of report.problems) console.log('  PROBLEM ' + p); process.exit(1) }
console.log('PACE SMOKE OK')
