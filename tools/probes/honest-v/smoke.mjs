// tools/probes/honest-v/smoke.mjs — the honest-numbers browser smoke (lane V Task 7,
// 2026-09-04 honest-numbers spec §7 "Verify lane"). How to run it: tools/probes/README.md.
//
// What it proves against the REAL app that jsdom cannot:
//   1. The wizard's steps are DECOUPLED. Saving a month whose spending step was never touched
//      must fire exactly one PUT /net-worth/months/{m} and ZERO PUT /spending/months/{m}.
//      That is a claim about the network, so only a browser can make it.
//   2. The $0 door is a door. The checkbox is unchecked by default, the save it enables
//      carries confirm_zero:true, and revisiting the month it wrote shows the repair banner.
//   3. A parent with components is READ-ONLY in the wizard and badged "derived".
//   4. The words on Overview, Spending, Projection, the money-flow card and Settings are the
//      spec's words, in BOTH themes, with no console error.
//
// IT WRITES, unlike the sandbox smoke — the wizard's save IS the subject. Every write goes to
// the scratch month 2019-01, which the dev book has never used, and the sweep deletes it from
// both tables (plus any account this run created) straight against the API. Each THEME also
// sweeps BEFORE it starts, so theme 2 meets the same untouched month theme 1 did, and the
// `finally` sweep runs even on a thrown Playwright timeout. PATCH /prefs is still stubbed: a
// smoke does not rewrite the account's settings.
//
// THREE DEVIATIONS from the plan's draft, each forced by what lanes C/D actually shipped and
// each keeping the plan's PROOF while changing only the driving:
//   a. There is no "Save balances" / "Save spending" pair. Lane C shipped ONE primary,
//      "Save month" on the review step, and put the decoupling inside save() (spec §4). The
//      network assertion is unchanged — it was always about the wire, not the label — and the
//      "untouched spending step" gate is read off the review step's own pre-save sentence
//      ("this save writes balances only") instead of a disabled button.
//   b. Coverage wording is checked against the LIVE /coverage of whatever book the dev
//      database holds, not against the census months in the plan (the dev book is not
//      production's). The contract under test is "the footer names each feed's latest and its
//      gaps; attention names the NEWEST missing and the NEWEST empty month" — pinning this
//      box's particular months would make the driver a fixture of the dev data rather than a
//      test of the rule.
//   c. The money-flow pending node exists only for a PARTLY entered year. The check asserts
//      the node when the wire carries one and asserts its ABSENCE when it does not, recording
//      take_home_months_entered either way.
//
// Needs the dev stack (uvicorn 127.0.0.1:8000 WITHOUT --reload — restart it after the backend
// lanes merged, the 2026-09-04 trap in tools/probes/README.md — and vite on APP_BASE) and a
// JWT in TOKEN_FILE minted with POST /api/v1/auth/login using the DEV seed credentials.
//
// Env: SMOKE_OUT, TOKEN_FILE, APP_BASE, API_BASE, EDGE_PATH, PLAYWRIGHT_CORE, ONLY_THEME,
// ONLY_STEP (wizard|overview|spending|projection|moneyflow|settings), SCRATCH_MONTH.
//
// The first two lines spoof the node version: this box runs node 18, playwright-core wants 20.
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
const out = process.env.SMOKE_OUT ?? path.join(repo, 'scratchpad', 'honest-smoke')
mkdirSync(out, { recursive: true })
const TOKEN = readFileSync(process.env.TOKEN_FILE ?? path.join(out, 'token.txt'), 'utf8').trim()
const BASE = process.env.APP_BASE ?? 'http://localhost:5173'
const API = process.env.API_BASE ?? 'http://127.0.0.1:8000'
const EDGE =
  process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const SCRATCH = process.env.SCRATCH_MONTH ?? '2019-01-01'
