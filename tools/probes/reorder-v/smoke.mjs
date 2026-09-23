// tools/probes/reorder-v/smoke.mjs — the drag-to-reorder verification walk (lane V, 2026-09-23
// drag-to-reorder spec §9 and §10; plan docs/superpowers/plans/2026-09-23-reorder-v-verify.md).
// Recipe: tools/probes/README.md, "Running the reorder smoke".
//
// It WRITES, so it runs only against the lane's own pair of servers — vite on 5196 proxying to
// uvicorn on 8096, which serves the PRIVATE database finance_reorder_scratch — and only on a FRESH
// copy: the database is rebuilt from the shared read-only finance_realdata before each theme, one
// theme per run (ONLY_THEME=dark|light is required), and a gate refuses a copy an earlier pass
// already wrote to. The page may write only through a short allowlist — the five reorder PUTs, the
// change log's Undo and the token renewal; PATCH /prefs goes through with its overview_layout key
// alone (the Customize list's own save) — and anything else is aborted and reported. The walk's
// own scratch rows (two ledger trades, one spending category) are made and removed over the API.
//
// Per width (1600×1000, then 1280×800), in real Edge with real pointer events, on each of the six
// lists — Settings › Spending categories, Settings › Accounts, Portfolio › Manage › Transactions,
// Overview › Customize, Credit Cards › Card roster, Credit Cards › Categories & weights:
//   - the resting table against the collapsed border model it replaced, pixel for pixel;
//   - a real mouse drag: the lifted row follows the pointer, exactly the peers it passes make
//     room, its cells carry their own hairline, it lands where the gap was, the order survives a
//     reload;
//   - the toast and its Undo (Overview has no toast: Reset to defaults is its way back);
//   - the keyboard path — Space, ↓ ×2, Space — with focus kept on the grip;
//   - reduced-motion emulation: one accent drop line, no transform on a peer, Escape cancelling
//     with no request.
// Plus auto-scroll inside the 420px Settings box (a group whose first row the box can hide: the
// roster's last group never scrolls under lane R0's range-end stop) and the 440px Categories &
// weights box — the scroll stopping at the range's first slot, the sticky header recorded while
// the row in hand crosses it mid-scroll and at the stop — and on the page (the ledger at 1280×800);
// the Accounts roster's groups, nesting and carried components, and a component held to its
// siblings; the ledger in a person scope and a sell dragged above its buy; the credit-line colours
// through a reorder and in every person scope, and the rewards matrix's columns; Escape inside the
// Customize popover; a real two-tab 409 and a resize that cancels; and, at the last width, the
// Activity feed — one entry per logged reorder, the card's Undo, the overlap refusal. Every page
// load must stay under CLS 0.1 and every step must keep the console clean.
//
// Not probed here, on purpose: the importer's identity rule (spec §3.4) — a workbook re-import is
// backend territory, pinned by backend/tests/test_importer_apply.py — and the failure paths the
// lanes forced with stubbed 500s and 409s (their own browser checks and unit tests own those).
//
// Env: ONLY_THEME (required), ONLY_WIDTH, ONLY_SURFACE (comma list of settings, portfolio,
// overview, cards, activity), APP_BASE, API_BASE, SMOKE_OUT, EXPECT_HEAD, EDGE_PATH,
// PLAYWRIGHT_CORE. Prints `REORDER SMOKE OK — …` or exits 1 listing every problem (2 when it
// refuses to start); report.json and the PNGs land in SMOKE_OUT (default
// scratchpad/reorder-v/<theme>).
//
// The first two lines spoof the node version: this box runs node 18 and playwright-core refuses
// anything under 20. playwright-core is resolved out of the npx cache because it is not a repo
// dependency (PLAYWRIGHT_CORE overrides the path).
Object.defineProperty(process, 'version', { value: 'v20.19.0' })
Object.defineProperty(process.versions, 'node', { value: '20.19.0' })
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const { chromium } = require(
  process.env.PLAYWRIGHT_CORE ??
    'C:/Users/edyli/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core',
)

// ── configuration ────────────────────────────────────────────────────────────────────────────
const THEME = process.env.ONLY_THEME
if (THEME !== 'dark' && THEME !== 'light') {
  console.error(
    'ONLY_THEME=dark|light is required: finance_reorder_scratch is rebuilt before each theme, so one run is one theme (tools/probes/README.md).',
  )
  process.exit(2)
}
const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../..')
const OUT = process.env.SMOKE_OUT ?? path.join(repo, 'scratchpad', 'reorder-v', THEME)
mkdirSync(OUT, { recursive: true })
const APP = process.env.APP_BASE ?? 'http://localhost:5196'
const API = process.env.API_BASE ?? 'http://127.0.0.1:8096'
if (new URL(APP).port !== '5196' || new URL(API).port !== '8096') {
  console.error(
    `refusing to write through ${APP} / ${API}: lane V writes only through vite 5196 → uvicorn 8096 (finance_reorder_scratch)`,
  )
  process.exit(2)
}
const EDGE =
  process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const EXPECT_HEAD = process.env.EXPECT_HEAD ?? 'f12026092301'
const SIZES = [
  { width: 1600, height: 1000 },
  { width: 1280, height: 800 },
].filter((s) => !process.env.ONLY_WIDTH || String(s.width) === process.env.ONLY_WIDTH)
const SURFACES = (process.env.ONLY_SURFACE ?? 'settings,portfolio,overview,cards,activity')
  .split(',')
  .map((s) => s.trim())
const SETTLE = 1500
// MOTION_MS.fast (src/theme/motion.ts): a pointer drop eases into its gap this long, then commits.
const MOTION = 120
const NOISE =
  /favicon|DevTools|\[vite\]|@vite\/client|Download the React DevTools|React Router Future Flag/i

// The words the walk expects on screen — spec §8.1–§8.4, verbatim.
const CAT_NOTE =
  'The Monthly update lists categories in this order — a spreadsheet column pasted there fills them in this order too.'
const ACC_NOTE =
  'The Monthly update lists accounts in this order within each person and group — a spreadsheet column pasted there fills them in this order too.'
const LEDGER_HINT =
  "The list is the order trades are replayed to work out cost basis and gains — with no dates on the rows, it is the ledger's timeline. Drag a row to move a trade earlier or later."
const STALE_CATEGORIES =
  'The spending categories changed since this list was loaded — nothing was moved.'
const OVERLAP = 'Later changes touched these rows — undo those first'
const REORDER_LABEL = /^(Moved (account|category) .+|Reordered \d+ (accounts|categories))$/
const LABEL_OF = {
  categories: /^(Moved category .+|Reordered \d+ categories)$/,
  accounts: /^(Moved account .+|Reordered \d+ accounts)$/,
}
// The walk's own scratch rows, named so a left-over is unmistakable — and refused by the gate.
const SCRATCH_ACCOUNT = 'V scratch'
const SCRATCH_CATEGORY = 'V two-tab'

// src/charts/theme.ts — the roster's group order and headings (spec §4.2).
const GROUP_ORDER = ['cash', 'pre_tax', 'post_tax', 'taxable', 'equity', 'other', 'liability']
const GROUP_LABELS = {
  cash: 'Cash',
  pre_tax: 'Pre-tax',
  post_tax: 'Post-tax',
  taxable: 'Taxable',
  equity: 'Equity',
  other: 'Other',
  liability: 'Liabilities',
}
// src/prefs/overviewLayout.ts — DEFAULT_OVERVIEW_LAYOUT. finance_realdata stores no layout.
const DEFAULT_LAYOUT = {
  tiles: ['net_worth', 'portfolio', 'living_spending', 'tax'],
  cards: ['ytd', 'performance', 'spending', 'money_flow'],
}
const TILE_KEYS = [
  ['Net worth', 'net_worth'],
  ['Portfolio', 'portfolio'],
  ['Living spending', 'living_spending'],
  ['Estimated tax', 'tax'],
]

// Selectors — each the owning lane's own, as its browser check proved it.
const CATS = '#categories table.category-table' // R2
const CAT_ROWS = `${CATS} tbody tr[data-reorder-id]`
const CAT_BOX = '#categories .settings-scroll'
const ACCS = '#accounts table.accounts-table' // R2
const ACC_ROWS = `${ACCS} tbody tr[data-reorder-id]`
const ACC_BOX = '#accounts .settings-scroll:has(table.accounts-table)'
const LEDGER_PANEL = '#portfolio-records-transactions' // R3
const LEDGER = `${LEDGER_PANEL} table`
const TXN_ROWS = `${LEDGER} tbody tr[data-reorder-id]`
const DIALOG = '[role="dialog"][aria-label="Customize overview"]' // R4
const TILE_ROWS = `${DIALOG} fieldset:nth-of-type(1) .overview-customize-row[data-reorder-id]`
const ROSTER = '.roster-table' // R5
const CARD_ROWS = `${ROSTER} tbody tr[data-reorder-id]`
const WEIGHTS = '.categories-table' // R5
const WEIGHT_ROWS = `${WEIGHTS} tbody tr[data-reorder-id]`
const WEIGHT_BOX = '.categories-scroll'
// owner=all spelled out: with no owner param a page falls back to the account's remembered scope.
const HOUSEHOLD_LEDGER = '/portfolio?section=manage&owner=all'
const MANAGE = '/credit-cards?section=manage&owner=all'
const LINES = '/credit-cards?section=lines&owner=all'
const REWARDS = '/credit-cards?owner=all'

// The only writes the PAGE may make. PATCH /prefs has its own rule in fence().
const WRITE_ALLOW = [
  ['PUT', /^\/api\/v1\/spending\/categories\/order$/],
  ['PUT', /^\/api\/v1\/net-worth\/accounts\/order$/],
  ['PUT', /^\/api\/v1\/portfolio\/transactions\/order$/],
  ['PUT', /^\/api\/v1\/credit-cards\/order$/],
  ['PUT', /^\/api\/v1\/credit-cards\/categories\/order$/],
  ['POST', /^\/api\/v1\/activity\/batches\/[0-9a-f-]+\/undo$/],
  ['POST', /^\/api\/v1\/auth\/(login|renew)$/],
]
const LOGGED_ROUTE = /^\/api\/v1\/(net-worth\/accounts|spending\/categories)\/order$/
const UNDO_ROUTE = /^\/api\/v1\/activity\/batches\/([0-9a-f-]+)\/undo$/
const ORDER_ROUTE = {
  categories: '/spending/categories/order',
  accounts: '/net-worth/accounts/order',
  transactions: '/portfolio/transactions/order',
  cards: '/credit-cards/order',
  weights: '/credit-cards/categories/order',
}

// ── the record ───────────────────────────────────────────────────────────────────────────────
const report = {
  generatedAt: new Date().toISOString(),
  theme: THEME,
  app: APP,
  api: API,
  sizes: SIZES,
  surfaces: SURFACES,
  census: null,
  checks: [],
  writes: [],
  blockedWrites: [],
  prefsWrites: [],
  logged: [],
  undos: [],
  scratch: [],
  knownBenign: [],
  warnings: [],
  files: [],
  problems: [],
}
let tag = 'setup'
const where = { surface: 'setup', step: 'gate' }
let browser = null
let page = null
let size = SIZES[0]
let themedOnce = false
let current = null
let expecting = []
const errors = []

const problem = (message) => report.problems.push(message)
function check(name, ok, observed) {
  const pass = Boolean(ok)
  report.checks.push({
    tag,
    surface: where.surface,
    step: where.step,
    name,
    ok: pass,
    observed: observed ?? null,
  })
  if (!pass) {
    problem(
      `${tag} ${where.surface}:${where.step}: ${name} — observed ${JSON.stringify(observed ?? null).slice(0, 700)}`,
    )
  }
  return pass
}
const note = (name, observed) =>
  report.checks.push({
    tag,
    surface: where.surface,
    step: where.step,
    name,
    ok: null,
    observed: observed ?? null,
  })
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
// JSONB hands a stored layout back with its keys in its own order (lane R4's finding): compare
// the two lists, never the objects' JSON.
const sameLayout = (a, b) =>
  a !== null && b !== null && same(a.tiles, b.tiles) && same(a.cards, b.cards)
const moveTo = (ids, from, to) => {
  const next = [...ids]
  const [id] = next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(read, want, timeout = 8000) {
  const start = Date.now()
  let seen = await read()
  while (!same(seen, want) && Date.now() - start < timeout) {
    await sleep(150)
    seen = await read()
  }
  return seen
}

// ── the API, as the app's own user, straight to the lane's uvicorn ───────────────────────────
const login = await fetch(`${API}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@example.com', password: 'changeme123' }),
}).catch((error) => ({ ok: false, status: String(error) }))
if (!login.ok) {
  console.error(
    `login on ${API} failed (${login.status}) — is the lane's uvicorn up? A 401 on a fresh copy: the plan's Task 1 Step 6 resets the PRIVATE copy's password.`,
  )
  process.exit(2)
}
const TOKEN = (await login.json()).access_token
const apiRaw = (method, route, body) =>
  fetch(`${API}/api/v1${route}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
async function api(method, route, body) {
  const res = await apiRaw(method, route, body)
  if (!res.ok) {
    throw new Error(`${method} ${route} → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  return res.status === 204 ? null : res.json()
}
const idsOf = (rows) => rows.map((row) => String(row.id))
/** The roster as Settings draws it (spec §4.2): group by group in GROUP_ORDER, API order inside a
 *  group, each component right after its parent when the parent sits in the same group. */
function displayOf(accounts) {
  const rows = []
  for (const group of GROUP_ORDER) {
    const inGroup = accounts.filter((a) => a.group === group)
    const present = new Set(inGroup.map((a) => a.id))
    for (const account of inGroup) {
      if (account.parent_account_id !== null && present.has(account.parent_account_id)) continue
      rows.push({ id: String(account.id), group, parent: null })
      for (const child of inGroup.filter((c) => c.parent_account_id === account.id)) {
        rows.push({ id: String(child.id), group, parent: String(account.id) })
      }
    }
  }
  return rows
}
const read = {
  categories: async () => idsOf(await api('GET', '/spending/categories')),
  // The stored order (what a PUT wrote) and the drawn one (what Settings shows).
  accountsStored: async () => idsOf(await api('GET', '/net-worth/accounts')),
  accounts: async () => displayOf(await api('GET', '/net-worth/accounts')).map((row) => row.id),
  transactions: async (owner = null) =>
    idsOf(await api('GET', `/portfolio/transactions${owner === null ? '' : `?owner=${owner}`}`)),
  cards: async () => idsOf(await api('GET', '/credit-cards')),
  weights: async () => idsOf(await api('GET', '/credit-cards/categories')),
  layout: async () => (await api('GET', '/prefs')).prefs?.overview_layout?.value ?? null,
}
const activity = async (limit = 200) => (await api('GET', `/activity?limit=${limit}`)).entries
/** A reorder straight through the API — the walk's put-back. A logged list's batch is recorded:
 *  the Activity step counts every logged reorder of the pass, the walk's own included. */
