// tools/probes/charts-c7/smoke.mjs — the chart-grammar visual smoke (charts C7 Task 4, spec §17).
// How to run it: see tools/probes/README.md (dev stack up, TOKEN_FILE minted from /auth/login).
//
// What it proves, against the REAL app (real echarts, real dev data, headless Edge) rather
// than jsdom:
//   1. Every chart page renders in BOTH themes at 1600x1000 with no console error, no
//      pageerror and no failed request. This is the 2026-08-25 class of bug: a real category
//      name collided with a sankey node, echarts threw inside setOption, and the route blanked
//      for good — reloading could not fix it. No unit test saw it; a browser walk does.
//   2. Every <canvas> sits inside a `.chart-card` section — the spec §6 promise that there is
//      exactly ONE chart mount. A bare canvas means a page grew its own chart chrome again.
//   3. Every canvas actually PAINTED: pixels are sampled and a canvas that is one flat colour
//      (or unreadable, or zero-sized) fails the run. A blank chart is the defect that
//      screenshots alone let you scroll straight past.
//   4. One screenshot per tooltip grammar (axis / item / sankey), the heatmap's three scale
//      modes, the industry -> ticker heat-treemap and the log-axis projection fan, in both
//      themes, so the design pass has something legible to eyeball.
//
// Needs the dev stack up (uvicorn on 127.0.0.1:8000, vite on localhost:5173) and a JWT in
// TOKEN_FILE — mint one with `POST /api/v1/auth/login`. The token is seeded into localStorage
// BEFORE first paint (addInitScript), because the app boots its auth out of there.
// Screenshots and report.json land in SMOKE_OUT, which defaults to the repo's gitignored
// scratchpad/ rather than next to this tracked script.
//
// Env overrides: SMOKE_OUT, TOKEN_FILE, APP_BASE, EDGE_PATH, PLAYWRIGHT_CORE, ONLY_THEME,
// ONLY_ROUTE (path or screenshot name), SKIP_WALK, SKIP_DETAILS.
//
// Exits 1 listing every `problems` entry; prints `CHARTS SMOKE OK` when there are none.
//
// The first two lines spoof the node version: this box runs node 18 and playwright-core
// refuses anything under 20. playwright-core is resolved out of the npx cache because it is
// not a repo dependency (PLAYWRIGHT_CORE overrides the path).
Object.defineProperty(process, 'version', { value: 'v20.19.0' })
Object.defineProperty(process.versions, 'node', { value: '20.19.0' })
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.PLAYWRIGHT_CORE ??
    'C:/Users/edyli/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core',
)

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../..')
const out = process.env.SMOKE_OUT ?? path.join(repo, 'scratchpad', 'charts-smoke')
mkdirSync(out, { recursive: true })
const TOKEN = readFileSync(process.env.TOKEN_FILE ?? path.join(out, 'token.txt'), 'utf8').trim()
const BASE = process.env.APP_BASE ?? 'http://localhost:5173'
const EDGE =
  process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const VIEWPORT = { width: 1600, height: 1000 }
// The entrance animation is 450ms and every page fires a refetch beat behind it.
const SETTLE = 1500

// Every route that draws a chart. `/` is written to <theme>-overview.png.
const ROUTES = [
  ['/', 'overview'],
  ['/net-worth', 'net-worth'],
  ['/spending', 'spending'],
  ['/portfolio', 'portfolio'],
  ['/projection', 'projection'],
  ['/comp', 'comp'],
  ['/espp', 'espp'],
  ['/taxes', 'taxes'],
  ['/credit-cards', 'credit-cards'],
  ['/paycheck', 'paycheck'],
  ['/calendar', 'calendar'],
]

const THEMES = ['dark', 'light'].filter(
  (t) => !process.env.ONLY_THEME || t === process.env.ONLY_THEME,
)

// Browser chatter that is never a defect (the same list the shell smoke filters), plus the
// HMR socket: `@vite/client` dials ws://localhost:5173 while vite listens on [::1] only, so
// the handshake is refused on every run of this box. It is the dev server talking to itself —
// the app opens no websocket — and the page under it is fully loaded either way.
const NOISE =
  /favicon|DevTools|\[vite\]|@vite\/client|Download the React DevTools|React Router Future Flag/i

