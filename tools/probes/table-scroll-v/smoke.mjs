// tools/probes/table-scroll-v/smoke.mjs — the capped table boxes, the dividend months and the ledger's
// drag in a real browser (2026-09-24 table-scroll spec §6). Recipe: tools/probes/README.md.
//
// READ-ONLY BY CONSTRUCTION. Every /api call passes a fence in the browser context:
//   - a GET is fetched by the fence itself, straight from API_BASE, and handed to the page. Not
//     through vite's proxy: on this box the dev proxy stalled about one proxied request in a dozen
//     page loads past the app's 15 s timeout (2026-09-24 — with and without Playwright's routing;
//     none in fifteen loads fetched direct), and a load that stalls is a flake, not a finding;
//   - every other method is answered from memory — 200 '{}' — and recorded (`writesBlocked`; PATCH
//     /prefs in `prefsWrites`), so a dropped drag or a stray click persists nothing, and "nothing was
//     sent" is itself a check;
//   - the fence REMEMBERS the writes the smoke makes on purpose (three per theme and size) and plays
//     the server's part for them in the GETs that follow: two dividend PATCHes (their fields merged
//     into those rows of GET /portfolio/dividends) and a transaction DELETE (the row left out of GET
//     /portfolio/transactions). Without it the refetch after the write returns the unchanged book,
//     PortfolioPage keeps the ledger it has (its identical-payload skip) and nothing re-renders —
//     neither the saved entry's reveal nor "a reload keeps the box's place" would be exercised at
//     all. Each check clears the memory once it has read its answer.
// CLASSIC SCROLLBARS. Headless Chromium lays out 0px overlay scrollbars (its default
// --hide-scrollbars); the user's headed Edge draws ~15px classic ones, which is where the right-edge
// mask met the box's own scrollbar and where Holdings' tight fit is judged (Task 5 review). The
// launch drops that flag, and every box that scrolls must measure a scrollbar that takes room — a
// check, so a run that lost the flag says so instead of passing on overlay scrollbars.
// Judge it on a book whose tables are long: the spec's run used `finance_scroll`, a private copy of
// production (dividends 378 rows / 14 months, transactions 80, securities 87, holdings 73,
// classifications 37 unclassified / 87 in all, Net worth accounts 29, reward categories 19).
//
// The plan's draft (Task 9), and what the code reviews added to it: the scrollbar variable and the
// mask's opaque strip over the scrollbar (judged in pixels); header focus that never moves a scrolled
// box (Holdings' sort headers, the matrix's card buttons); the focus "Back to matrix" hands back —
// the card detail REPLACES the matrix, so the box's scroll does not survive the trip (a note, never
// claimed); a sort, a chip and a search that start the list from its first row; a Tab walk that
// never parks a focus stop under the "more below" fade; the inside/outside focus rings; the drag held
// at the WINDOW's foot from the arrival state (the box running to its end before the page moves);
// the print release (computed under print media, and a PDF as the artifact); the dividend table's
// size observer, the default month, and a saved entry revealed inside the box without moving the page.
// Where the draft's own checks changed, the claim stayed and the driving moved: "only the newest
// month is open" is "only the newest month on or before today's" — the spec's rule (§4.4), which the
// newest month is only by chance, "today" being the server's product day (X-Product-Today, lane K);
// the keyboard lift judges its landing slot and the drop line on it, since under this context's
// reduced motion the lifted row stays home (lane R7); the page-still drag and the wheel set the box's
// foot just inside the window with room below, where the draft's placements left the page at its
// maximum scroll (a ledger is often the last thing on its page) and the claims could not fail; and
// the wheel reaches the box's end by wheel before judging the chain (see `wheel`).
//
// Env: TOKEN_FILE (default <SMOKE_OUT>/token.txt), APP_BASE, API_BASE, SMOKE_OUT, EDGE_PATH,
// PLAYWRIGHT_CORE, ONLY_THEME (dark|light), ONLY_SIZE (1280|1600|1920, or 1440 for the record pass
// alone), ONLY_TARGET (a TARGETS name), RECORD=0 (skip the 1440×900 record pass). An ONLY_* value
// that names nothing is refused (exit 2) — a mistyped filter must not pass on zero checks.
// The first two lines spoof the node version: this box runs node 18, playwright-core wants 20.
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
const OUT = process.env.SMOKE_OUT ?? path.join(process.cwd(), 'scratchpad', 'table-scroll-v')
const BASE = process.env.APP_BASE ?? 'http://localhost:5261'
const API = process.env.API_BASE ?? 'http://127.0.0.1:8061'
const EDGE = process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const { ONLY_THEME, ONLY_SIZE, ONLY_TARGET } = process.env
const ALL_SIZES = [
  { width: 1280, height: 800 },
  { width: 1600, height: 1000 },
  { width: 1920, height: 1080 },
]
const SIZES = ALL_SIZES.filter((s) => !ONLY_SIZE || String(s.width) === ONLY_SIZE)
const ALL_THEMES = ['dark', 'light']
const THEMES = ALL_THEMES.filter((t) => !ONLY_THEME || t === ONLY_THEME)
// The record pass: the spec's before-numbers were measured at 1440×900 (2026-09-24, the default view
// of each page), so one pass there — one theme, page heights only, plus the arrival drag the Task 4
// review asked for at this size too.
const RECORD_SIZE = { width: 1440, height: 900 }
const RECORD = process.env.RECORD !== '0' && (!ONLY_SIZE || ONLY_SIZE === '1440')

// The seven boxes (spec §3). `foot`: the table pins a totals row. `prepare`: what puts the long
// version of the table on screen. `before`: the page's height at 1440×900 before the boxes (spec §0).
// `rings`: controls a keyboard reaches inside the box and the outline-offset their ring must compute —
// 2px (outside) for the padding-free text buttons, -2px (inset) for the row actions (index.css).
// `walk`: Tab down the whole box, judging every focus stop against the fade and the header.
const ALL_TARGETS = [
  { name: 'dividends', url: '/portfolio?owner=all&section=income', label: 'Dividends by month', foot: false, before: 17586,
    rings: [['.dividend-month-toggle', '2px'], ['.row-actions button', '-2px']] },
  { name: 'transactions', url: '/portfolio?owner=all&section=manage', label: 'Transactions table', foot: false, before: 4101, walk: true,
    rings: [['.row-actions button', '-2px']] },
  { name: 'securities', url: '/portfolio?owner=all&tab=securities', label: 'Securities table', foot: false,
    rings: [['.row-actions button', '-2px']] },
  { name: 'holdings', url: '/portfolio?owner=all&section=holdings', label: 'Holdings table', foot: false, before: 4378,
    rings: [['.th-sort', '2px'], ['.row-toggle', '2px']] },
  { name: 'classifications', url: '/portfolio?owner=all&section=allocation', label: 'Security classifications table', foot: false, before: 3264,
    prepare: 'all-chip', walk: true },
  { name: 'networth', url: '/net-worth?owner=all&section=accounts', label: 'Accounts table', foot: true, before: 1964,
    rings: [['.row-toggle', '2px']] },
  { name: 'rewards', url: '/credit-cards?owner=all&section=rewards', label: 'Rewards matrix', foot: true, before: 2004,
    rings: [['.matrix-card-btn', '2px']] },
]
const TARGETS = ALL_TARGETS.filter((t) => !ONLY_TARGET || t.name === ONLY_TARGET)

// A mistyped filter narrows the run to nothing and would "pass" on zero checks: refuse it up front,
// naming what exists (exit 2 — the run never started).
const refuse = (name, value, valid) => {
  console.error(`TABLE SCROLL SMOKE REFUSED — ${name}=${value} names nothing; one of: ${valid.join(', ')}`)
  process.exit(2)
}
if (ONLY_THEME && !ALL_THEMES.includes(ONLY_THEME)) refuse('ONLY_THEME', ONLY_THEME, ALL_THEMES)
if (ONLY_SIZE && !['1440', ...ALL_SIZES.map((s) => String(s.width))].includes(ONLY_SIZE)) refuse('ONLY_SIZE', ONLY_SIZE, [...ALL_SIZES.map((s) => String(s.width)), '1440 (the record pass)'])
if (ONLY_TARGET && TARGETS.length === 0) refuse('ONLY_TARGET', ONLY_TARGET, ALL_TARGETS.map((t) => t.name))

mkdirSync(OUT, { recursive: true })
const TOKEN = readFileSync(process.env.TOKEN_FILE ?? path.join(OUT, 'token.txt'), 'utf8').trim()
const NOISE = /favicon|DevTools|\[vite\]|@vite\/client|React DevTools|React Router Future Flag/i
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const boxSel = (label) => `[role="region"][aria-label="${label}"]`
const slug = (text) => text.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')
const monthLabel = (key) => `${MONTHS[Number(key.slice(5)) - 1]} ${key.slice(0, 4)}`
const report = {
  at: new Date().toISOString(), base: BASE, api: API, sizes: SIZES, themes: THEMES,
  checks: [], heights: [], known: [], writesBlocked: [], prefsWrites: [], fenceErrors: [], fenceRetries: [], loadRetries: [], problems: [],
}
const check = (where, name, ok, observed) => {
  report.checks.push({ where, name, ok, observed })
  if (!ok) report.problems.push(`${where}: ${name} — observed ${JSON.stringify(observed)}`)
  return ok
}
const note = (where, name, observed) => report.checks.push({ where, name, ok: null, observed })

// Three claims the product fails today for reasons outside the capped boxes — measured on the
// 2026-09-24 run, none introduced by the table-scroll batch, all follow-ups for the user. `known()`
// records them rather than failing the run (charts-c7's knownBenign precedent): the day one is fixed,
// its check simply passes; until then report.json holds it as { ok: null, known: true, ref } with its
// evidence, and the run prints one `KNOWN (pre-existing)` line per defect. A failure only counts as
// the known defect when it carries that defect's signature (`test`); any other failure of the same
// claim is a new problem and fails the run like any check.
const KNOWN_DEFECTS = {
  'networth-scope-shift': {
    why: "Net worth's scope row wraps to a second line at 1280px when the month chips land and pushes the still-loading body down 42px (CLS ≈0.166; 0.162 with overlay scrollbars, ≤0.01 from 1440 up) — src/components/shell/ScopeBar.tsx / the page frame's scope row, not the box",
    evidence: 'report.json `shifts` (the scope-bar group and the page body moving) and `scopeRowShift`',
    // Known only while the scope row's own shifts explain the failure: take them away and the load
    // must be under the limit, so any other shift that pushes it over still fails the run.
    test: (o) => o.scopeRowShift > 0 && o.cls - o.scopeRowShift < 0.1,
  },
  'dividend-save-focus': {
    why: 'Save changes disables itself while the save is in flight (src/components/portfolio/DividendsPanel.tsx `disabled={busy}`, since 2026-08-22) and Chromium blurs a focused control that becomes disabled, so the focus falls to <body> — a mouse click and Space on the button alike; saved with Enter in Notes it stays (checked)',
    evidence: 'report.json `focusLog` (the focus leaving the disabled Save changes)',
    test: (o) => o.after === 'body' && o.focusLog.some((f) => f.disabled && /Save changes/.test(f.from ?? '')),
  },
  'matrix-focus-return': {
    why: "Back to matrix hands the focus back in a setTimeout(0) (src/pages/CreditCardsPage.tsx closeDetail) that fires before the router re-renders the matrix ~70 ms later, so card-col-<id> does not exist yet and the focus falls to <body>",
    evidence: 'report.json (`active: body` with the card button back) and <where>-back-to-matrix.png',
    test: (o) => o.active === 'body' && o.buttonBack === true,
  },
}
const known = (where, name, ok, observed, ref) => {
  if (ok || !KNOWN_DEFECTS[ref].test(observed)) return check(where, name, ok, observed)
  report.checks.push({ where, name, ok: null, known: true, ref, observed })
  report.known.push({ where, name, ref })
  return false
}