async function putOrder(list, ids) {
  const res = await apiRaw('PUT', ORDER_ROUTE[list], { ids: ids.map(Number) })
  if (!res.ok) {
    throw new Error(
      `PUT ${ORDER_ROUTE[list]} → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`,
    )
  }
  const batch = res.headers.get('x-change-batch')
  if (batch !== null) {
    report.logged.push({ id: batch, list, via: `api ${where.surface}:${where.step}` })
  }
  return res.json()
}

// ── the gate: the lane's stack, and a copy nothing has written to yet ────────────────────────
const status = await api('GET', '/system/status')
check(
  `the lane's backend is at the batch head (${EXPECT_HEAD})`,
  status.database?.alembic_head === EXPECT_HEAD,
  status.database ?? null,
)
const viaVite = await fetch(`${APP}/api/v1/system/status`, {
  headers: { authorization: `Bearer ${TOKEN}` },
})
  .then((res) => (res.ok ? res.json() : null))
  .catch(() => null)
check(
  'vite 5196 proxies to that backend (VITE_API_PROXY=http://127.0.0.1:8096)',
  viaVite?.database?.alembic_head === EXPECT_HEAD,
  viaVite?.database ?? null,
)
const staleReorders = (await activity()).filter(
  (entry) => entry.type === 'batch' && REORDER_LABEL.test(entry.label.replace(/^Undid: /, '')),
)
check(
  'the copy is fresh: its Activity holds no reorder yet',
  staleReorders.length === 0,
  staleReorders.slice(0, 3).map((entry) => entry.label),
)
const ledgerLabels = (await api('GET', '/portfolio/accounts')).map((account) => account.label)
check(
  `the copy is fresh: no '${SCRATCH_ACCOUNT}' ledger account`,
  !ledgerLabels.includes(SCRATCH_ACCOUNT),
  ledgerLabels,
)
const categoryNames = (await api('GET', '/spending/categories')).map((c) => c.name)
check(
  `the copy is fresh: no '${SCRATCH_CATEGORY}' category`,
  !categoryNames.includes(SCRATCH_CATEGORY),
  categoryNames.length,
)
if (report.problems.length > 0) {
  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  console.error('REORDER SMOKE REFUSED — the lane stack or the copy is not what this walk needs:')
  for (const p of report.problems) console.error(`  - ${p}`)
  console.error('Rebuild finance_reorder_scratch and restart uvicorn (plan Task 1), then run again.')
  process.exit(2)
}
const ORIG = {
  categories: await read.categories(),
  accounts: await read.accounts(),
  ledger: await read.transactions(),
  cards: await read.cards(),
  weights: await read.weights(),
  layout: await read.layout(),
}
const PEOPLE = (await api('GET', '/household')).people
report.census = {
  categories: ORIG.categories.length,
  accounts: ORIG.accounts.length,
  trades: ORIG.ledger.length,
  cards: ORIG.cards.length,
  weights: ORIG.weights.length,
  layout: ORIG.layout,
  people: PEOPLE.map((person) => `${person.id}:${person.name}`),
}
note(
  'census (finance_realdata of 2026-09-23: 19 categories, 29 accounts, 39 trades, 7 cards, 19 reward categories, no stored layout)',
  report.census,
)

// ── the browser: one context per width, a write fence, a layout-shift meter ──────────────────
// Cumulative layout shift, the ESPP smoke's instrument: __clsPage counts only shifts whose source
// lies OUTSIDE the shell's route-hold cross-fade (.xfade/.xfade-veil/.loading-dim/
// .loading-fallback), which intermittently books ~0.13 on pages this batch never touched.
const INIT = `(() => {
  window.__cls = 0
  window.__clsPage = 0
  window.__clsShell = 0
  const SHELL = /(^|\\s)(xfade|xfade-veil|loading-dim|loading-fallback)(\\s|$|-)/
  const isShell = (n) => { for (let e = n; e && e.nodeType === 1; e = e.parentElement) { const c = e.getAttribute && e.getAttribute('class'); if (c && SHELL.test(c)) return true } return false }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue
        window.__cls += e.value
        const src = (e.sources || []).map((s) => s.node).filter(Boolean)
        if (src.length && src.every(isShell)) window.__clsShell += e.value
        else window.__clsPage += e.value
      }
    }).observe({ type: 'layout-shift', buffered: true })
  } catch {}
})()`

async function openContext() {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 })
  // Seeded before first paint: the app boots its token and theme out of localStorage, and the
  // "landed" flag keeps an account landing page from bouncing / elsewhere (lane R4's driver).
  await context.addInitScript(
    ([token, theme]) => {
      localStorage.setItem('finance_token', token)
      localStorage.setItem('finance.theme', theme)
      sessionStorage.setItem('finance.landed', '1')
    },
    [TOKEN, THEME],
  )
  await context.addInitScript(INIT)
  const stamp = new Date().toISOString()
  // ONE handler for every /api/v1 call, so the order of registration can never let a write past.
  await context.route('**/api/v1/**', (route) => fence(route, stamp))
  return context
}

async function fence(route, stamp) {
  const request = route.request()
  const method = request.method()
  const { pathname } = new URL(request.url())
  if (/^\/api\/v1\/prefs\b/.test(pathname)) {
    const theme = { value: THEME, updated_at: stamp }
    if (method === 'GET') {
      // The account owns the theme: this pass's theme is injected into the answer.
      let body = { prefs: {} }
      try {
        body = await (await route.fetch()).json()
      } catch (error) {
        problem(`${tag}: GET /prefs could not be read (${error.message})`)
      }
      body.prefs = { ...(body.prefs ?? {}), theme }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    }
    // Only the Customize list's own save reaches the server: overview_layout, and nothing else —
    // a theme or a remembered scope never rewrites the account.
    let sent = {}
    try {
      sent = JSON.parse(request.postData() ?? '{}')
    } catch {
      sent = {}
    }
    const others = Object.keys(sent).filter((key) => key !== 'overview_layout')
    if ('overview_layout' in sent) {
      report.prefsWrites.push({ tag, step: where.step, passed: 'overview_layout', stubbed: others })
      return route.continue({ postData: JSON.stringify({ overview_layout: sent.overview_layout }) })
    }
    report.prefsWrites.push({ tag, step: where.step, passed: null, stubbed: others })
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ prefs: { theme } }),
    })
  }
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue()
  if (WRITE_ALLOW.some(([allowed, re]) => allowed === method && re.test(pathname))) {
    report.writes.push({ tag, surface: where.surface, step: where.step, method, pathname })
    return route.continue()
  }
  report.blockedWrites.push({ tag, surface: where.surface, step: where.step, method, pathname })
  problem(
    `${tag} ${where.surface}:${where.step}: BLOCKED a write this walk must never make — ${method} ${pathname}`,
  )
  return route.abort()
}
/** Writes that reached the server from the page: the allowlist's, plus layout PATCHes. */
const writesNow = () =>
  report.writes.length + report.prefsWrites.filter((w) => w.passed !== null).length

function take(entry) {
  if (NOISE.test(entry.text) || NOISE.test(entry.url)) return
  const rule = expecting.find(
    (e) => e.re.test(entry.url) && (entry.kind !== 'http' || entry.text === `HTTP ${e.status}`),
  )
  if (rule !== undefined) {
    report.knownBenign.push({ tag, surface: where.surface, step: where.step, why: rule.why, ...entry })
    return
  }
  errors.push({ tag, surface: where.surface, step: where.step, ...entry })
}
function drain() {
  for (const e of errors.splice(0)) {
    problem(`${e.tag} ${e.surface}:${e.step}: ${e.kind} ${e.text}${e.url ? ` <${e.url}>` : ''}`)
  }
}
function step(name) {
  drain()
  where.step = name
}
async function onResponse(response) {
  const status = response.status()
  const request = response.request()
  let pathname = ''
  try {
    pathname = new URL(response.url()).pathname
  } catch {
    return
  }
  if (status >= 400) take({ kind: 'http', text: `HTTP ${status}`, url: response.url() })
  if (status !== 200) return
  try {
    if (request.method() === 'PUT' && LOGGED_ROUTE.test(pathname)) {
      const batch = await response.headerValue('x-change-batch')
      if (batch !== null) {
        report.logged.push({
          id: batch,
          list: pathname.includes('/net-worth/') ? 'accounts' : 'categories',
          via: `page ${where.surface}:${where.step}`,
        })
      }
    } else if (request.method() === 'POST' && UNDO_ROUTE.test(pathname)) {
      const body = await response.json()
      report.undos.push({
        id: body.batch_id,
        of: UNDO_ROUTE.exec(pathname)[1],
        label: body.label,
        via: `page ${where.surface}:${where.step}`,
      })
    }
  } catch (error) {
    report.warnings.push({ tag, text: `could not read ${request.method()} ${pathname}: ${error.message}` })
  }
}
function wire() {
  page.on('console', (message) => {
    const type = message.type()
    if (type === 'warning') {
      if (!NOISE.test(message.text())) {
        report.warnings.push({ tag, step: where.step, text: message.text().slice(0, 300) })
      }
      return
    }
    if (type !== 'error') return
    take({ kind: 'console', text: message.text().slice(0, 300), url: (message.location() || {}).url || '' })
  })
  page.on('pageerror', (error) =>
    take({ kind: 'pageerror', text: String(error.message).slice(0, 300), url: page.url() }),
  )
  page.on('requestfailed', (request) => {
    const failure = request.failure()
    if (failure && /ERR_ABORTED/.test(failure.errorText)) return
    take({ kind: 'requestfailed', text: failure ? failure.errorText : 'request failed', url: request.url() })
  })
  page.on('response', (response) => {
    void onResponse(response)
  })
}

// ── page plumbing ────────────────────────────────────────────────────────────────────────────
const file = (name) => {
  const target = path.join(OUT, `${size.width}-${name}.png`)
  report.files.push(path.basename(target))
  return target
}
const snap = (name) => page.screenshot({ path: file(name) })
const clsNow = () =>
  page.evaluate(() => ({
    total: +(window.__cls ?? 0).toFixed(3),
    page: +(window.__clsPage ?? 0).toFixed(3),
    shell: +(window.__clsShell ?? 0).toFixed(3),
  }))
async function leave() {
  if (current === null || page === null) return
  const cls = await clsNow().catch(() => null)
  note(`${current}: CLS when the walk left it (input-driven moves are outside the metric)`, cls)
  current = null
}
async function visit(route, ready) {
  await leave()
  try {
    await page.goto(APP + route, { waitUntil: 'networkidle', timeout: 45000 })
  } catch {
    await page.goto(APP + route, { waitUntil: 'load', timeout: 45000 })
  }
  if (/^\/login/.test(new URL(page.url()).pathname)) {
    throw new Error(`bounced to ${page.url()} — the seeded token did not authenticate`)
  }
  await page.locator(ready).first().waitFor({ timeout: 30000 })
  await page.waitForTimeout(SETTLE)
  if (!themedOnce) {
    themedOnce = true
    const painted = await page.evaluate(() => document.documentElement.dataset.theme ?? null)
    check(`the app paints the ${THEME} theme`, painted === THEME, painted)
  }
  const cls = await clsNow()
  check(`${route} loads with CLS < 0.1 (the page's own shifts)`, cls.page < 0.1, cls)
  current = route
}
async function openSettings() {
  await visit('/settings', CAT_ROWS)
  await page.locator(ACC_ROWS).first().waitFor({ timeout: 20000 })
}
async function openOverview() {
  await visit('/', '.kpi-row .stat-label-text')
  await page.waitForFunction(
    () => document.querySelectorAll('.kpi-row .stat-label-text').length === 4,
    null,
    { timeout: 30000 },
  )
}
async function openManage() {
  await visit(MANAGE, WEIGHT_ROWS)
  await page.locator(CARD_ROWS).first().waitFor({ timeout: 20000 })
}
const dialog = () => page.locator(DIALOG)
async function openCustomize() {
  if ((await dialog().count()) === 0) {
    await page.getByRole('button', { name: 'Customize', exact: true }).click()
  }
  await dialog().waitFor({ state: 'visible', timeout: 10000 })
  await page.waitForTimeout(MOTION + 100) // the pop-in
}
async function tileOrder() {
  const labels = await page.locator('.kpi-row .stat-label-text').allTextContents()
  return labels.map(
    (text) =>
      TILE_KEYS.find(([prefix]) => text.trim().startsWith(prefix))?.[1] ?? `?${text.trim().slice(0, 40)}`,
  )
}
/** A Customize fieldset as the reader sees it (lane R4's reader): grip, box, label; the divider. */
const rowsOf = (legend) =>
  page
    .getByRole('group', { name: legend, exact: true })
    .locator('.overview-customize-row, .overview-customize-divider')
    .evaluateAll((els) =>
      els.map((el) =>
        el.classList.contains('overview-customize-divider')
          ? `— ${el.textContent.trim()} —`
          : `${el.querySelector('.reorder-grip') ? '⋮ ' : ''}${el.querySelector('input').checked ? '[x]' : '[ ]'} ${el.textContent.trim()}`,
      ),
    )
/** The credit-line chart's series off echarts' applied option. The echarts handle is imported
 *  only after the card painted (tools/probes/espp-v: an import at page-init makes the dev server
 *  transform the chart graph mid-load and books a layout shift the product does not have). */
async function lineSeries(title = /Credit line history/) {
  await page
    .locator('section.chart-card', { has: page.locator('h2', { hasText: title }) })
    .scrollIntoViewIfNeeded()
  await page.evaluate(async () => {
    try {
      const m = await import('/src/charts/echarts.ts')
      window.__echarts = m.echarts
    } catch (error) {
      window.__hookError = String(error)
    }
  })
  const start = Date.now()
  while (Date.now() - start < 10000) {
    const seen = await page.evaluate(([source, flags]) => {
      const re = new RegExp(source, flags)
      const card = [...document.querySelectorAll('section.chart-card')].find((c) =>
        re.test(c.querySelector('h2')?.textContent ?? ''),
      )
      const host = card?.querySelector('[_echarts_instance_]')
      const inst = host && window.__echarts ? window.__echarts.getInstanceByDom(host) : null
      const series = inst?.getOption()?.series
      return Array.isArray(series) && series.length > 0
        ? series.map((s) => ({ name: s.name, color: s.color }))
        : null
    }, [title.source, title.flags])
    if (seen !== null) return seen
    await page.waitForTimeout(250)
  }
  return null
}
const activityRows = () =>
  page.$$eval('#activity .activity-row', (els) =>
    els.map((el) => ({
      label: (el.querySelector('.activity-label')?.textContent ?? '').trim(),
      source: (el.querySelector('.activity-source')?.textContent ?? '').trim(),
      undone: [...el.querySelectorAll('.settings-note')].some((n) => n.textContent.trim() === 'undone'),
    })),
  )