// Two dev-data facts that look like errors and are not. They are RECORDED in the report under
// knownBenign — never silently dropped — so a real regression hiding behind one stays visible.
const BENIGN = [
  {
    id: 'paycheck-profile-404',
    why: 'KNOWN NON-DEFECT: the viewed person has no paycheck profile in the dev DB, so /paycheck/* 404s and the page shows its own empty state.',
    test: (e) =>
      /\/api\/v1\/paycheck\b/.test(e.url) && /\b404\b|Not Found/i.test(`${e.text} ${e.url}`),
  },
  {
    id: 'portfolio-joint-empty',
    why: 'KNOWN NON-DEFECT: owner=joint holds no positions in the dev DB.',
    test: (e) => /owner=joint/.test(`${e.text} ${e.url}`),
  },
]

// Pixel readback, verbatim from the shell smoke: sample a ~60x60 grid off every canvas and
// call it painted only when it carries several colours and is not one flat wash.
const PIXEL_PROBE = `(() => {
  const out = []
  for (const cv of document.querySelectorAll('canvas')) {
    const w = cv.width, h = cv.height
    if (!w || !h) { out.push({ w, h, painted: false, why: 'zero-size' }); continue }
    let data
    try { data = cv.getContext('2d').getImageData(0, 0, w, h).data } catch (e) { out.push({ w, h, painted: false, why: 'readback:' + e.message }); continue }
    const counts = new Map(); let n = 0
    const sx = Math.max(1, Math.floor(w / 60)), sy = Math.max(1, Math.floor(h / 60))
    for (let y = 0; y < h; y += sy) for (let x = 0; x < w; x += sx) {
      const i = (y * w + x) * 4
      const k = data[i] + ',' + data[i + 1] + ',' + data[i + 2] + ',' + data[i + 3]
      counts.set(k, (counts.get(k) || 0) + 1); n++
    }
    let top = 0
    for (const v of counts.values()) if (v > top) top = v
    const nonDominant = n ? (n - top) / n : 0
    out.push({ w, h, colors: counts.size, nonDominant: +nonDominant.toFixed(3), painted: counts.size >= 4 && nonDominant >= 0.02 })
  }
  return out
})()`

// Structure: how many chart cards, which canvases sit outside one, what the cards are called,
// and whether the theme actually applied. The canvas list is in document order, so the pixel
// results index-align with it. `card` is the index of the owning .chart-card (null = bare) and
// `zrId` is zrender's layer id: one echarts chart paints onto SEVERAL canvases when a series
// renders progressively (the heatmap splits its cells across `zr_0.0`, `zr_0.1`, `zr_0.2`), so
// "did this chart paint" is a question about a card, not about a single canvas.
const CARD_PROBE = `(() => {
  const title = (card) => {
    const h2 = card.querySelector('h2')
    if (!h2) return null
    const first = [...h2.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim())
    return (first ? first.textContent : h2.textContent).trim().slice(0, 70)
  }
  const cards = [...document.querySelectorAll('section.chart-card')]
  const canvases = [...document.querySelectorAll('canvas')]
  return {
    theme: document.documentElement.dataset.theme || null,
    cards: cards.length,
    cardTitles: cards.map(title),
    cardsMissingHeader: cards.filter((c) => !c.querySelector('.chart-card-header')).length,
    canvases: canvases.length,
    canvasOwners: canvases.map((cv) => {
      const card = cv.closest('section.chart-card')
      return {
        card: card ? cards.indexOf(card) : null,
        title: card ? title(card) : null,
        zrId: cv.getAttribute('data-zr-dom-id'),
      }
    }),
    bare: canvases
      .filter((cv) => !cv.closest('section.chart-card'))
      .map((cv) => ({
        w: cv.width,
        h: cv.height,
        cls: cv.className || null,
        parent: cv.parentElement ? String(cv.parentElement.className).slice(0, 80) : null,
        section: cv.closest('section,div[class]') ? String(cv.closest('section,div[class]').className).slice(0, 80) : null,
      })),
    emptyNotes: [...document.querySelectorAll('.chart-card .empty-note')].map((p) => p.textContent.trim().slice(0, 90)),
    cardErrors: [...document.querySelectorAll('.chart-card-error')].map((p) => p.textContent.trim().slice(0, 90)),
    banners: [...document.querySelectorAll('.error-banner')].map((p) => p.textContent.trim().slice(0, 120)),
  }
})()`

// echarts renders its tooltip as a DOM box; the house theme gives every one the class
// `chart-tip`, so an opened tooltip is observable rather than merely hoped for.
const TIP_PROBE = `(() => {
  return [...document.querySelectorAll('.chart-tip')].map((t) => {
    const cs = getComputedStyle(t)
    const r = t.getBoundingClientRect()
    return {
      visible: cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05 && r.width > 4 && r.height > 4,
      inFrame: r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      text: t.innerText.trim().slice(0, 240),
    }
  })
})()`