// Installed at document start on every load: the layout-shift sum (CLS per load), the app's own
// echarts module (pace-v's hook — the dividend chart's bars are read off the live instance), and the
// band a box's pinned rows leave, read the way revealInBox reads it (tableScrollDom.ts): below the
// header, above the totals row — or, where there is none, above the "more below" fade.
function pageHelpers() {
  window.__cls = 0
  // The shifts that count, with what moved — so a CLS failure names its cause. `__shifts` lists the
  // ones worth reading (≥ 0.01); `__scopeRowShift` sums EVERY counted shift that moves an element of
  // the page frame's sticky scope block, however small — the part of the CLS that block explains.
  window.__shifts = []
  window.__scopeRowShift = 0
  const elementOf = (node) => (node?.nodeType === 1 ? node : node?.parentElement ?? null)
  const describe = (node) => {
    const el = elementOf(node)
    return el ? `${el.tagName.toLowerCase()}.${String(el.className).split(' ').filter(Boolean).slice(0, 2).join('.')}` : null
  }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue
        window.__cls += entry.value
        if (entry.sources.some((s) => elementOf(s.node)?.closest('.page-frame-scope'))) window.__scopeRowShift += entry.value
        if (entry.value >= 0.01) {
          window.__shifts.push({
            at: Math.round(entry.startTime), value: +entry.value.toFixed(3),
            moved: entry.sources.map((s) => `${describe(s.node)} y ${Math.round(s.previousRect.y)}→${Math.round(s.currentRect.y)}`),
          })
        }
      }
    }).observe({ type: 'layout-shift', buffered: true })
  } catch {
    // no layout-shift entries in this engine: CLS reads 0
  }
  import('/src/charts/echarts.ts').then(
    (m) => { window.__echarts = m.echarts },
    (e) => { window.__hookError = String(e) },
  )
  window.__ts = {
    box: (label) => document.querySelector(`[role="region"][aria-label="${label}"]`),
    frames: () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    band(box) {
      const rect = box.getBoundingClientRect()
      const px = (name) => parseFloat(box.style.getPropertyValue(name)) || 0
      const top = rect.top + box.clientTop
      const bottom = top + box.clientHeight
      const hasFoot = box.querySelector(':scope > table > tfoot') !== null
      const fade = hasFoot ? 0 : parseFloat(getComputedStyle(box).getPropertyValue('--table-fade-h')) || 0
      return {
        top, bottom, head: px('--table-head-h'), foot: px('--table-foot-h'), fade,
        headBottom: top + px('--table-head-h'), clearBottom: bottom - px('--table-foot-h') - fade,
        left: rect.left, right: rect.right, scrollTop: box.scrollTop, scrollLeft: box.scrollLeft,
        maxScroll: box.scrollHeight - box.clientHeight, more: box.getAttribute('data-scroll-more') ?? '',
      }
    },
  }
}

// The fence's memory of the writes it answered (see the header): reset with every context.
const state = { where: '', memory: null }
const forget = () => {
  state.memory = { dividends: new Map(), deletedTransactions: new Set() }
}
function remember(method, pathname, body) {
  const dividend = /^\/api\/v1\/portfolio\/dividends\/(\d+)$/.exec(pathname)
  if (dividend && method === 'PATCH') state.memory.dividends.set(Number(dividend[1]), JSON.parse(body ?? '{}'))
  const txn = /^\/api\/v1\/portfolio\/transactions\/(\d+)$/.exec(pathname)
  if (txn && method === 'DELETE') state.memory.deletedTransactions.add(Number(txn[1]))
}
function overlayFor(pathname) {
  const { dividends, deletedTransactions } = state.memory
  if (pathname === '/api/v1/portfolio/dividends' && dividends.size > 0)
    return (rows) => rows.map((row) => (dividends.has(row.id) ? { ...row, ...dividends.get(row.id) } : row))
  if (pathname === '/api/v1/portfolio/transactions' && deletedTransactions.size > 0)
    return (rows) => rows.filter((row) => !deletedTransactions.has(row.id))
  return null
}

/** A GET the fence fetches from API_BASE itself. Asked once more when the socket died unanswered —
 *  uvicorn closing an idle keep-alive connection just as it was reused ("socket hang up", measured in
 *  the 2026-09-24 record pass): the server never saw the request, and a GET is safe to repeat. The
 *  retry is logged (`fenceRetries`), so a run shows how often the transport, not the app, stumbled. */
async function fetchDirect(route, url) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await route.fetch({ url })
    } catch (error) {
      const message = String(error?.message ?? error).split('\n')[0]
      if (attempt >= 2 || !/socket hang up|ECONNRESET|ECONNREFUSED/i.test(message)) throw error
      report.fenceRetries.push({ where: state.where, url: url.replace(API, ''), error: message })
    }
  }
}

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'],
  ignoreDefaultArgs: ['--hide-scrollbars'],
})
let page

async function makeContext(theme, size) {
  forget()
  // Reduced motion zeroes the motion tokens: the fade's opacity reads final at once, and a pointer
  // drag marks its landing edge with `data-reorder-drop` (lane R7's drop line) instead of shifting
  // the peers — the would-be slot, readable mid-drag.
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, reducedMotion: 'reduce' })
  await ctx.addInitScript(([t, th]) => {
    localStorage.setItem('finance_token', t)
    localStorage.setItem('finance.theme', th)
    localStorage.setItem('finance.chartDecals', 'off')
  }, [TOKEN, theme])
  await ctx.addInitScript(pageHelpers)
  const themeEntry = { value: theme, updated_at: new Date().toISOString() }
  // A pathname test, not a '**/api/**' glob: that also matches vite's own /src/api/*.ts modules.
  await ctx.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const req = route.request()
    const method = req.method()
    const url = new URL(req.url())
    try {
      if (method === 'GET' || method === 'HEAD') {
        const response = await fetchDirect(route, API + url.pathname + url.search)
        if (method === 'GET' && response.ok()) {
          if (url.pathname === '/api/v1/prefs') {
            // The run's theme wins over whatever the book saved.
            const body = await response.json()
            return await route.fulfill({ response, json: { ...body, prefs: { ...body.prefs, theme: themeEntry } } })
          }
          const overlay = overlayFor(url.pathname)
          if (overlay !== null) return await route.fulfill({ response, json: overlay(await response.json()) })
        }
        return await route.fulfill({ response })
      }
      const entry = { where: state.where, method, url: url.pathname + url.search }
      if (url.pathname === '/api/v1/prefs') {
        report.prefsWrites.push(entry)
        return await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ prefs: { theme: themeEntry } }) })
      }
      report.writesBlocked.push({ ...entry, body: req.postData() })
      remember(method, url.pathname, req.postData())
      return await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    } catch (error) {
      // Logged, then aborted: the page sees a failed request (and says so in its console). A context
      // that closed under an in-flight request has no page left to tell — nothing to log.
      const message = String(error?.message ?? error).split('\n')[0]
      if (!/has been closed|disposed/i.test(message)) report.fenceErrors.push({ where: state.where, method, url: url.pathname + url.search, error: message })
      await route.abort().catch(() => {})
    }
  })
  return ctx
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** Two animation frames: enough for a scroll event (and useScrollEdges' attribute) to land. */
const frames = () => page.evaluate(() => window.__ts.frames())

/** The box's band (see pageHelpers). */
const bandOf = (label) => page.evaluate((l) => window.__ts.band(window.__ts.box(l)), label)

/** Load the target's page until its box shows — three tries. A load that failed (a `goto` timeout
 *  included) or a box that never showed is retried and logged (`loadRetries`, counted in the final
 *  line) with what went wrong, so a flaky load is never silent; the third failure is thrown. */
async function open(target, { prepare = true } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    let failure
    try {
      await page.goto(BASE + target.url, { waitUntil: 'networkidle' })
      const shown = await page.locator(boxSel(target.label)).waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false)
      if (shown) break
      const showing = await page.evaluate(() => (document.querySelector('main')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 160)).catch(() => null)
      failure = `the box did not show within 15 s; the page showed: ${showing}`
    } catch (error) {
      failure = `the load failed: ${String(error?.message ?? error).split('\n')[0]}`
    }
    if (attempt === 3) throw new Error(`the ${target.label} box never rendered at ${target.url} (3 tries; the last: ${failure})`)
    report.loadRetries.push({ where: state.where, url: target.url, attempt, failure })
  }
  await sleep(1200)
  if (prepare && target.prepare === 'all-chip') {
    await page.locator('.classification-toolbar button', { hasText: /^All/ }).first().click()
    await sleep(400)
  }
}

/** Centre the box in the window and scroll it: 'top' | 'middle' | 'end' | a scrollTop. */
const boxTo = (label, at) =>
  page.evaluate(async ([l, to]) => {
    const box = window.__ts.box(l)
    box.scrollIntoView({ block: 'center' })
    const max = box.scrollHeight - box.clientHeight
    box.scrollTop = to === 'top' ? 0 : to === 'end' ? max : to === 'middle' ? Math.round(max / 2) : to
    await window.__ts.frames()
    return window.__ts.band(box)
  }, [label, at])

/** Put the KEYBOARD's focus on the box. Chromium counts a script focus that follows keyboard input
 *  as keyboard focus (:focus-visible), so a key goes first. `at` as boxTo; null keeps the scroll. */
async function focusBox(label, at = 'top') {
  await page.keyboard.press('Tab')
  await page.evaluate(async ([l, to]) => {
    const box = window.__ts.box(l)
    box.scrollIntoView({ block: 'center' })
    if (to !== null) {
      box.scrollLeft = 0
      box.scrollTop = to === 'middle' ? Math.round((box.scrollHeight - box.clientHeight) / 2) : 0
    }
    box.focus({ preventScroll: true })
    await window.__ts.frames()
  }, [label, at])
}