// ── list plumbing (rows are anything that carries data-reorder-id) ───────────────────────────
const order = (rows) => page.$$eval(rows, (els) => els.map((el) => el.getAttribute('data-reorder-id')))
const rowSel = (rows, id) => `${rows}[data-reorder-id="${id}"]`
const gripSel = (rows, id) => `${rowSel(rows, id)} .reorder-grip`
/** Every row's box (client y), in list order — what `aim` measures. */
const boxes = (rows) =>
  page.$$eval(rows, (els) =>
    els.map((el) => {
      const box = el.getBoundingClientRect()
      return { top: box.top, bottom: box.bottom }
    }),
  )
const grabbing = () => page.evaluate(() => document.documentElement.classList.contains('reorder-active'))
const live = (scope) =>
  page.$eval(`${scope} .visually-hidden[aria-live="assertive"]`, (el) => (el.textContent ?? '').trim())
/** A page-scrolled row stands at `fraction` of the window: under the sticky chrome, clear of the
 *  toasts and of both 40px auto-scroll zones. */
const standAt = (selector, fraction = 0.45) =>
  page.evaluate(
    ([sel, f]) => {
      const el = document.querySelector(sel)
      window.scrollBy(0, el.getBoundingClientRect().top - window.innerHeight * f)
    },
    [selector, fraction],
  )
/** A capped box centred in the window and scrolled to its top. */
const boxTop = (box) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)
    el.scrollIntoView({ block: 'center' })
    el.scrollTop = 0
  }, box)
/** A capped box centred in the window, a row of it `offset` px below its top edge. */
const boxTo = (box, selector, offset) =>
  page.evaluate(
    ([b, sel, off]) => {
      const el = document.querySelector(b)
      el.scrollIntoView({ block: 'center' })
      const row = document.querySelector(sel)
      el.scrollTop += row.getBoundingClientRect().top - (el.getBoundingClientRect().top + off)
    },
    [box, selector, offset],
  )
const scrollTopOf = (box) => page.evaluate((sel) => document.querySelector(sel).scrollTop, box)
const visibleBand = (box) =>
  page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect()
    const top = Math.max(r.top, 0)
    const bottom = Math.min(r.bottom, window.innerHeight)
    const left = Math.max(0, r.left)
    return {
      top,
      bottom,
      clip: {
        x: Math.floor(left),
        y: Math.floor(top),
        width: Math.floor(Math.min(r.right, window.innerWidth) - left),
        height: Math.floor(bottom - top),
      },
    }
  }, box)
/** Who wins the sticky header's first labelled cell: the header, or a lifted row over it. */
const headerCover = (box) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)
    const th = [...el.querySelectorAll('thead th')].find((cell) => cell.textContent.trim() !== '')
    const r = th.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + Math.min(24, r.width / 2), r.top + r.height / 2)
    const lifted = el.querySelector('[data-reorder="lifted"]')
    const l = lifted === null ? null : lifted.getBoundingClientRect()
    return {
      header: th.textContent.trim(),
      headerOnTop: hit !== null && th.contains(hit),
      liftedOver: lifted !== null && hit !== null && lifted.contains(hit),
      headerBox: [Math.round(r.top), Math.round(r.bottom)],
      liftedBox: l === null ? null : [Math.round(l.top), Math.round(l.bottom)],
      overlapPx:
        l === null ? 0 : Math.max(0, Math.round(Math.min(r.bottom, l.bottom) - Math.max(r.top, l.top))),
      zIndex: {
        header: getComputedStyle(th).zIndex,
        lifted: lifted === null ? null : getComputedStyle(lifted).zIndex,
      },
    }
  }, box)

// ── toasts ───────────────────────────────────────────────────────────────────────────────────
const toastsWith = (text) => page.locator('.toast:not(.toast-leaving)').filter({ hasText: text })
async function toastText(text) {
  const message = page.locator('.toast:not(.toast-leaving) .toast-message').filter({ hasText: text }).last()
  await message.waitFor({ timeout: 10000 })
  return ((await message.textContent()) ?? '').trim()
}
async function toastSays(name, text, want) {
  const said = await toastText(text).catch((error) => `(no toast: ${error.message.split('\n')[0]})`)
  return check(name, said === want, said)
}
async function clearToasts() {
  for (const close of await page.locator('.toast-close').all()) await close.click().catch(() => {})
  await page.waitForTimeout(250)
}
async function clickUndo(text, which = 'last') {
  const toasts = toastsWith(text)
  await (which === 'first' ? toasts.first() : toasts.last())
    .getByRole('button', { name: 'Undo', exact: true })
    .click()
}
async function orderRestored() {
  await page
    .locator('.toast-message')
    .filter({ hasText: /^Order restored$/ })
    .last()
    .waitFor({ timeout: 10000 })
}
/** A drag starts only on a list whose grips are live. A busy list parks every grip (lane R0
 *  consumer rule 4: aria-disabled, still focusable) — through a save, an Undo, and, on the ledger,
 *  the page's revalidation after either (lane R3's `reloading` prop) — and a press or a Space on a
 *  parked grip lifts nothing, by design. So every drag instrument waits here first, the way a reader
 *  waits for the grips to come back; a fixed settle cannot know how long the page's reload runs. */
const ready = (rows) =>
  page.waitForFunction(
    (sel) =>
      document.querySelector(sel) !== null &&
      document.querySelector(`${sel} .reorder-grip[aria-disabled="true"]`) === null,
    rows,
    { timeout: 20000 },
  )
/** The list's save is back: no grip in `scope` is parked any more (R0: aria-disabled while busy). */
const waitIdle = (scope) =>
  page.waitForFunction(
    (sel) => document.querySelector(`${sel} .reorder-grip[aria-disabled="true"]`) === null,
    scope,
    { timeout: 15000 },
  )

// ── the drag instruments ─────────────────────────────────────────────────────────────────────
/** What lane R0's hook has written onto the rows right now; null when nothing is lifted. */
const liftState = (rows) =>
  page.evaluate((sel) => {
    const els = [...document.querySelectorAll(sel)]
    const lifted = els.filter((el) => el.getAttribute('data-reorder') === 'lifted')
    if (lifted.length === 0) return null
    const first = lifted[0]
    const isRow = first.tagName === 'TR'
    const table = isRow ? first.closest('table') : null
    const cells = isRow ? [...first.children] : []
    const actions = isRow ? first.querySelector('td.row-actions') : null
    return {
      table: isRow,
      liftedIds: lifted.map((el) => el.getAttribute('data-reorder-id')),
      offset: Number(/translateY\((-?[\d.]+)px\)/.exec(first.style.transform)?.[1] ?? NaN),
      transforms: lifted.map((el) => el.style.transform),
      displaced: els.filter(
        (el) => el.getAttribute('data-reorder') === 'shifting' && el.style.transform !== '',
      ).length,
      shifting: els.filter((el) => el.getAttribute('data-reorder') === 'shifting').length,
      peerTransforms: els.filter(
        (el) => el.getAttribute('data-reorder') !== 'lifted' && el.style.transform !== '',
      ).length,
      drop: els
        .filter((el) => el.hasAttribute('data-reorder-drop'))
        .map((el) => [el.getAttribute('data-reorder-id'), el.getAttribute('data-reorder-drop')]),
      grabbing: document.documentElement.classList.contains('reorder-active'),
      separate: table === null ? null : getComputedStyle(table).borderCollapse === 'separate',
      hairlines: isRow
        ? cells.every((td) => {
            const s = getComputedStyle(td)
            return (
              s.borderBottomStyle === 'solid' &&
              parseFloat(s.borderBottomWidth) >= 1 &&
              s.borderBottomColor !== 'rgba(0, 0, 0, 0)'
            )
          })
        : null,
      cellBackground: isRow && cells[1] ? getComputedStyle(cells[1]).backgroundColor : null,
      actionsBackground: actions === null ? null : getComputedStyle(actions).backgroundColor,
      shadow: getComputedStyle(first).boxShadow,
    }
  }, rows)
/** The pointer's travel that lands the lifted row exactly on the k-th peer's slot (k < 0 is up).
 *  Lane R0's slot rule is the LEADING edge's (round 4, reorderMath.slotFor): a peer below is passed
 *  once the lifted row's bottom edge reaches its midpoint, a peer above once the top edge rises
 *  above its midpoint. Travel that puts the leading edge on the k-th peer's far edge therefore
 *  passes exactly |k| peers, half a row clear of the rule on either side, whatever the rows'
 *  heights. (The plan's centre-rule aim — 40% past the k-th midpoint — sat 0.1 row from the next
 *  slot under the leading-edge rule.) Every row between is a unit of one: the caller's lists are. */
function aim(b, from, k) {
  const to = from + k
  return k > 0 ? b[to].bottom - b[from].bottom : b[to].top - b[from].top
}
/** Press a grip, pass the 4px lift threshold, travel `dy` in steps — the button stays down. */
async function press(rows, id, dy, sign) {
  const g = await page.locator(gripSel(rows, id)).boundingBox()
  if (g === null) throw new Error(`no grip on screen for row ${id}`)
  const x = g.x + g.width / 2
  const y0 = g.y + g.height / 2
  await page.mouse.move(x, y0)
  await page.mouse.down()
  await page.mouse.move(x, y0 + sign * 6, { steps: 2 })
  await page.mouse.move(x, y0 + dy, { steps: 12 })
  await page.waitForTimeout(250)
  return { x, y0 }
}
/** A real mouse drag of `id` by k peers (k < 0 is up), every row a unit of one. The caller puts
 *  the rows on screen, clear of the auto-scroll zones. */
async function mouseDrag({ rows, id, k, shot = null }) {
  await clearToasts()
  await ready(rows)
  const before = await order(rows)
  const from = before.indexOf(String(id))
  const to = from + k
  const dy = aim(await boxes(rows), from, k)
  await press(rows, id, dy, Math.sign(k))
  const mid = await liftState(rows)
  if (shot !== null) await snap(shot)
  await page.mouse.up()
  await page.waitForTimeout(MOTION + 700)
  if (check('a row lifts under the pointer', mid !== null, mid)) {
    check('the lifted row follows the pointer (±2px)', Math.abs(mid.offset - dy) <= 2, {
      offset: mid.offset,
      dy,
    })
    check(`exactly the ${Math.abs(k)} row(s) it passes make room`, mid.displaced === Math.abs(k), mid.displaced)
    check('the page says grabbing mid-drag', mid.grabbing, mid.grabbing)
    if (mid.table) {
      check(
        "the lifted row's cells draw their own hairline (separate borders: the line travels with it)",
        mid.separate === true && mid.hairlines === true,
        { separate: mid.separate, hairlines: mid.hairlines },
      )
      if (mid.actionsBackground !== null) {
        check('the pinned actions cell rides on the lifted surface', mid.actionsBackground === mid.cellBackground, {
          cell: mid.cellBackground,
          actions: mid.actionsBackground,
        })
      }
    } else {
      check('the lifted row is raised — a shadow under it', mid.shadow !== 'none', mid.shadow)
    }
  }
  const expected = moveTo(before, from, to)
  const after = await order(rows)
  check('it lands where the gap was', same(after, expected), { from, to, after })
  return expected
}
/** Focus the grip, Space, the keys, Space — no judgement. */
async function keyboardPress(rows, id, keys) {
  await clearToasts()
  await ready(rows)
  const grip = page.locator(gripSel(rows, id))
  const name = await grip.getAttribute('aria-label')
  await grip.focus()
  await page.keyboard.press('Space')
  await page.waitForTimeout(80)
  const lifted = await page
    .$eval(rowSel(rows, id), (el) => ({
      state: el.getAttribute('data-reorder'),
      mode: el.getAttribute('data-reorder-mode'),
    }))
    .catch(() => null)
  for (const key of keys) {
    await page.keyboard.press(key)
    await page.waitForTimeout(60)
  }
  await page.keyboard.press('Space')
  await page.waitForTimeout(400)
  return { name, lifted }
}
/** The keyboard path (spec §2.4): lifted from the keyboard, moved, focus kept on the grip. */
async function keyboardMove({ rows, id, keys }) {
  const before = await order(rows)
  const { name, lifted } = await keyboardPress(rows, id, keys)
  const from = before.indexOf(String(id))
  const places =
    keys.filter((key) => key === 'ArrowDown').length - keys.filter((key) => key === 'ArrowUp').length
  const expected = moveTo(before, from, from + places)
  const arrows = keys.map((key) => (key === 'ArrowDown' ? '↓' : '↑')).join(' ')
  check('Space lifts the row from the keyboard', lifted?.state === 'lifted' && lifted?.mode === 'keyboard', lifted)
  const after = await order(rows)
  check(`Space, ${arrows}, Space moves it ${Math.abs(places)} place(s)`, same(after, expected), { before, after })
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null)
  check('focus stays on the moved grip', focused === name, { focused, name })
  return expected
}
/** Reduced motion (spec §2.5): the lifted row still follows the pointer, peers stay put, one
 *  accent drop line marks the landing edge; Escape then cancels with no request. */
async function reducedMotion({ rows, id, k, popover = false }) {
  await clearToasts()
  await ready(rows)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(250)
  try {
    const writes = writesNow()
    const before = await order(rows)
    const from = before.indexOf(String(id))
    const to = from + k
    const dy = aim(await boxes(rows), from, k)
    await press(rows, id, dy, Math.sign(k))
    const mid = await liftState(rows)
    await snap(`${where.step}-held`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)
    const after = await liftState(rows)
    const residue = await page.$$eval(
      rows,
      (els) =>
        els.filter(
          (el) =>
            el.hasAttribute('data-reorder') ||
            el.hasAttribute('data-reorder-drop') ||
            el.style.transform !== '',
        ).length,
    )
    const cursor = await grabbing()
    const open = popover ? await dialog().isVisible() : null
    await page.mouse.up()
    await page.waitForTimeout(MOTION + 300)
    if (check('reduced motion: a row lifts under the pointer', mid !== null, mid)) {
      check('reduced motion: it still follows the pointer (direct manipulation)', Math.abs(mid.offset - dy) <= 2, {
        offset: mid.offset,
        dy,
      })
      check('reduced motion: no peer shifts — no shifting row, no transform on a peer', mid.shifting === 0 && mid.peerTransforms === 0, mid)
      check('reduced motion: one accent drop line marks the landing edge', same(mid.drop, [[before[to], k > 0 ? 'after' : 'before']]), mid.drop)
    }
    check('Escape cancels at once: nothing lifted, no line, no transform, no grabbing cursor', after === null && residue === 0 && !cursor, {
      after,
      residue,
      cursor,
    })
    check('…with no request, and the order unchanged', writesNow() === writes && same(await order(rows), before), {
      writes: writesNow() - writes,
    })
    if (popover) check('Escape mid-drag leaves the Customize popover open', open === true, open)
  } finally {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.waitForTimeout(150)
  }
}
/** The ledger at 1280×800 is taller than the window: a pointer parked in the bottom 40px zone
 *  scrolls the page under the lifted row (spec §2.3.5, §10). Lane R3's long drag. */