const VIEWPORT = { width: 1600, height: 1100 }
const SETTLE = 1400 // 450ms entrance + a refetch beat
const THEMES = ['dark', 'light'].filter(
  (t) => !process.env.ONLY_THEME || t === process.env.ONLY_THEME,
)
const STEPS = ['wizard', 'overview', 'spending', 'projection', 'moneyflow', 'settings'].filter(
  (s) => !process.env.ONLY_STEP || s === process.env.ONLY_STEP,
)
const NOISE =
  /favicon|DevTools|\[vite\]|@vite\/client|Download the React DevTools|React Router Future Flag/i

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// The app's own formatMonth (src/utils/format.ts) — never `new Date(iso)`, which shifts
// first-of-month back a day in negative offsets.
const formatMonth = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`
const literal = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

// The app's own windowWords (src/components/overview/ytd.ts): a window inside ONE year drops
// the year from both ends, so "Jan 2025 – Dec 2025" prints as "Jan–Dec".
const windowWords = (w) => {
  const short = (iso) => formatMonth(iso).slice(0, 3)
  if (w.from.slice(0, 4) !== w.to.slice(0, 4)) return `${formatMonth(w.from)}–${formatMonth(w.to)}`
  return w.from === w.to ? short(w.from) : `${short(w.from)}–${short(w.to)}`
}

const report = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  scratchMonth: SCRATCH,
  themes: THEMES,
  steps: STEPS,
  checks: [],
  writes: [],
  prefsWrites: [],
  createdAccounts: [],
  sweep: [],
  problems: [],
}
const problem = (m) => report.problems.push(m)
const check = (theme, step, name, ok, observed) => {
  report.checks.push({ theme, step, name, ok, observed })
  if (!ok) problem(`${theme} ${step}: ${name} — observed ${JSON.stringify(observed)}`)
  return ok
}
const note = (theme, step, name, observed) =>
  report.checks.push({ theme, step, name, ok: null, observed })
const files = []
const api = (route, init = {}) =>
  fetch(`${API}/api/v1${route}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })

// Delete the scratch month from both tables. Called before EACH theme and in the finally
// sweep: a theme never inherits the previous one's writes, and a crash never leaves them.
const sweepScratch = async (label) => {
  for (const [what, route] of [
    ['spending month', `/spending/months/${SCRATCH}`],
    ['balances month', `/net-worth/months/${SCRATCH}`],
  ]) {
    const resp = await api(route, { method: 'DELETE' })
    report.sweep.push({ label, what, route, status: resp.status })
    if (![200, 204, 404].includes(resp.status))
      problem(`sweep(${label}): ${what} ${route} answered ${resp.status} — it may survive`)
  }
}

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'],
})

