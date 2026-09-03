// tools/probes/calendar-e/smoke.mjs — the calendar walk (calendar Plan E Task 4, spec §17).
// How to run it: see tools/probes/README.md (dev stack up, TOKEN_FILE minted from /auth/login).
//
// What it proves, against the REAL app (real dev data, headless Edge) rather than jsdom:
//   1. /calendar renders its grid, its four-tile cash-flow strip and its eight-source health
//      footer in BOTH themes with no console error — and the list view, the ?add= deep link,
//      the Overview "Up next" block and the Settings feed card do the same.
//   2. The keyboard contract holds on real markup: exactly one gridcell carries tabindex=0,
//      the "+N more" button opens the day drawer, and Escape hands focus back to that cell.
//   3. The write paths run end to end against Postgres: a custom event is added, edited,
//      deleted, restored through the toast's Undo and deleted again; a generated deadline is
//      marked done through the override overlay and reopened. Every row this walk creates it
//      also removes — twice over: through the UI, because undoing its own work is part of what
//      the walk proves, and then through `sweep()` in a `finally`, straight against the API, so
//      a Playwright timeout halfway through still leaves the database as it was found.
//   4. The two ICS routes really serve a calendar: "Add to calendar (.ics)" saves a file that
//      starts BEGIN:VCALENDAR (Plan E's swap onto the server renderer), and a freshly created
//      feed token fetches feed.ics with NO bearer, revalidates to a 304 on its own ETag, and
//      404s the moment it is revoked.
//   5. The GET /calendar timing the spec's §20 risk asks for is measured and printed — past
//      ~150 ms the follow-up is the snapshot cache, not storage.
//
// Needs a JWT in TOKEN_FILE — mint one with `POST /api/v1/auth/login`. The token is seeded
// into localStorage BEFORE first paint (addInitScript), because the app boots its auth out of
// there. Screenshots and report.json land in SMOKE_OUT, which defaults to the repo's
// gitignored scratchpad/ rather than next to this tracked script.
//
// API_BASE exists because a merge lane runs its own uvicorn beside the shared dev one: every
// /api/v1 request is re-issued against it, so the walk never depends on which build happens
// to own port 8000. PATCH /prefs is stubbed for the same reason charts-c7 stubs it — a smoke
// walks, it does not get to rewrite the account's settings — and the pass's theme is injected
// into the GET answer so the light pass stays light.
//
// Env overrides: SMOKE_OUT, TOKEN_FILE, APP_BASE, API_BASE, EDGE_PATH, PLAYWRIGHT_CORE,
// ONLY_THEME, SKIP_ACTIONS. PLAYWRIGHT_CORE and EDGE_PATH default to paths that exist on one
// box only — off it, both must be set (tools/probes/README.md says how).
//
// Exits 1 listing every `problems` entry; prints `CALENDAR SMOKE OK` when there are none.
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
const out = process.env.SMOKE_OUT ?? path.join(repo, 'scratchpad', 'calendar-smoke')
mkdirSync(out, { recursive: true })
const TOKEN = readFileSync(process.env.TOKEN_FILE ?? path.join(out, 'token.txt'), 'utf8').trim()
const BASE = process.env.APP_BASE ?? 'http://localhost:5173'
const API = process.env.API_BASE ?? 'http://127.0.0.1:8000'
const EDGE =
  process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const VIEWPORT = { width: 1600, height: 1000 }
// The entrance animation is 450ms and every page fires a refetch beat behind it.
const SETTLE = 1200
// The month the walk stands on. A literal, not "today": the assertions below name real days,
// and a smoke whose subject moves with the wall clock proves a different thing every night.
const MONTH = '2026-09'
// The day the custom-event walk uses. It already carries a payday and the Q3 deadline in the
// dev data, so two added events push it past the three-chip cap and the "+N more" appears.
const DAY = `${MONTH}-15`
// The month view fetches the month plus the days either side that the grid shows. The
// sweep asks for the same window, so it sees exactly the rows the walk could have written.
const [WALK_YEAR, WALK_MONTH] = MONTH.split('-').map(Number)
const WINDOW = {
  start: new Date(Date.UTC(WALK_YEAR, WALK_MONTH - 2, 1)).toISOString().slice(0, 10),
  end: new Date(Date.UTC(WALK_YEAR, WALK_MONTH + 1, 0)).toISOString().slice(0, 10),
}
// Every row this walk is allowed to remove, named exactly. A prefix match would let the
// sweep eat a real event that happens to start with the same word.
const LABEL = 'Smoke insurance'
const EDITED = 'Smoke insurance (edited)'
const GYM = 'Smoke gym'
const SMOKE_LABELS = [LABEL, EDITED, GYM]
const FEED_LABEL = 'smoke'

// Every override key the walk PUTs (see the interceptor), and how each one read BEFORE it
// did — the sweep puts the user's own overlay back rather than assuming the row is ours.
const overrideKeys = new Set()
const overridesBefore = new Map()
const OVERRIDE_PUT = new RegExp(String.raw`/api/v1/calendar/overrides/([^?]+)`)