async function longDrag(rows, id) {
  await clearToasts()
  await ready(rows)
  const before = await order(rows)
  const from = before.indexOf(String(id))
  await standAt(rowSel(rows, id), 0.35)
  await page.waitForTimeout(250)
  const scrollBefore = await page.evaluate(() => window.scrollY)
  const g = await page.locator(gripSel(rows, id)).boundingBox()
  const x = g.x + g.width / 2
  const y0 = g.y + g.height / 2
  await page.mouse.move(x, y0)
  await page.mouse.down()
  await page.mouse.move(x, y0 + 6, { steps: 2 })
  await page.mouse.move(x, size.height - 12, { steps: 20 })
  await page.waitForTimeout(1200)
  const mid = await liftState(rows)
  const scrolled = (await page.evaluate(() => window.scrollY)) - scrollBefore
  await snap('ledger-auto-scroll')
  await page.mouse.move(x, size.height / 2, { steps: 10 })
  await page.waitForTimeout(250)
  await page.mouse.up()
  await page.waitForTimeout(MOTION + 700)
  const after = await order(rows)
  const to = after.indexOf(String(id))
  check('a row lifts and the page says grabbing', mid !== null && mid.grabbing, mid)
  check('the page auto-scrolls under a pointer held in the bottom 40px zone', scrolled > 200, { scrolled })
  check('the row travels with the scroll', to - from >= 8, { from, to })
  check('nothing else moved', same(after, moveTo(before, from, to)), after)
  return after
}
/** Inside a capped box: the LAST of `ids` (a range of single-row units, in order) dragged to the
 *  box's top edge — the box scrolls up under the held pointer and the row lands first (spec §10).
 *  Lane R0 round 4 stops the scroll once the range's first slot shows clear of the 40px zone and
 *  clamps the held unit to its range, so the walk starts with that first row hidden above the zone,
 *  and proves the stop. The sticky header is read at rest; with the row in hand over it while the
 *  box still scrolls (pointer 28px in: ~1.6px a frame, slow enough to catch — at the stop the row
 *  sits clamped below the header, lane R5's observation), and held at the stop (both a judgement —
 *  plan Task 7); and once the drag ends. Then Undo. */
async function autoScrollInBox({ box, rows, ids, scope, label, shot }) {
  await clearToasts()
  await ready(rows)
  const first = ids[0]
  const last = ids[ids.length - 1]
  // The last row 60px above the visible band's foot, as the plan placed it — and when that still
  // shows the range's first row clear of the top zone (a short range), the last row's grip raised to
  // 60px under the band's top: under the ~38px sticky header and out of the zone, the first row
  // hidden above.
  await page.evaluate(
    ([b, firstSel, lastSel]) => {
      const el = document.querySelector(b)
      el.scrollIntoView({ block: 'center' })
      const band = () => {
        const r = el.getBoundingClientRect()
        return { top: Math.max(r.top, 0), bottom: Math.min(r.bottom, window.innerHeight) }
      }
      const lastRow = document.querySelector(lastSel)
      el.scrollTop += lastRow.getBoundingClientRect().bottom - (band().bottom - 60)
      if (document.querySelector(firstSel).getBoundingClientRect().top >= band().top + 40) {
        const grip = lastRow.querySelector('.reorder-grip').getBoundingClientRect()
        el.scrollTop += grip.top + grip.height / 2 - (band().top + 60)
      }
    },
    [box, rowSel(rows, first), rowSel(rows, last)],
  )
  await page.waitForTimeout(250)
  const s0 = await scrollTopOf(box)
  const rest = await headerCover(box)
  const band = await visibleBand(box)
  const hiddenBy = await page.evaluate(
    ([sel, top]) => Math.round((top - document.querySelector(sel).getBoundingClientRect().top) * 10) / 10,
    [rowSel(rows, first), band.top],
  )
  const g = await page.locator(gripSel(rows, last)).boundingBox()
  const x = g.x + g.width / 2
  const y0 = g.y + g.height / 2
  await page.mouse.move(x, y0)
  await page.mouse.down()
  await page.mouse.move(x, y0 - 8, { steps: 2 })
  // Mid-scroll: the pointer 28px into the box — inside the 40px zone, where the box scrolls slowly
  // and the row, still short of its range's first row, follows the pointer across the header.
  await page.mouse.move(x, band.top + 28, { steps: 6 })
  await page.waitForTimeout(250)
  const scrolling = await headerCover(box)
  const sMid = await scrollTopOf(box)
  await page.screenshot({ path: file(`${shot}-scrolling`), clip: band.clip })
  // Then the plan's hold: 12px in, fast, until the scroll stops at the range's first slot.
  await page.mouse.move(x, band.top + 12, { steps: 4 })
  await page.waitForTimeout(1200)
  const s1 = await scrollTopOf(box)
  const held = await headerCover(box)
  await page.screenshot({ path: file(`${shot}-held`), clip: band.clip })
  await page.waitForTimeout(400)
  const s2 = await scrollTopOf(box)
  const rangeStartsBox = await page.evaluate(
    ([b, id]) => document.querySelector(b)?.querySelector('tr[data-reorder-id]')?.getAttribute('data-reorder-id') === id,
    [box, String(first)],
  )
  await page.mouse.up()
  await page.waitForTimeout(MOTION + 700)
  check('at rest the sticky header is on top of its box', rest.headerOnTop, rest)
  check('holding the pointer in the top edge zone scrolls the box up', hiddenBy > 0 && s0 > 20 && s1 < s0 - 20, {
    s0,
    sMid,
    s1,
    firstRowHiddenBy: hiddenBy,
  })
  // Spec §2.3.5 as amended (lane R0 round 4): the scroll stops once the range's end is inside the
  // band the reader can see — the scroller's box clipped to the window — less the 40px edge margin,
  // or at the scroller's own end. So: still 400ms later, and either the box reached its top (only
  // where the range starts the box — Categories & weights is one range) or it stopped short with the
  // row in hand, clamped at the range's first slot, at least 40px into the band. Whether that slot
  // clears the box's sticky header is not the rule's concern — a two-line header is taller than the
  // margin — so it is measured in the JUDGE record below (held.overlapPx), not asserted.
  const slotInBand = held.liftedBox === null ? null : held.liftedBox[0] - Math.round(band.top)
  check(
    "the scroll stops at the range's end — the box's own top, or the row in hand clamped at the range's first slot ≥ 40px into the visible band",
    s2 === s1 && slotInBand !== null && (s1 === 0 ? rangeStartsBox : slotInBand >= 39),
    { s1, s2, slotInBand, liftedBox: held.liftedBox, headerBox: held.headerBox, rangeStartsBox },
  )
  note('JUDGE (plan Task 7): the row in hand over the sticky header — mid-scroll, then held at the stop', {
    scrolling,
    held,
    scrolls: { s0, sMid, s1 },
    shots: [`${size.width}-${shot}-scrolling.png`, `${size.width}-${shot}-held.png`],
  })
  await toastSays('the toast names the row', /^Moved /, `Moved ${label}`)
  await waitIdle(scope)
  const now = (await order(rows)).filter((rowId) => ids.includes(rowId))
  check('the last row lands first', same(now, [last, ...ids.slice(0, -1)]), now)
  const after = await headerCover(box)
  check('once the drag ends the sticky header is on top again', after.headerOnTop, after)
  await clickUndo(`Moved ${label}`)
  await orderRestored()
  const back = await waitFor(async () => (await order(rows)).filter((rowId) => ids.includes(rowId)), ids)
  check('Undo puts the order back', same(back, ids), back)
}
/** Two PNGs of one clip compared pixel by pixel inside the page (no PNG library in the repo).
 *  `zones` are the pinned (position: sticky) cells, judged apart. A channel delta over 24 counts
 *  as a difference. `lines` are the pixel rows of the table's row hairlines (each row's bottom
 *  edge, ±1px): compared exactly. Everywhere else a pixel still counts only when no pixel ONE ROW
 *  above or below it in the other shot matches it — the collapsed model draws every cell's content
 *  half a CSS pixel lower than the separate one (CSS 2.1 §17.6.2: half of each shared border lies
 *  inside the cell), which rasterizes as a 0-or-1px offset of text and controls while the lines stay
 *  put (measured at lane V: row bottoms identical, text +0.5px). The as-drawn counts (no offset
 *  allowed — the plan's statistic) ride along. The diff image marks the judged differences magenta
 *  and those a 1px content offset explains yellow. */
function comparePngs(a, b, zones, lines) {
  return page.evaluate(
    async ([a64, b64, rects, lineRows]) => {
      const decode = async (data) => {
        const bin = atob(data)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(bitmap, 0, 0)
        return { w: bitmap.width, h: bitmap.height, px: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data }
      }
      const [A, B] = await Promise.all([decode(a64), decode(b64)])
      const w = Math.min(A.w, B.w)
      const h = Math.min(A.h, B.h)
      const mask = new Uint8Array(w * h)
      for (const r of rects) {
        for (let y = Math.max(0, r.y); y < Math.min(h, r.y + r.h); y += 1) {
          for (let x = Math.max(0, r.x); x < Math.min(w, r.x + r.w); x += 1) mask[y * w + x] = 1
        }
      }
      const strict = new Uint8Array(h)
      for (const line of lineRows) {
        for (let y = Math.max(0, line - 1); y <= Math.min(h - 1, line + 1); y += 1) strict[y] = 1
      }
      const delta = (i, j) =>
        Math.max(
          Math.abs(A.px[i] - B.px[j]),
          Math.abs(A.px[i + 1] - B.px[j + 1]),
          Math.abs(A.px[i + 2] - B.px[j + 2]),
        )
      const out = new OffscreenCanvas(w, h)
      const octx = out.getContext('2d')
      const img = octx.createImageData(w, h)
      let outside = 0
      let inside = 0
      let outsideAsDrawn = 0
      let insideAsDrawn = 0
      let outsidePixels = 0
      let insidePixels = 0
      let maxDelta = 0
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const i = (y * A.w + x) * 4
          const j = (y * B.w + x) * 4
          const k = (y * w + x) * 4
          const d = delta(i, j)
          const pinned = mask[y * w + x] === 1
          if (pinned) insidePixels += 1
          else outsidePixels += 1
          if (d > maxDelta) maxDelta = d
          const asDrawn = d > 24
          let differs = asDrawn
          // Off the hairlines, a half-pixel content offset (0 or 1px once rasterized) is the border
          // model's, not a change of look: the same pixel one row up or down in the other shot.
          if (differs && strict[y] === 0) {
            for (const dy of [-1, 1]) {
              const yb = y + dy
              if (yb >= 0 && yb < h && delta(i, (yb * B.w + x) * 4) <= 24) {
                differs = false
                break
              }
            }
          }
          if (asDrawn && pinned) insideAsDrawn += 1
          if (asDrawn && !pinned) outsideAsDrawn += 1
          if (differs && pinned) inside += 1
          if (differs && !pinned) outside += 1
          const shifted = asDrawn && !differs
          img.data[k] = differs || shifted ? 255 : A.px[i]
          img.data[k + 1] = differs ? 0 : shifted ? 200 : A.px[i + 1]
          img.data[k + 2] = differs ? 255 : shifted ? 0 : A.px[i + 2]
          img.data[k + 3] = differs || shifted ? 255 : 72
        }
      }
      let png = null
      if (outsideAsDrawn + insideAsDrawn > 0) {
        octx.putImageData(img, 0, 0)
        const bytes = new Uint8Array(await (await out.convertToBlob({ type: 'image/png' })).arrayBuffer())
        let s = ''
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        png = btoa(s)
      }
      return {
        sizes: [A.w, A.h, B.w, B.h],
        outside,
        outsideAsDrawn,
        outsidePixels,
        inside,
        insideAsDrawn,
        insidePixels,
        lineRows: lineRows.length,
        maxDelta,
        png,
      }
    },
    [a.toString('base64'), b.toString('base64'), zones, lines],
  )
}
/** The resting look (spec §2.5, §10): the table as drawn — `.reorder-table`'s separate borders —
 *  against the same table switched back to `border-collapse: collapse` by an inline style. The
 *  class itself stays on: it also carries the grip column's width, and taking it off would move
 *  every column and compare nothing. Pinned (sticky) cells are judged apart: the collapsed model
 *  paints row lines on the table, UNDER a pinned cell's opaque background; the separate model has
 *  each cell draw its own, so a difference there is expected and is a person's call (Task 7). */
