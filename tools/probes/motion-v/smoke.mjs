// tools/probes/motion-v/smoke.mjs — the motion & polish smoke (lane V, 2026-09-05 spec §10).
// Recipe: tools/probes/README.md. READ-ONLY BY CONSTRUCTION: every non-GET /api call is fenced and
// answered from memory (PATCH /prefs included), so no run can persist anything. Instruments lifted
// from the 2026-09-05 UX-pass probes: per-frame rAF paint tracer, buffered layout-shift observer,
// ECharts prototype setOption/dispose wrapper. Needs the dev stack, uvicorn restarted after merges.
// Env: SMOKE_OUT, TOKEN_FILE, APP_BASE, EDGE_PATH, PLAYWRIGHT_CORE, ONLY_THEME, ONLY_STEP.
//
// SEVEN DEVIATIONS from the plan's draft, each keeping the CLAIM and changing only the driving:
//   a. The entrance's per-card sequence carries each sample's OWN frame time. The draft filtered
//      the card out of the frames that had none yet and then indexed the UNFILTERED frame list
//      with the filtered index, which reads the span off the wrong clock.
//   b. The reveal is read off TOP-LEVEL cards only. `.page-frame-body .card .card` sets
//      `animation-name: none` (panels.css, the nested-group rule), so a nested card reads the
//      registered initial --reveal of 1 wherever it sits and would answer for its parent.
//   c. Settings' Accounts card is addressed by its id (`section#accounts`) rather than by a
//      `^Accounts` text filter — `hasText` matches a substring anywhere, and several sections
//      of that page contain the word.
//   d. The drill hunts for a click point that actually drills and records which one worked; a
//      miss that left the bars alone would otherwise pass "no blank frame, no dispose" by
//      never having moved. The theme swap is undone after it is measured, so the steps that
//      follow it run — and screenshot — in the theme the file name claims.
//   e. Screenshots are viewport-sized except the CLS and reduced-motion ones: this smoke's
//      subject IS the viewport (a parked scroll position, a stuck row, a below-fold canvas),
//      and Playwright's fullPage capture resizes it.
//   f. The entrance walk SCROLLS to the first mounted-but-unpainted chart inside its paint
//      window. M1's one-shot holds the first paint of any chart less than 20% on screen, which
//      at 1440x900 is every chart on Taxes and Portfolio: without the scroll the step measures
//      an entrance that has not been allowed to happen yet, which is a different claim.
//   g. Each CLS route is loaded TWICE and the worst reported. Whether a block that appears from
//      nothing beats the first body paint is a race — Paycheck's owner chips land either side
//      of it and score 0.047 or 0.39 — and one sample makes the verdict luck.
//
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
const OUT = process.env.SMOKE_OUT ?? path.join(process.cwd(), 'scratchpad', 'motion-smoke')
mkdirSync(OUT, { recursive: true })
const TOKEN = readFileSync(process.env.TOKEN_FILE ?? path.join(OUT, 'token.txt'), 'utf8').trim()
const BASE = process.env.APP_BASE ?? 'http://localhost:5173'
const EDGE = process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const VIEWPORT = { width: 1440, height: 900 }
// 13 links, the sidebar's own order (src/components/navItems.ts).
const NAV = ['Overview', 'Monthly update', 'Net worth', 'Portfolio', 'Spending', 'Credit cards', 'Paycheck', 'Comp', 'ESPP', 'Taxes', 'Projection', 'Calendar', 'Settings']
const CLS_ROUTES = [['/paycheck', 'Paycheck'], ['/espp', 'ESPP'], ['/comp', 'Comp'], ['/net-worth', 'Net worth'], ['/', 'Overview']]
const ENTRANCE = [['/net-worth', 'Net worth'], ['/taxes', 'Taxes'], ['/portfolio', 'Portfolio']]
const THEMES = ['dark', 'light'].filter((t) => !process.env.ONLY_THEME || t === process.env.ONLY_THEME)
const STEPS = ['entrance', 'nav', 'cls', 'indicator', 'hint', 'reveal', 'belowfold', 'drill', 'themeswap', 'reduced', 'errors'].filter((s) => !process.env.ONLY_STEP || s === process.env.ONLY_STEP)
const NOISE = /favicon|DevTools|\[vite\]|@vite\/client|React DevTools|React Router Future Flag/i
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const files = []
const report = { generatedAt: new Date().toISOString(), base: BASE, themes: THEMES, steps: STEPS, checks: [], writesBlocked: [], prefsWrites: [], badResponses: [], problems: [] }
const problem = (m) => report.problems.push(m)
const check = (theme, step, name, ok, observed) => { report.checks.push({ theme, step, name, ok, observed }); if (!ok) problem(`${theme} ${step}: ${name} — observed ${JSON.stringify(observed)}`); return ok }
const note = (theme, step, name, observed) => report.checks.push({ theme, step, name, ok: null, observed })