const THEMES = ['dark', 'light'].filter(
  (t) => !process.env.ONLY_THEME || t === process.env.ONLY_THEME,
)

// Browser chatter that is never a defect (the same list the chart smoke filters), plus the
// HMR socket: `@vite/client` dials the dev server while vite listens on [::1] only, so the
// handshake is refused on every run of this box. The app opens no websocket of its own.
const NOISE =
  /favicon|DevTools|\[vite\]|@vite\/client|Download the React DevTools|React Router Future Flag/i

// Dev-data facts that look like errors and are not. RECORDED under knownBenign — never
// silently dropped — so a real regression hiding behind one stays visible.
const BENIGN = [
  {
    id: 'paycheck-profile-404',
    why: 'KNOWN NON-DEFECT: the viewed person has no paycheck profile in the dev DB, so /paycheck/* 404s and the page shows its own empty state.',
    test: (e) => /\/api\/v1\/paycheck\b/.test(e.url) && /\b404\b|Not Found/i.test(`${e.text} ${e.url}`),
  },
  {
    id: 'feed-revoked-404',
    why: 'EXPECTED: the walk revokes its own feed token and re-fetches to prove the 404.',
    test: (e) => /\/calendar\/feed\.ics/.test(e.url) && /\b404\b/.test(`${e.text} ${e.url}`),
  },
]

// What the page is FOR, read out of the DOM in one pass so the assertions below are about
// values rather than about selectors.
const CAL_PROBE = `(() => {
  const text = (el) => (el ? el.textContent.replace(/\\s+/g, ' ').trim() : null)
  const grid = document.querySelector('[role="grid"]')
  const chips = [...document.querySelectorAll('.cal-chip')]
  return {
    theme: document.documentElement.dataset.theme || null,
    grid: grid !== null,
    gridLabel: grid ? grid.getAttribute('aria-label') : null,
    roving: document.querySelectorAll('[role="gridcell"][tabindex="0"]').length,
    cells: document.querySelectorAll('[role="gridcell"][data-day]').length,
    chips: chips.map((c) => ({ text: text(c), title: c.getAttribute('title'), day: c.closest('[data-day]')?.dataset.day ?? null })),
    more: [...document.querySelectorAll('.cal-more')].map((b) => ({ text: text(b), day: b.closest('[data-day]')?.dataset.day ?? null })),
    gutters: [...document.querySelectorAll('.cal-gutter')].map(text),
    strip: [...document.querySelectorAll('.cal-strip .stat-tile')].map((t) => ({
      label: text(t.querySelector('.stat-label')),
      value: text(t.querySelector('.stat-value')),
    })),
    health: [...document.querySelectorAll('.cal-health > li')].map(text),
    list: [...document.querySelectorAll('.cal-list .cal-list-item')].map(text),
    formDate: document.querySelector('.cal-form input[type="date"]')?.value ?? null,
    url: location.pathname + location.search,
    drawer: (() => {
      const d = document.querySelector('.cal-drawer')
      return d ? { title: text(d.querySelector('.cal-drawer-title')), rows: d.querySelectorAll('.cal-drawer-row').length } : null
    })(),
  }
})()`

const UP_NEXT_PROBE = `(() => {
  const text = (el) => (el ? el.textContent.replace(/\\s+/g, ' ').trim() : null)
  const block = document.querySelector('.up-next')
  if (!block) return null
  return {
    rows: [...block.querySelectorAll('.up-next-list li')].map(text),
    amounts: [...block.querySelectorAll('.up-next-amount')].map((a) => {
      const li = a.closest('li').getBoundingClientRect()
      const own = a.getBoundingClientRect()
      // Right-aligned means the amount's right edge sits at the row's, not the label's.
      return { text: text(a), flushRight: Math.abs(li.right - own.right) < 24 }
    }),
    line: text(block.querySelector('.up-next-line')),
  }
})()`

const report = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  api: API,
  month: MONTH,
  viewport: VIEWPORT,
  themes: THEMES,
  routes: [],
  actions: [],
  timings: [],
  knownBenign: [],
  problems: [],
}
const problem = (msg) => report.problems.push(msg)

// The API from node, with the bearer. The sweep runs through this and not through the
// page: whatever broke the walk is usually the browser, and a cleanup that needs the thing
// that just died is not a cleanup.
const api = async (method, pathname, body) =>
  fetch(`${API}/api/v1${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

// The four overlay fields a PUT replaces, read off a composed event. `amount` only counts
// as the user's when the event says so — otherwise it is the generator's own estimate.
const overlayOf = (event) => ({
  done: event.done,
  hidden: event.hidden,
  note: event.note,
  amount: event.amount_overridden ? event.amount : null,
})
const isBlankOverlay = (o) => !o.done && !o.hidden && o.note === null && o.amount === null
const files = []
const shoot = async (page, name) => {
  const file = path.join(out, `${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  files.push(path.basename(file))
}

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'],
})