async function restingLook(table, clipOf, name) {
  await clearToasts()
  await page.mouse.move(2, 2) // off every row: no hover state in either shot
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  await page.waitForTimeout(300)
  const geo = await page.evaluate(
    ([t, c]) => {
      const el = document.querySelector(t)
      const r = document.querySelector(c).getBoundingClientRect()
      const x = Math.max(0, Math.floor(r.left))
      const y = Math.max(0, Math.floor(r.top))
      const right = Math.min(window.innerWidth, Math.ceil(r.right))
      const bottom = Math.min(window.innerHeight, Math.ceil(r.bottom))
      const pinned = [...el.querySelectorAll('th, td')]
        .filter((cell) => getComputedStyle(cell).position === 'sticky')
        .map((cell) => {
          const b = cell.getBoundingClientRect()
          return { x: Math.floor(b.left) - x - 1, y: Math.floor(b.top) - y - 1, w: Math.ceil(b.width) + 3, h: Math.ceil(b.height) + 3 }
        })
      // Every row's hairline: the pixel row just above its rounded bottom edge (both models put the
      // shared line there — the row boxes do not move), compared exactly in the clip.
      const lines = [...el.querySelectorAll('tr')]
        .map((tr) => Math.round(tr.getBoundingClientRect().bottom) - y - 1)
        .filter((line) => line >= 0 && line < bottom - y)
      return { clip: { x, y, width: right - x, height: bottom - y }, pinned, lines, model: getComputedStyle(el).borderCollapse }
    },
    [table, clipOf],
  )
  const drawn = await page.screenshot({ clip: geo.clip })
  await page.$eval(table, (el) => {
    el.style.borderCollapse = 'collapse'
  })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const collapsed = await page.screenshot({ clip: geo.clip })
  await page.$eval(table, (el) => {
    el.style.borderCollapse = ''
  })
  const diff = await comparePngs(drawn, collapsed, geo.pinned, geo.lines)
  writeFileSync(file(`${name}-separate`), drawn)
  writeFileSync(file(`${name}-collapse`), collapsed)
  if (diff.png !== null) writeFileSync(file(`${name}-diff`), Buffer.from(diff.png, 'base64'))
  const budget = Math.max(40, Math.round(diff.outsidePixels * 0.001))
  const { png, ...stats } = diff
  check(
    `the resting table matches the collapsed border model outside its pinned cells — hairlines exact, cell content within the model's half-pixel offset (≤ ${budget} px differ)`,
    geo.model === 'separate' && diff.lineRows > 0 && diff.outside <= budget,
    { model: geo.model, clip: geo.clip, budget, ...stats },
  )
  note('JUDGE (plan Task 7): pixels that differ INSIDE the pinned (sticky) cells', {
    inside: diff.inside,
    insideAsDrawn: diff.insideAsDrawn,
    insidePixels: diff.insidePixels,
    diff: png === null ? null : `${size.width}-${name}-diff.png`,
  })
}

// ── Settings › Spending categories and Accounts (lane R2) ────────────────────────────────────
async function settingsWalk() {
  const categories = await api('GET', '/spending/categories')
  const catName = new Map(categories.map((c) => [String(c.id), c.name]))
  const accounts = await api('GET', '/net-worth/accounts')
  const accName = new Map(accounts.map((a) => [String(a.id), a.name]))
  const display = displayOf(accounts)
  const C0 = ORIG.categories

  step('open')
  await openSettings()

  step('categories-rest')
  const cat = await page.evaluate(
    ([t, card]) => {
      const table = document.querySelector(t)
      const head = table.querySelector('thead th')
      return {
        className: table.className,
        collapse: getComputedStyle(table).borderCollapse,
        gripHead: [head?.className ?? null, head?.getAttribute('aria-hidden') ?? null],
        heads: [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()),
        text: (document.querySelector(card)?.textContent ?? '').replace(/\s+/g, ' '),
      }
    },
    [CATS, '#categories'],
  )
  check('the table is reorderable, with separate borders', cat.className.split(' ').includes('reorder-table') && cat.collapse === 'separate', {
    className: cat.className,
    collapse: cat.collapse,
  })
  check('the grip column comes first and the Sort column is gone', same(cat.gripHead, ['reorder-grip-cell', 'true']) && same(cat.heads, ['', 'Category', 'Kind', 'Status', '']), {
    gripHead: cat.gripHead,
    heads: cat.heads,
  })
  check('the order note sits under the table (spec §8.1)', cat.text.includes(CAT_NOTE), null)
  check('the rows are the server order', same(await order(CAT_ROWS), C0), await order(CAT_ROWS))
  await boxTop(CAT_BOX)
  await restingLook(CATS, CAT_BOX, 'categories-rest')

  step('categories-drag')
  await boxTop(CAT_BOX)
  const cDrag = await mouseDrag({ rows: CAT_ROWS, id: C0[0], k: 3, shot: 'categories-mid-drag' })
  await toastSays('the toast names the category', /^Moved /, `Moved ${catName.get(C0[0])}`)
  await waitIdle('#categories')
  check('the server holds the new order', same(await read.categories(), cDrag), await read.categories())
  await openSettings()
  check('the order survives a reload', same(await order(CAT_ROWS), cDrag), await order(CAT_ROWS))
  await putOrder('categories', C0)
  await openSettings()
  check('put back through the API', same(await order(CAT_ROWS), C0), await order(CAT_ROWS))

  step('categories-undo')
  await boxTop(CAT_BOX)
  await mouseDrag({ rows: CAT_ROWS, id: C0[0], k: 3 })
  await toastText(`Moved ${catName.get(C0[0])}`)
  await waitIdle('#categories')
  await clickUndo(`Moved ${catName.get(C0[0])}`)
  await orderRestored()
  check("the toast's Undo restores the server order", same(await waitFor(read.categories, C0), C0), await read.categories())
  check('…and the table shows it', same(await waitFor(() => order(CAT_ROWS), C0), C0), await order(CAT_ROWS))

  step('categories-keyboard')
  await boxTop(CAT_BOX)
  const cKeys = await keyboardMove({ rows: CAT_ROWS, id: C0[1], keys: ['ArrowDown', 'ArrowDown'] })
  await toastSays('the toast names the category', /^Moved /, `Moved ${catName.get(C0[1])}`)
  await waitIdle('#categories')
  check('the server holds it', same(await read.categories(), cKeys), await read.categories())
  await clickUndo(`Moved ${catName.get(C0[1])}`)
  await orderRestored()
  check('Undo restores it', same(await waitFor(read.categories, C0), C0), await read.categories())

  step('categories-reduced-motion')
  await boxTop(CAT_BOX)
  await reducedMotion({ rows: CAT_ROWS, id: C0[0], k: 2 })

  if (size.width === 1600) {
    // A real two-tab 409 (spec §9): the list gains a row behind this page's back, over the API.
    step('categories-two-tab')
    await boxTop(CAT_BOX)
    const top = Math.max(...(await api('GET', '/spending/categories')).map((c) => c.sort_order))
    const created = await api('POST', '/spending/categories', { name: SCRATCH_CATEGORY })
    report.scratch.push({ kind: 'category', id: created.id })
    check('a category created with no position appends after the last one (spec §3.3)', created.sort_order > top, {
      created: created.sort_order,
      top,
    })
    expecting = [
      {
        re: /\/api\/v1\/spending\/categories\/order$/,
        status: 409,
        why: 'two-tab: this page still lists the categories as they were before the API added one',
      },
    ]
    const reload = page.waitForRequest(
      (r) => r.method() === 'GET' && /\/api\/v1\/spending\/categories(\?|$)/.test(r.url()),
      { timeout: 10000 },
    )
    await keyboardPress(CAT_ROWS, C0[0], ['ArrowDown'])
    await toastSays("the stale list shows the server's sentence (spec §8.3)", STALE_CATEGORIES, STALE_CATEGORIES)
    check('…and the card reloads the list', await reload.then(() => true, () => false), null)
    await waitIdle('#categories')
    const withNew = [...C0, String(created.id)]
    const seen = await waitFor(() => order(CAT_ROWS), withNew)
    check('nothing moved, and the new category is listed last', same(seen, withNew) && same(await read.categories(), withNew), seen)
    expecting = []
    await api('DELETE', `/spending/categories/${created.id}`)
    await openSettings()
    check('the scratch category is gone and the table reads as it did', same(await order(CAT_ROWS), C0), await order(CAT_ROWS))

    // A resize cancels a live drag (spec §2.3.7, §9) — easing home, no request.
    step('categories-resize-cancels')
    await boxTop(CAT_BOX)
    await clearToasts()
    await ready(CAT_ROWS)
    const writes = writesNow()
    await press(CAT_ROWS, C0[0], aim(await boxes(CAT_ROWS), 0, 2), 1)
    const lifted = await liftState(CAT_ROWS)
    await page.setViewportSize({ width: size.width - 40, height: size.height })
    await page.waitForTimeout(MOTION + 300)
    const after = await liftState(CAT_ROWS)
    const cursor = await grabbing()
    await page.mouse.up()
    await page.setViewportSize(size)
    await page.waitForTimeout(500)
    check('a resize mid-drag cancels the lift', lifted !== null && after === null && !cursor, {
      lifted: lifted?.liftedIds ?? null,
      after,
      cursor,
    })
    check('…with no request, and nothing moved', writesNow() === writes && same(await order(CAT_ROWS), C0), {
      writes: writesNow() - writes,
    })
  }

  step('accounts-rest')
  const roster = await page.evaluate(
    ([t, card]) => {
      const table = document.querySelector(t)
      const head = table.querySelector('thead th')
      const seq = [...table.querySelectorAll('tbody tr')].map((row) => {
        if (row.classList.contains('accounts-group-row')) {
          const th = row.querySelector('th')
          return { heading: row.textContent.trim(), scope: th?.getAttribute('scope') ?? null, span: th?.colSpan ?? null }
        }
        const cell = row.querySelector('.accounts-name-cell')
        return {
          id: row.getAttribute('data-reorder-id'),
          nested: row.classList.contains('component-row'),
          indent: cell === null ? null : parseFloat(getComputedStyle(cell).paddingLeft),
          disabled: row.querySelector('.reorder-grip')?.disabled ?? null,
        }
      })
      return {
        className: table.className,
        collapse: getComputedStyle(table).borderCollapse,
        gripHead: [head?.className ?? null, head?.getAttribute('aria-hidden') ?? null],
        heads: [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()),
        seq,
        // Lane R2 (the §4.2 rowgroup correction): one <tbody> per group, its heading row first.
        bodies: [...table.tBodies].map((body) =>
          body.rows[0]?.classList.contains('accounts-group-row') ? body.rows[0].textContent.trim() : null,
        ),
        text: (document.querySelector(card)?.textContent ?? '').replace(/\s+/g, ' '),
      }
    },
    [ACCS, '#accounts'],
  )
  const expectSeq = []
  for (const group of GROUP_ORDER) {
    const inGroup = display.filter((row) => row.group === group)
    if (inGroup.length === 0) continue
    expectSeq.push(`# ${GROUP_LABELS[group]}`, ...inGroup.map((row) => (row.parent === null ? row.id : `  ${row.id}`)))
  }
  const seenSeq = roster.seq.map((row) =>
    row.heading !== undefined ? `# ${row.heading}` : row.nested ? `  ${row.id}` : row.id,
  )
  const headings = roster.seq.filter((row) => row.heading !== undefined)
  check('the roster is reorderable, with separate borders', roster.className.split(' ').includes('reorder-table') && roster.collapse === 'separate', {
    className: roster.className,
    collapse: roster.collapse,
  })
  check('columns: grip · Account · Owner · Roll-up · Status · actions — no Group, no Sort', same(roster.gripHead, ['reorder-grip-cell', 'true']) && same(roster.heads, ['', 'Account', 'Owner', 'Roll-up', 'Status', '']), roster.heads)
  // Lane R2's final DOM (the spec §4.2 rowgroup correction): each group is its own <tbody> whose
  // first row is a `scope="rowgroup"` heading spanning the six columns — the table has no
  // <colgroup> for a colgroup scope to name.
  const groupLabels = expectSeq.filter((entry) => entry.startsWith('# ')).map((entry) => entry.slice(2))
  check(
    'one rowgroup heading per non-empty group in GROUP_ORDER, each group its own <tbody>, each account under its group, each component right after its parent',
    same(seenSeq, expectSeq) &&
      headings.every((row) => row.scope === 'rowgroup' && row.span === 6) &&
      same(roster.bodies, groupLabels),
    { seenSeq, expectSeq, bodies: roster.bodies, scopes: [...new Set(headings.map((row) => row.scope))] },
  )
  const nestedIndent = roster.seq.filter((row) => row.nested).map((row) => row.indent)
  const topIndent = roster.seq.filter((row) => row.id !== undefined && !row.nested).map((row) => row.indent)
  check('a component is indented in its Account cell', nestedIndent.length > 0 && Math.min(...nestedIndent) > Math.max(...topIndent), {
    nested: [...new Set(nestedIndent)],
    top: [...new Set(topIndent)],
  })
  const rangeOf = (row) => (row.parent === null ? row.group : `parent:${row.parent}`)
  const rangeSize = new Map()
  for (const row of display) rangeSize.set(rangeOf(row), (rangeSize.get(rangeOf(row)) ?? 0) + 1)
  const wantDisabled = display.filter((row) => rangeSize.get(rangeOf(row)) < 2).map((row) => row.id)
  const seenDisabled = roster.seq.filter((row) => row.disabled === true).map((row) => row.id)
  check('a grip is disabled exactly where its range holds nothing else (spec §9)', same(seenDisabled, wantDisabled), {
    seenDisabled,
    wantDisabled,
  })
  check('the order note sits under the roster (spec §8.1)', roster.text.includes(ACC_NOTE), null)
  await boxTop(ACC_BOX)
  await restingLook(ACCS, ACC_BOX, 'accounts-rest')

  // The longest group with no components (Liabilities in this book): single-row units, flat moves.
  const flatGroup = GROUP_ORDER.map((group) => display.filter((row) => row.group === group))
    .filter((rows) => rows.length >= 5 && rows.every((row) => row.parent === null))
    .reduce((a, b) => (b.length > a.length ? b : a), [])
  if (flatGroup.length < 5) throw new Error('no group of five or more accounts without components to drag in')
  const lg = flatGroup.map((row) => row.id)
  note('the group the flat account drags use', { group: flatGroup[0].group, accounts: lg.map((id) => accName.get(id)) })
  const A0 = await order(ACC_ROWS)

  step('accounts-drag')
  await boxTo(ACC_BOX, rowSel(ACC_ROWS, lg[0]), 80)
  const aDrag = await mouseDrag({ rows: ACC_ROWS, id: lg[0], k: 3, shot: 'accounts-mid-drag' })
  await toastSays('the toast names the account', /^Moved /, `Moved ${accName.get(lg[0])}`)
  await waitIdle('#accounts')
  check(
    'the server holds the whole roster in the new order — group by group, each parent before its components',
    same(await read.accountsStored(), aDrag),
    await read.accountsStored(),
  )
  await openSettings()
  check('the order survives a reload', same(await order(ACC_ROWS), aDrag), await order(ACC_ROWS))
  await putOrder('accounts', A0)
  await openSettings()
  check('put back through the API', same(await order(ACC_ROWS), A0), await order(ACC_ROWS))

  step('accounts-undo')
  await boxTo(ACC_BOX, rowSel(ACC_ROWS, lg[0]), 80)
  await mouseDrag({ rows: ACC_ROWS, id: lg[0], k: 3 })
  await toastText(`Moved ${accName.get(lg[0])}`)
  await waitIdle('#accounts')
  await clickUndo(`Moved ${accName.get(lg[0])}`)
  await orderRestored()
  check("the toast's Undo restores the roster on the server", same(await waitFor(read.accounts, ORIG.accounts), ORIG.accounts), await read.accounts())
  check('…and the table shows it', same(await waitFor(() => order(ACC_ROWS), A0), A0), await order(ACC_ROWS))

  step('accounts-keyboard')
  await boxTo(ACC_BOX, rowSel(ACC_ROWS, lg[1]), 80)
  const aKeys = await keyboardMove({ rows: ACC_ROWS, id: lg[1], keys: ['ArrowDown', 'ArrowDown'] })
  await toastSays('the toast names the account', /^Moved /, `Moved ${accName.get(lg[1])}`)
  await waitIdle('#accounts')
  check('the server holds it', same(await read.accountsStored(), aKeys), await read.accountsStored())
  await clickUndo(`Moved ${accName.get(lg[1])}`)
  await orderRestored()
  check('Undo restores it', same(await waitFor(read.accounts, ORIG.accounts), ORIG.accounts), await read.accounts())

  // A parent with components that has a sibling below it (Fidelity Traditional 401(k) here).
  let carrier = null
  for (const group of GROUP_ORDER) {
    const units = display.filter((row) => row.group === group && row.parent === null)
    for (let i = 0; carrier === null && i + 1 < units.length; i += 1) {
      const kids = display.filter((row) => row.parent === units[i].id).map((row) => row.id)
      if (kids.length > 0) {
        const sibling = units[i + 1].id
        carrier = {
          parent: units[i].id,
          kids,
          sibling: [sibling, ...display.filter((row) => row.parent === sibling).map((row) => row.id)],
        }
      }
    }
    if (carrier !== null) break
  }

  step('accounts-carry')
  if (carrier === null) {
    note('no parent with components has a sibling below it in this book — skipped', null)
  } else {
    const unit = [carrier.parent, ...carrier.kids]
    await boxTo(ACC_BOX, rowSel(ACC_ROWS, carrier.parent), 80)
    await clearToasts()
    await ready(ACC_ROWS)
    const before = await order(ACC_ROWS)
    const bottomOf = (list) =>
      page.evaluate(
        ([sel, ids]) =>
          Math.max(...ids.map((id) => document.querySelector(`${sel}[data-reorder-id="${id}"]`).getBoundingClientRect().bottom)),
        [ACC_ROWS, list],
      )
    // Lane R0's leading-edge rule (round 4): moving down, the unit passes a peer once its BOTTOM
    // edge reaches that peer's midpoint. The plan's centre-rule travel (sibling centre − unit
    // centre + 4) is clamped at the range's end under it and passes the next peer too (the HSA
    // here — lane R2's round-2 finding), landing the 401(k) last. The unit's bottom set on the
    // sibling unit's bottom passes the sibling alone, half a row clear either way.
    const dy = (await bottomOf(carrier.sibling)) - (await bottomOf(unit))
    await press(ACC_ROWS, carrier.parent, dy, 1)
    const mid = await liftState(ACC_ROWS)
    await snap('accounts-carry-mid-drag')
    await page.mouse.up()
    await page.waitForTimeout(MOTION + 700)
    check(
      'the parent lifts with its components as one unit — one transform on every row',
      mid !== null && same(mid.liftedIds, unit) && mid.transforms.every((t) => t !== '' && t === mid.transforms[0]),
      mid === null ? null : { lifted: mid.liftedIds, transforms: mid.transforms },
    )
    check('exactly the sibling it passes makes room', mid !== null && mid.displaced === carrier.sibling.length, mid?.displaced ?? null)
    await toastSays('the toast names the parent', /^Moved /, `Moved ${accName.get(carrier.parent)}`)
    await waitIdle('#accounts')
    const rest = before.filter((id) => !unit.includes(id))
    const at = rest.indexOf(carrier.sibling[carrier.sibling.length - 1]) + 1
    const expected = [...rest.slice(0, at), ...unit, ...rest.slice(at)]
    const nested = await page.$$eval(ACC_ROWS, (els) =>
      els.filter((el) => el.classList.contains('component-row')).map((el) => el.getAttribute('data-reorder-id')),
    )
    check(
      'it lands below its sibling, its components still nested right after it',
      same(await order(ACC_ROWS), expected) && carrier.kids.every((id) => nested.includes(id)),
      { expected, nested },
    )
    await clickUndo(`Moved ${accName.get(carrier.parent)}`)
    await orderRestored()
    check('Undo puts the group back', same(await waitFor(() => order(ACC_ROWS), before), before), await order(ACC_ROWS))
  }

  if (size.width === 1600 && carrier !== null) {
    // A component moves only among its siblings, and says where it is (spec §2.2, §8.2).
    step('accounts-component-range')
    const kid = carrier.kids[0]
    const n = carrier.kids.length
    const kidName = accName.get(kid)
    await boxTo(ACC_BOX, rowSel(ACC_ROWS, carrier.parent), 80)
    await clearToasts()
    await ready(ACC_ROWS)
    const before = await order(ACC_ROWS)
    const writes = writesNow()
    await page.locator(gripSel(ACC_ROWS, kid)).focus()
    await page.keyboard.press('Space')
    await page.waitForTimeout(150)
    const liftedSaid = await live('#accounts')
    await page.keyboard.press('End')
    await page.waitForTimeout(300)
    const endSaid = await live('#accounts')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(MOTION + 300)
    const cancelSaid = await live('#accounts')
    check(
      "a component picks up within its parent's components",
      liftedSaid === `Picked up ${kidName}. Position 1 of ${n} in ${accName.get(carrier.parent)}'s components.`,
      liftedSaid,
    )
    check('End takes it to its last sibling and no further', endSaid === `${kidName}, position ${n} of ${n}.`, endSaid)
    check(
      'Escape puts it back, with no request',
      cancelSaid === `Cancelled. ${kidName} is back at position 1 of ${n}.` &&
        writesNow() === writes &&
        same(await order(ACC_ROWS), before),
      { cancelSaid, writes: writesNow() - writes },
    )
  }

  step('accounts-autoscroll')
  // Auto-scroll needs a range whose first row the box can hide above its top zone: lane R0 round 4
  // stops the scroll once the range's first row shows clear of the 40px zone, and the held unit is
  // clamped to its range. The group that ends the roster (Liabilities here, the plan's pick) never
  // can — at full depth its first row already shows ~119px below the box's top (lane R2's round-2
  // finding), so a drag there scrolls 0px. The longest flat group with rows below it can (Taxable
  // here, R2's case b).
  const lastGroup = [...GROUP_ORDER].reverse().find((group) => display.some((row) => row.group === group))
  const scrollGroup = GROUP_ORDER.filter((group) => group !== lastGroup)
    .map((group) => display.filter((row) => row.group === group))
    .filter((rows) => rows.length >= 3 && rows.every((row) => row.parent === null))
    .reduce((a, b) => (b.length > a.length ? b : a), [])
  if (scrollGroup.length < 3) {
    note('no flat group of three or more accounts has rows below it in this book — skipped', null)
  } else {
    const sg = scrollGroup.map((row) => row.id)
    note('the group the auto-scroll drag uses', { group: scrollGroup[0].group, accounts: sg.map((id) => accName.get(id)) })
    await autoScrollInBox({
      box: ACC_BOX,
      rows: ACC_ROWS,
      ids: sg,
      scope: '#accounts',
      label: accName.get(sg[sg.length - 1]),
      shot: 'accounts-autoscroll',
    })
  }

  step('accounts-reduced-motion')
  await boxTo(ACC_BOX, rowSel(ACC_ROWS, lg[0]), 80)
  await reducedMotion({ rows: ACC_ROWS, id: lg[0], k: 2 })
}