const INIT = `(() => {
  window.__ls = []; window.__log = []; window.__frames = []; window.__trace = []
  const where = (n) => { if (!n || !n.tagName) return '?'; const p = []; let el = n
    for (let i = 0; i < 3 && el && el.tagName; i++) { p.push(el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(' ').filter(Boolean).slice(0, 2).join('.') : '')); el = el.parentElement }
    return p.join(' < ') }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__ls.push({ t: Math.round(e.startTime), v: +e.value.toFixed(4), src: (e.sources || []).slice(0, 3).map((s) => ({ at: where(s.node), from: [Math.round(s.previousRect.y), Math.round(s.previousRect.height)], to: [Math.round(s.currentRect.y), Math.round(s.currentRect.height)] })) }) }).observe({ type: 'layout-shift', buffered: true }) } catch {}
  window.__cls = (since) => ({ cls: +window.__ls.filter((s) => s.t >= since).reduce((a, s) => a + s.v, 0).toFixed(4), src: window.__ls.filter((s) => s.t >= since && s.v > 0.005).slice(0, 6) })
  window.__sig = (cv) => { const w = cv.width, h = cv.height; if (!w || !h) return null; let d; try { d = cv.getContext('2d').getImageData(0, 0, w, h).data } catch { return null }
    let hash = 0; const uniq = new Set(); for (let y = 0; y < h; y += 9) for (let x = 0; x < w; x += 9) { const i = (y * w + x) * 4; const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]; hash = (hash * 31 + k) >>> 0; uniq.add(k) }
    return { hash, colors: uniq.size, painted: uniq.size >= 4 } }
  window.__paint = (ms) => { window.__frames = []; const t0 = performance.now(); const step = () => { const now = performance.now()
    window.__frames.push({ t: Math.round(now - t0), cards: [...document.querySelectorAll('section.chart-card')].slice(0, 8).map((c) => { const cv = c.querySelector('canvas'); const s = cv ? window.__sig(cv) : null; return { top: Math.round(c.getBoundingClientRect().top), hash: s ? s.hash : null, painted: !!(s && s.painted) } }) })
    if (now - t0 < ms) requestAnimationFrame(step) }; requestAnimationFrame(step) }
  window.__route = (ms) => { window.__trace = []; const t0 = performance.now(); const step = () => { const now = performance.now(); const m = document.getElementById('main'); const h1 = document.querySelector('.page-frame-header h1') || document.querySelector('main h1'); const ind = document.querySelector('.nav-indicator')
    window.__trace.push({ t: Math.round(now - t0), kids: m ? m.childElementCount : -1, chars: m ? m.innerText.trim().length : -1, h1: h1 ? h1.textContent.trim().slice(0, 24) : null, fb: !!document.querySelector('.route-fallback'), tf: ind ? getComputedStyle(ind).transform : null, path: location.pathname })
    if (now - t0 < ms) requestAnimationFrame(step) }; requestAnimationFrame(step) }
  const hook = async () => { try { const m = await import('/src/charts/echarts.ts'); if (window.__hooked) return; window.__hooked = true
    const tmp = document.createElement('div'); const probe = m.echarts.init(tmp, null, { width: 10, height: 10 }); const proto = Object.getPrototypeOf(probe); probe.dispose()
    const title = (i) => { try { const c = i.getDom().closest('section.chart-card'); const h = c && c.querySelector('h2'); return h ? h.textContent.trim().slice(0, 40) : null } catch { return null } }
    const so = proto.setOption; proto.setOption = function (...a) { const o = a[0] || {}; window.__log.push({ kind: 'setOption', t: Math.round(performance.now()), id: this.id, title: title(this), animation: o.animation, animationDuration: o.animationDuration, theme: document.documentElement.dataset.theme }); return so.apply(this, a) }
    const dp = proto.dispose; proto.dispose = function (...a) { window.__log.push({ kind: 'dispose', t: Math.round(performance.now()), id: this.id, title: title(this) }); return dp.apply(this, a) }
  } catch (e) { window.__hookError = String(e) } }; hook()
})()`

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'] })
// The ONE mutable piece: the errors step flips it to 422 to provoke a validation message that
// never reaches the server.
let mutate = { status: 200, body: '{}' }