// One context factory for both passes: seeds auth + theme before first paint, re-points every
// /api/v1 call at API, stubs PATCH /prefs, and records console/pageerror/failed requests.
async function makeContext(theme) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    acceptDownloads: true,
  })
  await ctx.addInitScript(
    ([token, th]) => {
      localStorage.setItem('finance_token', token)
      localStorage.setItem('finance.theme', th)
    },
    [TOKEN, theme],
  )
  // `closing` mutes the reporters while the context tears down: a page with eight card
  // fetches in flight always has some of them aborted by the close itself, and those are the
  // harness talking, not the app.
  const state = { theme, route: 'boot', closing: false, errors: [], warnings: [], http: [], prefsWrites: [] }
  const stamp = new Date().toISOString()
  const themeEntry = { value: theme, updated_at: stamp }
  await ctx.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const target = request.url().replace(/^https?:\/\/[^/]+/, API)
    const isPrefs = /\/api\/v1\/prefs\b/.test(target)
    // "Reopen" is a PUT with done=false, not a DELETE, so putting a deadline back leaves an
    // all-default override ROW behind. Record every key the walk writes and drop the rows at
    // the end: "the dev database is left as it was found" has to mean the table too.
    const overridePut = OVERRIDE_PUT.exec(target)
    if (overridePut && request.method() === 'PUT') overrideKeys.add(decodeURIComponent(overridePut[1]))
    if (isPrefs && request.method() !== 'GET') {
      state.prefsWrites.push({ route: state.route, method: request.method(), body: (request.postData() || '').slice(0, 200) })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ prefs: { theme: themeEntry } }) })
    }
    const started = Date.now()
    let upstream
    try {
      upstream = await route.fetch({ url: target })
    } catch {
      // One retry before calling it a defect: a single-worker dev uvicorn drops the odd
      // connection under the double-fetch React's StrictMode makes in dev, and a smoke that
      // fails on that reports the harness rather than the app. A second failure is real.
      try {
        upstream = await route.fetch({ url: target })
      } catch (e) {
        if (!state.closing) {
          problem(`${theme} ${state.route}: ${target} could not be reached twice (${e.message})`)
        }
        return route.abort().catch(() => {})
      }
    }
    const ms = Date.now() - started
    if (/\/api\/v1\/calendar\?/.test(target)) {
      report.timings.push({ theme, route: state.route, url: target.slice(target.indexOf('/api')), ms })
    }
    if (isPrefs) {
      const body = await upstream.json()
      body.prefs = { ...body.prefs, theme: themeEntry }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    }
    return route.fulfill({ response: upstream })
  })

  const take = (entry) => {
    if (state.closing || NOISE.test(entry.text) || NOISE.test(entry.url)) return
    const rule = BENIGN.find((b) => b.test(entry))
    if (rule) {
      report.knownBenign.push({ theme, route: state.route, rule: rule.id, why: rule.why, ...entry })
      return
    }
    state.errors.push({ theme, route: state.route, ...entry })
  }
  const page = await ctx.newPage()
  page.on('console', (m) => {
    const type = m.type()
    if (type !== 'error' && type !== 'warning') return
    const entry = { kind: 'console', text: m.text().slice(0, 400), url: (m.location() || {}).url || '' }
    if (type === 'warning') {
      if (!NOISE.test(entry.text)) state.warnings.push({ theme, route: state.route, ...entry })
      return
    }
    take(entry)
  })
  page.on('pageerror', (e) => take({ kind: 'pageerror', text: String(e.message).slice(0, 400), url: page.url() }))
  page.on('requestfailed', (r) => {
    const f = r.failure()
    if (f && /ERR_ABORTED/.test(f.errorText)) return
    take({ kind: 'requestfailed', text: f ? f.errorText : 'request failed', url: r.url() })
  })
  page.on('response', (r) => {
    if (r.status() >= 400) state.http.push({ theme, route: state.route, status: r.status(), url: r.url() })
  })

  // networkidle is the honest wait, but a page that keeps a poll open would hang it — fall
  // back to `load` and say so in the report.
  const visit = async (route) => {
    state.route = route
    let waited = 'networkidle'
    try {
      await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 45000 })
    } catch {
      waited = 'load-fallback'
      await page.goto(BASE + route, { waitUntil: 'load', timeout: 45000 })
    }
    await page.waitForTimeout(SETTLE)
    if (/\/login/.test(page.url())) {
      problem(`${theme} ${route}: bounced to ${page.url()} — the seeded finance_token did not authenticate`)
    }
    return waited
  }
  const drain = (label) => {
    const taken = state.errors.splice(0)
    for (const e of taken) problem(`${theme} ${label}: ${e.kind} ${e.text}${e.url ? ` <${e.url}>` : ''}`)
    return taken
  }
  const finish = async () => {
    state.closing = true
    await page.close()
    await ctx.close()
  }
  return { page, state, visit, drain, finish }
}