// ── Portfolio › Manage › Transactions (lane R3) ──────────────────────────────────────────────
async function portfolioWalk() {
  const trades = await api('GET', '/portfolio/transactions')
  const securities = await api('GET', '/portfolio/securities')
  const ticker = new Map(securities.map((s) => [s.id, s.ticker]))
  const trade = new Map(trades.map((t) => [String(t.id), t]))
  // Every real-data move below passes rows of OTHER holdings only — the one holding with two rows,
  // NVDA · Schwab ESPP, holds two buys — so no figure moves (lane R3's census).
  const quiet = (id) =>
    `Moved the ${ticker.get(trade.get(id).security_id)} ${trade.get(id).type}. No holding's figures changed.`
  const L0 = ORIG.ledger

  step('open')
  await visit(HOUSEHOLD_LEDGER, TXN_ROWS)

  step('ledger-rest')
  const rest = await page.evaluate(
    ([t, panel]) => {
      const table = document.querySelector(t)
      const head = table.querySelector('thead th')
      return {
        className: table.className,
        collapse: getComputedStyle(table).borderCollapse,
        gripHead: [head?.className ?? null, head?.getAttribute('aria-hidden') ?? null],
        hint: (document.querySelector(`${panel} p.hint`)?.textContent ?? '').replace(/\s+/g, ' '),
      }
    },
    [LEDGER, LEDGER_PANEL],
  )
  check('the ledger is reorderable, with separate borders', rest.className.split(' ').includes('reorder-table') && rest.collapse === 'separate', {
    className: rest.className,
    collapse: rest.collapse,
  })
  check('the grip column comes first', same(rest.gripHead, ['reorder-grip-cell', 'true']), rest.gripHead)
  check('the hint says the list is the replay order (spec §8.1)', rest.hint.includes(LEDGER_HINT), rest.hint)
  check('the rows are the server order', same(await order(TXN_ROWS), L0), await order(TXN_ROWS))
  await standAt(`${LEDGER} thead`, 0.2)
  await restingLook(LEDGER, LEDGER, 'ledger-rest')

  step('ledger-drag')
  const movedFirst = size.width === 1280 ? L0[0] : L0[1]
  let bOrder
  if (size.width === 1280) {
    bOrder = await longDrag(TXN_ROWS, L0[0])
  } else {
    await standAt(rowSel(TXN_ROWS, L0[1]))
    await page.waitForTimeout(250)
    bOrder = await mouseDrag({ rows: TXN_ROWS, id: L0[1], k: 3, shot: 'ledger-mid-drag' })
  }
  await toastSays('the toast names the trade and says no figure moved', /^Moved the /, quiet(movedFirst))
  await waitIdle(LEDGER_PANEL)
  check('the server holds the new order', same(await read.transactions(), bOrder), await read.transactions())
  await visit(HOUSEHOLD_LEDGER, TXN_ROWS)
  check('the order survives a reload', same(await order(TXN_ROWS), bOrder), await order(TXN_ROWS))
  await putOrder('transactions', L0)
  await visit(HOUSEHOLD_LEDGER, TXN_ROWS)
  check('put back through the API', same(await order(TXN_ROWS), L0), await order(TXN_ROWS))

  step('ledger-undo')
  await standAt(rowSel(TXN_ROWS, L0[1]))
  await page.waitForTimeout(250)
  await mouseDrag({ rows: TXN_ROWS, id: L0[1], k: 3 })
  await toastText(/^Moved the /)
  await waitIdle(LEDGER_PANEL)
  await clickUndo(/^Moved the /)
  await orderRestored()
  await page.waitForTimeout(SETTLE) // the page's reload lands (R3: Undo is not optimistic)
  check("the toast's Undo restores the server order", same(await read.transactions(), L0), await read.transactions())
  check('…and the ledger shows it', same(await waitFor(() => order(TXN_ROWS), L0), L0), await order(TXN_ROWS))

  step('ledger-keyboard')
  await standAt(rowSel(TXN_ROWS, L0[0]))
  const dOrder = await keyboardMove({ rows: TXN_ROWS, id: L0[0], keys: ['ArrowDown', 'ArrowDown'] })
  await toastSays('the toast names the trade', /^Moved the /, quiet(L0[0]))
  await waitIdle(LEDGER_PANEL)
  check('the server holds it', same(await read.transactions(), dOrder), await read.transactions())
  await clickUndo(/^Moved the /)
  await orderRestored()
  check('Undo restores it', same(await waitFor(read.transactions, L0), L0), await read.transactions())

  if (size.width === 1600) {
    // A person scope that hides rows (Grace's: her own accounts plus the joint one).
    step('ledger-person-scope')
    let person = null
    for (const candidate of PEOPLE) {
      const ids = await read.transactions(candidate.id)
      if (ids.length >= 3 && ids.length < L0.length) {
        person = candidate.id
        break
      }
    }
    if (person === null) {
      note('no person scope hides a row in this book — skipped', null)
    } else {
      const scoped = await read.transactions(person)
      await visit(`/portfolio?section=manage&owner=${person}`, TXN_ROWS)
      check('the scope lists exactly its own rows', same(await order(TXN_ROWS), scoped), await order(TXN_ROWS))
      await standAt(rowSel(TXN_ROWS, scoped[0]))
      await page.waitForTimeout(250)
      const put = page.waitForRequest(
        (r) => r.method() === 'PUT' && r.url().includes('/portfolio/transactions/order'),
        { timeout: 10000 },
      )
      const eOrder = await mouseDrag({ rows: TXN_ROWS, id: scoped[0], k: 2 })
      const request = await put
      const sent = (request.postDataJSON()?.ids ?? []).map(String)
      check(
        'the PUT names the scope and carries the visible ids in their new order',
        new URL(request.url()).searchParams.get('owner') === String(person) && same(sent, eOrder),
        { url: request.url(), sent },
      )
      await toastText(/^Moved the /)
      await waitIdle(LEDGER_PANEL)
      const household = await read.transactions()
      const visible = new Set(scoped)
      check(
        "every hidden row keeps its slot in the household order (its holding's rows never move)",
        L0.every((id, index) => visible.has(id) || household[index] === id),
        household,
      )
      check('the visible rows moved among their own slots', same(household.filter((id) => visible.has(id)), eOrder), household)
      await clickUndo(/^Moved the /)
      await orderRestored()
      check('Undo restores the household order', same(await waitFor(read.transactions, L0), L0), await read.transactions())
    }

    // A move that re-times a trade: a sell dragged above its buy (spec §5, §8.1).
    step('ledger-figures')
    const voo = securities.find((s) => s.ticker === 'VOO') ?? securities[0]
    const buy = await api('POST', '/portfolio/transactions', {
      security_id: voo.id,
      account: SCRATCH_ACCOUNT,
      type: 'buy',
      shares: '10',
      price: '100',
    })
    report.scratch.push({ kind: 'trade', id: buy.id })
    const sell = await api('POST', '/portfolio/transactions', {
      security_id: voo.id,
      account: SCRATCH_ACCOUNT,
      type: 'sell',
      shares: '4',
      price: '150',
    })
    report.scratch.push({ kind: 'trade', id: sell.id })
    try {
      await visit(HOUSEHOLD_LEDGER, TXN_ROWS)
      check(
        'trades added with no position land last in the ledger',
        same((await order(TXN_ROWS)).slice(-2), [String(buy.id), String(sell.id)]),
        (await order(TXN_ROWS)).slice(-3),
      )
      await standAt(rowSel(TXN_ROWS, sell.id))
      await page.waitForTimeout(250)
      await mouseDrag({ rows: TXN_ROWS, id: sell.id, k: -1, shot: 'ledger-figures-mid-drag' })
      // Buy 10 @ 100 then sell 4 @ 150 realizes $200; the sell replayed first finds no shares
      // (average cost 0) and realizes $600 — the fold's arithmetic, read off the server's answer.
      await toastSays(
        'the toast names the realized-gain change the move made',
        /^Moved the /,
        `Moved the ${voo.ticker} sell. ${voo.ticker} at ${SCRATCH_ACCOUNT}: realized gain $200.00 → $600.00.`,
      )
      await waitIdle(LEDGER_PANEL)
    } finally {
      for (const id of [sell.id, buy.id]) {
        await api('DELETE', `/portfolio/transactions/${id}`).catch((error) =>
          problem(`${tag} portfolio: scratch trade ${id} was not deleted — ${error.message}`),
        )
      }
    }
    await visit(HOUSEHOLD_LEDGER, TXN_ROWS)
    check(
      'the scratch trades are gone and the ledger reads as it did',
      same(await order(TXN_ROWS), L0) && same(await read.transactions(), L0),
      await order(TXN_ROWS),
    )
  }

  step('ledger-reduced-motion')
  await standAt(rowSel(TXN_ROWS, L0[2]))
  await page.waitForTimeout(250)
  await reducedMotion({ rows: TXN_ROWS, id: L0[2], k: 2 })
}