async function makeContext(theme, reducedMotion = 'no-preference') {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion })
  await ctx.addInitScript(([t, th]) => { localStorage.setItem('finance_token', t); localStorage.setItem('finance.theme', th); localStorage.setItem('finance.chartDecals', 'off') }, [TOKEN, theme])
  await ctx.addInitScript(INIT)
  const themeEntry = { value: theme, updated_at: new Date().toISOString() }
  await ctx.route('**/api/v1/**', async (route) => { const req = route.request(); const m = req.method()
    if (/\/api\/v1\/prefs/.test(req.url())) {
      if (m === 'GET') { let body = { prefs: {} }; try { body = await (await route.fetch()).json() } catch (e) { problem(`GET /prefs unreadable (${e.message})`) }
        body.prefs = { ...body.prefs, theme: themeEntry }; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }) }
      report.prefsWrites.push({ theme, method: m }); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ prefs: { theme: themeEntry } }) }) }
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return route.continue()
    report.writesBlocked.push({ theme, method: m, url: req.url(), answeredWith: mutate.status })
    return route.fulfill({ status: mutate.status, contentType: 'application/json', body: mutate.body }) })
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

    // A. chart entrances last (audit: 1–2 frames). Cold load per route, so the entrance IS the
    //    first paint — EXCEPT where M1's one-shot holds it: a chart less than 20% on screen at
    //    1440x900 (every chart on /taxes and /portfolio) waits to be seen, by design. The tracer
    //    therefore runs across the cold load AND a scroll to the first mounted-but-unpainted
    //    chart, and records which one it had to go and look at.
    if (STEPS.includes('entrance')) {
      for (const [route, label] of ENTRANCE) {
        await page.goto(BASE + route, { waitUntil: 'commit' }); await page.evaluate(() => window.__paint(9000)); await sleep(3000)
        const held = await page.evaluate(() => { const c = [...document.querySelectorAll('section.chart-card')].find((x) => x.querySelector('[_echarts_instance_]') && !x.querySelector('canvas'))
          if (!c) return null; c.scrollIntoView({ block: 'center' }); return (c.querySelector('h2')?.textContent ?? '').trim().slice(0, 40) })
        await sleep(6200)
        const f = await page.evaluate(() => window.__frames)
        const per = (i) => { const seq = f.map((x) => ({ t: x.t, c: x.cards[i] })).filter((x) => x.c)
          const first = seq.findIndex((x) => x.c.painted); if (first < 0) return null
          let changes = 0, lastT = null; for (let k = first + 1; k < seq.length; k++) if (seq[k].c.hash !== seq[k - 1].c.hash) { changes++; lastT = seq[k].t }
          return { firstAt: seq[first].t, changes, span: lastT === null ? 0 : lastT - seq[first].t } }
        const best = (f.at(-1)?.cards ?? []).map((_, i) => per(i)).filter(Boolean).sort((a, b) => b.span - a.span)[0] ?? null
        check(theme, 'entrance', `${label}: a chart draws over ≥300ms of paint deltas`, !!best && best.span >= 300 && best.changes >= 8, { best, samples: f.length, scrolledTo: held })
        await shot(`entrance-${label.toLowerCase().replace(/\s+/g, '-')}`)
      }
      drain('entrance')
    }

    // B. the 13 nav clicks: #main never empty, the old page holds until the new one paints.
    if (STEPS.includes('nav')) {
      await page.goto(BASE + '/', { waitUntil: 'networkidle' }); await sleep(1500)
      for (const label of NAV) {
        const before = await page.evaluate(() => { const h = document.querySelector('.page-frame-header h1') || document.querySelector('main h1'); return h ? h.textContent.trim().slice(0, 24) : null })
        await page.evaluate(() => window.__route(2500))
        await page.locator('nav[aria-label="Primary"] .nav-link').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).click()
        await sleep(2600)
        const t = await page.evaluate(() => window.__trace); const blank = t.filter((r) => r.kids <= 0 || r.chars <= 0)
        check(theme, 'nav', `${label}: #main is non-empty on every frame`, blank.length === 0, { frames: t.length, blank: blank.slice(0, 3) })
        const arrive = t.findIndex((r) => r.h1 !== null && r.h1 !== before); const held = arrive < 0 ? t : t.slice(0, arrive)
        check(theme, 'nav', `${label}: the old page stays visible until the new one paints`, held.every((r) => r.h1 !== null) && !t.some((r) => r.fb), { holdMs: arrive < 0 ? 'no title change' : t[arrive].t, nullH1: held.filter((r) => r.h1 === null).length })
      }
      await shot('nav-walk-end')
      drain('nav')
    }

    // C. CLS on the five known offenders (audit: 0.15–0.22).
    if (STEPS.includes('cls')) {
      // TWICE per route, worst reported: whether a block that appears from nothing beats the
      // first body paint is a RACE (Paycheck's owner chips land either side of it and score
      // 0.047 or 0.39 accordingly), and one sample turns that into luck.
      for (const [route, label] of CLS_ROUTES) {
        const runs = []
        for (let i = 0; i < 2; i++) {
          await page.goto(BASE + route, { waitUntil: 'commit' }); await sleep(4000)
          runs.push(await page.evaluate(() => window.__cls(0)))
          if (i === 0) await shot(`cls-${label.toLowerCase().replace(/\s+/g, '-')}`, true)
        }
        const worst = runs.reduce((a, b) => (b.cls > a.cls ? b : a))
        check(theme, 'cls', `${label}: layout shift ≤ 0.05`, worst.cls <= 0.05, { cls: worst.cls, both: runs.map((r) => r.cls), src: worst.src })
      }
      drain('cls')
    }

    // D. the indicator slides over --t-nav (200ms).
    if (STEPS.includes('indicator')) {
      await page.goto(BASE + '/', { waitUntil: 'networkidle' }); await sleep(1500)
      await page.evaluate(() => window.__route(900))
      await page.locator('nav[aria-label="Primary"] .nav-link').filter({ hasText: /^\s*Spending\s*$/ }).click(); await sleep(1000)
      const ind = (await page.evaluate(() => window.__trace)).filter((r) => r.tf !== null)
      const moves = ind.filter((r, i) => i > 0 && r.tf !== ind[i - 1].tf); const span = moves.length ? moves.at(-1).t - moves[0].t : null
      check(theme, 'indicator', 'the nav indicator transform changes over ~200ms', ind.length > 0 && moves.length >= 4 && span >= 120 && span <= 400, { samples: ind.length, moves: moves.length, spanMs: span, first: moves[0]?.tf ?? null, last: moves.at(-1)?.tf ?? null })
      await shot('nav-indicator')
      drain('indicator')
    }

    // E. an InfoHint under the STUCK scope row stays inside the viewport.
    if (STEPS.includes('hint')) {
      await page.goto(BASE + '/net-worth', { waitUntil: 'networkidle' }); await sleep(2000); await page.evaluate(() => scrollTo(0, 420)); await sleep(600)
      // Park a body hint 24px under the STUCK row rather than hoping one is already there:
      // that gap is the geometry the flip exists for (a bubble opening upward from here is
      // covered by the row), and no scroll offset guesses at it.
      await page.evaluate(() => { const row = document.querySelector('.page-frame-scope'); const b = row ? row.getBoundingClientRect().bottom : 0
        const h = [...document.querySelectorAll('.page-frame-body .info-hint')].find((x) => x.getBoundingClientRect().top + scrollY > b + scrollY)
        if (!h) return; scrollTo(0, h.getBoundingClientRect().top + scrollY - b - 24) })
      await sleep(700)
      const stuck = await page.evaluate(() => !!document.querySelector('.page-frame-scope.is-stuck'))
      const target = await page.evaluate(() => { const row = document.querySelector('.page-frame-scope'); const b = row ? row.getBoundingClientRect().bottom : 0
        const hits = [...document.querySelectorAll('.page-frame-body .info-hint')].filter((x) => { const r = x.getBoundingClientRect(); return r.top > b - 40 && r.top < b + 180 }); if (!hits.length) return false; hits[0].dataset.motionTarget = '1'; return true })
      if (!stuck || !target) note(theme, 'hint', 'no hint sits under the stuck row on /net-worth', { stuck, target })
      else {
        await page.locator('.info-hint[data-motion-target]').click(); await sleep(400)
        const hint = await page.evaluate(() => { const b = document.querySelector('.info-hint-bubble'); if (!b) return null; const r = b.getBoundingClientRect(); const el = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2))
          return { rect: [r.top, r.bottom, r.left, r.right].map(Math.round), vh: innerHeight, vw: innerWidth, below: b.classList.contains('is-below'), z: getComputedStyle(b).zIndex, hit: b === el || b.contains(el) } })
        check(theme, 'hint', 'the bubble is fully inside the viewport and is what the cursor would hit', !!hint && hint.rect[0] >= 0 && hint.rect[1] <= hint.vh && hint.rect[2] >= 0 && hint.rect[3] <= hint.vw && hint.hit, hint)
        await shot('infohint-stuck'); await page.keyboard.press('Escape')
      }
      drain('hint')
    }

    // F. the reveal dial, parked so entry/exit progress is ~0: the reading must be the FLOOR,
    //    not "somewhere dim". Top-level cards only — a nested one runs no reveal at all.
    //    The two edges are NOT the viewport's two edges: panels.css insets both view()
    //    timelines by --sticky-inset (spec §4), so the bottom edge is the viewport's but the
    //    top edge is the STUCK scope row's UNDERSIDE. Parking a card 4px under the viewport
    //    top would bury it behind the row, past the end of its exit range, where reveal-out's
    //    `fill: none` leaves it reading 1 — a pass for the wrong reason.
    //    The floor is read from the page, never retyped here: it is a token, and a smoke that
    //    hard-codes it fails on the tuning pass instead of on the regression.
    if (STEPS.includes('reveal')) {
      await page.goto(BASE + '/net-worth', { waitUntil: 'networkidle' }); await sleep(2500)
      const floor = await page.evaluate(() => +getComputedStyle(document.documentElement).getPropertyValue('--reveal-floor'))
      const near = (v, want) => v !== null && v !== undefined && Math.abs(v - want) <= 0.05
      // The parking corrects itself: the reveal's own `transform: translateY(±6px)` is inside
      // getBoundingClientRect, so a single scrollTo computed from the rect lands ~7px off and
      // leaves NO card straddling the edge at all. Two corrections converge to the pixel.
      const reveal = async (mode) => page.evaluate((m) => {
        const cards = [...document.querySelectorAll('.page-frame-body .card')].filter((c) => c.parentElement === null || c.parentElement.closest('.card') === null)
        if (!cards.length) return null
        // Sticky at top: 0, so the row's bottom IS the line the timelines are inset to. Zero
        // on a page that declares no scope row, which is exactly the un-inset geometry.
        const rowEl = document.querySelector('.page-frame-scope'); const rowBottom = rowEl ? Math.round(rowEl.getBoundingClientRect().bottom) : 0
        const low = cards.find((x) => x.getBoundingClientRect().top + scrollY > innerHeight) ?? cards.at(-1); const r = low.getBoundingClientRect()
        if (m === 'park-bottom') { scrollTo(0, r.top + scrollY - innerHeight + 4); return null }              // 4px of the card visible at the bottom
        if (m === 'park-top') { scrollTo(0, r.top + scrollY + r.height - rowBottom - 4); return null }        // 4px of it left BELOW the row
        if (m === 'fix-bottom') { scrollBy(0, low.getBoundingClientRect().top - (innerHeight - 4)); return null }
        if (m === 'fix-top') { scrollBy(0, low.getBoundingClientRect().bottom - rowBottom - 4); return null }
        const val = (x) => +getComputedStyle(x).getPropertyValue('--reveal'); const box = (x) => x.getBoundingClientRect()
        const edge = cards.find((x) => box(x).top < innerHeight && box(x).bottom > innerHeight), top = cards.find((x) => box(x).top < rowBottom && box(x).bottom > rowBottom)
        // "Mid-page" is simply a card wholly on screen: past its entry range, before its exit
        // range, which is where the grammar promises full brightness. "On screen" starts under
        // the row for the same reason the top edge does.
        const mid = cards.find((x) => box(x).top >= rowBottom && box(x).bottom <= innerHeight)
        return { edge: edge ? val(edge) : null, top: top ? val(top) : null, mid: mid ? val(mid) : null, floor: getComputedStyle(document.documentElement).getPropertyValue('--reveal-floor').trim(), cards: cards.length,
          stuck: !!document.querySelector('.page-frame-scope.is-stuck'), rowBottom,
          inset: getComputedStyle(document.querySelector('.page-frame-body')).getPropertyValue('--sticky-inset').trim(),
          rects: cards.map((x) => [Math.round(box(x).top), Math.round(box(x).bottom)]) }
      }, mode)
      await reveal('park-bottom'); await sleep(400); await reveal('fix-bottom'); await sleep(300); await reveal('fix-bottom'); await sleep(400); const rev = await reveal('read')
      check(theme, 'reveal', `the card straddling the bottom edge sits at the floor (${floor} ±0.05)`, !!rev && near(rev.edge, floor), rev)
      check(theme, 'reveal', 'a mid-page card is fully bright (1.0)', !!rev && rev.mid !== null && rev.mid >= 0.99, rev)
      // The inset is PageFrame's measurement of this page's own row; 0px would mean the effect
      // never ran and every top-edge reading below would be measuring the old geometry.
      check(theme, 'reveal', 'PageFrame wrote the sticky row height onto the body', !!rev && /^\d+(\.\d+)?px$/.test(rev.inset) && parseFloat(rev.inset) > 0, rev && { inset: rev.inset, rowBottom: rev.rowBottom })
      await shot('reveal-bottom-edge')
      await reveal('park-top'); await sleep(400); await reveal('fix-top'); await sleep(300); await reveal('fix-top'); await sleep(400); const rev2 = await reveal('read')
      check(theme, 'reveal', `the card straddling the row's underside mirrors the floor (${floor} ±0.05)`, !!rev2 && near(rev2.top, floor), rev2)
      await shot('reveal-top-edge')

      // The scroll-UP walk, and the inset's own proof (spec §4, §10). Before the inset a card
      // coming back from the top had finished its exit range at the VIEWPORT's top edge — one
      // row-height higher — so it emerged from under the sticky row already at full brightness
      // and the mirror was never seen. One card is followed from the moment its bottom clears
      // the row to the point where 45% of it is showing below it, reading --reveal AND the
      // opacity it actually paints at (they are the same number only while --enter is 1, so
      // both are recorded rather than one inferred from the other).
      const upTarget = await page.evaluate(async () => {
        const wait = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        scrollTo(0, document.documentElement.scrollHeight); await wait(); await wait()
        const rowEl = document.querySelector('.page-frame-scope'); const rowBottom = rowEl ? rowEl.getBoundingClientRect().bottom : 0
        const cards = [...document.querySelectorAll('.page-frame-body .card')].filter((c) => c.parentElement.closest('.card') === null)
        // The card that will emerge FIRST on the way back up: the lowest one already entirely
        // above the row's underside. Tagged, so the walk below follows THAT card and not
        // whichever one happens to be there after a scroll.
        const target = [...cards].reverse().find((c) => c.getBoundingClientRect().bottom <= rowBottom)
        if (!target) return null
        target.dataset.revealUp = '1'
        const h2 = target.querySelector('h2, h3')
        return { title: h2 ? h2.textContent.trim().slice(0, 40) : null, height: Math.round(target.getBoundingClientRect().height), rowBottom: Math.round(rowBottom) }
      })
      if (!upTarget) note(theme, 'reveal', 'no card had fully exited above the row at the document bottom', null)
      else {
        // Fractions of the card's OWN height showing below the row: the exit range is one card
        // height long, so --reveal-range 45% means full brightness at 45% shown.
        const parkUp = async (f) => page.evaluate(async (frac) => {
          const wait = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
          const target = document.querySelector('.page-frame-body .card[data-reveal-up]')
          const rowB = () => { const r = document.querySelector('.page-frame-scope'); return r ? r.getBoundingClientRect().bottom : 0 }
          const h = target.getBoundingClientRect().height, want = Math.round(h * frac)
          for (let i = 0; i < 3; i += 1) { scrollBy(0, target.getBoundingClientRect().bottom - rowB() - want); await wait() }
          await wait()
          const cs = getComputedStyle(target); const shown = Math.round(target.getBoundingClientRect().bottom - rowB())
          return { wantPct: Math.round(frac * 100), shownPx: shown, shownPct: Math.round((shown / h) * 100), reveal: +cs.getPropertyValue('--reveal'), opacity: +cs.opacity,
            stuck: !!document.querySelector('.page-frame-scope.is-stuck'), rowBottom: Math.round(rowB()) }
        }, f)
        const steps = []
        for (const f of [0.01, 0.15, 0.3, 0.45, 0.6]) {
          steps.push(await parkUp(f)); await sleep(250)
          // 1% is where the CLAIM is read (the floor, with 5px of card showing); 15% is where
          // the eye can see it — a 5px sliver photographs as nothing — and 45% is the arrival.
          if (f === 0.01 || f === 0.15 || f === 0.45) await shot(`reveal-up-${Math.round(f * 100)}pct`)
        }
        note(theme, 'reveal', 'scroll-up walk: --reveal and opacity as the card emerges below the stuck row', { target: upTarget, steps })
        const emerging = steps[0], full = steps.find((s) => s.shownPct >= 45) ?? steps.at(-1)
        check(theme, 'reveal', `emerging below the stuck row it reads the floor (${floor} ±0.05), in --reveal AND in painted opacity`,
          near(emerging.reveal, floor) && near(emerging.opacity, floor), emerging)
        check(theme, 'reveal', 'it is fully bright once ~45% of it shows below the row', full.shownPct >= 45 && full.reveal >= 0.99 && full.opacity >= 0.99, full)
        // Monotonic, so the walk is a gradient and not two states with a jump between them.
        check(theme, 'reveal', 'and it brightens monotonically on the way up', steps.every((s, i) => i === 0 || s.reveal >= steps[i - 1].reveal - 0.01), steps)
      }
      drain('reveal')
    }

    // G. a chart below the fold waits to be seen, then draws ONCE.
    if (STEPS.includes('belowfold')) {
      await page.goto(BASE + '/portfolio', { waitUntil: 'networkidle' }); await sleep(3000)
      // A card with a MOUNTED chart, not one showing an empty note: only the former has a
      // first paint to hold.
      const idx = await page.evaluate(() => [...document.querySelectorAll('section.chart-card')].findIndex((c) => c.getBoundingClientRect().top > innerHeight && c.querySelector('[_echarts_instance_]')))
      if (idx < 0) note(theme, 'belowfold', 'no chart card below the fold at 1440x900 on /portfolio', idx)
      else {
        // No canvas IS "has not painted": zrender builds the painter's canvas on the first
        // render, so a held first paint leaves the container with an _echarts_instance_ and
        // nothing to draw on. Both facts are recorded, so the two states stay distinguishable.
        const read = (i) => page.evaluate((n) => { const c = document.querySelectorAll('section.chart-card')[n]; const cv = c.querySelector('canvas'); const h = c.querySelector('h2'); const title = h ? h.textContent.trim().slice(0, 40) : null
          return { title, canvas: !!cv, mounted: !!c.querySelector('[_echarts_instance_]'), painted: cv ? !!(window.__sig(cv) || {}).painted : false, setOptions: window.__log.filter((e) => e.kind === 'setOption' && e.title === title).length } }, i)
        const pre = await read(idx); check(theme, 'belowfold', 'a chart below the fold has not painted yet', pre.painted === false, pre)
        await page.evaluate((n) => document.querySelectorAll('section.chart-card')[n].scrollIntoView({ block: 'center' }), idx); await sleep(1600)
        const post = await read(idx)
        check(theme, 'belowfold', 'it draws once scrolled into view (one-shot)', post.painted === true && post.setOptions > pre.setOptions, { pre, post })
        await shot('belowfold-drawn')
      }
      drain('belowfold')
    }

    // H. the Spending month drill: no dispose, no blank frame (the bar→pie universalTransition morph).
    if (STEPS.includes('drill')) {
      await page.goto(BASE + '/spending', { waitUntil: 'networkidle' }); await sleep(2500)
      const point = async (fx, fy) => page.evaluate(([x, y]) => { const el = [...document.querySelectorAll('section.chart-card')].find((c) => /spend/i.test(c.querySelector('h2')?.textContent ?? ''))
        const cv = el && el.querySelector('canvas'); if (!cv) return null; const r = cv.getBoundingClientRect(); return { x: r.x + r.width * x, y: r.y + r.height * y } }, [fx, fy])
      const drilledNow = () => page.evaluate(() => [...document.querySelectorAll('section.chart-card h2')].some((h) => /Spending breakdown/i.test(h.textContent)))
      let bar = null
      for (const [fx, fy] of [[0.6, 0.7], [0.82, 0.75], [0.5, 0.6], [0.7, 0.8], [0.4, 0.5], [0.9, 0.85]]) {
        const p = await point(fx, fy); if (!p) break
        await page.mouse.click(p.x, p.y); await sleep(1400)
        if (await drilledNow()) { bar = { ...p, fx, fy }; const back = page.getByRole('button', { name: /All months/ }); if (await back.count()) { await back.first().click(); await sleep(1400) } break }
      }
      if (!bar) note(theme, 'drill', 'no click point on the spending bars drilled a month', null)
      else {
        await page.evaluate(() => { window.__log.length = 0; window.__paint(2200) })
        await page.mouse.click(bar.x, bar.y); await sleep(2400)
        const frames = await page.evaluate(() => window.__frames); const log = await page.evaluate(() => window.__log)
        const blankFrames = frames.filter((f) => f.cards[0] && f.cards[0].painted === false)
        const morphed = await drilledNow()
        check(theme, 'drill', 'the drill morphs with no blank frame', blankFrames.length === 0 && morphed, { frames: frames.length, blank: blankFrames.slice(0, 3), clickedAt: [bar.fx, bar.fy], morphed })
        check(theme, 'drill', 'the drill disposes no chart instance', log.filter((e) => e.kind === 'dispose').length === 0, log.filter((e) => e.kind === 'dispose'))
        await shot('drill-pie')
        const back = page.getByRole('button', { name: /All months/ }); if (await back.count()) await back.first().click()
      }
      drain('drill')
    }

    // I. a theme swap re-inits WITHOUT replaying the entrance (the cached-paint rule).
    if (STEPS.includes('themeswap')) {
      await page.goto(BASE + '/net-worth', { waitUntil: 'networkidle' }); await sleep(3000); await page.evaluate(() => { window.__log.length = 0 })
      await page.getByRole('button', { name: /^Switch to (light|dark) theme$/ }).click(); await sleep(1800)
      const post = (await page.evaluate(() => window.__log)).filter((e) => e.kind === 'setOption')
      check(theme, 'themeswap', 'every setOption after a theme swap is animation-free', post.length > 0 && post.every((e) => e.animation === false || e.animationDuration === 0), post.slice(0, 6))
      await shot('theme-swapped')
      // …and back, so the steps below run in the theme their file names claim.
      await page.getByRole('button', { name: /^Switch to (light|dark) theme$/ }).click(); await sleep(1200)
      drain('themeswap')
    }

    // J. reduced motion — its own context, so the emulation covers first paint.
    if (STEPS.includes('reduced')) {
      const rctx = await makeContext(theme, 'reduce'); const rpage = await rctx.newPage()
      await rpage.goto(BASE + '/net-worth', { waitUntil: 'networkidle' }); await sleep(3000)
      const rm = await rpage.evaluate(() => { const cs = getComputedStyle(document.documentElement); const tok = (n) => cs.getPropertyValue(n).trim()
        const running = document.getAnimations().filter((a) => { const d = a.effect && a.effect.getTiming().duration; return typeof d === 'number' && d > 0 })
        return { tokens: ['--t-page', '--t-enter', '--t-stagger', '--t-xfade', '--t-nav'].map(tok), floor: tok('--reveal-floor'), animations: running.map((a) => a.animationName || 'anon').slice(0, 5),
          reveals: [...new Set([...document.querySelectorAll('.page-frame-body .card')].map((c) => getComputedStyle(c).getPropertyValue('--reveal').trim()))], charts: window.__log.filter((e) => e.kind === 'setOption').map((e) => e.animation) } })
      check(theme, 'reduced', 'every motion token is 0ms', rm.tokens.every((v) => v === '0ms'), rm.tokens)
      check(theme, 'reduced', 'the reveal floor is 1 and every card reads 1', rm.floor === '1' && rm.reveals.every((v) => Number(v) === 1), { floor: rm.floor, reveals: rm.reveals })
      check(theme, 'reduced', 'no timed animation is running', rm.animations.length === 0, rm.animations)
      check(theme, 'reduced', 'charts init with animation:false', rm.charts.length > 0 && rm.charts.every((a) => a === false), rm.charts.slice(0, 6))
      const rfile = path.join(OUT, `${theme}-reduced-motion.png`); await rpage.screenshot({ path: rfile, fullPage: true }); files.push(path.basename(rfile))
      await rpage.close(); await rctx.close()
    }

    // K. the error grammar: ONE banner on a stubbed 500, no Retry on a validation error.
    if (STEPS.includes('errors')) {
      await page.route('**/api/v1/espp/**', (r) => r.request().method() === 'GET' ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"boom"}' }) : r.continue())
      await page.goto(BASE + '/espp', { waitUntil: 'networkidle' }); await sleep(2500)
      const banners = await page.evaluate(() => [...document.querySelectorAll('.error-banner')].map((b) => ({ text: b.innerText.trim().slice(0, 200), buttons: [...b.querySelectorAll('button')].map((x) => x.textContent.trim()) })))
      check(theme, 'errors', 'a 500 on ESPP yields exactly ONE banner', banners.length === 1, banners)
      check(theme, 'errors', 'the banner speaks the house grammar', banners.length === 1 && /Couldn't load .+ — the server had a problem \(HTTP 500\)/.test(banners[0].text), banners[0] ?? null)
      check(theme, 'errors', 'a load failure offers Retry', banners.length === 1 && banners[0].buttons.some((t) => /Retry/i.test(t)), banners[0] ?? null)
      await shot('espp-500-banner'); await page.unroute('**/api/v1/espp/**')
      drain('errors', true)
      mutate = { status: 422, body: '{"detail":[{"loc":["body","name"],"msg":"Value error, name is required"}]}' }   // fenced: the POST never leaves the browser
      await page.goto(BASE + '/settings', { waitUntil: 'networkidle' }); await sleep(2500)
      const card = page.locator('section#accounts')
      await card.getByLabel('Account name').fill('zzz-motion-smoke')
      await card.getByRole('button', { name: /Add account/ }).click(); await sleep(1200)
      // The form's banner sits at the FOOT of the form, so the card's first 400 characters are
      // its fields: the message is read off the banner itself.
      const form = await card.evaluate((el) => ({ banners: [...el.querySelectorAll('.error-banner')].map((b) => b.innerText.trim().slice(0, 160)), retries: [...el.querySelectorAll('button')].filter((b) => /Retry/i.test(b.textContent)).length }))
      check(theme, 'errors', 'a Settings validation error shows NO Retry', form.retries === 0, form)
      check(theme, 'errors', 'the validation error is stated inline', form.banners.some((t) => /required|Couldn't save|invalid/i.test(t)), form.banners)
      await shot('settings-validation'); mutate = { status: 200, body: '{}' }
      drain('errors', true)
    }

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
console.log('MOTION SMOKE OK')