// ---------------------------------------------------------------------------------------
// Pass 1 — the read-only walk, both themes.
// ---------------------------------------------------------------------------------------
for (const theme of THEMES) {
  const { page, state, visit, drain, finish } = await makeContext(theme)
  // Reported, not thrown: pass 2 owns the cleanup of anything an earlier interrupted run
  // left behind, so a read-only pass that dies must still hand over to it.
  try {
    // --- the month grid ---
    let waited = await visit(`/calendar?month=${MONTH}`)
    let dom = await page.evaluate(CAL_PROBE)
    await shoot(page, `${theme}-calendar-grid`)
    if (dom.theme !== theme) problem(`${theme} /calendar: html[data-theme] is ${dom.theme} — the theme did not apply`)
    if (!dom.grid) problem(`${theme} /calendar: no [role="grid"]`)
    if (dom.roving !== 1) problem(`${theme} /calendar: ${dom.roving} gridcells carry tabindex=0 — the roving tabindex must name exactly one`)
    if (dom.strip.length !== 4) problem(`${theme} /calendar: the cash-flow strip has ${dom.strip.length} tiles, expected 4`)
    for (const tile of dom.strip) {
      if (tile.value === null || /NaN|undefined/.test(tile.value)) problem(`${theme} /calendar: strip tile "${tile.label}" reads "${tile.value}"`)
    }
    if (dom.health.length !== 8) problem(`${theme} /calendar: the source-health footer lists ${dom.health.length} sources, expected 8`)
    // Money on the chips is the whole point of the v2 calendar (spec §1): at least one chip in
    // the month has to carry a figure, or the page is the v1 identity-string grid again.
    const priced = dom.chips.filter((c) => /\$/.test(c.text ?? ''))
    if (priced.length === 0) problem(`${theme} /calendar: no chip carries an amount — ${JSON.stringify(dom.chips.map((c) => c.text))}`)
    const payday = dom.chips.find((c) => (c.text ?? '').startsWith('Payday'))
    if (!payday) problem(`${theme} /calendar: no folded "Payday" chip in ${MONTH}`)
    report.routes.push({ theme, route: `/calendar?month=${MONTH}`, waited, dom, http: state.http.splice(0) })
    drain(`/calendar?month=${MONTH}`)

    // --- the list view ---
    waited = await visit(`/calendar?view=list&month=${MONTH}`)
    dom = await page.evaluate(CAL_PROBE)
    await shoot(page, `${theme}-calendar-list`)
    if (dom.grid) problem(`${theme} /calendar?view=list: the grid is still mounted beside the list`)
    if (dom.list.length === 0) problem(`${theme} /calendar?view=list: the list card is empty`)
    report.routes.push({ theme, route: `/calendar?view=list&month=${MONTH}`, waited, dom, http: state.http.splice(0) })
    drain(`/calendar?view=list&month=${MONTH}`)

    // --- the ?add= deep link ---
    waited = await visit(`/calendar?add=1&date=${MONTH}-20`)
    dom = await page.evaluate(CAL_PROBE)
    await shoot(page, `${theme}-calendar-add`)
    if (dom.formDate !== `${MONTH}-20`) problem(`${theme} /calendar?add=1: the form's date reads "${dom.formDate}", expected ${MONTH}-20`)
    if (dom.url !== '/calendar') problem(`${theme} /calendar?add=1: the URL is "${dom.url}" — the arrival params must be consumed once and stripped`)
    report.routes.push({ theme, route: '/calendar?add=1', waited, dom, http: state.http.splice(0) })
    drain('/calendar?add=1')

    // --- Overview "Up next" ---
    waited = await visit('/')
    const upNext = await page.evaluate(UP_NEXT_PROBE)
    await shoot(page, `${theme}-overview-up-next`)
    if (upNext === null) problem(`${theme} /: no .up-next block on the Overview`)
    else {
      if (upNext.rows.length === 0) problem(`${theme} /: Up next lists nothing`)
      if (upNext.rows.length > 5) problem(`${theme} /: Up next lists ${upNext.rows.length} rows, the cap is 5`)
      if (!/Next 45 days:/.test(upNext.line ?? '')) problem(`${theme} /: the 45-day line reads "${upNext.line}"`)
      for (const a of upNext.amounts) {
        if (!a.flushRight) problem(`${theme} /: Up next amount "${a.text}" is not right-aligned in its row`)
      }
    }
    report.routes.push({ theme, route: '/', waited, upNext, http: state.http.splice(0) })
    drain('/')

    // --- the Settings Calendar feed card ---
    // Two observations, not one: the ring lives ~1.2 s and is gone by the time the page has
    // settled, while "did the jump LAND" can only be judged after the cards above it have
    // finished growing — the very drift this route is here to catch.
    state.route = '/settings#calendar'
    await page.goto(`${BASE}/settings#calendar`, { waitUntil: 'load', timeout: 45000 })
    let rang = false
    for (let i = 0; i < 20 && !rang; i++) {
      rang = await page.evaluate(`!!document.getElementById('calendar')?.classList.contains('is-highlighted')`)
      if (!rang) await page.waitForTimeout(100)
    }
    await page.waitForTimeout(2500)
    const card = await page.evaluate(`(() => {
      const el = document.getElementById('calendar')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return {
        label: el.getAttribute('aria-label'),
        top: Math.round(r.top),
        // Landed means still on screen once every card above it has filled in.
        inView: r.top >= -8 && r.top < window.innerHeight,
        hasDayBox: !!el.querySelector('[aria-label="Monthly update reminder day"]'),
        hasNewLink: [...el.querySelectorAll('button')].some((b) => b.textContent.trim() === 'New feed link'),
      }
    })()`)
    waited = 'load'
    await shoot(page, `${theme}-settings-calendar`)
    if (card === null) problem(`${theme} /settings#calendar: no card wearing id="calendar"`)
    else {
      if (!rang) problem(`${theme} /settings#calendar: the anchored arrival never rang the card`)
      if (!card.inView) problem(`${theme} /settings#calendar: the card sits at top=${card.top}px once the page settles — the jump did not hold`)
      if (!card.hasDayBox) problem(`${theme} /settings#calendar: no monthly-update reminder-day box`)
      if (!card.hasNewLink) problem(`${theme} /settings#calendar: no "New feed link" button`)
    }
    if (card !== null) card.rang = rang
    report.routes.push({ theme, route: '/settings#calendar', waited, card, http: state.http.splice(0) })
    drain('/settings#calendar')

  } catch (e) {
    problem(`${theme} ${state.route}: the read walk stopped early (${e.message})`)
  } finally {
    report.routes.push({ theme, name: '_walk-logs', warnings: state.warnings.splice(0), prefsWrites: state.prefsWrites })
    await finish().catch((err) => problem(`${theme}: the browser context would not close (${err.message})`))
  }
}