// ── Overview › Customize (lane R4) ───────────────────────────────────────────────────────────
async function overviewWalk() {
  step('open')
  await openOverview()
  check(
    'the tiles start in the stored order (the defaults: finance_realdata stores no layout)',
    same(await tileOrder(), DEFAULT_LAYOUT.tiles),
    await tileOrder(),
  )

  step('customize-rest')
  await openCustomize()
  const tiles = await rowsOf('Summary tiles')
  check(
    'Summary tiles lists the stored order with a grip on every row, nothing hidden',
    same(tiles, ['⋮ [x] Net worth', '⋮ [x] Portfolio', '⋮ [x] Living spending', '⋮ [x] Estimated tax']),
    tiles,
  )
  const cards = await rowsOf('Deeper views')
  check(
    'Deeper views lists the stored order with a grip on every row, nothing hidden',
    same(cards, ['⋮ [x] Year to date', '⋮ [x] Portfolio performance', '⋮ [x] Recent spending', '⋮ [x] Money flow']),
    cards,
  )
  const shape = await page.$$eval(`${DIALOG} .overview-customize-row`, (els) => ({
    heights: els.map((el) => Math.round(el.getBoundingClientRect().height)),
    lefts: els.map((el) => Math.round(el.querySelector('input').getBoundingClientRect().left)),
  }))
  check('every row is one height and every box stands in one column', new Set(shape.heights).size === 1 && new Set(shape.lefts).size === 1, shape)
  await snap('customize-rest')

  step('customize-drag')
  const moved = await mouseDrag({ rows: TILE_ROWS, id: 'net_worth', k: 2, shot: 'customize-mid-drag' })
  await page.waitForTimeout(600)
  check('the tiles behind the popover take the new order', same(await tileOrder(), moved), await tileOrder())
  check('the drop leaves the popover open', await dialog().isVisible(), null)
  check('no toast — a layout preference applies at once (spec §6)', (await page.locator('.toast').count()) === 0, await page.locator('.toast-message').allTextContents())
  const want = { tiles: moved, cards: DEFAULT_LAYOUT.cards }
  let stored = null
  for (let attempt = 0; attempt < 20 && !sameLayout(stored, want); attempt += 1) {
    stored = await read.layout()
    if (!sameLayout(stored, want)) await sleep(250)
  }
  check('the server holds the new layout (the pref sync)', sameLayout(stored, want), stored)
  await openOverview()
  check('the order survives a reload', same(await tileOrder(), moved), await tileOrder())
  await api('PATCH', '/prefs', { overview_layout: DEFAULT_LAYOUT })
  await openOverview()
  check('put back through the API', same(await tileOrder(), DEFAULT_LAYOUT.tiles), await tileOrder())

  step('customize-keyboard')
  await openCustomize()
  const typed = await keyboardMove({ rows: TILE_ROWS, id: 'portfolio', keys: ['ArrowDown', 'ArrowDown'] })
  await page.waitForTimeout(400)
  check('the tiles behind take it', same(await tileOrder(), typed), await tileOrder())
  const said = await live(`${DIALOG} fieldset:nth-of-type(1)`)
  check('the list says where it landed (spec §8.2)', said === 'Dropped Portfolio at position 4 of 4.', said)
  await dialog().getByRole('button', { name: 'Reset to defaults', exact: true }).click()
  await page.waitForTimeout(600)
  check('Reset to defaults puts the tiles back', same(await tileOrder(), DEFAULT_LAYOUT.tiles), await tileOrder())
  let reset = null
  for (let attempt = 0; attempt < 20 && !sameLayout(reset, DEFAULT_LAYOUT); attempt += 1) {
    reset = await read.layout()
    if (!sameLayout(reset, DEFAULT_LAYOUT)) await sleep(250)
  }
  check('…and the server holds the defaults', sameLayout(reset, DEFAULT_LAYOUT), reset)

  step('customize-escape')
  const writes = writesNow()
  const grip = await page.locator(gripSel(TILE_ROWS, 'portfolio')).boundingBox()
  const x = grip.x + grip.width / 2
  const y = grip.y + grip.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + 40, { steps: 5 })
  await page.waitForTimeout(150)
  const up = await liftState(TILE_ROWS)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(MOTION + 200)
  const gone = await liftState(TILE_ROWS)
  const open = await dialog().isVisible()
  await page.mouse.up()
  await page.waitForTimeout(MOTION + 300)
  check('a row was up when Escape landed', up !== null && same(up.liftedIds, ['portfolio']), up)
  check('Escape mid-drag cancels the drag only — the popover stays open (spec §6, §9)', gone === null && open, { gone, open })
  check(
    'the cancelled drag moved and saved nothing',
    same(await tileOrder(), DEFAULT_LAYOUT.tiles) && writesNow() === writes,
    { tiles: await tileOrder(), writes: writesNow() - writes },
  )
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? null)
  check(
    'with nothing lifted, Escape closes the popover and hands focus back to Customize',
    (await dialog().count()) === 0 && focused === 'Customize',
    { focused },
  )

  step('customize-reduced-motion')
  await openCustomize()
  await reducedMotion({ rows: TILE_ROWS, id: 'net_worth', k: 2, popover: true })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
}

// ── Credit Cards › Card roster and Categories & weights (lane R5) ────────────────────────────
async function cardsWalk() {
  const cards = await api('GET', '/credit-cards')
  const weights = await api('GET', '/credit-cards/categories')
  const cardName = new Map(cards.map((c) => [String(c.id), c.name]))
  const weightName = new Map(weights.map((c) => [String(c.id), c.name]))
  const drawnCard = (c) => c.is_active && c.limit_events.length > 0
  const drawn = new Set(cards.filter(drawnCard).map((c) => String(c.id)))
  const active = new Set(cards.filter((c) => c.is_active).map((c) => String(c.id)))
  /** The chart's expected legend: the list order, drawn cards only, then the total. */
  const legendFor = (ids) => {
    const names = ids.filter((id) => drawn.has(id)).map((id) => cardName.get(id))
    return names.length > 1 ? [...names, 'Total line'] : names
  }
  // A person's view is their own cards plus the joint ones (CreditCardsPage's ownerMatches).
  const drawnIn = (scope) =>
    cards.filter(
      (c) => drawnCard(c) && (scope === 'joint' ? c.person_id === null : c.person_id === scope || c.person_id === null),
    ).length
  const K0 = ORIG.cards
  const W0 = ORIG.weights

  step('open')
  await openManage()

  step('rest')
  for (const [table, clipOf, name] of [
    [ROSTER, ROSTER, 'roster-rest'],
    [WEIGHTS, WEIGHT_BOX, 'weights-rest'],
  ]) {
    const rest = await page.evaluate((sel) => {
      const t = document.querySelector(sel)
      const head = t.querySelector('thead th')
      const cells = [...t.querySelectorAll('tbody tr:nth-child(-n+3) > td')]
      return {
        className: t.className,
        collapse: getComputedStyle(t).borderCollapse,
        gripHead: [head?.className ?? null, head?.getAttribute('aria-hidden') ?? null],
        hairlines: cells.every((td) => getComputedStyle(td).borderBottomWidth === '1px'),
      }
    }, table)
    check(`${table} is reorderable, with separate borders`, rest.className.split(' ').includes('reorder-table') && rest.collapse === 'separate', rest)
    check(`${table} puts the grip column first`, same(rest.gripHead, ['reorder-grip-cell', 'true']), rest.gripHead)
    check(`every ${table} cell keeps its hairline`, rest.hairlines, rest)
    if (table === ROSTER) await standAt(`${ROSTER} thead`, 0.25)
    else await boxTop(WEIGHT_BOX)
    await restingLook(table, clipOf, name)
  }
  check('the roster is the server order', same(await order(CARD_ROWS), K0), await order(CARD_ROWS))
  check('Categories & weights are the server order', same(await order(WEIGHT_ROWS), W0), await order(WEIGHT_ROWS))

  let colourOf = null
  if (size.width === 1600) {
    // Spec §7 as amended: a card's colour is its rank by id among ALL the cards the page knows.
    step('colours')
    await visit(LINES, 'section.chart-card')
    const before = await lineSeries()
    check(
      'the credit-line chart painted, a colour on every series',
      before !== null && before.every((s) => typeof s.color === 'string' && s.color !== ''),
      before,
    )
    check('its legend is the list order', same(before?.map((s) => s.name) ?? null, legendFor(K0)), before)
    colourOf = new Map((before ?? []).map((s) => [s.name, s.color]))
    for (const scope of [...PEOPLE.map((person) => person.id), 'joint']) {
      await visit(`/credit-cards?section=lines&owner=${scope}`, 'section.chart-card')
      if (drawnIn(scope) === 0) {
        note(`owner=${scope} draws no card`, null)
        continue
      }
      const seen = ((await lineSeries()) ?? []).filter((s) => s.name !== 'Total line')
      check(
        `owner=${scope}: every card drawn wears its household colour`,
        seen.length > 0 && seen.every((s) => colourOf.get(s.name) === s.color),
        seen,
      )
    }
    // Spec §7 as amended at lane R5's review: a card's drill-in draws its lone credit line in the
    // colour the page gives it — its rank among the household's active cards — never the first
    // slot a lone series would take. The drawn card with the highest id (rank > 0) discriminates.
    const drill = cards.filter(drawnCard).sort((a, b) => b.id - a.id)[0]
    if (drill === undefined || cards.filter(drawnCard).length < 2) {
      note('fewer than two drawn cards — the drill-in colour check is skipped', null)
    } else {
      await visit(`/credit-cards?card=${drill.slug}&owner=all`, 'section.chart-card')
      const own = await lineSeries(/^\s*Credit line(?! history)/)
      check(
        `the ${drill.name} drill-in draws its line in the card's household colour`,
        own !== null && own.length === 1 && own[0].color === colourOf.get(drill.name),
        { own, household: colourOf.get(drill.name) },
      )
    }
  }

  step('roster-drag')
  await openManage()
  await standAt(rowSel(CARD_ROWS, K0[0]))
  await page.waitForTimeout(250)
  const cOrder = await mouseDrag({ rows: CARD_ROWS, id: K0[0], k: 3, shot: 'roster-mid-drag' })
  await toastSays('the toast names the card', /^Moved /, `Moved ${cardName.get(K0[0])}`)
  await waitIdle(ROSTER)
  check('the server holds the new order', same(await read.cards(), cOrder), await read.cards())
  await openManage()
  check('the order survives a reload', same(await order(CARD_ROWS), cOrder), await order(CARD_ROWS))

  if (size.width === 1600) {
    step('roster-follows')
    await visit(REWARDS, '[id^="card-col-"]')
    const columns = await page.$$eval('[id^="card-col-"]', (els) => els.map((el) => el.id.slice('card-col-'.length)))
    check("the rewards matrix's columns follow the new order", same(columns, cOrder.filter((id) => active.has(id))), columns)
    await visit(LINES, 'section.chart-card')
    const after = await lineSeries()
    check('the legend follows the new order', same(after?.map((s) => s.name) ?? null, legendFor(cOrder)), after)
    check('the move changed the drawn order (so the colour check means something)', !same(legendFor(cOrder), legendFor(K0)), legendFor(cOrder))
    check(
      'every card keeps its colour through the reorder',
      (after ?? []).length > 0 && (after ?? []).every((s) => colourOf.get(s.name) === s.color),
      after,
    )
    await page
      .locator('section.chart-card', { has: page.locator('h2', { hasText: 'Credit line history' }) })
      .screenshot({ path: file('credit-lines-after-reorder') })
    const narrow = PEOPLE.map((person) => person.id)
      .filter((id) => drawnIn(id) > 0)
      .sort((a, b) => drawnIn(a) - drawnIn(b))[0]
    if (narrow === undefined) {
      note('no person scope draws a card — the scoped colour check after the reorder is skipped', null)
    } else {
      await visit(`/credit-cards?section=lines&owner=${narrow}`, 'section.chart-card')
      const scoped = ((await lineSeries()) ?? []).filter((s) => s.name !== 'Total line')
      check(
        `owner=${narrow} after the reorder: each card still wears its household colour`,
        scoped.length > 0 && scoped.every((s) => colourOf.get(s.name) === s.color),
        scoped,
      )
    }
  }

  step('roster-put-back')
  await putOrder('cards', K0)
  await openManage()
  check('put back through the API', same(await order(CARD_ROWS), K0), await order(CARD_ROWS))

  step('roster-undo')
  await standAt(rowSel(CARD_ROWS, K0[0]))
  await page.waitForTimeout(250)
  await mouseDrag({ rows: CARD_ROWS, id: K0[0], k: 3 })
  await toastText(`Moved ${cardName.get(K0[0])}`)
  await waitIdle(ROSTER)
  await clickUndo(`Moved ${cardName.get(K0[0])}`)
  await orderRestored()
  await page.waitForTimeout(SETTLE)
  check("the toast's Undo restores the server order", same(await read.cards(), K0), await read.cards())
  check('…and the roster shows it', same(await waitFor(() => order(CARD_ROWS), K0), K0), await order(CARD_ROWS))

  step('roster-keyboard')
  await standAt(rowSel(CARD_ROWS, K0[1]))
  const gOrder = await keyboardMove({ rows: CARD_ROWS, id: K0[1], keys: ['ArrowDown', 'ArrowDown'] })
  await toastSays('the toast names the card', /^Moved /, `Moved ${cardName.get(K0[1])}`)
  await waitIdle(ROSTER)
  check('the server holds it', same(await read.cards(), gOrder), await read.cards())
  await clickUndo(`Moved ${cardName.get(K0[1])}`)
  await orderRestored()
  check('Undo restores it', same(await waitFor(read.cards, K0), K0), await read.cards())

  step('roster-reduced-motion')
  await standAt(rowSel(CARD_ROWS, K0[0]))
  await page.waitForTimeout(250)
  await reducedMotion({ rows: CARD_ROWS, id: K0[0], k: 2 })

  step('weights-drag')
  await boxTop(WEIGHT_BOX)
  const hOrder = await mouseDrag({ rows: WEIGHT_ROWS, id: W0[0], k: 3, shot: 'weights-mid-drag' })
  await toastSays('the toast names the category', /^Moved /, `Moved ${weightName.get(W0[0])}`)
  await waitIdle(WEIGHTS)
  check('the server holds the new order', same(await read.weights(), hOrder), await read.weights())
  await openManage()
  check('the order survives a reload', same(await order(WEIGHT_ROWS), hOrder), await order(WEIGHT_ROWS))
  await putOrder('weights', W0)
  await openManage()
  check('put back through the API', same(await order(WEIGHT_ROWS), W0), await order(WEIGHT_ROWS))

  step('weights-undo')
  await boxTop(WEIGHT_BOX)
  await mouseDrag({ rows: WEIGHT_ROWS, id: W0[0], k: 3 })
  await toastText(`Moved ${weightName.get(W0[0])}`)
  await waitIdle(WEIGHTS)
  await clickUndo(`Moved ${weightName.get(W0[0])}`)
  await orderRestored()
  await page.waitForTimeout(SETTLE)
  check("the toast's Undo restores the server order", same(await read.weights(), W0), await read.weights())
  check('…and the list shows it', same(await waitFor(() => order(WEIGHT_ROWS), W0), W0), await order(WEIGHT_ROWS))

  step('weights-autoscroll')
  await autoScrollInBox({
    box: WEIGHT_BOX,
    rows: WEIGHT_ROWS,
    ids: W0,
    scope: WEIGHTS,
    label: weightName.get(W0[W0.length - 1]),
    shot: 'weights-autoscroll',
  })

  step('weights-keyboard')
  await boxTop(WEIGHT_BOX)
  const jOrder = await keyboardMove({ rows: WEIGHT_ROWS, id: W0[1], keys: ['ArrowDown', 'ArrowDown'] })
  await toastSays('the toast names the category', /^Moved /, `Moved ${weightName.get(W0[1])}`)
  await waitIdle(WEIGHTS)
  check('the server holds it', same(await read.weights(), jOrder), await read.weights())
  await clickUndo(`Moved ${weightName.get(W0[1])}`)
  await orderRestored()
  check('Undo restores it', same(await waitFor(read.weights, W0), W0), await read.weights())

  step('weights-reduced-motion')
  await boxTop(WEIGHT_BOX)
  await reducedMotion({ rows: WEIGHT_ROWS, id: W0[0], k: 2 })
}