const report = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  viewport: VIEWPORT,
  themes: THEMES,
  routes: [],
  details: [],
  knownBenign: [],
  problems: [],
}
const problem = (msg) => report.problems.push(msg)
const files = []
const wrote = (file) => {
  files.push(path.basename(file))
  return file
}

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'],
})

for (const theme of THEMES) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  // Seeded BEFORE first paint: the app reads its token and its theme out of localStorage as it
  // boots, so setting them after a goto would smoke-test the login screen instead.
  await ctx.addInitScript(
    ([token, th]) => {
      localStorage.setItem('finance_token', token)
      localStorage.setItem('finance.theme', th)
      // Patterns off, so the walk shows the plain fills the palette work is judged on.
      localStorage.setItem('finance.chartDecals', 'off')
    },
    [TOKEN, theme],
  )
  const page = await ctx.newPage()
  const where = { theme, route: 'boot' }
  // Since 2026-09-03 (data-lifecycle spec §10) the ACCOUNT owns the theme: the app paints
  // from localStorage, then GET /prefs answers and the server's stored value is adopted. The
  // seeded light pass therefore flipped back to dark a beat after every goto — a smoke that
  // screenshots one theme twice. The pass's theme is injected into the ANSWER instead, so the
  // app adopts what the walk asked for; every other preference passes through untouched.
  //
  // PATCH is stubbed rather than forwarded: a smoke walks, it does not get to rewrite the
  // account's settings (the first merged-main run wrote `theme: dark` into the dev user's
  // preferences before this existed). Attempts are recorded in the report.
  const prefsWrites = []
  const stamp = new Date().toISOString()
  const themeEntry = { value: theme, updated_at: stamp }
  await ctx.route('**/api/v1/prefs*', async (route) => {
    const request = route.request()
    if (request.method() === 'GET') {
      let body = { prefs: {} }
      try {
        const upstream = await route.fetch()
        body = await upstream.json()
      } catch (e) {
        problem(`${theme} ${where.route}: GET /prefs could not be read (${e.message})`)
      }
      body.prefs = { ...body.prefs, theme: themeEntry }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    }
    prefsWrites.push({ ...where, method: request.method(), body: (request.postData() || '').slice(0, 200) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ prefs: { theme: themeEntry } }) })
  })

  const errors = []
  const warnings = []
  const http = []
  const take = (entry) => {
    if (NOISE.test(entry.text) || NOISE.test(entry.url)) return
    const rule = BENIGN.find((b) => b.test(entry))
    if (rule) {
      report.knownBenign.push({ ...where, rule: rule.id, why: rule.why, ...entry })
      return
    }
    errors.push({ ...where, ...entry })
  }
  page.on('console', (m) => {
    const type = m.type()
    if (type !== 'error' && type !== 'warning') return
    const entry = {
      kind: 'console',
      text: m.text().slice(0, 400),
      url: (m.location() || {}).url || '',
    }
    if (type === 'warning') {
      if (!NOISE.test(entry.text)) warnings.push({ ...where, ...entry })
      return
    }
    take(entry)
  })
  page.on('pageerror', (e) =>
    take({ kind: 'pageerror', text: String(e.message).slice(0, 400), url: page.url() }),
  )
  page.on('requestfailed', (r) => {
    const f = r.failure()
    if (f && /ERR_ABORTED/.test(f.errorText)) return
    take({ kind: 'requestfailed', text: f ? f.errorText : 'request failed', url: r.url() })
  })
  page.on('response', (r) => {
    if (r.status() >= 400) http.push({ ...where, status: r.status(), url: r.url() })
  })

  // networkidle is the honest wait (a chart page fires several fetches), but a page that keeps
  // a socket or a poll open would hang it — fall back to `load` and say so in the report.
  const visit = async (route) => {
    where.route = route
    let waited = 'networkidle'
    try {
      await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 45000 })
    } catch {
      waited = 'load-fallback'
      await page.goto(BASE + route, { waitUntil: 'load', timeout: 45000 })
    }
    await page.waitForTimeout(SETTLE)
    if (/\/login/.test(page.url())) {
      problem(
        `${theme} ${route}: bounced to ${page.url()} — the seeded finance_token did not authenticate`,
      )
    }
    return waited
  }

  if (!process.env.SKIP_WALK) {
    // ONLY_ROUTE takes the path OR the screenshot name ("/spending" or "spending") — a leading
    // slash is worth avoiding under Git Bash, which rewrites `/spending` into a Windows path.
    const only = process.env.ONLY_ROUTE
    const walk = ROUTES.filter((r) => !only || r[0] === only || r[1] === only)
    for (const [route, name] of walk) {
      const rec = { theme, route, name }
      rec.waited = await visit(route)
      rec.dom = await page.evaluate(CARD_PROBE)
      rec.paint = await page.evaluate(PIXEL_PROBE)
      await page.screenshot({ path: wrote(path.join(out, `${theme}-${name}.png`)), fullPage: true })
      rec.errors = errors.splice(0)
      rec.warnings = warnings.splice(0)
      rec.http = http.splice(0)

      if (rec.dom.theme !== theme) {
        problem(`${theme} ${route}: html[data-theme] is ${rec.dom.theme} — the theme did not apply`)
      }
      if (rec.dom.bare.length > 0) {
        problem(
          `${theme} ${route}: ${rec.dom.bare.length} canvas outside a .chart-card (spec §6) — ${JSON.stringify(rec.dom.bare)}`,
        )
      }
      // Paint is judged per CHART: a progressive series spreads its marks over several zrender
      // layers, and the sparse ones read as flat on their own. A chart is blank only when NONE
      // of its card's layers painted — which is the 2026-08-25 failure exactly. Every layer's
      // numbers stay in the report, so a chart that lost a layer is still readable there.
      const byCard = new Map()
      rec.paint.forEach((p, i) => {
        const owner = rec.dom.canvasOwners[i] ?? { card: null, title: null, zrId: null }
        const key = owner.card === null ? `bare#${i}` : `card#${owner.card}`
        const group = byCard.get(key) ?? { key, title: owner.title, layers: [] }
        group.layers.push({ i, zrId: owner.zrId, ...p })
        byCard.set(key, group)
      })
      rec.charts = [...byCard.values()].map((g) => ({
        ...g,
        painted: g.layers.some((l) => l.painted),
      }))
      for (const chart of rec.charts) {
        if (chart.painted) continue
        const why = chart.layers
          .map((l) => `#${l.i} ${l.zrId ?? '?'} ${l.w}x${l.h} ${l.why ?? `colors=${l.colors} nonDominant=${l.nonDominant}`}`)
          .join('; ')
        problem(
          `${theme} ${route}: "${chart.title ?? chart.key}" is BLANK — no painted layer among ${chart.layers.length} (${why})`,
        )
      }
      for (const e of rec.errors) {
        problem(`${theme} ${route}: ${e.kind} ${e.text}${e.url ? ` <${e.url}>` : ''}`)
      }
      report.routes.push(rec)
      console.log(
        `${theme} ${route}: ${rec.dom.cards} cards, ${rec.dom.canvases} canvas in ${
          rec.charts.length
        } charts (${rec.charts.filter((c) => c.painted).length} painted), ${rec.dom.bare.length} bare, ${rec.errors.length} err${
          rec.dom.emptyNotes.length > 0 ? `, ${rec.dom.emptyNotes.length} empty-note` : ''
        }${rec.waited === 'networkidle' ? '' : ` [${rec.waited}]`}`,
      )
    }
  }

  if (process.env.SKIP_DETAILS) {
    await page.close()
    await ctx.close()
    continue
  }

  const detail = (name, extra) => {
    report.details.push({ theme, name, file: `${theme}-${name}.png`, ...extra })
  }

  // Where the marks actually are, read off the canvas itself: the dominant colour is the
  // background, and a point counts as a mark only when a whole 13px box around it differs from
  // it — which passes filled bars, cells, nodes and slices while rejecting text, gridlines and
  // axis ticks. An ITEM tooltip only opens over a mark, and the marks can be tiny: the tax
  // waterfall's floating bars are ~25px of a 1269px canvas, so neither the centre nor any
  // hand-written point list finds them reliably. Candidates are spread out so the fallbacks
  // are not all inside one bar.
  const findMarks = (canvas) =>
    canvas.evaluate((cv) => {
      const w = cv.width
      const h = cv.height
      let data
      try {
        data = cv.getContext('2d').getImageData(0, 0, w, h).data
      } catch {
        return []
      }
      const counts = new Map()
      for (let y = 0; y < h; y += 4) {
        for (let x = 0; x < w; x += 4) {
          const i = (y * w + x) * 4
          const k = `${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}`
          counts.set(k, (counts.get(k) || 0) + 1)
        }
      }
      let bg = ''
      let top = -1
      for (const [k, v] of counts) if (v > top) [top, bg] = [v, k]
      const [br, bgr, bb, ba] = bg.split(',').map(Number)
      const far = (x, y) => {
        const i = (y * w + x) * 4
        return (
          Math.abs(data[i] - br) +
            Math.abs(data[i + 1] - bgr) +
            Math.abs(data[i + 2] - bb) +
            Math.abs(data[i + 3] - ba) >
          60
        )
      }
      const R = 6
      const found = []
      for (let y = R; y < h - R; y += 6) {
        for (let x = R; x < w - R; x += 6) {
          if (!far(x, y)) continue
          let solid = true
          for (let dy = -R; dy <= R && solid; dy += 3) {
            for (let dx = -R; dx <= R; dx += 3) {
              if (!far(x + dx, y + dy)) {
                solid = false
                break
              }
            }
          }
          if (solid) found.push([x / w, y / h])
        }
      }
      const picked = []
      for (const p of found) {
        if (picked.every((q) => Math.abs(q[0] - p[0]) > 0.04 || Math.abs(q[1] - p[1]) > 0.08)) {
          picked.push(p)
        }
        if (picked.length >= 14) break
      }
      return picked
    })

  // A tooltip screenshot is only worth taking once the tooltip is really open. The canvas
  // centre is tried first (an axis tooltip opens anywhere over the plot), then the marks the
  // pixels found. Every apparent hit is CONFIRMED by moving off the chart, waiting for the
  // tooltip to go, and hovering the winning point again: echarts fades a tooltip out over
  // ~400ms, so a leftover from the previous candidate otherwise reads as a hit on this one.
  const clearTips = async () => {
    await page.mouse.move(4, 4)
    await page.waitForTimeout(600)
  }
  const openTooltip = async (canvas, label) => {
    if ((await canvas.count()) === 0) {
      problem(`${theme} ${label}: no .chart-card canvas on the page`)
      return { hovered: null, tips: [] }
    }
    await canvas.scrollIntoViewIfNeeded()
    await page.waitForTimeout(600)
    const box = await canvas.boundingBox()
    if (!box) {
      problem(`${theme} ${label}: the canvas has no box to hover`)
      return { hovered: null, tips: [] }
    }
    const card = await canvas
      .locator('xpath=ancestor::section[contains(@class,"chart-card")][1]')
      .locator('h2')
      .first()
      .innerText()
      .catch(() => null)
    // Hover through the locator rather than absolute page coordinates: it re-measures and
    // re-scrolls at action time, so a page that reflowed while its data landed cannot leave
    // the cursor pointing at stale geometry. Two hovers per point, because echarts acts on a
    // mousemove DELTA — a single jump onto a fresh point sometimes arrives without one.
    const hover = async (fx, fy) => {
      const at = (d) => ({ position: { x: box.width * fx + d, y: box.height * fy + d }, force: true })
      await canvas.hover(at(-6))
      await canvas.hover(at(0))
    }
    const marks = await findMarks(canvas)
    const candidates = [['centre', 0.5, 0.5], ...marks.map(([fx, fy]) => ['mark', fx, fy])]
    let last = { card, marks: marks.length, hovered: null, tips: [] }
    for (const [kind, fx, fy] of candidates) {
      await hover(fx, fy)
      await page.waitForTimeout(250)
      let tips = await page.evaluate(TIP_PROBE)
      if (!tips.some((t) => t.visible)) {
        last = { card, marks: marks.length, hovered: { kind, fx, fy }, tips }
        continue
      }
      await clearTips()
      await hover(fx, fy)
      await page.waitForTimeout(350)
      tips = await page.evaluate(TIP_PROBE)
      last = { card, marks: marks.length, hovered: { kind, fx, fy }, tips }
      if (tips.some((t) => t.visible)) return last
    }
    problem(
      `${theme} ${label}: hovered the centre and ${marks.length} marks and no .chart-tip tooltip opened`,
    )
    return last
  }

  const cardByText = (text) => page.locator('section.chart-card').filter({ hasText: text })

  const shotElement = async (locator, name, label) => {
    const count = await locator.count()
    if (count === 0) {
      problem(`${theme} ${label}: target card not found — no ${theme}-${name}.png written`)
      return { found: 0 }
    }
    const el = locator.first()
    await el.scrollIntoViewIfNeeded()
    await page.waitForTimeout(400)
    await el.screenshot({ path: wrote(path.join(out, `${theme}-${name}.png`)) })
    return {
      found: count,
      title: await el
        .locator('h2')
        .first()
        .innerText()
        .catch(() => null),
      hasCanvas: (await el.locator('canvas').count()) > 0,
    }
  }

  // --- axis tooltip: the spending page's stacked spend-vs-net-pay bars (its first card).
  await visit('/spending')
  const axis = await openTooltip(
    page.locator('.chart-card canvas').first(),
    'tooltip-axis (/spending first card)',
  )
  await page.screenshot({ path: wrote(path.join(out, `${theme}-tooltip-axis.png`)) })
  detail('tooltip-axis', { route: '/spending', ...axis })

  // --- the heatmap's three scale modes, as element shots so cells and legend stay legible.
  const heat = cardByText(/category heatmap/i)
  if ((await heat.count()) === 0) {
    problem(`${theme} /spending: no month-by-category heatmap card — its mode shots are missing`)
  } else {
    for (const mode of ['Absolute', 'Row', 'vs average']) {
      const button = page
        .getByRole('group', { name: 'Heatmap scale' })
        .getByRole('button', { name: mode, exact: true })
      if ((await button.count()) === 0) {
        problem(`${theme} /spending: no "${mode}" button in the Heatmap scale group`)
        continue
      }
      await button.first().click()
      await page.waitForTimeout(900)
      const pressed = await button.first().getAttribute('aria-pressed')
      const slug = `heatmap-${mode.replace(/\s+/g, '-')}`
      detail(slug, {
        route: '/spending',
        mode,
        pressed,
        ...(await shotElement(heat, slug, slug)),
      })
    }
  }

  // --- item tooltip: the tax waterfall.
  await visit('/taxes')
  const item = await openTooltip(
    page.locator('.chart-card canvas').first(),
    'tooltip-item (/taxes first card)',
  )
  await page.screenshot({ path: wrote(path.join(out, `${theme}-tooltip-item.png`)) })
  detail('tooltip-item', { route: '/taxes', ...item })

  // --- sankey tooltip: where each paycheck goes.
  await visit('/paycheck')
  const sankey = await openTooltip(
    page.locator('.chart-card canvas').first(),
    'tooltip-sankey (/paycheck first card)',
  )
  await page.screenshot({ path: wrote(path.join(out, `${theme}-tooltip-sankey.png`)) })
  detail('tooltip-sankey', { route: '/paycheck', ...sankey })

  // --- the industry -> ticker heat-treemap.
  await visit('/portfolio')
  detail('heat-treemap', {
    route: '/portfolio',
    ...(await shotElement(cardByText('Allocation by industry'), 'heat-treemap', 'heat-treemap')),
  })

  // --- the projection fan on a log axis.
  await visit('/projection')
  const log = page
    .getByRole('group', { name: 'Axis scale' })
    .getByRole('button', { name: 'Log', exact: true })
  if ((await log.count()) === 0) {
    problem(`${theme} /projection: no "Log" button in the Axis scale group — no log shot`)
  } else {
    await log.first().click()
    await page.waitForTimeout(1200)
    detail('projection-log', {
      route: '/projection',
      pressed: await log.first().getAttribute('aria-pressed'),
      ...(await shotElement(
        cardByText('Projected investable balance'),
        'projection-log',
        'projection-log',
      )),
    })
  }

  // The detail pass hovers and clicks; anything it broke is a defect too.
  const tail = errors.splice(0)
  for (const e of tail) {
    problem(`${theme} details (${e.route}): ${e.kind} ${e.text}${e.url ? ` <${e.url}>` : ''}`)
  }
  report.details.push({
    theme,
    name: '_detail-pass-logs',
    errors: tail,
    warnings: warnings.splice(0),
    http: http.splice(0),
    // Stubbed PATCH /prefs bodies: what the app WOULD have written to the account had the
    // route not been intercepted. Empty is the expected reading.
    prefsWrites,
  })

  await page.close()
  await ctx.close()
}

await browser.close()
report.files = files
writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1))
console.log(`\n${files.length} screenshots + report.json in ${out}`)
if (report.knownBenign.length > 0) {
  const rules = [...new Set(report.knownBenign.map((k) => k.rule))].join(', ')
  console.log(`known benign (recorded, not failed): ${rules} x${report.knownBenign.length}`)
}
if (report.problems.length > 0) {
  console.error(`\n${report.problems.length} PROBLEM(S):`)
  for (const p of report.problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('CHARTS SMOKE OK')