/** Where the keyboard's focus is, against the box it should be in. */
const focusIn = (label) =>
  page.evaluate(async (l) => {
    await window.__ts.frames()
    const box = window.__ts.box(l)
    const a = document.activeElement
    const r = a.getBoundingClientRect()
    const cs = getComputedStyle(a)
    return {
      inBox: box.contains(a) && a !== box, inHead: a.closest('thead') !== null && box.contains(a),
      name: (a.getAttribute('aria-label') ?? a.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40),
      cls: String(a.className), top: r.top, bottom: r.bottom, visible: a.matches(':focus-visible'),
      outline: cs.outlineStyle, offset: cs.outlineOffset, band: window.__ts.band(box),
    }
  }, label)

/** Screenshots are artifacts; `clip` in viewport pixels. */
const shot = (where, name, clip) =>
  page.screenshot({ path: path.join(OUT, `${slug(where)}-${name}.png`), ...(clip ? { clip } : {}) })

/** Two PNGs compared pixel by pixel (in the page — no image library needed): the mean and the
 *  largest per-pixel channel difference, and how many pixels differ by more than 48. */
async function pixelDiff(a, b) {
  return page.evaluate(async ([x, y]) => {
    const load = async (b64) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const g = canvas.getContext('2d')
      g.drawImage(bitmap, 0, 0)
      return g.getImageData(0, 0, bitmap.width, bitmap.height).data
    }
    const [p, q] = await Promise.all([load(x), load(y)])
    let sum = 0
    let max = 0
    let strong = 0
    for (let i = 0; i < p.length; i += 4) {
      const d = Math.max(Math.abs(p[i] - q[i]), Math.abs(p[i + 1] - q[i + 1]), Math.abs(p[i + 2] - q[i + 2]))
      sum += d
      max = Math.max(max, d)
      if (d > 48) strong += 1
    }
    return { mean: +(sum / (p.length / 4)).toFixed(2), max, strong, pixels: p.length / 4 }
  }, [a.toString('base64'), b.toString('base64')])
}

// ---------------------------------------------------------------------------------------------
// The battery every box answers (spec §6)
// ---------------------------------------------------------------------------------------------

async function geometry(where, target) {
  const g = await page.evaluate((l) => {
    const box = window.__ts.box(l)
    const table = box.querySelector(':scope > table')
    const cs = getComputedStyle(box)
    const borders = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0)
    return {
      cls: box.className, tabIndex: box.tabIndex,
      height: box.getBoundingClientRect().height, tableHeight: table.getBoundingClientRect().height,
      overflows: box.scrollHeight > box.clientHeight + 1, sideways: box.scrollWidth > box.clientWidth + 1,
      cap: Math.min(720, Math.max(420, window.innerHeight * 0.6)),
      pageHeight: document.documentElement.scrollHeight,
      headH: box.style.getPropertyValue('--table-head-h'), footH: box.style.getPropertyValue('--table-foot-h'),
      scrollbarVar: box.style.getPropertyValue('--table-scrollbar-w'), scrollbar: box.offsetWidth - box.clientWidth - borders,
    }
  }, target.label)
  note(where, 'page height with the box', { pageHeight: g.pageHeight, box: Math.round(g.height), table: Math.round(g.tableHeight) })
  report.heights.push({ where, target: target.name, pageHeight: g.pageHeight, box: Math.round(g.height), table: Math.round(g.tableHeight) })
  check(where, 'the box is a table-scroll region a keyboard can reach', g.cls.split(' ').includes('table-scroll') && g.tabIndex === 0, g)
  check(where, 'the box is never taller than the cap', g.height <= g.cap + 1, g)
  if (g.tableHeight > g.cap + 1) check(where, 'a table taller than the cap fills exactly the cap', g.height >= g.cap - 1, g)
  else note(where, 'the table fits under the cap — rendered at its own height', g)
  check(where, 'the pinned-row heights are measured onto the box', /px$/.test(g.headH) && /px$/.test(g.footH), { headH: g.headH, footH: g.footH })
  check(where, "the box's own vertical scrollbar is measured into --table-scrollbar-w", g.scrollbarVar === `${g.scrollbar}px`, { var: g.scrollbarVar, measured: g.scrollbar })
  if (g.overflows) check(where, 'the scrollbar is a classic one that takes room (the launch keeps scrollbars)', g.scrollbar > 0, { scrollbar: g.scrollbar })
  return g
}

async function pins(where, target) {
  await boxTo(target.label, 'middle')
  await sleep(150)
  const p = await page.evaluate((l) => {
    const box = window.__ts.box(l)
    const table = box.querySelector(':scope > table')
    const top = box.getBoundingClientRect().top + box.clientTop
    const bottom = top + box.clientHeight
    const heads = [...table.tHead.rows[0].cells]
    const first = heads[0].getBoundingClientRect()
    const hit = document.elementFromPoint(first.left + Math.min(first.width / 2, 24), first.top + first.height / 2)
    const footRow = table.tFoot ? table.tFoot.rows[table.tFoot.rows.length - 1] : null
    const card = box.closest('.card')
    return {
      scrollTop: box.scrollTop,
      headOff: Math.max(...heads.map((c) => Math.abs(c.getBoundingClientRect().top - top))),
      headWins: hit !== null && table.tHead.contains(hit),
      footOff: footRow ? Math.max(...[...footRow.cells].map((c) => Math.abs(c.getBoundingClientRect().bottom - bottom))) : null,
      headBg: getComputedStyle(heads[0]).backgroundColor,
      footBg: footRow ? getComputedStyle(footRow.cells[0]).backgroundColor : null,
      cardBg: card === null ? null : getComputedStyle(card).backgroundColor,
    }
  }, target.label)
  check(where, 'mid-scroll, the header row sits at the top of the box', p.scrollTop > 0 && p.headOff <= 1, p)
  check(where, 'the pinned header paints over the rows sliding under it', p.headWins, p)
  check(where, "the pinned header wears the card's own surface", p.headBg === p.cardBg, p)
  if (target.foot) {
    check(where, 'mid-scroll, the totals row sits at the foot of the box', p.footOff !== null && p.footOff <= 1, p)
    check(where, "the pinned totals row wears the card's own surface", p.footBg === p.cardBg, p)
  }
  await page.locator(boxSel(target.label)).screenshot({ path: path.join(OUT, `${slug(where)}-mid.png`) })
}

async function fade(where, target) {
  const f = await page.evaluate(async (l) => {
    const box = window.__ts.box(l)
    const read = () => getComputedStyle(box, '::after').opacity
    box.scrollTop = 0
    await window.__ts.frames()
    const atTop = read()
    box.scrollTop = box.scrollHeight
    await window.__ts.frames()
    const atEnd = read()
    box.scrollTop = 0
    return { atTop, atEnd }
  }, target.label)
  if (target.foot) check(where, 'no fade where a pinned totals row marks the edge', f.atTop === '0' && f.atEnd === '0', f)
  else check(where, 'the foot fades while rows hide below, and not at the end', f.atTop === '1' && f.atEnd === '0', f)
}

async function keyboard(where, target) {
  await boxTo(target.label, 'top')
  const maskAtRest = await page.evaluate((l) => getComputedStyle(window.__ts.box(l)).maskImage, target.label)
  await focusBox(target.label)
  const ring = await page.evaluate((l) => {
    const box = window.__ts.box(l)
    const cs = getComputedStyle(box)
    return { focused: document.activeElement === box, visible: box.matches(':focus-visible'), outline: cs.outlineStyle, mask: cs.maskImage }
  }, target.label)
  check(where, 'the focused box shows the focus ring', ring.focused && ring.visible && ring.outline !== 'none', ring)
  // Only a box masked at rest can show the mask dropping; one with nothing to drop is a reading.
  if (maskAtRest !== 'none') check(where, 'with keyboard focus the box drops its edge mask (a mask would clip the ring)', ring.mask === 'none', { maskAtRest, focused: ring.mask })
  else note(where, 'no edge mask at rest here — nothing for the keyboard focus to drop', { maskAtRest, focused: ring.mask })
  await page.keyboard.press('ArrowDown')
  await sleep(250)
  const down = await page.evaluate((l) => window.__ts.box(l).scrollTop, target.label)
  await page.keyboard.press('PageDown')
  await sleep(300)
  const paged = await page.evaluate((l) => window.__ts.box(l).scrollTop, target.label)
  check(where, 'ArrowDown scrolls the focused box', down > 0, { scrollTop: down })
  check(where, 'PageDown scrolls the focused box a page on', paged > down + 100, { before: down, after: paged })
}

/** The middle of the box's visible part — where the pointer rests to wheel over it. */
const overBox = (label) =>
  page.evaluate((l) => {
    const r = window.__ts.box(l).getBoundingClientRect()
    return { x: r.left + r.width / 2, y: (Math.max(r.top, 0) + Math.min(r.bottom, window.innerHeight)) / 2 }
  }, label)

/** A wheel at the box's end carries on down the page — no trap (spec §2.2). The box's foot goes 8px
 *  inside the window (the ledger drag's placement), so whatever the page holds below the box is room
 *  the wheel can move it into: the draft's box-at-the-window-top placement left every page that ENDS
 *  in its box at its maximum scroll, where chaining could not be measured. The reader's own wheel
 *  carries the box to its end first: a script's scrollTop can land a sub-pixel past where the wheel
 *  puts the end (1600×1000: 442 by script, 441 by wheel, on a 1041.875px table), and the next gesture
 *  then spends itself on that pixel — a smoke artifact, not a trap. */
async function wheel(where, target) {
  const placed = await page.evaluate(async (l) => {
    const box = window.__ts.box(l)
    box.scrollTop = Math.max(0, box.scrollHeight - box.clientHeight - 150)
    window.scrollBy(0, box.getBoundingClientRect().bottom - (window.innerHeight - 8))
    await window.__ts.frames()
    return { y0: window.scrollY, room: Math.round(document.documentElement.scrollHeight - window.innerHeight - window.scrollY) }
  }, target.label)
  const first = await overBox(target.label)
  await page.mouse.move(first.x, first.y)
  await page.mouse.wheel(0, 400)
  await sleep(500)
  const atEnd = await page.evaluate((l) => ({
    boxAtEnd: !(window.__ts.box(l).getAttribute('data-scroll-more') ?? '').includes('bottom'), pageY: window.scrollY,
  }), target.label)
  const second = await overBox(target.label)
  await page.mouse.move(second.x, second.y)
  await page.mouse.wheel(0, 400)
  await sleep(500)
  const y1 = await page.evaluate(() => window.scrollY)
  const seen = { room: placed.room, y0: placed.y0, afterTheBoxsEnd: atEnd.pageY, y1, boxAtEnd: atEnd.boxAtEnd }
  if (placed.room >= 20) check(where, 'a wheel over the box at its end scrolls the page on — no trap', atEnd.boxAtEnd && y1 > placed.y0, seen)
  else note(where, 'the page ends at this box — no room below it to measure the wheel chaining', seen)
}