// ---------------------------------------------------------------------------------------
// Pass 2 — the write walk, dark only. Everything it creates it removes.
// ---------------------------------------------------------------------------------------

// What the walk owes the dev database, settled from node whatever happened to the browser.
// Each step is independent and each one survives its own failure: a sweep that stops at the
// first error leaves more behind than one that reports three and finishes. Anything it could
// not settle becomes a `problem`, so the run exits non-zero and the leftover is named.
const sweep = async () => {
  const settled = { events: [], tokens: [], overrides: [] }

  try {
    const res = await api('GET', `/calendar?start=${WINDOW.start}&end=${WINDOW.end}`)
    if (!res.ok) throw new Error(`GET /calendar answered ${res.status}`)
    const { events } = await res.json()
    // By exact label and only rows that carry an id (custom events); a generated event has
    // none, and a prefix match could take a real row that opens with the same word.
    for (const event of events.filter((e) => e.id !== null && SMOKE_LABELS.includes(e.label))) {
      const del = await api('DELETE', `/calendar/events/${event.id}`)
      if (del.status !== 204) problem(`sweep: DELETE event ${event.id} answered ${del.status}`)
      settled.events.push({ id: event.id, label: event.label, status: del.status })
    }
  } catch (e) {
    problem(`sweep: the custom events could not be swept (${e.message})`)
  }

  try {
    const res = await api('GET', '/calendar/feed-tokens')
    if (!res.ok) throw new Error(`GET /calendar/feed-tokens answered ${res.status}`)
    // This run's own token only: the label AND a creation stamp inside the run. A link the
    // user made earlier and happened to call "smoke" is theirs. Compared as instants, not as
    // strings — the API stamps with an offset and `generatedAt` with a Z, and the minute of
    // slack is for a database clock that lags this process's.
    const since = Date.parse(report.generatedAt) - 60_000
    const mine = (await res.json()).filter(
      (t) => t.label === FEED_LABEL && Date.parse(t.created_at) >= since,
    )
    for (const token of mine) {
      const del = await api('DELETE', `/calendar/feed-tokens/${token.id}`)
      if (del.status !== 204) problem(`sweep: revoking feed token ${token.id} answered ${del.status}`)
      settled.tokens.push({ id: token.id, status: del.status })
    }
  } catch (e) {
    problem(`sweep: the feed tokens could not be swept (${e.message})`)
  }

  for (const key of overrideKeys) {
    try {
      const before = overridesBefore.get(key)
      // A row the walk found already carrying the user's own marks goes back exactly as it
      // was; anything else is dropped. Dropping is right for a blank overlay too: every
      // reader treats "no row" and "a row with nothing set" identically, and the walk is the
      // only reason a blank row would exist at all.
      const restore = before !== undefined && !isBlankOverlay(before)
      const res = restore
        ? await api('PUT', `/calendar/overrides/${encodeURIComponent(key)}`, before)
        : await api('DELETE', `/calendar/overrides/${encodeURIComponent(key)}`)
      // 404 on a DELETE is fine: an interrupted pass can record a key whose row never landed.
      const ok = restore ? res.ok : res.status === 204 || res.status === 404
      if (!ok) problem(`sweep: ${restore ? 'restoring' : 'deleting'} override ${key} answered ${res.status}`)
      settled.overrides.push({ key, action: restore ? 'restored' : 'deleted', status: res.status })
    } catch (e) {
      problem(`sweep: override ${key} could not be settled (${e.message})`)
    }
  }

  return settled
}