try {
  const coverage = await (await api('/coverage')).json()
  report.coverageBefore = coverage
  if ((coverage.spending ?? []).includes(SCRATCH) || (coverage.balances ?? []).includes(SCRATCH))
    problem(`preflight: ${SCRATCH} already carries real data — pick another SCRATCH_MONTH`)

  for (const theme of THEMES) {
    if (STEPS.includes('wizard')) await sweepScratch(`before ${theme}`)
    const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })
    await ctx.addInitScript(
      ([token, th]) => {
        localStorage.setItem('finance_token', token)
        localStorage.setItem('finance.theme', th)
        localStorage.setItem('finance.chartDecals', 'off')
      },
      [TOKEN, theme],
    )
    const where = { theme, step: 'boot' }
    const themeEntry = { value: theme, updated_at: new Date().toISOString() }
    await ctx.route('**/api/v1/prefs*', async (route) => {
      const request = route.request()
      if (request.method() === 'GET') {
        let body = { prefs: {} }
        try {
          body = await (await route.fetch()).json()
        } catch (e) {
          problem(`${theme} ${where.step}: GET /prefs unreadable (${e.message})`)
        }
        body.prefs = { ...body.prefs, theme: themeEntry }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(body),
        })
      }
      report.prefsWrites.push({ ...where, method: request.method() })
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ prefs: { theme: themeEntry } }),
      })
    })

    const page = await ctx.newPage()
    const errors = []
    page.on('console', (m) => {
      if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(m.text())
    })
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('request', (r) => {
      const m = r.method()
      if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return
      const body = r.postData() || ''
      report.writes.push({
        ...where,
        method: m,
        url: r.url(),
        // The report keeps a readable prefix; the flag is decided on the WHOLE body, which
        // for a 19-category month carries confirm_zero long past 300 characters.
        confirmZero: /"confirm_zero"\s*:\s*true/.test(body),
        body: body.slice(0, 300),
      })
    })
    const drain = (step) => {
      if (errors.length) {
        problem(`${theme} ${step}: console — ${errors.join(' | ')}`)
        errors.length = 0
      }
    }
    const shot = async (name) => {
      const file = path.join(out, `${theme}-${name}.png`)
      await page.screenshot({ path: file, fullPage: true })
      files.push(path.basename(file))
    }
    const go = async (url) => {
      await page.goto(BASE + url, { waitUntil: 'networkidle' })
      await page.waitForTimeout(SETTLE)
    }
    const savePrimary = () =>
      page.getByRole('button', { name: /^(Save month|Retry spending)$/ }).click()

    // --- wizard ---------------------------------------------------------------------
    if (STEPS.includes('wizard')) {
      where.step = 'wizard'
      const before = report.writes.length
      await go(`/update?month=${SCRATCH}`)

      // (1) A derived parent row is read-only and shows the live sum. Checked here, on the
      //     balances step, which is where those rows live.
      // `.entry-derived` is the <tr> itself (MonthlyUpdatePage.tsx), not a cell inside one.
      const derived = page.locator('tr.entry-derived').first()
      if (await derived.count()) {
        const row = await derived.innerText()
        check(
          theme,
          'wizard',
          'a derived parent row has no editable input',
          (await derived.locator('input').count()) === 0,
          row,
        )
        check(theme, 'wizard', 'the derived row is badged "derived"', /derived/i.test(row), row)
      } else {
        note(theme, 'wizard', 'no parent-with-components in the dev book — branch skipped', 0)
      }

      // (2) Touch ONE balance, walk to review without entering any spending, and save.
      //     One balances PUT, zero spending PUTs — the decoupling, on the wire.
      const cell = page.locator('input[data-entry-cell]').first()
      await cell.fill('1234.56')
      await cell.blur()
      await shot('wizard-balances')
      await page.getByRole('button', { name: /^Next: spending$/ }).click()
      await page.waitForTimeout(SETTLE)

      // (3) The $0 door is shut by default.
      const zero = page.getByRole('checkbox', { name: /Record this month as \$0/i })
      check(
        theme,
        'wizard',
        'the $0 checkbox is unchecked by default',
        (await zero.count()) === 1 && !(await zero.isChecked()),
        await zero.count(),
      )
      check(
        theme,
        'wizard',
        'the $0 checkbox explains itself',
        /Writes \$0\.00 for every category — use it for a month you truly spent nothing\./.test(
          await page.locator('main').innerText(),
        ),
        null,
      )
      await page.getByRole('button', { name: /^Next: review$/ }).click()
      await page.waitForTimeout(SETTLE)
      // Deviation (a): lane C states the decoupling in prose on the review step.
      const reviewText = await page.locator('main').innerText()
      check(
        theme,
        'wizard',
        'the review step warns that an untouched spending step writes balances only',
        /Spending: nothing entered — this save writes balances only\./.test(reviewText),
        (reviewText.match(/Spending:[^\n]*/) ?? [null])[0],
      )
      await savePrimary()
      await page.waitForTimeout(SETTLE)
      const fresh = report.writes.slice(before)
      check(
        theme,
        'wizard',
        'the balances leg writes balances only — no spending PUT',
        fresh.filter((w) => /net-worth\/months/.test(w.url)).length === 1 &&
          fresh.filter((w) => /spending\/months/.test(w.url)).length === 0,
        fresh.map((w) => `${w.method} ${new URL(w.url).pathname}`),
      )
      await shot('wizard-balances-saved')

      // (4) The $0 door, taken deliberately.
      await go(`/update?month=${SCRATCH}&step=spending`)
      await page.getByRole('checkbox', { name: /Record this month as \$0/i }).check()
      await shot('wizard-zero-checked')
      await page.getByRole('button', { name: /^Next: review$/ }).click()
      await page.waitForTimeout(SETTLE)
      const mark = report.writes.length
      await savePrimary()
      await page.waitForTimeout(SETTLE)
      const zeroPut = report.writes.slice(mark).find((w) => /spending\/months/.test(w.url))
      check(
        theme,
        'wizard',
        'the $0 save carries confirm_zero:true',
        zeroPut?.confirmZero === true,
        zeroPut?.body ?? null,
      )
      await shot('wizard-zero-saved')

      // (5) The repair banner on the month it just emptied.
      await go(`/update?month=${SCRATCH}&step=spending`)
      const banner = page
        .locator('.feed-banner, [role="status"], [role="alert"]')
        .filter({ hasText: /saved with no spending/i })
      check(
        theme,
        'wizard',
        'an empty month shows the repair banner',
        (await banner.count()) > 0,
        (await banner.count()) ? await banner.first().innerText() : null,
      )
      check(
        theme,
        'wizard',
        'the banner offers the delete door',
        (await page.getByRole('button', { name: /Delete the empty month/i }).count()) > 0,
        null,
      )
      await shot('wizard-repair-banner')
      drain('wizard')
    }

    // What the pages should say NOW — re-read, because the wizard just moved the book.
    const cov = await (await api('/coverage')).json()
    const latest = cov.latest ?? {}
    const inWindow = (m) =>
      (cov.balances ?? []).length > 0 &&
      m >= cov.balances[0] &&
      m <= cov.balances[cov.balances.length - 1]
    const newestMissing = [...(cov.spending_missing ?? [])].sort().pop() ?? null
    const newestEmpty = [...(cov.spending_empty ?? [])].filter(inWindow).sort().pop() ?? null

    // --- overview -------------------------------------------------------------------
    if (STEPS.includes('overview')) {
      where.step = 'overview'
      await go('/')
      const body = await page.locator('main').innerText()
      const clauses = [
        latest.balances
          ? `Balances through ${formatMonth(latest.balances)}`
          : 'Balances — no months',
        latest.spending
          ? `Spending through ${formatMonth(latest.spending)}`
          : 'Spending — no months',
        latest.net_pay ? `Net pay through ${formatMonth(latest.net_pay)}` : 'Net pay — no months',
      ]
      check(theme, 'overview', 'the footer names each feed and where it stands', clauses.every((c) => body.includes(c)), {
        want: clauses,
        got: (body.match(/Balances[^\n]*/) ?? [null])[0],
      })
      if (newestMissing) {
        const want = `${formatMonth(newestMissing)} spending was never entered`
        check(theme, 'overview', 'attention names the newest never-entered month', literal(want).test(body), want)
      } else {
        note(theme, 'overview', 'no missing month in the book — item not expected', null)
      }
      if (newestEmpty) {
        const want = `${formatMonth(newestEmpty)} was saved with no spending`
        check(theme, 'overview', 'attention names the newest empty month', literal(want).test(body), want)
      } else {
        note(theme, 'overview', 'no windowed empty month in the book — item not expected', null)
      }
      // The YTD facts. A fact whose figure is "—" (nothing entered for this year yet) has no
      // window to name, so the words are asserted only where there IS a figure — the claim
      // under test is "a printed YTD figure always says which months it covers".
      const facts = await Promise.all(
        (await page.locator('.ytd-fact').all()).map(async (f) =>
          (await f.innerText()).replace(/\s+/g, ' ').trim(),
        ),
      )
      for (const label of ['SPEND', 'SAVED']) {
        const text = facts.find((t) => t.toUpperCase().startsWith(label))
        if (text === undefined) {
          check(theme, 'overview', `the YTD card carries a ${label} fact`, false, facts)
        } else if (/—/.test(text)) {
          note(theme, 'overview', `${label} has nothing entered this year — no window to name`, text)
        } else {
          check(
            theme,
            'overview',
            `the YTD ${label} figure names the months it covers`,
            /\b[A-Z][a-z]{2}(\s*[–-]\s*[A-Z][a-z]{2})?\b/.test(text.slice(label.length)),
            text,
          )
        }
      }
      await shot('overview')
      drain('overview')
    }

    // --- spending -------------------------------------------------------------------
    if (STEPS.includes('spending')) {
      where.step = 'spending'
      await go('/spending')
      const body = await page.locator('main').innerText()
      // Deviation: the legend words themselves ("Total (incl. payroll)" / "Cash") are painted
      // INTO the canvas by echarts and are unreachable from the DOM — they are pinned by
      // spendingChartOptions.test.ts's TOTAL_RATE_SERIES/CASH_RATE_SERIES instead. What a
      // browser can prove is that the card really carries BOTH rates: its accessible name
      // says so, and its Table twin has a column per rate.
      const savingsChart = page.locator('[aria-label*="savings rates" i]').first()
      check(
        theme,
        'spending',
        'the savings chart is announced as drawing both rates',
        (await savingsChart.count()) > 0 &&
          /total and cash savings rates/i.test(
            (await savingsChart.getAttribute('aria-label')) ?? '',
          ),
        (await savingsChart.count()) ? await savingsChart.getAttribute('aria-label') : null,
      )
      const savingsCard = page
        .locator('.chart-card, .card')
        .filter({ hasText: /Savings rate/i })
        .first()
      await savingsCard.getByRole('button', { name: /^Table$/ }).click()
      await page.waitForTimeout(500)
      const savingsTable = await savingsCard.locator('table').first().innerText()
      check(
        theme,
        'spending',
        'the savings table carries a cash rate column beside the total one',
        /Cash rate/i.test(savingsTable) && /Total rate/i.test(savingsTable),
        savingsTable.split('\n')[0],
      )
      await savingsCard.getByRole('button', { name: /^Table$/ }).click()
      await page.waitForTimeout(300)
      check(
        theme,
        'spending',
        'the rollup carries living / tax / transfer rows and its matched count',
        /Living spend/.test(body) &&
          /Tax paid/.test(body) &&
          /Transfers/.test(body) &&
          /Months matched/i.test(body),
        null,
      )
      check(
        theme,
        'spending',
        'the non-living badge is visible on the rollup',
        (await page.locator('.badge, .chip').filter({ hasText: /^(tax|transfer)$/i }).count()) > 0,
        null,
      )
      await shot('spending')
      drain('spending')
    }

    // --- projection -----------------------------------------------------------------
    if (STEPS.includes('projection')) {
      where.step = 'projection'
      await go('/projection')
      const body = await page.locator('main').innerText()
      const window = (await (await api('/projection')).json()).derived_window
      if (window) {
        const want = `derived over ${windowWords(window)} (${window.months} month`
        check(theme, 'projection', 'the Assumptions card prints the derived window', body.includes(want), {
          want,
          got: (body.match(/derived over[^\n]*/) ?? [null])[0],
        })
      } else {
        note(theme, 'projection', 'derived_window null (a typed knob overrides it) — echo not expected', null)
      }
      await shot('projection')
      drain('projection')
    }

    // --- money flow -----------------------------------------------------------------
    if (STEPS.includes('moneyflow')) {
      where.step = 'moneyflow'
      await go('/')
      const card = page.locator('.chart-card, .card').filter({ hasText: /Money flow/i }).first()
      await card.scrollIntoViewIfNeeded()
      await page.waitForTimeout(SETTLE)
      const box = await card.locator('canvas').first().boundingBox()
      check(theme, 'moneyflow', 'the money-flow sankey painted', !!box && box.width > 100, box)
      // Deviation (c): the pending node exists only for a PARTLY entered year, so ask the
      // wire which of the card's own year buttons has one and drive the card there. The node
      // LABEL is painted into the canvas, so the DOM proof is the card's Table twin, which
      // exports one row per node (moneyFlowOptions.test.ts pins the same string).
      const years = (
        await card.locator('.segmented button, .year-picker button').allInnerTexts()
      ).filter((t) => /^\d{4}$/.test(t.trim()))
      let partly = null
      for (const y of years) {
        const flow = await (await api(`/overview/money-flow?year=${y.trim()}`)).json()
        report.checks.push({
          theme,
          step: 'moneyflow',
          name: `wire for ${y.trim()}`,
          ok: null,
          observed: {
            entered: flow.take_home_months_entered,
            pending: flow.take_home_pending,
            renderable: flow.renderable,
          },
        })
        if (Number(flow.take_home_pending ?? 0) > 0 && flow.renderable) partly = { year: y.trim(), flow }
      }
      if (partly === null) {
        note(theme, 'moneyflow', 'no partly-entered year in the dev book — pending node not reachable', years)
        check(
          theme,
          'moneyflow',
          'no pending node is invented for a year the wire cannot price',
          !/not yet entered/i.test(await card.innerText()),
          null,
        )
      } else {
        await card.getByRole('button', { name: new RegExp(`^${partly.year}$`) }).click()
        await page.waitForTimeout(SETTLE)
        await card.getByRole('button', { name: /^Table$/ }).click()
        await page.waitForTimeout(500)
        const table = await card.locator('table').first().innerText()
        const missing = 12 - partly.flow.take_home_months_entered
        const want = `Take-home not yet entered (${missing} month${missing === 1 ? '' : 's'})`
        check(theme, 'moneyflow', 'the card carries the pending take-home node', table.includes(want), {
          year: partly.year,
          want,
          entered: partly.flow.take_home_months_entered,
          got: (table.match(/Take-home[^\n]*/) ?? [null])[0],
        })
        await shot('moneyflow-pending-table')
        await card.getByRole('button', { name: /^Table$/ }).click()
        await page.waitForTimeout(300)
      }
      await shot('moneyflow')
      drain('moneyflow')
    }

    // --- settings -------------------------------------------------------------------
    if (STEPS.includes('settings')) {
      where.step = 'settings'
      await go('/settings')
      // Lane E shipped this in CategoriesCard.tsx — the spec §8 table named
      // CategoriesPanel.tsx, a file that was never created under that name.
      const picker = page.locator('.segmented').filter({ hasText: /Living/ }).first()
      check(
        theme,
        'settings',
        'each category row carries a three-way kind picker',
        (await picker.count()) > 0 &&
          /Living[\s\S]*Tax[\s\S]*Transfer/.test(await picker.innerText()),
        (await picker.count()) ? await picker.innerText() : null,
      )
      const help = await page.locator('main').innerText()
      check(
        theme,
        'settings',
        'the picker warns that a kind applies to ALL history',
        /all history|every figure|retroactive/i.test(help),
        (help.match(/[^\n]*ALL history[^\n]*/i) ?? [null])[0],
      )
      await shot('settings-categories')
      drain('settings')
    }

    await page.close()
    await ctx.close()
  }
} finally {
  // The sweep. Runs even on a thrown Playwright timeout: the dev database goes back to what
  // it was. Only rows this run can NAME are touched.
  await sweepScratch('final')
  for (const id of report.createdAccounts) {
    const resp = await api(`/net-worth/accounts/${id}`, { method: 'DELETE' })
    report.sweep.push({ label: 'final', what: 'scratch account', id, status: resp.status })
    if (![200, 204, 404].includes(resp.status))
      problem(`sweep: account ${id} answered ${resp.status}`)
  }
  const left = await (await api(`/spending/months/${SCRATCH}`)).json().catch(() => null)
  report.sweep.push({ label: 'scratch month after sweep', exists: left?.exists ?? null })
  if (left?.exists) problem('sweep: the scratch spending month still exists after the DELETE')
  await browser.close()
}

report.files = files
writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1))
const passed = report.checks.filter((c) => c.ok === true).length
const failed = report.checks.filter((c) => c.ok === false).length
console.log(
  `\n${passed} checks passed, ${failed} failed; ${files.length} screenshots + report.json in ${out}`,
)
console.log(
  `writes recorded: ${report.writes.length} (all to ${SCRATCH}); PATCH /prefs stubbed: ${report.prefsWrites.length}; sweep: ${JSON.stringify(report.sweep)}`,
)
if (report.problems.length > 0) {
  console.error(`\n${report.problems.length} PROBLEM(S):`)
  for (const p of report.problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('HONEST SMOKE OK')