/** index.css draws the house ring OUTSIDE a control (outline-offset 2px) but inset (-2px) inside a
 *  clipping box; the padding-free text buttons keep the outside one (tableScroll.css, dividends.css). */
async function rings(where, target) {
  for (const [selector, offset] of target.rings ?? []) {
    await focusBox(target.label)
    let found = null
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press('Tab')
      const f = await focusIn(target.label)
      if (!f.inBox) break
      if (await page.evaluate((sel) => document.activeElement.matches(sel), selector)) {
        found = f
        break
      }
    }
    check(where, `a keyboard-focused ${selector} in the box draws its ring at outline-offset ${offset}`,
      found !== null && found.visible && found.outline !== 'none' && found.offset === offset,
      found && { name: found.name, visible: found.visible, outline: found.outline, offset: found.offset })
  }
}

/** Tab down the whole box: no focus stop may land under the "more below" fade while rows still hide
 *  below (Task 4 review: 4 of 60 Transactions stops did before the fade joined the bottom margin), nor
 *  under the pinned header. */
async function focusStops(where, target) {
  await focusBox(target.label)
  const stops = []
  for (let i = 0; i < 800; i += 1) {
    await page.keyboard.press('Tab')
    const f = await focusIn(target.label)
    if (!f.inBox) break
    stops.push({ i, name: f.name, top: Math.round(f.top), bottom: Math.round(f.bottom), headBottom: Math.round(f.band.headBottom), clearBottom: Math.round(f.band.clearBottom), more: f.band.more, scrollTop: Math.round(f.band.scrollTop) })
  }
  const underFade = stops.filter((s) => s.more.includes('bottom') && s.bottom > s.clearBottom + 1)
  const underHead = stops.filter((s) => s.top < s.headBottom - 1)
  const last = stops[stops.length - 1]
  check(where, `Tab walks the box stop by stop (${stops.length} stops) and none lands under the "more below" fade`, stops.length > 10 && underFade.length === 0, { stops: stops.length, underFade: underFade.slice(0, 4) })
  check(where, 'no focus stop lands under the pinned header', underHead.length === 0, underHead.slice(0, 4))
  check(where, 'the walk carries the box to its end', last !== undefined && !last.more.includes('bottom'), last)
}

// ---------------------------------------------------------------------------------------------
// Holdings: the sort, the header's focus, the sideways mask over the scrollbar (pixels), the dock
// ---------------------------------------------------------------------------------------------

async function holdingsHeader(where, target) {
  // A sort is a new list, read from its first row (Task 5 review) — clicked with the MOUSE at the
  // header's own pixels: locator.click() scrolls its target into view first, which would move the box.
  const mid = (await boxTo(target.label, 'middle')).scrollTop
  const hit = await page.evaluate((l) => {
    const button = [...window.__ts.box(l).querySelectorAll('.th-sort')].find((b) => b.textContent.startsWith('Ticker'))
    const r = button.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, target.label)
  await page.mouse.click(hit.x, hit.y)
  await frames()
  await sleep(200)
  const sorted = await page.evaluate((l) => {
    const box = window.__ts.box(l)
    const th = [...box.querySelectorAll('thead th')].find((c) => c.textContent.startsWith('Ticker'))
    return { scrollTop: box.scrollTop, ariaSort: th.getAttribute('aria-sort'), first: box.querySelector('tbody tr .ticker')?.textContent }
  }, target.label)
  check(where, 'a sort starts the box at its first row', mid > 0 && sorted.scrollTop === 0 && sorted.ariaSort === 'ascending', { from: mid, ...sorted })
  // Header focus never moves a scrolled box: the clicked sort button holds the focus; Tab across
  // the rest of the pinned header with the box mid-list.
  const again = (await page.evaluate(async (l) => {
    const box = window.__ts.box(l)
    box.scrollTop = Math.round((box.scrollHeight - box.clientHeight) / 2)
    await window.__ts.frames()
    return box.scrollTop
  }, target.label))
  const walk = []
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('Tab')
    const f = await focusIn(target.label)
    if (!f.inHead) break
    walk.push({ name: f.name, scrollTop: Math.round(f.band.scrollTop) })
  }
  check(where, 'Tab across the pinned sort headers never moves the scrolled box', walk.length >= 8 && walk.every((w) => w.scrollTop === again), { scrollTop: again, walk })
}

/** The right-edge fade must stop short of the box's own scrollbar (Task 5 review), and the keyboard
 *  focus ring must show at a masked edge (Task 3 review) — both judged in PIXELS. */
async function sidewaysMask(where, target) {
  const s = await page.evaluate(async (l) => {
    const box = window.__ts.box(l)
    // Nothing focused: a keyboard-focused box drops its mask by design (checked on its own below).
    document.activeElement?.blur()
    box.scrollIntoView({ block: 'center' })
    box.scrollTop = 0
    box.scrollLeft = 0
    await window.__ts.frames()
    return {
      sideways: box.scrollWidth > box.clientWidth + 1, rowActions: box.querySelector('.row-actions') !== null,
      scrollbar: box.offsetWidth - box.clientWidth, more: box.getAttribute('data-scroll-more') ?? '',
      mask: getComputedStyle(box).maskImage,
    }
  }, target.label)
  if (!s.sideways) {
    note(where, 'the table fits the box sideways here — no edge mask to judge', s)
    return
  }
  const opaqueTail = `rgba(0, 0, 0, 0) calc(100% - ${s.scrollbar}px), rgb(0, 0, 0) calc(100% - ${s.scrollbar}px))`
  check(where, "the right-edge mask turns opaque again over the box's own scrollbar", s.more.includes('right') && s.mask.endsWith(opaqueTail), s)
  const b = await bandOf(target.label)
  const strip = { x: Math.round(b.right - s.scrollbar), y: Math.round(b.top + 4), width: s.scrollbar, height: Math.round(b.bottom - b.top - 8) }
  const fadeZone = { x: Math.round(b.right - s.scrollbar - 22), y: strip.y, width: 16, height: strip.height }
  const masked = { strip: await page.screenshot({ clip: strip }), fade: await page.screenshot({ clip: fadeZone }) }
  await page.evaluate(async (l) => {
    window.__ts.box(l).style.setProperty('mask-image', 'none', 'important')
    await window.__ts.frames()
  }, target.label)
  const plain = { strip: await page.screenshot({ clip: strip }), fade: await page.screenshot({ clip: fadeZone }) }
  await page.evaluate((l) => window.__ts.box(l).style.removeProperty('mask-image'), target.label)
  writeFileSync(path.join(OUT, `${slug(where)}-scrollbar-masked.png`), masked.strip)
  writeFileSync(path.join(OUT, `${slug(where)}-scrollbar-unmasked.png`), plain.strip)
  const fadeDiff = await pixelDiff(masked.fade, plain.fade)
  const stripDiff = await pixelDiff(masked.strip, plain.strip)
  check(where, 'the mask is live in the pixels (the strip left of the scrollbar fades)', fadeDiff.strong > 0, fadeDiff)
  check(where, "the box's vertical scrollbar is not faded — its pixels match the unmasked box", stripDiff.max <= 8, stripDiff)
  // The ring at the masked edge: the strip just OUTSIDE the box's right edge, focused vs blurred at
  // the same scroll (a blur moves nothing), so only the ring can tell the two apart.
  await focusBox(target.label, 'top')
  const f = await bandOf(target.label)
  const ringClip = { x: Math.round(f.right), y: Math.round(f.top + 12), width: 6, height: 100 }
  const focused = await page.screenshot({ clip: ringClip })
  await page.evaluate(() => document.activeElement?.blur())
  await frames()
  const blurred = await page.screenshot({ clip: ringClip })
  writeFileSync(path.join(OUT, `${slug(where)}-ring-edge.png`), focused)
  const ringDiff = await pixelDiff(blurred, focused)
  check(where, 'the keyboard-focused box draws its ring at the masked edge (pixels)', ringDiff.strong >= ringClip.height, ringDiff)
}

/** Holdings with the detail dock open narrows the card: the sideways checks again, if it overflows. */
async function holdingsDock(where, target) {
  const toggle = await page.evaluate(async (l) => {
    const box = window.__ts.box(l)
    box.scrollIntoView({ block: 'center' })
    box.scrollTop = 0
    await window.__ts.frames()
    const r = box.querySelector('tbody .row-toggle').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, target.label)
  await page.mouse.click(toggle.x, toggle.y)
  const opened = await page.locator('.detail-panel-body').first().waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)
  await sleep(600)
  // Docked beside the content (it narrows the card), or an overlay with a backdrop (it does not).
  const d = await page.evaluate((l) => {
    const box = window.__ts.box(l)
    return { docked: document.querySelector('.detail-panel-backdrop') === null, width: box.clientWidth, scrollWidth: box.scrollWidth }
  }, target.label)
  note(where, 'the Holdings box with the holding detail open', { opened, ...d })
  if (opened && d.docked) await sidewaysMask(`${where} +dock`, target)
  await page.getByRole('button', { name: 'Close details' }).first().click().catch(() => {})
  await sleep(300)
}

// ---------------------------------------------------------------------------------------------
// Classifications: a chip and a search start the list from its first row
// ---------------------------------------------------------------------------------------------

async function classificationResets(where, target) {
  const chip = async (text) => {
    const r = await page.evaluate((t) => {
      const b = [...document.querySelectorAll('.classification-toolbar button')].find((x) => x.textContent.startsWith(t))
      const rect = b.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    }, text)
    await page.mouse.click(r.x, r.y)
    await frames()
    await sleep(250)
  }
  const boxState = () => page.evaluate((l) => {
    const box = window.__ts.box(l)
    return box === null ? null : { scrollTop: box.scrollTop, rows: box.querySelectorAll('tbody tr').length, overflows: box.scrollHeight > box.clientHeight + 1 }
  }, target.label)
  // The chips and the search sit above the box: a window that shows them, the box mid-list.
  const midWithChipsInView = () => page.evaluate(async (l) => {
    const box = window.__ts.box(l)
    const bar = document.querySelector('.classification-toolbar')
    window.scrollBy(0, bar.getBoundingClientRect().top - window.innerHeight * 0.3)
    box.scrollTop = Math.round((box.scrollHeight - box.clientHeight) / 2)
    await window.__ts.frames()
    return box.scrollTop
  }, target.label)
  // A reset is only there to see when the box was scrolled before and the new list still scrolls:
  // a list that fits its box has no place but its first row, whatever the code did.
  const reset = (name, from, after) => {
    const seen = { from, ...after }
    if (from > 0 && after !== null && after.overflows) check(where, name, after.scrollTop === 0, seen)
    else note(where, `${name} — not measurable here (the box was not scrolled first, or the new list fits it)`, seen)
  }
  const mid = await midWithChipsInView()
  await chip('Not reviewed')
  reset('a new filter chip starts the list from its first row', mid, await boxState())
  await chip('All')
  const mid2 = await midWithChipsInView()
  const search = page.locator('.classification-search')
  await search.focus()
  await page.keyboard.type('e')
  await frames()
  await sleep(250)
  reset('a search starts the list from its first row', mid2, await boxState())
  await search.fill('')
  await sleep(250)
}