if (!process.env.SKIP_ACTIONS) {
  const { page, state, visit, drain, finish } = await makeContext(THEMES[0] ?? 'dark')
  const step = (name, value) => report.actions.push({ name, ...value })

  // "Is this event on the calendar?" asked of the LIST, never of document.innerText: the
  // delete toast quotes the label it just removed, so the page text says yes for two seconds
  // after the row is gone.
  const listedEvents = async () => {
    // `month=` PINNED, never left to default: the list would otherwise answer for whatever
    // month the wall clock is in while every write below aims at the literal DAY — so from
    // the first of the next month the edit and delete steps would miss, and the leftovers
    // check would clear a month the walk never touched while Smoke rows sat in another.
    await visit(`/calendar?view=list&month=${MONTH}`)
    return page.evaluate(`[...document.querySelectorAll('.cal-list-item')].map((b) => b.textContent.replace(/\\s+/g, ' ').trim())`)
  }
  const isListed = async (label) => (await listedEvents()).some((t) => t.includes(label))

  // Read the overlays BEFORE anything is written: the sweep restores what it finds here,
  // and after the first PUT there is nothing left to compare against.
  try {
    const res = await api('GET', `/calendar?start=${WINDOW.start}&end=${WINDOW.end}`)
    if (!res.ok) throw new Error(`answered ${res.status}`)
    for (const event of (await res.json()).events) overridesBefore.set(event.key, overlayOf(event))
  } catch (e) {
    problem(`actions: the overlay baseline could not be read (${e.message}) — the sweep will delete rather than restore`)
  }

  // Everything below is inside a try whose finally sweeps: a Playwright timeout halfway
  // through is a defect to report, not a reason to leave two events, a live feed token and
  // an override row in the user's database.
  try {
    // --- an override on a generated deadline: Mark done, then Reopen ---
    // Before the custom events go in: two more events on this day push the deadline past the
    // three-chip cap and into the drawer, and the point here is the chip.
    await visit(`/calendar?month=${MONTH}`)
    // The popover SURVIVES the write (openKey is page state; the revalidate only swaps the
    // data under it), so re-clicking the chip would CLOSE it rather than reopen it — open it
    // once, then drive the actions inside it.
    const openTaxPopover = async () => {
      if (await page.$('.cal-popover')) return true
      const chip = await page.$(`[data-day="${DAY}"] .cal-chip:has-text("tax")`)
      if (!chip) return false
      await chip.click()
      await page.waitForTimeout(400)
      return !!(await page.$('.cal-popover'))
    }
    const clickInPopover = async (label) => {
      const button = await page.$(`.cal-popover button:has-text("${label}")`)
      if (!button) return false
      await button.click()
      await page.waitForTimeout(600)
      return true
    }
    // POLL, never a fixed wait: the write is followed by a re-fetch of the whole window, and
    // that GET has been seen taking 1.3 s on this box — a sleep long enough to be safe today is
    // a smoke that passes for the wrong reason tomorrow.
    const doneChips = async (want) => {
      let count = -1
      for (let i = 0; i < 40; i++) {
        count = await page.evaluate(`document.querySelectorAll('.cal-chip.is-done').length`)
        if (count === want) return count
        await page.waitForTimeout(250)
      }
      return count
    }
    if (!(await openTaxPopover())) problem(`actions: no tax-deadline chip on ${DAY} to override`)
    else {
      // Baseline first: an interrupted earlier run can leave the deadline marked done, and a
      // walk that assumes its starting state proves nothing about the write it then makes.
      await clickInPopover('Reopen')
      await doneChips(0)
      const marked = await clickInPopover('Mark done')
      const done = await doneChips(1)
      await shoot(page, 'actions-3-override-done')
      if (!marked) problem('actions: the deadline popover offers no "Mark done"')
      if (done < 1) problem('actions: Mark done wrote the override but no chip renders as done')
      // Put it back: the overlay row is the user's, not the smoke's.
      if (!(await clickInPopover('Reopen'))) problem('actions: the done chip offers no Reopen')
      const left = await doneChips(0)
      if (left !== 0) problem(`actions: ${left} chip(s) still done after Reopen — the walk left an override behind`)
      step('override', { doneChips: done, afterReopen: left })
    }

    await visit(`/calendar?add=1&date=${DAY}`)

    // --- add two custom events on one day (the second pushes the day past the chip cap) ---
    const addEvent = async (label, amount) => {
      if (!(await page.$('.cal-form'))) await page.click('button:has-text("Add event")')
      await page.fill('.cal-form input[type="date"]', DAY)
      const boxes = await page.$$('.cal-form input.cal-form-input')
      await boxes[1].fill(label)
      await page.fill('[aria-label="Amount (optional)"]', amount)
      await page.selectOption('.cal-form select >> nth=1', 'out')
      await page.click('button:has-text("Save event")')
      // The form unmounts on a successful save (`setForm(null)`), which is the honest signal
      // that the POST landed — a fixed sleep here raced the land-on-save re-fetch.
      await page.waitForSelector('.cal-form', { state: 'detached', timeout: 15000 })
      await page.waitForTimeout(400)
    }
    await addEvent(LABEL, '180')
    await addEvent(GYM, '45')
    // …and the re-fetch behind it lands separately, so poll for the fold rather than assume it.
    let dom = await page.evaluate(CAL_PROBE)
    for (let i = 0; i < 40 && !dom.more.some((m) => m.day === DAY); i++) {
      await page.waitForTimeout(250)
      dom = await page.evaluate(CAL_PROBE)
    }
    const added = dom.chips.filter((c) => /^Smoke/.test(c.text ?? ''))
    const overflow = dom.more.find((m) => m.day === DAY)
    if (added.length + (overflow ? 1 : 0) < 1) problem(`actions: neither added event reached ${DAY}`)
    if (!overflow) problem(`actions: ${DAY} carries 4 events but shows no "+N more" — the three-chip cap did not fold`)
    await shoot(page, 'actions-1-added')
    step('add-custom-events', { chips: dom.chips.map((c) => c.text), more: dom.more })

    // --- the day drawer, opened from "+N more", and Escape's focus contract ---
    if (overflow) {
      await page.click(`[data-day="${DAY}"] .cal-more`)
      await page.waitForTimeout(400)
      const drawer = await page.evaluate(`(() => {
        const d = document.querySelector('[role="dialog"].cal-drawer')
        if (!d) return null
        const r = d.getBoundingClientRect()
        return { rows: d.querySelectorAll('.cal-drawer-row').length, visible: r.width > 8 && r.height > 8, title: d.querySelector('.cal-drawer-title')?.textContent.trim() ?? null }
      })()`)
      await shoot(page, 'actions-2-drawer')
      if (drawer === null) problem('actions: "+N more" did not open [role="dialog"].cal-drawer')
      else {
        if (!drawer.visible) problem('actions: the day drawer opened with no box')
        if (drawer.rows < 4) problem(`actions: the drawer lists ${drawer.rows} rows for a 4-event day`)
      }
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      const focus = await page.evaluate(`(() => {
        const a = document.activeElement
        return { role: a?.getAttribute('role') ?? null, day: a?.dataset?.day ?? null, tabindex: a?.getAttribute('tabindex') ?? null }
      })()`)
      if (focus.role !== 'gridcell' || focus.day !== DAY) {
        problem(`actions: Escape left focus on ${JSON.stringify(focus)} — it must return to the ${DAY} gridcell`)
      }
      step('day-drawer', { drawer, focusAfterEscape: focus })
    }

    // --- "Add to calendar (.ics)": the server-rendered window (Plan E Task 2) ---
    await visit(`/calendar?month=${MONTH}`)
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }).catch(() => null),
      page.click('button:has-text("Add to calendar (.ics)")'),
    ])
    if (download === null) problem('actions: "Add to calendar (.ics)" produced no download')
    else {
      const file = path.join(out, 'export.ics')
      await download.saveAs(file)
      const ics = readFileSync(file, 'utf8')
      const events = (ics.match(/BEGIN:VEVENT/g) || []).length
      if (!ics.startsWith('BEGIN:VCALENDAR')) problem(`actions: export.ics starts "${ics.slice(0, 40)}"`)
      if (!/X-WR-CALNAME:/.test(ics)) problem('actions: export.ics carries no X-WR-CALNAME')
      if (events === 0) problem('actions: export.ics carries no VEVENT')
      if (!/SUMMARY:[^\r\n]*\$/.test(ics)) problem('actions: no VEVENT SUMMARY carries an amount')
      const long = ics.split('\r\n').filter((l) => Buffer.byteLength(l, 'utf8') > 75)
      if (long.length > 0) problem(`actions: ${long.length} ICS line(s) over 75 octets — RFC 5545 folding broke`)
      step('export-ics', { filename: download.suggestedFilename(), bytes: ics.length, events })
    }

    // --- edit, delete, Undo, delete again ---
    // Through the LIST, not the grid: the grid folds past three chips, so whether an event is
    // a chip or a drawer row depends on how many of them are still undeleted — which is the
    // one thing these steps keep changing. The list shows every event of the month, unfolded,
    // and its rows expand the same EventDetails the chips do.
    const openSmoke = async (label) => {
      await visit(`/calendar?view=list&month=${MONTH}`)
      const row = await page.$(`.cal-list-item:has-text("${label}")`)
      if (!row) return false
      await row.click()
      await page.waitForTimeout(400)
      return true
    }
    if (!(await openSmoke(LABEL))) problem(`actions: could not reach "${LABEL}" to edit it`)
    else {
      await page.waitForTimeout(300)
      await page.click('button:has-text("Edit")')
      await page.waitForTimeout(400)
      const boxes = await page.$$('.cal-form input.cal-form-input')
      await boxes[1].fill(EDITED)
      await page.click('button:has-text("Save changes")')
      await page.waitForTimeout(900)
      await shoot(page, 'actions-4-edited')
      const edited = await isListed(EDITED)
      if (!edited) problem(`actions: the edit did not land — "${EDITED}" is not on the calendar`)
      step('edit-custom-event', { edited })
    }

    const deleteSmoke = async (label) => {
      if (!(await openSmoke(label))) return false
      await page.click('button:has-text("Delete")')
      await page.waitForTimeout(900)
      return true
    }
    if (!(await deleteSmoke(EDITED))) problem(`actions: could not reach "${EDITED}" to delete it`)
    else {
      // Wait for the toast rather than sleep at it: it appears only once the DELETE resolves,
      // and it auto-dismisses, so both ends of that window are the app's timing, not ours.
      const undo = await page
        .waitForSelector('button:has-text("Undo")', { timeout: 10000 })
        .catch(() => null)
      await shoot(page, 'actions-5-deleted-with-undo')
      if (!undo) problem('actions: the delete toast offered no Undo')
      else {
        await undo.click()
        await page.waitForTimeout(1500)
        await shoot(page, 'actions-6-undone')
        const back = await isListed(EDITED)
        if (!back) problem(`actions: Undo did not restore "${EDITED}"`)
        step('delete-and-undo', { restored: back })
      }
    }
    // Cleanup: every smoke row leaves with the walk.
    for (const label of [EDITED, LABEL, GYM]) {
      if (await isListed(label)) {
        await deleteSmoke(label)
      }
    }
    const leftovers = (await listedEvents()).filter((t) => /Smoke/.test(t))
    if (leftovers.length > 0) problem(`actions: the walk left ${JSON.stringify(leftovers)} in the dev database`)
    step('cleanup', { leftovers })

    // --- the token feed, end to end, with no bearer ---
    await visit('/settings#calendar')
    await page.fill('[aria-label="Label for the new link"]', 'smoke')
    await page.click('button:has-text("New feed link")')
    await page.waitForTimeout(1200)
    const feedUrl = await page.evaluate(`document.querySelector('.feed-url')?.value ?? null`)
    await shoot(page, 'settings-feed-token')
    if (feedUrl === null) problem('actions: creating a feed link showed no one-time URL')
    else {
      // A PLAIN fetch from the page: no Authorization header, the token in the URL is the whole
      // credential (spec §11). The route interceptor re-points it at API, nothing else.
      const feed = await page.evaluate(`(async (url) => {
        const first = await fetch(url)
        const body = await first.text()
        const etag = first.headers.get('etag')
        const again = etag ? await fetch(url, { headers: { 'If-None-Match': etag } }) : null
        return { status: first.status, type: first.headers.get('content-type'), etag, body: body.slice(0, 200000), revalidated: again ? again.status : null }
      })(${JSON.stringify(feedUrl)})`)
      const vevents = (feed.body.match(/BEGIN:VEVENT/g) || []).length
      if (feed.status !== 200) problem(`actions: feed.ics answered ${feed.status} to its own fresh token`)
      if (!/text\/calendar/.test(feed.type ?? '')) problem(`actions: feed.ics served content-type "${feed.type}"`)
      if (!feed.body.startsWith('BEGIN:VCALENDAR')) problem(`actions: feed.ics body starts "${feed.body.slice(0, 40)}"`)
      if (vevents === 0) problem('actions: feed.ics carries no VEVENT')
      if (feed.revalidated !== 304) problem(`actions: If-None-Match on the feed's own ETag answered ${feed.revalidated}, expected 304`)

      await page.click('button:has-text("Done")')
      await page.waitForTimeout(400)
      await page.click('[aria-label="Revoke the smoke link"]')
      await page.waitForTimeout(1200)
      const after = await page.evaluate(`(async (url) => (await fetch(url)).status)(${JSON.stringify(feedUrl)})`)
      await shoot(page, 'settings-feed-revoked')
      if (after !== 404) problem(`actions: the revoked feed link answered ${after}, expected 404`)
      const rows = await page.evaluate(`[...document.querySelectorAll('.feed-table tbody tr')].map((r) => r.cells[0].textContent.trim())`)
      if (rows.includes('smoke')) problem('actions: the revoked link is still listed')
      step('feed-token', { url: feedUrl.replace(/token=.*/, 'token=REDACTED'), status: feed.status, type: feed.type, vevents, revalidated: feed.revalidated, afterRevoke: after, rows })
    }

  } catch (e) {
    problem(`actions: the write walk stopped early (${e.message})`)
  } finally {
    drain('actions')
    report.actions.push({ name: '_action-logs', warnings: state.warnings.splice(0), http: state.http.splice(0), prefsWrites: state.prefsWrites })
    // Close the page first so the sweep is not racing the walk's last in-flight fetches,
    // and never let the close itself swallow the sweep.
    await finish().catch((e) => problem(`actions: the browser context would not close (${e.message})`))
    report.sweep = await sweep()
  }
}

await browser.close()

report.files = files
writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1))

const calTimings = report.timings.filter((t) => /\/calendar\?/.test(t.url))
if (calTimings.length > 0) {
  const worst = Math.max(...calTimings.map((t) => t.ms))
  console.log(`GET /calendar: ${calTimings.map((t) => `${t.ms}ms`).join(' ')} (worst ${worst}ms; spec §20 watches ~150ms)`)
}
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
console.log('CALENDAR SMOKE OK')