// ── Activity: the logged lists' Undo, and one entry per logged reorder (spec §3.2, §8.4, §9) ──
async function activityWalk() {
  const catName = new Map((await api('GET', '/spending/categories')).map((c) => [String(c.id), c.name]))

  step('activity-undo')
  await openSettings()
  await boxTop(CAT_BOX)
  const y0 = await order(CAT_ROWS)
  await keyboardMove({ rows: CAT_ROWS, id: y0[2], keys: ['ArrowDown'] })
  await toastText(`Moved ${catName.get(y0[2])}`)
  await waitIdle('#categories')
  await clearToasts()
  const fresh = report.logged[report.logged.length - 1] ?? null
  await visit('/settings?section=data', '#activity .activity-row')
  const top = page.locator('#activity .activity-row').first()
  const label = ((await top.locator('.activity-label').textContent()) ?? '').trim()
  const newest = (await activity(1))[0] ?? null
  check(
    'the newest Activity entry is that reorder, labelled by its list (spec §8.4)',
    newest?.type === 'batch' && newest.batch_id === fresh?.id && newest.label === label && LABEL_OF.categories.test(label),
    { label, newest, fresh },
  )
  await top.getByRole('button', { name: 'Undo', exact: true }).click()
  check('the first click arms it', (await top.getByRole('button', { name: 'Undo?', exact: true }).count()) === 1, null)
  await top.getByRole('button', { name: 'Undo?', exact: true }).click()
  await toastText(`Undone — ${label}`)
  check("the card's Undo restores the order", same(await waitFor(read.categories, y0), y0), await read.categories())
  const wantRows = [
    [`Undid: ${label}`, false],
    [label, true],
  ]
  // The change log's Undo also records a run (kind "undo", its report behind "View report" — the
  // house's Activity since 2026-09-03), drawn as its own row just above the "Undid:" batch. The
  // question here is about the batches, so the runs are set aside — the activity-feed step's rule.
  const rows = await waitFor(
    async () =>
      (await activityRows())
        .filter((row) => row.source !== 'run')
        .slice(0, 2)
        .map((row) => [row.label, row.undone]),
    wantRows,
  )
  check('the feed puts the undo on top and marks the entry undone', same(rows, wantRows), rows)

  step('activity-overlap')
  await openSettings()
  await boxTop(CAT_BOX)
  const z0 = await order(CAT_ROWS)
  const a = z0[3]
  const aName = catName.get(a)
  await keyboardMove({ rows: CAT_ROWS, id: a, keys: ['ArrowDown'] })
  await toastText(`Moved ${aName}`)
  await waitIdle('#categories')
  // Both toasts must stay on screen for the two Undos: the pointer rests on the first one, which
  // pauses the toast clock (ToastProvider's hover latch). Focus stays on the moved grip.
  await toastsWith(`Moved ${aName}`).first().hover()
  await page.keyboard.press('Space')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Space')
  await page.waitForTimeout(400)
  await waitIdle('#categories')
  const zA = moveTo(z0, 3, 4)
  const zB = moveTo(zA, 4, 5)
  check('a second move of the same row saves on top of the first', same(await read.categories(), zB), await read.categories())
  expecting = [
    {
      re: /\/api\/v1\/activity\/batches\/[0-9a-f-]+\/undo$/,
      status: 409,
      why: "overlap step: the first move's Undo is refused because the second move touched its rows",
    },
  ]
  await clickUndo(`Moved ${aName}`, 'first')
  const refused = await toastText(OVERLAP).catch(() => null)
  check("the first move's Undo is refused with the overlap sentence (spec §9)", refused === OVERLAP, refused)
  check('…and nothing changed', same(await read.categories(), zB), await read.categories())
  expecting = []
  await clickUndo(`Moved ${aName}`, 'last')
  await orderRestored()
  check("the second move's Undo still works: the rows read as after the first", same(await waitFor(read.categories, zA), zA), await read.categories())
  await putOrder('categories', z0)
  await openSettings()
  check('put back through the API', same(await order(CAT_ROWS), z0), await order(CAT_ROWS))

  step('activity-feed')
  const batches = (await activity(200)).filter((entry) => entry.type === 'batch')
  const byId = new Map(batches.map((b) => [b.batch_id, b]))
  const missing = report.logged.filter((b) => !byId.has(b.id))
  const mislabelled = report.logged.filter((b) => byId.has(b.id) && !LABEL_OF[b.list].test(byId.get(b.id).label))
  check(
    'every logged reorder of this pass is in Activity, labelled by its list (spec §8.4)',
    report.logged.length > 0 && missing.length === 0 && mislabelled.length === 0,
    { logged: report.logged.length, missing, mislabelled },
  )
  const entries = batches.filter((b) => REORDER_LABEL.test(b.label))
  check(
    'one Activity entry per logged reorder — none twice, none from a cancelled drag or a refused save',
    entries.length === report.logged.length && new Set(report.logged.map((b) => b.id)).size === report.logged.length,
    { entries: entries.length, logged: report.logged.length },
  )
  const badUndos = report.undos.filter((u) => byId.get(u.id)?.label !== `Undid: ${byId.get(u.of)?.label}`)
  check('every Undo is its own entry, "Undid: {label}"', report.undos.length > 0 && badUndos.length === 0, {
    undos: report.undos.length,
    badUndos,
  })
  await visit('/settings?section=data', '#activity .activity-row')
  const card = (await activityRows()).filter((row) => row.source !== 'run').map((row) => row.label)
  const firstPage = (await activity(50)).filter((entry) => entry.type === 'batch').map((entry) => entry.label)
  check('the Activity card lists the feed exactly as the API pages it', same(card, firstPage), {
    card: card.slice(0, 8),
    api: firstPage.slice(0, 8),
  })
  await snap('activity')
}

// ── put-backs: a stopped walk must not leave the private copy moved ──────────────────────────
async function restoreSettings() {
  for (const c of (await api('GET', '/spending/categories')).filter((row) => row.name === SCRATCH_CATEGORY)) {
    await api('DELETE', `/spending/categories/${c.id}`)
    problem(`${tag} settings: the scratch category ${c.id} was still there — deleted through the API`)
  }
  if (!same(await read.categories(), ORIG.categories)) {
    problem(`${tag} settings: the categories were not in their starting order — put back through the API`)
    await putOrder('categories', ORIG.categories)
  }
  if (!same(await read.accounts(), ORIG.accounts)) {
    problem(`${tag} settings: the accounts were not in their starting order — put back through the API`)
    await putOrder('accounts', ORIG.accounts)
  }
}
async function restorePortfolio() {
  for (const t of (await api('GET', '/portfolio/transactions')).filter((row) => row.account === SCRATCH_ACCOUNT)) {
    await api('DELETE', `/portfolio/transactions/${t.id}`)
    problem(`${tag} portfolio: scratch trade ${t.id} was still there — deleted through the API`)
  }
  if (!same(await read.transactions(), ORIG.ledger)) {
    problem(`${tag} portfolio: the ledger was not in its starting order — put back through the API`)
    await putOrder('transactions', ORIG.ledger)
  }
}
async function restoreOverview() {
  const layout = await read.layout()
  if (layout !== null && !sameLayout(layout, DEFAULT_LAYOUT)) {
    problem(`${tag} overview: the layout was not back at the defaults — put back through the API`)
    await api('PATCH', '/prefs', { overview_layout: DEFAULT_LAYOUT })
  }
}
async function restoreCards() {
  if (!same(await read.cards(), ORIG.cards)) {
    problem(`${tag} cards: the roster was not in its starting order — put back through the API`)
    await putOrder('cards', ORIG.cards)
  }
  if (!same(await read.weights(), ORIG.weights)) {
    problem(`${tag} cards: the reward categories were not in their starting order — put back through the API`)
    await putOrder('weights', ORIG.weights)
  }
}
async function surface(name, walk, restore) {
  where.surface = name
  where.step = 'start'
  try {
    await walk()
  } catch (error) {
    problem(`${tag} ${name}:${where.step}: the walk stopped — ${error instanceof Error ? error.message : String(error)}`)
    await page.screenshot({ path: file(`${name}-stopped`), fullPage: true }).catch(() => {})
  } finally {
    expecting = []
    await page.mouse.up().catch(() => {})
    await page.emulateMedia({ reducedMotion: 'no-preference' }).catch(() => {})
    await restore().catch((error) => problem(`${tag} ${name}: the put-back failed — ${error.message}`))
    drain()
  }
}

// ── the run ──────────────────────────────────────────────────────────────────────────────────
browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'],
})
try {
  for (const sz of SIZES) {
    size = sz
    tag = `${THEME}-${sz.width}`
    themedOnce = false
    current = null
    const context = await openContext()
    page = await context.newPage()
    wire()
    try {
      if (SURFACES.includes('settings')) await surface('settings', settingsWalk, restoreSettings)
      if (SURFACES.includes('portfolio')) await surface('portfolio', portfolioWalk, restorePortfolio)
      if (SURFACES.includes('overview')) await surface('overview', overviewWalk, restoreOverview)
      if (SURFACES.includes('cards')) await surface('cards', cardsWalk, restoreCards)
      if (sz === SIZES[SIZES.length - 1] && SURFACES.includes('activity')) {
        await surface('activity', activityWalk, restoreSettings)
      }
      await leave()
      drain()
    } finally {
      await context.close()
      page = null
    }
  }
} finally {
  await browser.close()
}

tag = THEME
where.surface = 'end'
where.step = 'as-found'
check('the categories end in the order they started in', same(await read.categories(), ORIG.categories), await read.categories())
check('the accounts end in the order they started in', same(await read.accounts(), ORIG.accounts), await read.accounts())
check('the ledger ends in the order it started in', same(await read.transactions(), ORIG.ledger), await read.transactions())
check('the card roster ends in the order it started in', same(await read.cards(), ORIG.cards), await read.cards())
check('the reward categories end in the order they started in', same(await read.weights(), ORIG.weights), await read.weights())
const layoutAtEnd = await read.layout()
check('the Overview layout ends at the defaults', layoutAtEnd === null || sameLayout(layoutAtEnd, DEFAULT_LAYOUT), layoutAtEnd)
const leftovers = {
  trades: (await api('GET', '/portfolio/transactions')).filter((t) => t.account === SCRATCH_ACCOUNT).length,
  categories: (await api('GET', '/spending/categories')).filter((c) => c.name === SCRATCH_CATEGORY).length,
}
check('no scratch trade and no scratch category remain', leftovers.trades === 0 && leftovers.categories === 0, leftovers)

writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
const passed = report.checks.filter((c) => c.ok === true).length
const failed = report.checks.filter((c) => c.ok === false).length
const noted = report.checks.filter((c) => c.ok === null).length
console.log(
  `checks: ${passed} ok, ${failed} failed, ${noted} noted; page writes ${report.writes.length} (blocked ${report.blockedWrites.length}); logged reorders ${report.logged.length}, undos ${report.undos.length}; ${report.files.length} files in ${OUT}`,
)
for (const judge of report.checks.filter((c) => c.ok === null && /^JUDGE/.test(c.name))) {
  console.log(`JUDGE ${judge.tag} ${judge.surface}:${judge.step} — ${JSON.stringify(judge.observed)}`)
}
if (report.problems.length > 0) {
  console.error(`REORDER SMOKE FAILED — ${report.problems.length} problem(s):`)
  for (const p of report.problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(`REORDER SMOKE OK — ${THEME}: ${passed} checks`)