// ---------------------------------------------------------------------------------------------
// The rewards matrix: header focus, and the focus hand-back from a card's detail
// ---------------------------------------------------------------------------------------------

async function rewardsHeader(where, target) {
  await focusBox(target.label, 'middle')
  const mid = (await bandOf(target.label)).scrollTop
  const walk = []
  for (let i = 0; i < 20; i += 1) {
    await page.keyboard.press('Tab')
    const f = await focusIn(target.label)
    if (!f.inHead) break
    walk.push({ name: f.name, scrollTop: Math.round(f.band.scrollTop) })
  }
  check(where, "Tab across the pinned card buttons never moves the scrolled box", mid > 0 && walk.length > 0 && walk.every((w) => w.scrollTop === Math.round(mid)), { scrollTop: mid, walk })
}

/** A card's detail and back. Both clicks are the MOUSE at the control's own pixels (locator.click()
 *  scrolls first). CreditCardsPage renders the detail INSTEAD of the matrix (`activeCard ? <CardDetail/>
 *  : …`), so the matrix unmounts while a card is open and Back to matrix mounts a new box at its top:
 *  the box's scroll cannot survive the trip, by the page's design, before this batch — a note, with a
 *  mark on the old box element to show the new one is new. */
async function matrixBack(where, target) {
  const before = await boxTo(target.label, 'middle')
  const card = await page.evaluate((l) => {
    const box = window.__ts.box(l)
    box.__smokeMark = true
    const button = box.querySelector('.matrix-card-btn')
    const r = button.getBoundingClientRect()
    return { id: button.id, x: r.left + r.width / 2, y: r.top + r.height / 2, pageY: Math.round(window.scrollY) }
  }, target.label)
  await page.mouse.click(card.x, card.y)
  await page.getByRole('button', { name: 'Back to the matrix' }).waitFor({ state: 'visible', timeout: 5000 })
  await frames()
  // The page's scroll with the detail open, before anything here scrolls it; the button brought into
  // the window only if the detail left it outside.
  const open = await page.evaluate(() => {
    const pageY = Math.round(window.scrollY)
    const button = document.querySelector('[aria-label="Back to the matrix"]')
    let r = button.getBoundingClientRect()
    if (r.top < 0 || r.bottom > window.innerHeight) {
      button.scrollIntoView({ block: 'center' })
      r = button.getBoundingClientRect()
    }
    return { pageY, x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await page.mouse.click(open.x, open.y)
  await page.waitForFunction((id) => document.activeElement?.id === id, card.id, { timeout: 3000 }).catch(() => {})
  await frames()
  const s = await page.evaluate((id) => {
    const a = document.activeElement
    const button = document.getElementById(id)
    const r = (button ?? a).getBoundingClientRect()
    const scope = document.querySelector('.page-frame-scope')?.getBoundingClientRect() ?? null
    const box = button?.closest('.table-scroll') ?? null
    return {
      active: a === document.body ? 'body' : `${a.tagName.toLowerCase()}#${a.id}`, buttonBack: button !== null,
      top: Math.round(r.top), bottom: Math.round(r.bottom), scopeBottom: scope && Math.round(scope.bottom),
      clearOfScopeRow: scope === null || r.top >= scope.bottom - 1, inWindow: r.top >= 0 && r.bottom <= window.innerHeight,
      pageY: Math.round(window.scrollY), boxScrollTop: box?.scrollTop ?? null, newBox: box !== null && box.__smokeMark !== true,
    }
  }, card.id)
  known(where, "Back to matrix hands the focus back to the card's column button", s.active === `button#${card.id}`, { expected: card.id, ...s }, 'matrix-focus-return')
  // Where it lands (or would) against the page's sticky scope row — a reading, not a vote.
  note(where, `where the card button lands after Back to matrix against the sticky scope row${s.active === `button#${card.id}` ? '' : ' (it did not take the focus)'}`, s)
  note(where, "the card detail replaces the matrix, so Back to matrix returns to the box's top — pre-existing; the page's own scroll resets on open too (it jumps to the detail and is not restored on Back)", {
    box: { beforeOpen: before.scrollTop, afterBack: s.boxScrollTop, newBoxElement: s.newBox },
    page: { beforeOpen: card.pageY, withDetailOpen: open.pageY, afterBack: s.pageY },
  })
  await shot(where, 'back-to-matrix')
}

/** Whether a table outgrows its box sideways here (and so wears the edge masks) — a reading per size. */
async function sidewaysNote(where, target, subject) {
  const s = await page.evaluate((l) => {
    const box = window.__ts.box(l)
    return { clientWidth: box.clientWidth, scrollWidth: box.scrollWidth, more: box.getAttribute('data-scroll-more') ?? '' }
  }, target.label)
  const overflows = s.scrollWidth > s.clientWidth + 1
  note(where, `${subject} ${overflows ? 'overflows its box sideways — the edge masks apply' : 'fits its box sideways — no edge masks'}`, s)
}

// ---------------------------------------------------------------------------------------------
// Net worth on paper
// ---------------------------------------------------------------------------------------------

async function printed(where, target) {
  // No leftover keyboard ring from the checks before on the printed artifacts.
  await page.evaluate(() => {
    document.activeElement?.blur()
    window.scrollTo(0, 0)
  })
  // Print media always comes off again, thrown or not: every check after this one reads the screen.
  let p
  await page.emulateMedia({ media: 'print' })
  try {
    await frames()
    p = await page.evaluate((l) => {
      const box = window.__ts.box(l)
      const cs = getComputedStyle(box)
      const table = box.querySelector(':scope > table')
      const pinned = [...table.querySelectorAll(':scope > thead th, :scope > tfoot td, :scope > tfoot th')]
      const body = table.tBodies[table.tBodies.length - 1].rows
      const lastRow = body[body.length - 1].getBoundingClientRect()
      const foot = table.tFoot?.rows[0].getBoundingClientRect() ?? null
      return {
        maxHeight: cs.maxHeight, overflowY: cs.overflowY, mask: cs.maskImage, fade: getComputedStyle(box, '::after').display,
        pinned: pinned.length, notStatic: pinned.filter((c) => getComputedStyle(c).position !== 'static').length,
        footTop: foot && foot.top, lastRowBottom: lastRow.bottom,
        boxHeight: box.getBoundingClientRect().height, tableHeight: table.getBoundingClientRect().height,
      }
    }, target.label)
    // The PDF is the artifact of record; the full-page shot under print media is its eyeball-able twin.
    await page.pdf({ path: path.join(OUT, `${slug(where)}-print.pdf`), printBackground: true })
    await page.screenshot({ path: path.join(OUT, `${slug(where)}-print-media.png`), fullPage: true })
  } finally {
    await page.emulateMedia({ media: 'screen' }).catch(() => {})
  }
  await frames()
  check(where, 'on paper the box lets go: no cap, no scroller, no mask, no fade', p.maxHeight === 'none' && p.overflowY === 'visible' && p.mask === 'none' && p.fade === 'none' && p.boxHeight >= p.tableHeight - 1, p)
  check(where, 'on paper every pinned header and totals cell prints static — none overprints the rows', p.pinned > 0 && p.notStatic === 0, p)
  check(where, 'on paper the totals row follows the last account row', p.footTop !== null && Math.abs(p.footTop - p.lastRowBottom) <= 1, p)
}

// ---------------------------------------------------------------------------------------------
// Dividends by month (spec §4)
// ---------------------------------------------------------------------------------------------

const DIVIDENDS = 'Dividends by month'

/** The book's own ledger, from the API (a GET outside the page). */
async function ledger() {
  const res = await page.request.get(`${API}/api/v1/portfolio/dividends`, { headers: { Authorization: `Bearer ${TOKEN}` } })
  const all = await res.json()
  const cents = new Map()
  const counts = new Map()
  for (const d of all) {
    const k = d.pay_date.slice(0, 7)
    cents.set(k, (cents.get(k) ?? 0) + Math.round(Number(d.amount) * 100))
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const keys = [...cents.keys()].sort().reverse()
  // The product's day, as the server names it on every response (X-Product-Today, 2026-09-23 spec
  // §K1) — the day the app's todayIso() answers; a stack that predates the header falls back to this
  // box's own date, which the browser's clock then shares.
  const now = new Date()
  const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const productToday = res.headers()['x-product-today'] ?? null
  return {
    all, cents, counts, keys, today: productToday ?? local, todayFrom: productToday === null ? 'this box' : 'X-Product-Today',
    fullest: keys.reduce((a, b) => (counts.get(b) > counts.get(a) ? b : a)),
  }
}

/** Fold every month, then open exactly `labels` — each through its line's own button. */
const openOnly = (labels) =>
  page.evaluate(async ([l, wanted]) => {
    const box = window.__ts.box(l)
    for (const b of box.querySelectorAll('.dividend-month-toggle[aria-expanded="true"]')) b.click()
    await window.__ts.frames()
    for (const b of box.querySelectorAll('.dividend-month-toggle')) {
      if (wanted.includes(b.querySelector('.dividend-month-label').textContent)) b.click()
    }
    await window.__ts.frames()
  }, [DIVIDENDS, labels])

async function dividendMonths(where) {
  const { all, cents, counts, keys, fullest, today, todayFrom } = await ledger()
  const lines = await page.$$eval(`${boxSel(DIVIDENDS)} .dividend-month-row`, (rows) =>
    rows.map((r) => ({
      text: r.querySelector('.dividend-month-label').textContent,
      total: r.querySelector('td.num').textContent,
      expanded: r.querySelector('button').getAttribute('aria-expanded'),
    })),
  )
  check(where, 'one line per recorded month, newest first', JSON.stringify(lines.map((l) => l.text)) === JSON.stringify(keys.map(monthLabel)), { dom: lines.map((l) => l.text), api: keys.map(monthLabel) })
  // Spec §4.4: the newest month on or before today's (a future-dated entry must not fold the current
  // month away), else the newest — "today" being the product's day (see ledger()).
  const current = today.slice(0, 7)
  const expected = keys.find((k) => k <= current) ?? keys[0]
  const open = lines.filter((l) => l.expanded === 'true').map((l) => l.text)
  check(where, `only the default month is open — the newest on or before ${monthLabel(current)} (${monthLabel(expected)})`, JSON.stringify(open) === JSON.stringify([monthLabel(expected)]), { open, today, todayFrom })
  const wrong = lines.filter((l, i) => l.total !== money.format(cents.get(keys[i]) / 100))
  check(where, "every month's total is the cent-exact sum of its entries", wrong.length === 0, wrong.slice(0, 3))
  // Read past any separator the line's accessible name puts before the count (a visually-hidden comma).
  const countTexts = await page.$$eval(`${boxSel(DIVIDENDS)} .dividend-month-count`, (els) => els.map((e) => e.textContent.replace(/^[\s,]+/, '')))
  const countsWrong = countTexts.flatMap((text, i) => {
    const expected = `${counts.get(keys[i])} ${counts.get(keys[i]) === 1 ? 'entry' : 'entries'}`
    return text === expected ? [] : [{ month: monthLabel(keys[i]), text, expected }]
  })
  check(where, 'every line counts its entries', countTexts.length === keys.length && countsWrong.length === 0, countsWrong.slice(0, 4))
  // The bars, off the live chart through the app's own echarts module (pageHelpers' hook). A card on
  // the page whose instance cannot be read — the hook failed to load, or no chart ever mounted — is a
  // failure with its reason, never a quiet skip; only a page with no such card is a note.
  const chartState = () => page.evaluate(() => {
    const card = [...document.querySelectorAll('.chart-card')].find((c) => /Monthly dividend income/i.test(c.textContent ?? ''))
    const host = card?.querySelector('[_echarts_instance_]')
    const chart = host && window.__echarts ? window.__echarts.getInstanceByDom(host) : null
    const state = { card: card !== undefined, host: host != null, hooked: window.__echarts !== undefined, hookError: window.__hookError ?? null }
    if (!chart) return { ...state, bars: null }
    const option = chart.getOption()
    return { ...state, bars: { cats: option.xAxis[0].data, values: option.series[0].data.map((v) => (v !== null && typeof v === 'object' ? v.value : v)) } }
  })
  let chart = await chartState()
  for (let i = 0; i < 10 && chart.card && chart.bars === null; i += 1) {
    await sleep(300)
    chart = await chartState()
  }
  const barsName = "each month's total equals its bar in the Monthly dividend income chart"
  if (!chart.card) note(where, `${barsName} — no such chart on the page here`, chart)
  else if (chart.bars === null) check(where, barsName, false, { reason: 'the chart is on the page but its instance could not be read', ...chart })
  else {
    const mismatched = []
    let compared = 0
    chart.bars.cats.forEach((cat, i) => {
      const k = keys.find((key) => monthLabel(key) === cat)
      if (k === undefined) return
      compared += 1
      if (Math.round(Number(chart.bars.values[i]) * 100) !== cents.get(k)) mismatched.push({ cat, bar: chart.bars.values[i], total: cents.get(k) / 100 })
    })
    check(where, `${barsName} (${compared} months)`, compared > 0 && mismatched.length === 0, mismatched.slice(0, 3))
  }
  const toolbar = page.locator('.dividend-months-bar button')
  await toolbar.click()
  await sleep(400)
  const expanded = await page.$$eval(`${boxSel(DIVIDENDS)} tr[data-dividend-id]`, (rows) => rows.length)
  check(where, 'Expand all renders every entry', expanded === all.length && (await toolbar.textContent()) === 'Collapse all', { expanded, api: all.length })
  await toolbar.click()
  await sleep(400)
  check(where, 'Collapse all folds every month', (await page.$$eval(`${boxSel(DIVIDENDS)} tr[data-dividend-id]`, (rows) => rows.length)) === 0, null)
  // The fullest month alone, scrolled to its middle: its line must stay pinned under the header.
  await openOnly([monthLabel(fullest)])
  await page.evaluate(([l, monthText]) => {
    const box = window.__ts.box(l)
    box.scrollIntoView({ block: 'center' })
    const line = [...box.querySelectorAll('.dividend-month-row')].find((r) => r.querySelector('.dividend-month-label').textContent === monthText)
    const rows = line.closest('tbody').querySelectorAll('tr[data-dividend-id]')
    const middle = rows[Math.floor(rows.length / 2)]
    box.scrollTop += middle.getBoundingClientRect().top - (box.getBoundingClientRect().top + box.clientHeight / 2)
  }, [DIVIDENDS, monthLabel(fullest)])
  await frames()
  await sleep(200)
  const pinned = await page.evaluate(([l, monthText]) => {
    const box = window.__ts.box(l)
    const line = [...box.querySelectorAll('.dividend-month-row')].find((r) => r.querySelector('.dividend-month-label').textContent === monthText)
    const cell = line.cells[0].getBoundingClientRect()
    const expectedTop = window.__ts.band(box).headBottom
    const hit = document.elementFromPoint(cell.left + 30, cell.top + cell.height / 2)
    return { offBy: Math.abs(cell.top - expectedTop), wins: hit !== null && line.contains(hit), scrollTop: box.scrollTop }
  }, [DIVIDENDS, monthLabel(fullest)])
  check(where, `the open month's line (${monthLabel(fullest)}) stays pinned under the column header mid-month`, pinned.scrollTop > 0 && pinned.offBy <= 1 && pinned.wins, pinned)
  await page.locator(boxSel(DIVIDENDS)).screenshot({ path: path.join(OUT, `${slug(where)}-month-pinned.png`) })
  return { keys, fullest }
}

/** useScrollEdges' 'xy' observer watches the TABLE (Task 1 review): once the box is capped its own
 *  size never changes, so a month opening below the fold must raise "more below" with no scroll. */
async function dividendObserver(where, { keys }) {
  const newest = monthLabel(keys[0])
  const oldest = monthLabel(keys[keys.length - 1])
  await openOnly([newest])
  const before = await boxTo(DIVIDENDS, 'end')
  const line = await page.evaluate(([l, text]) => {
    const row = [...window.__ts.box(l).querySelectorAll('.dividend-month-row')].find((r) => r.querySelector('.dividend-month-label').textContent === text)
    const r = row.cells[0].getBoundingClientRect()
    return { x: r.left + Math.min(r.width / 2, 60), y: r.top + r.height / 2 }
  }, [DIVIDENDS, oldest])
  await page.mouse.click(line.x, line.y)
  await frames()
  const after = await page.evaluate(([l, text]) => {
    const box = window.__ts.box(l)
    const row = [...box.querySelectorAll('.dividend-month-row')].find((r) => r.querySelector('.dividend-month-label').textContent === text)
    return { opened: row.querySelector('button').getAttribute('aria-expanded'), scrollTop: box.scrollTop, more: box.getAttribute('data-scroll-more') ?? '' }
  }, [DIVIDENDS, oldest])
  const name = `opening the oldest month (${oldest}) at the box's end raises "more below" with no scroll — the observer watches the table`
  const seen = { before: { scrollTop: before.scrollTop, maxScroll: before.maxScroll, more: before.more }, after }
  // "At its end" means something only for a box that scrolls: one whose table fits has no end to be at.
  if (before.maxScroll > 0) check(where, name, !before.more.includes('bottom') && after.opened === 'true' && after.more.includes('bottom') && after.scrollTop === before.scrollTop, seen)
  else note(where, `${name} — not measurable here (the box did not scroll with only the newest month open)`, seen)
}

/** A saved entry is revealed inside the box without moving the page (spec §4.5), driven through the
 *  real revealInBox: the fence answers the PATCH 200 '{}' — no id in it, so the panel falls back to
 *  the row's own — and the page's refetch brings the edit back (the fence's memory). Saved two ways:
 *  'enter' — Enter in the Notes box, the keyboard's implicit submit, where the caret stays in a box
 *  nothing disables, so "the focus stays in the form" judges the reveal alone; and 'click' — the mouse
 *  on Save changes, as the review asked, where the submit button disables itself while the save is
 *  in flight (`disabled={busy}`, 2026-08-22) — the `focusout` log says what took the focus, if
 *  anything does. `offset` picks a different row of the month for each. */
async function dividendReveal(where, { fullest }, how, offset) {
  const tag = `(${how === 'enter' ? 'Enter in Notes' : 'a mouse click on Save changes'})`
  await openOnly([monthLabel(fullest)])
  const pick = await page.evaluate(async ([l, monthText, step]) => {
    const box = window.__ts.box(l)
    box.scrollIntoView({ block: 'center' })
    const line = [...box.querySelectorAll('.dividend-month-row')].find((r) => r.querySelector('.dividend-month-label').textContent === monthText)
    const rows = line.closest('tbody').querySelectorAll('tr[data-dividend-id]')
    const row = rows[Math.floor(rows.length / 2) + step]
    box.scrollTop += row.getBoundingClientRect().top - (box.getBoundingClientRect().top + box.clientHeight / 2)
    await window.__ts.frames()
    const edit = row.querySelector('button[aria-label="Edit this dividend"]').getBoundingClientRect()
    return { id: row.getAttribute('data-dividend-id'), x: edit.left + edit.width / 2, y: edit.top + edit.height / 2 }
  }, [DIVIDENDS, monthLabel(fullest), offset])
  await page.mouse.click(pick.x, pick.y)
  const submit = page.locator('.entry-form button[type="submit"]')
  const editing = (await submit.textContent()) === 'Save changes'
  const notes = page.locator('.entry-form .notes-field input')
  await notes.fill(`${(await notes.inputValue()).trim()} · table-scroll smoke`.replace(/^ · /, ''))
  // The row goes BELOW the band, 80px under the box's foot.
  const below = await page.evaluate(async ([l, id]) => {
    const box = window.__ts.box(l)
    const row = box.querySelector(`tr[data-dividend-id="${id}"]`)
    box.scrollTop += row.getBoundingClientRect().top - window.__ts.band(box).bottom - 80
    await window.__ts.frames()
    return row.getBoundingClientRect().top - window.__ts.band(box).bottom
  }, [DIVIDENDS, pick.id])
  const writesBefore = report.writesBlocked.length
  // The page's scroll the moment the form submits — after Playwright brought the control into reach —
  // and every focus that leaves the form from then on.
  await page.evaluate((l) => {
    const name = (el) => (el ? `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 20)}"` : null)
    window.__atSave = undefined
    window.__focusLog = []
    window.addEventListener('submit', () => {
      window.__atSave = { pageY: window.scrollY, boxTop: window.__ts.box(l).scrollTop, focused: name(document.activeElement) }
    }, { capture: true, once: true })
    document.addEventListener('focusout', (e) => {
      if (window.__atSave !== undefined) window.__focusLog.push({ from: name(e.target), disabled: e.target.disabled === true, to: name(e.relatedTarget) })
    }, { capture: true })
  }, DIVIDENDS)
  if (how === 'enter') await notes.press('Enter')
  else await submit.click()
  const revealed = await page
    .waitForFunction((l) => window.__atSave !== undefined && window.__ts.box(l).scrollTop !== window.__atSave.boxTop, DIVIDENDS, { timeout: 8000 })
    .then(() => true, () => false)
  await page.waitForLoadState('networkidle').catch(() => {})
  await frames()
  await sleep(300)
  const r = await page.evaluate(([l, id]) => {
    const box = window.__ts.box(l)
    const row = box.querySelector(`tr[data-dividend-id="${id}"]`)
    const b = window.__ts.band(box)
    const line = row?.closest('tbody').querySelector('.dividend-month-row').getBoundingClientRect().height ?? 0
    const rect = row?.getBoundingClientRect()
    const a = document.activeElement
    return {
      atSave: window.__atSave, pageY: window.scrollY, boxTop: box.scrollTop,
      rowTop: rect && rect.top, rowBottom: rect && rect.bottom, floor: b.headBottom + line, ceiling: b.clearBottom,
      notes: row?.querySelector('.notes-cell')?.textContent ?? null,
      focusInForm: a?.closest('form.entry-form') !== null,
      focused: a === document.body ? 'body' : `${a?.tagName.toLowerCase()} "${(a?.textContent || a?.getAttribute('aria-label') || '').trim().slice(0, 20)}"`,
      focusLog: window.__focusLog,
    }
  }, [DIVIDENDS, pick.id])
  const sent = report.writesBlocked.slice(writesBefore)
  check(where, `Edit → save ${tag} sends one fenced PATCH for the row (nothing reaches the server)`, editing && below > 0 && sent.length === 1 && sent[0].method === 'PATCH' && sent[0].url === `/api/v1/portfolio/dividends/${pick.id}`, { editing, below, sent })
  check(where, `the saved entry is revealed inside the box — the box scrolled to it ${tag}`, revealed && r.rowTop !== undefined, r)
  check(where, `the reveal never moves the page ${tag}`, r.atSave !== undefined && r.pageY === r.atSave.pageY, { atSave: r.atSave, pageY: r.pageY })
  check(where, `the revealed row sits in the band — below the header and its month's line, above the fade ${tag}`, r.rowTop >= r.floor - 1 && r.rowBottom <= r.ceiling + 1, r)
  // The mouse path is the known defect's (see KNOWN_DEFECTS); the keyboard path must pass outright.
  const focusName = `the focus stays in the entry form through the save ${tag}`
  const focusSeen = { atSubmit: r.atSave?.focused, after: r.focused, focusLog: r.focusLog }
  if (how === 'click') known(where, focusName, r.focusInForm, focusSeen, 'dividend-save-focus')
  else check(where, focusName, r.focusInForm, focusSeen)
  await page.locator(boxSel(DIVIDENDS)).screenshot({ path: path.join(OUT, `${slug(where)}-revealed-${how}.png`) })
  forget()
}

// ---------------------------------------------------------------------------------------------
// The transactions ledger: the drags (spec §2.6) and a reload that keeps the box's place
// ---------------------------------------------------------------------------------------------

const LEDGER = 'Transactions table'
const LEDGER_ROWS = `${boxSel(LEDGER)} tbody tr[data-reorder-id]`
const LIVE = '#portfolio-records-transactions [aria-live="assertive"]'
const ledgerOrder = () => page.$$eval(LEDGER_ROWS, (els) => els.map((e) => e.getAttribute('data-reorder-id')))

/** Every drag ends here, thrown or not: Escape drops a lift (nothing is sent), the release ends the
 *  press, and the frame trace stops — so a failure mid-drag never leaves the button down for the
 *  next check. Each step on its own catch: one failing must not skip the others. */
async function releaseDrag({ pointer = true } = {}) {
  await page.keyboard.press('Escape').catch(() => {})
  if (pointer) await page.mouse.up().catch(() => {})
  await page.evaluate(() => { window.__tracing = false }).catch(() => {})
}

/** From the arrival state — the page at its top, the box hanging past the window's foot — a pointer
 *  drag held at the WINDOW's foot must reach the ledger's last slot (Task 4 review: the page fallback),
 *  the box running to its end before the page takes the scroll over (the reorder hook's hand-off). */
async function arrivalDrag(where) {
  const start = await page.evaluate((l) => ({ pageY: window.scrollY, band: window.__ts.band(window.__ts.box(l)), innerHeight: window.innerHeight }), LEDGER)
  const before = await ledgerOrder()
  const writesBefore = report.writesBlocked.length
  const grip = await page.locator(`${LEDGER_ROWS}[data-reorder-id="${before[3]}"] .reorder-grip`).boundingBox()
  const x = grip.x + grip.width / 2
  const y = grip.y + grip.height / 2
  // Every frame of the hold: the page's scroll and the box's, to read the order they moved in.
  await page.evaluate((l) => {
    const box = window.__ts.box(l)
    window.__trace = []
    window.__tracing = true
    const tick = () => {
      window.__trace.push([window.scrollY, box.scrollTop])
      if (window.__tracing) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, LEDGER)
  let held
  let waited = 0
  await page.mouse.move(x, y)
  await page.mouse.down()
  try {
    await page.mouse.move(x, y + 6, { steps: 2 })
    await page.mouse.move(x, start.innerHeight - 2, { steps: 20 })
    // Hold until the page and the box have both stood still for 1.5 s.
    let still = 0
    let last = ''
    while (still < 6 && waited < 25000) {
      await sleep(250)
      waited += 250
      const key = await page.evaluate((l) => `${Math.round(window.scrollY)}/${Math.round(window.__ts.box(l).scrollTop)}`, LEDGER)
      still = key === last ? still + 1 : 0
      last = key
    }
    held = await page.evaluate(([l, live]) => {
      window.__tracing = false
      const edge = document.querySelector('[data-reorder-drop]')
      const rows = [...window.__ts.box(l).querySelectorAll('tbody tr[data-reorder-id]')]
      const boxMax = window.__ts.band(window.__ts.box(l)).maxScroll
      const trace = window.__trace
      const firstPageMove = trace.findIndex(([pageY]) => pageY > trace[0][0])
      return {
        live: document.querySelector(live)?.textContent ?? '', pageY: Math.round(window.scrollY),
        boxTop: Math.round(window.__ts.box(l).scrollTop), boxMax,
        edge: edge && { index: rows.indexOf(edge), side: edge.getAttribute('data-reorder-drop') }, rows: rows.length,
        order: {
          frames: trace.length, firstPageMove,
          boxThen: firstPageMove < 0 ? null : trace[firstPageMove][1],
          boxEndFrame: trace.findIndex(([, boxTop]) => boxTop >= boxMax - 1),
        },
      }
    }, [LEDGER, LIVE])
    await shot(where, 'arrival-drag-held')
  } finally {
    await releaseDrag()
  }
  await sleep(800)
  const slot = /position (\d+) of (\d+)/.exec(held.live)
  check(where, `from the arrival state (page at ${start.pageY}), a drag held at the window's foot reaches the ledger's last slot`,
    start.pageY === 0 && slot !== null && slot[1] === slot[2] && Number(slot[2]) === before.length && held.edge !== null && held.edge.index === held.rows - 1 && held.edge.side === 'after',
    { waited, start: { pageY: start.pageY, boxTop: Math.round(start.band.top), boxBottom: Math.round(start.band.bottom) }, held })
  // The hand-off is only there to see when the box hangs past the window on arrival; at 1920×1080 its
  // foot (1054) is inside the window, the box alone reaches the last slot, and the page never moves.
  const handOff = { boxBottom: Math.round(start.band.bottom), innerHeight: start.innerHeight, pageY: held.pageY, boxMax: held.boxMax, ...held.order }
  if (start.band.bottom > start.innerHeight) check(where, 'the box runs to its end before the page takes the scroll over', held.order.firstPageMove >= 0 && held.order.boxThen >= held.boxMax - 1, handOff)
  else note(where, "the box's foot is inside the window on arrival — the page never needs to take over", handOff)
  check(where, 'Escape drops the arrival drag: same order, nothing sent', JSON.stringify(await ledgerOrder()) === JSON.stringify(before) && report.writesBlocked.length === writesBefore, report.writesBlocked.slice(writesBefore))
}

async function ledgerDrag(where) {
  const before = await ledgerOrder()
  // The box at its top with its foot 8px inside the window: the box has all its room, and the page
  // has room below — so "the page stays put" could fail. Centred, it could not: the ledger is the last
  // thing on Portfolio › Manage, and a centred box left the page at its maximum scroll (Task 10 review).
  const placed = await page.evaluate(async (l) => {
    const box = window.__ts.box(l)
    box.scrollTop = 0
    window.scrollBy(0, box.getBoundingClientRect().bottom - (window.innerHeight - 8))
    await window.__ts.frames()
    return { band: window.__ts.band(box), pageY: window.scrollY, room: document.documentElement.scrollHeight - window.innerHeight - window.scrollY }
  }, LEDGER)
  const writesBefore = report.writesBlocked.length
  const pageY0 = placed.pageY
  const grip = await page.locator(`${LEDGER_ROWS} .reorder-grip`).first().boundingBox()
  const x = grip.x + grip.width / 2
  const y = grip.y + grip.height / 2
  let mid
  await page.mouse.move(x, y)
  await page.mouse.down()
  try {
    await page.mouse.move(x, y + 6, { steps: 2 })
    await page.mouse.move(x, placed.band.bottom - 12, { steps: 20 })
    await sleep(1200)
    mid = await page.evaluate((l) => ({
      boxTop: window.__ts.box(l).scrollTop,
      pageY: window.scrollY,
      grabbing: document.documentElement.classList.contains('reorder-active'),
    }), LEDGER)
  } finally {
    await releaseDrag()
  }
  await sleep(800)
  check(where, 'a drag held at the box foot auto-scrolls the BOX', mid.grabbing && mid.boxTop > 100, mid)
  if (placed.room >= 20) check(where, 'the page stays put while the box scrolls (with room below it to move)', mid.pageY === pageY0, { pageY0, pageY: mid.pageY, room: Math.round(placed.room) })
  else note(where, 'no room below the box — "the page stays put" is not measurable here', { pageY0, room: placed.room })
  check(where, 'Escape drops the drag: same order, nothing sent', JSON.stringify(await ledgerOrder()) === JSON.stringify(before) && report.writesBlocked.length === writesBefore, report.writesBlocked.slice(writesBefore))
  // From the keyboard: lift the first row and walk it past the visible band — its landing slot stays
  // in view. Under reduced motion (this context) the row itself stays home and the slot is the one
  // the drop line marks (`data-reorder-drop` on its edge row, lane R7): that slot is what the box
  // keeps in view (useReorder's ensureVisible), so that is what is measured.
  await boxTo(LEDGER, 'top')
  await page.locator(`${LEDGER_ROWS} .reorder-grip`).first().focus()
  let kb
  await page.keyboard.press('Space')
  try {
    for (let i = 0; i < 15; i += 1) {
      await page.keyboard.press('ArrowDown')
      await sleep(60)
    }
    await sleep(400)
    kb = await page.evaluate((l) => {
      const box = window.__ts.box(l)
      const lifted = box.querySelector('tbody tr[data-reorder="lifted"]')
      const edge = box.querySelector('tbody tr[data-reorder-drop]')
      if (lifted === null || edge === null) return null
      const b = window.__ts.band(box)
      const height = lifted.getBoundingClientRect().height
      const e = edge.getBoundingClientRect()
      const side = edge.getAttribute('data-reorder-drop')
      const slotTop = side === 'after' ? e.bottom - height : e.top
      const line = document.querySelector('.reorder-drop-line:not([hidden])')?.getBoundingClientRect() ?? null
      return {
        side, slotTop, slotBottom: slotTop + height, lineTop: line && line.top, lineBottom: line && line.bottom,
        bandTop: b.headBottom, bandBottom: b.bottom, boxTop: box.scrollTop,
        moved: [...box.querySelectorAll('tbody tr[data-reorder-id]')].indexOf(edge),
      }
    }, LEDGER)
  } finally {
    // Escape drops the keyboard lift; no button is down to release.
    await releaseDrag({ pointer: false })
  }
  await sleep(600)
  check(where, 'a keyboard-lifted row walked past the band keeps its landing slot — and the drop line on it — in view inside the box',
    kb !== null && kb.boxTop > 0 && kb.slotTop >= kb.bandTop - 1 && kb.slotBottom <= kb.bandBottom + 1 &&
      kb.lineTop !== null && kb.lineTop >= kb.bandTop - 1 && kb.lineBottom <= kb.bandBottom + 1, kb)
  check(where, 'Escape drops the keyboard move: same order, nothing sent', JSON.stringify(await ledgerOrder()) === JSON.stringify(before) && report.writesBlocked.length === writesBefore, report.writesBlocked.slice(writesBefore))
}

/** Spec §2.6: the panels re-render in place when the page reloads after a row action, so the box
 *  keeps its place. A mid-box row's Delete goes to the fence, which remembers it: the page's reload
 *  brings the ledger back without that row, so the panel really re-renders under the reader. */
async function reloadKeepsPlace(where) {
  const before = (await boxTo(LEDGER, 'middle')).scrollTop
  const pick = await page.evaluate((l) => {
    const box = window.__ts.box(l)
    const middle = box.getBoundingClientRect().top + box.clientHeight / 2
    const row = [...box.querySelectorAll('tbody tr[data-reorder-id]')].find((r) => {
      const rect = r.getBoundingClientRect()
      return rect.top <= middle && rect.bottom >= middle
    })
    if (!row) return null
    const button = row.querySelector('button[aria-label^="Delete"]').getBoundingClientRect()
    return { id: row.getAttribute('data-reorder-id'), x: button.left + button.width / 2, y: button.top + button.height / 2, rows: box.querySelectorAll('tbody tr[data-reorder-id]').length }
  }, LEDGER)
  if (pick === null) {
    note(where, 'no row under the middle of the box — the reload check was skipped', null)
    return
  }
  const writesBefore = report.writesBlocked.length
  await page.mouse.click(pick.x, pick.y)
  await page.waitForFunction(([sel, id]) => document.querySelector(`${sel}[data-reorder-id="${id}"]`) === null, [LEDGER_ROWS, pick.id], { timeout: 8000 }).catch(() => {})
  await page.waitForLoadState('networkidle').catch(() => {})
  await sleep(800)
  const after = await page.evaluate(([l, sel, id]) => ({
    scrollTop: window.__ts.box(l).scrollTop,
    gone: document.querySelector(`${sel}[data-reorder-id="${id}"]`) === null,
    rows: document.querySelectorAll(sel).length,
  }), [LEDGER, LEDGER_ROWS, pick.id])
  const sent = report.writesBlocked.slice(writesBefore)
  check(where, 'the row Delete is one fenced DELETE (nothing reaches the server)', sent.length === 1 && sent[0].method === 'DELETE' && sent[0].url === `/api/v1/portfolio/transactions/${pick.id}`, sent)
  check(where, 'a reload after a row action re-renders the ledger and leaves the box where the reader had it', after.gone && after.rows === pick.rows - 1 && Math.abs(after.scrollTop - before) <= 2, { before, ...after })
  forget()
}

// ---------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------

async function runTarget(where, target) {
  await open(target)
  const cls = await page.evaluate(() => ({ cls: +window.__cls.toFixed(4), scopeRowShift: +window.__scopeRowShift.toFixed(4), shifts: window.__shifts }))
  // Net worth at 1280 carries a known shift (the scope row's, KNOWN_DEFECTS); everywhere else CLS is a check.
  const clsName = 'the load shifts the layout less than 0.1 (CLS)'
  if (target.name === 'networth' && page.viewportSize().width === 1280) known(where, clsName, cls.cls < 0.1, cls, 'networth-scope-shift')
  else check(where, clsName, cls.cls < 0.1, cls)
  // First: the arrival state is the page as it loads, before anything scrolls it.
  if (target.name === 'transactions') await arrivalDrag(where)
  const g = await geometry(where, target)
  if (g.overflows) {
    await pins(where, target)
    await fade(where, target)
    await keyboard(where, target)
    await wheel(where, target)
    await rings(where, target)
    if (target.walk) await focusStops(where, target)
  } else note(where, 'the table fits its box here — pin, fade, keyboard, wheel and ring checks skipped', g)
  if (target.name === 'dividends') {
    const months = await dividendMonths(where)
    await dividendObserver(where, months)
    await dividendReveal(where, months, 'enter', 0)
    await dividendReveal(where, months, 'click', 3)
  }
  if (target.name === 'transactions' && g.overflows) {
    await ledgerDrag(where)
    // Last: its fenced Delete re-renders the ledger without a row.
    await reloadKeepsPlace(where)
  }
  if (target.name === 'holdings' && g.overflows) {
    await holdingsHeader(where, target)
    await sidewaysMask(where, target)
    await holdingsDock(where, target)
  }
  if (target.name === 'classifications' && g.overflows) await classificationResets(where, target)
  if (target.name === 'rewards') await sidewaysNote(where, target, 'the rewards matrix')
  if (target.name === 'rewards' && g.overflows) {
    await rewardsHeader(where, target)
    await matrixBack(where, target)
  }
  if (target.name === 'networth') await printed(where, target)
}

/** The record pass: each page's height at 1440×900 in its default view, against the before-number. */
async function recordTarget(where, target) {
  await open(target, { prepare: false })
  // Walk the page once so every lazily revealed card mounts (the before-numbers were taken so).
  const h = await page.evaluate(() => document.documentElement.scrollHeight)
  for (let y = 0; y < h; y += 700) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y)
    await sleep(120)
  }
  await page.evaluate(() => window.scrollTo(0, 0))
  await sleep(500)
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight)
  note(where, `page height at 1440×900 against the spec's before-number`, { before: target.before ?? null, after: pageHeight })
  report.heights.push({ where, target: target.name, pageHeight, before: target.before ?? null })
  if (target.name === 'transactions') {
    // The arrival drag needs the arrival state: a fresh load.
    await open(target)
    await arrivalDrag(where)
  }
}

async function withPage(theme, size, body) {
  const ctx = await makeContext(theme, size)
  page = await ctx.newPage()
  const errors = []
  const failed = []
  page.on('console', (m) => {
    if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  // A bare "Failed to load resource" names no URL: the request log does.
  page.on('requestfailed', (r) => failed.push(`${r.method()} ${r.url().replace(BASE, '')} (${r.failure()?.errorText})`))
  try {
    for (const target of TARGETS) {
      const where = `${theme} ${size.width}x${size.height} ${target.name}`
      state.where = where
      const t0 = Date.now()
      try {
        await body(where, target)
      } catch (error) {
        report.problems.push(`${where}: ${error.message.split('\n')[0]}`)
        await shot(where, 'error').catch(() => {})
      }
      if (errors.length > 0) {
        const requests = failed.length > 0 ? ` — failed requests: ${failed.slice(-4).join(', ')}` : ''
        report.problems.push(`${where}: console — ${errors.slice(0, 4).join(' | ')}${requests}`)
      }
      errors.length = 0
      failed.length = 0
      console.log(`  ${where}: ${((Date.now() - t0) / 1000).toFixed(1)} s`)
    }
  } finally {
    await ctx.close()
  }
}

try {
  for (const theme of THEMES) {
    for (const size of SIZES) await withPage(theme, size, runTarget)
  }
  if (RECORD && THEMES.length > 0) await withPage(THEMES[0], RECORD_SIZE, recordTarget)
} finally {
  await browser.close()
  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
}

console.log('Page heights (px):')
for (const h of report.heights) {
  const extra = h.before != null ? ` (before ${h.before})` : h.box != null ? ` (box ${h.box} of table ${h.table})` : ''
  console.log(`  ${h.where}: ${h.pageHeight}${extra}`)
}
const passed = report.checks.filter((c) => c.ok === true).length
const notes = report.checks.filter((c) => c.ok === null && !c.known).length
const retried = report.fenceRetries.length > 0 ? `, ${report.fenceRetries.length} GET(s) asked twice` : ''
const reloaded = report.loadRetries.length > 0 ? `, ${report.loadRetries.length} page load(s) retried` : ''
const unanswered = report.fenceErrors.length > 0 ? `, ${report.fenceErrors.length} request(s) the fence could not answer` : ''
const knownTally = report.known.length > 0 ? `, ${report.known.length} known (pre-existing)` : ''
const tally = `${passed} checks, ${notes} notes${knownTally}, ${report.writesBlocked.length} writes fenced (${report.prefsWrites.length} prefs)${retried}${reloaded}${unanswered}`
// A request the fence could not answer failed in the page — whatever the checks said around it.
for (const e of report.fenceErrors) report.problems.push(`${e.where}: the fence could not answer ${e.method} ${e.url} — ${e.error}`)
// A run whose filters and targets left nothing to judge has not passed.
if (passed === 0) report.problems.push('no check passed — nothing was judged (a filter, or every target failing to open)')
// Written in the `finally` above too, so a crash still leaves a report; this one carries the verdict.
writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
for (const ref of [...new Set(report.known.map((k) => k.ref))]) {
  const hits = report.known.filter((k) => k.ref === ref)
  const runs = hits.map((k) => k.where.replace(/ \S+$/, '')).join(', ')
  console.log(`KNOWN (pre-existing): ${KNOWN_DEFECTS[ref].why} — ${hits.length}× (${runs}); evidence: ${KNOWN_DEFECTS[ref].evidence}`)
}
// Requests the fence re-asked or could not answer (the page saw those fail): named, so a console
// error has a cause.
for (const r of report.fenceRetries) console.log(`  fence asked twice: GET ${r.url} (${r.where}): ${r.error}`)
for (const r of report.loadRetries) console.log(`  page load retried: ${r.url} (${r.where}, after attempt ${r.attempt}) — ${r.failure}`)
for (const e of report.fenceErrors) console.log(`  fence could not answer ${e.method} ${e.url} (${e.where}): ${e.error}`)
if (report.problems.length > 0) {
  console.log(`TABLE SCROLL SMOKE FAILED — ${report.problems.length} problem(s); ${tally}:`)
  for (const p of report.problems) console.log(`  - ${p}`)
  process.exit(1)
}
console.log(`TABLE SCROLL SMOKE OK — ${tally}`)
