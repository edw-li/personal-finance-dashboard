// tools/probes/sandbox-v/smoke.mjs — the planning-sandbox browser smoke (sandbox lane V Task 3,
// 2026-09-03 planning-sandboxes spec §15 step 4). How to run it: see tools/probes/README.md.
//
// What it proves, against the REAL app (real router, real echarts, real dev data, headless
// Edge) rather than jsdom:
//   1. Each of the three sandboxes OPENS FROM A LINK. A `whatif=` URL is the state, so the
//      only honest test of arrival is a browser that was handed one: the card is open, the
//      entries are on the knobs, and a preview has already run before anyone touched a
//      control. jsdom can assert the same reducer; it cannot prove the address bar.
//   2. The URL is written on RELEASE, not on every drag frame. A slider is dragged in real
//      pointer events and the address bar is sampled mid-drag: a history entry per frame is
//      the defect this catches, and it is invisible to a fireEvent test.
//   3. NOTHING IS PERSISTED. Every mutating request the page attempts is matched against a
//      short allowlist of the pure preview routes; anything else is ABORTED and recorded as a
//      problem, so a mis-driven button cannot write to the dev database and a sandbox that
//      grew a write is caught rather than trusted. `PATCH /prefs` is stubbed for the same
//      reason (the charts smoke once wrote `theme: dark` into the account before it was), and
//      every window.confirm is DISMISSED — the Apply doors are walked up to their question
//      and no further.
//   4. Both themes render every panel with no console error, no pageerror, no failed request.
//
// Needs the dev stack up (uvicorn on 127.0.0.1:8000, vite on APP_BASE) and a JWT in TOKEN_FILE
// — mint one with `POST /api/v1/auth/login`. The token and the theme are seeded into
// localStorage BEFORE first paint (addInitScript), because the app boots its auth out of
// there. Screenshots and report.json land in SMOKE_OUT.
//
// Env overrides: SMOKE_OUT, TOKEN_FILE, APP_BASE, EDGE_PATH, PLAYWRIGHT_CORE, ONLY_THEME,
// ONLY_STEP (paycheck|taxes|projection|assistant), SKIP_ASSISTANT, TICKER, ESPP_LOT,
// RETIRE_PERSON.
//
// Exits 1 listing every `problems` entry; prints `SANDBOX SMOKE OK` when there are none.
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
const out = process.env.SMOKE_OUT ?? path.join(repo, 'scratchpad', 'sandbox-smoke')
mkdirSync(out, { recursive: true })
const TOKEN = readFileSync(process.env.TOKEN_FILE ?? path.join(out, 'token.txt'), 'utf8').trim()
const BASE = process.env.APP_BASE ?? 'http://localhost:5173'
const EDGE =
  process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const VIEWPORT = { width: 1600, height: 1100 }
// The entrance animation is 450ms and every page fires a refetch beat behind it; a sandbox
// then debounces its preview by 400ms on top.
const SETTLE = 1800
const TICKER = process.env.TICKER ?? 'NVDA'
const ESPP_LOT = process.env.ESPP_LOT ?? '11'
const RETIRE_PERSON = process.env.RETIRE_PERSON ?? '2'

const THEMES = ['dark', 'light'].filter(
  (t) => !process.env.ONLY_THEME || t === process.env.ONLY_THEME,
)
const STEPS = ['paycheck', 'taxes', 'projection', 'assistant'].filter(
  (s) =>
    (!process.env.ONLY_STEP || s === process.env.ONLY_STEP) &&
    !(s === 'assistant' && process.env.SKIP_ASSISTANT),
)

// Browser chatter that is never a defect — the same list the charts smoke filters, plus the
// HMR socket (`@vite/client` dials ws://localhost while vite listens on [::1] only).
const NOISE =
  /favicon|DevTools|\[vite\]|@vite\/client|Download the React DevTools|React Router Future Flag/i

// Dev-data facts that look like errors and are not. RECORDED under knownBenign — never
// silently dropped — so a real regression hiding behind one stays visible.
const BENIGN = [
  {
    id: 'paycheck-profile-404',
    why: 'KNOWN NON-DEFECT: a viewed person has no paycheck profile in the dev DB, so /paycheck/* 404s and the page shows its own empty state.',
    test: (e) =>
      /\/api\/v1\/paycheck\b/.test(e.url) && /\b404\b|Not Found/i.test(`${e.text} ${e.url}`),
  },
  {
    id: 'portfolio-joint-empty',
    why: 'KNOWN NON-DEFECT: owner=joint holds no positions in the dev DB.',
    test: (e) => /owner=joint/.test(`${e.text} ${e.url}`),
  },
  {
    id: 'projection-retire-422',
    why: 'DELIBERATE: the projection step opens a link this book refuses (the partner holds no paycheck profile) to walk the frame Retry that drops refused entries. The 422 IS the step.',
    test: (e) => /\/api\/v1\/projection\b.*retire=/.test(e.url) && /\b422\b/.test(e.text),
  },
]

// The ONLY mutating requests a sandbox walk may make. Everything else is aborted before it
// reaches the server: a smoke walks, it never writes. `/prefs` is here because it is stubbed
// below (the fulfil happens in its own handler); the previews are the pure endpoints the
// purity test already guards server-side (backend/tests/test_sandbox_purity.py).
const WRITE_ALLOW = [
  /\/api\/v1\/auth\/login$/,
  /\/api\/v1\/paycheck\/preview$/,
  /\/api\/v1\/taxes\/what-if$/,
  /\/api\/v1\/assistant\/chat$/,
  /\/api\/v1\/prefs\b/,
]

const report = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  viewport: VIEWPORT,
  themes: THEMES,
  steps: STEPS,
  fixtures: { ticker: TICKER, esppLot: ESPP_LOT, retirePerson: RETIRE_PERSON },
  checks: [],
  dialogs: [],
  blockedWrites: [],
  prefsWrites: [],
  knownBenign: [],
  problems: [],
}
const problem = (msg) => report.problems.push(msg)
const files = []
const wrote = (file) => {
  files.push(path.basename(file))
  return file
}

// One check = one named assertion with its observed value, so report.json reads as evidence
// rather than as a pass/fail bit.
const check = (theme, step, name, ok, observed) => {
  report.checks.push({ theme, step, name, ok, observed })
  if (!ok) problem(`${theme} ${step}: ${name} — observed ${JSON.stringify(observed)}`)
  return ok
}
// A fact worth reading that is not a pass/fail (dev-data conditions, recorded values).
const note = (theme, step, name, observed) =>
  report.checks.push({ theme, step, name, ok: null, observed })

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
      localStorage.setItem('finance.chartDecals', 'off')
    },
    [TOKEN, theme],
  )
  const where = { theme, step: 'boot' }

  // The write fence (see WRITE_ALLOW). An aborted request surfaces as a requestfailed too, so
  // the abort itself is what the report names — the console noise it makes is expected.
  //
  // REGISTERED FIRST ON PURPOSE: playwright runs the LAST-matching handler and `continue()`
  // goes straight to the network rather than falling through, so a fence registered after the
  // /prefs stub below swallows GET /prefs — the theme injection never runs and the "light"
  // pass screenshots the dark app.
  await ctx.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const method = request.method()
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue()
    if (WRITE_ALLOW.some((re) => re.test(new URL(request.url()).pathname))) return route.continue()
    report.blockedWrites.push({
      ...where,
      method,
      url: request.url(),
      body: (request.postData() || '').slice(0, 300),
    })
    problem(
      `${theme} ${where.step}: BLOCKED a write the walk must never make — ${method} ${request.url()}`,
    )
    return route.abort()
  })

  // Since 2026-09-03 the ACCOUNT owns the theme: the app paints from localStorage, then
  // GET /prefs answers and the server's value is adopted. The pass's theme is injected into
  // the ANSWER so the app adopts what the walk asked for; PATCH is stubbed rather than
  // forwarded, because a smoke does not get to rewrite the account's settings.
  const stamp = new Date().toISOString()
  const themeEntry = { value: theme, updated_at: stamp }
  await ctx.route('**/api/v1/prefs*', async (route) => {
    const request = route.request()
    if (request.method() === 'GET') {
      let body = { prefs: {} }
      try {
        body = await (await route.fetch()).json()
      } catch (e) {
        problem(`${theme} ${where.step}: GET /prefs could not be read (${e.message})`)
      }
      body.prefs = { ...body.prefs, theme: themeEntry }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      })
    }
    report.prefsWrites.push({
      ...where,
      method: request.method(),
      body: (request.postData() || '').slice(0, 200),
    })
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ prefs: { theme: themeEntry } }),
    })
  })

  const page = await ctx.newPage()

  // Every confirm is DISMISSED and its text recorded: the Apply doors are walked up to their
  // question, which is exactly as far as a smoke is allowed to go.
  page.on('dialog', async (d) => {
    report.dialogs.push({ ...where, type: d.type(), message: d.message().slice(0, 600) })
    await d.dismiss()
  })

  const errors = []
  const warnings = []
  const http = []
  const take = (entry) => {
    if (NOISE.test(entry.text) || NOISE.test(entry.url)) return
    // A request this walk aborted on purpose is not a page defect; the abort is already a
    // problem in its own right when it happens.
    if (report.blockedWrites.some((b) => b.url === entry.url)) return
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

  const drain = (step) => {
    const tail = errors.splice(0)
    for (const e of tail) {
      problem(`${theme} ${step}: ${e.kind} ${e.text}${e.url ? ` <${e.url}>` : ''}`)
    }
    report.checks.push({
      theme,
      step,
      name: '_logs',
      ok: null,
      observed: { warnings: warnings.splice(0), http: http.splice(0) },
    })
    return tail.length
  }

  const themed = new Set()
  const visit = async (route, step) => {
    where.step = step
    try {
      await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 45000 })
    } catch {
      await page.goto(BASE + route, { waitUntil: 'load', timeout: 45000 })
    }
    await page.waitForTimeout(SETTLE)
    if (/\/login/.test(page.url())) {
      problem(
        `${theme} ${step}: bounced to ${page.url()} — the seeded finance_token did not authenticate`,
      )
    }
    // Once per step: a pass that silently painted the other theme would screenshot the same
    // page twice and call it "both themes" (the charts smoke's own trap).
    if (!themed.has(step)) {
      themed.add(step)
      const applied = await page.evaluate(() => document.documentElement.dataset.theme ?? null)
      check(theme, step, 'the page really is painting this theme', applied === theme, applied)
    }
  }
  // The address bar, decoded, so an entry reads as `trad_401k_pct:0.15` rather than %3A.
  const url = () => {
    const u = new URL(page.url())
    return decodeURIComponent(u.pathname + u.search)
  }
  const shot = async (name) => {
    await page.screenshot({ path: wrote(path.join(out, `${theme}-${name}.png`)), fullPage: true })
  }
  const card = page.locator('section.sandbox-card')
  // The header ACTIONS' toggle, not `card button[aria-expanded]`: the InfoHint beside the
  // eyebrow is also an aria-expanded button and comes first in document order.
  const toggle = card.locator('.sandbox-header-actions button[aria-expanded]').first()
  const isOpen = async () => (await toggle.getAttribute('aria-expanded')) === 'true'
  // Every label on screen is upper-cased by the house CSS, so innerText comes back shouting:
  // compare case-insensitively or every heading check reads as a defect.
  const has = (list, text) => list.some((l) => new RegExp(text, 'i').test(l))
  const presets = card.locator('div[role="group"][aria-label="Presets"] button')

  // ---------------------------------------------------------------- Paycheck: Try it
  if (STEPS.includes('paycheck')) {
    const step = 'paycheck'
    await visit('/paycheck?whatif=trad_401k_pct%3A0.15&whatif=hsa_per_check%3A250', step)

    check(theme, step, 'the card arrived OPEN', await isOpen(), await toggle.innerText())
    check(
      theme,
      step,
      'a preview ran before any control was touched',
      (await card.locator('table.compare-table').count()) > 0,
      { tables: await card.locator('table.compare-table').count() },
    )
    const heads = await card.locator('table.compare-table thead th').allInnerTexts()
    check(
      theme,
      step,
      'the compare table shows Baseline · Scenario · Δ',
      ['Baseline', 'Scenario', 'Δ'].every((h) => has(heads, h)),
      heads,
    )
    check(
      theme,
      step,
      'the pace strip is under the table',
      (await page.locator('section[role="region"][aria-label="Contribution pace"]').count()) > 0,
      null,
    )
    // The boxes are AmountInputs: unfocused they show canonical text ("15%", "$250.00"), so
    // the assertion is on the NUMBER, not on the wire string.
    const tradBox = card.locator('input[aria-label="Traditional 401(k)"]')
    const hsaBox = card.locator('input[aria-label="HSA per check"]')
    const knobs = { trad: await tradBox.inputValue(), hsa: await hsaBox.inputValue() }
    check(
      theme,
      step,
      'the URL entries are on the knobs',
      /\b15\b/.test(knobs.trad) && /\b250\b/.test(knobs.hsa),
      knobs,
    )
    const chips = await card.locator('.delta-chip').allInnerTexts()
    check(
      theme,
      step,
      'the 401(k) knob wears its distance from the profile',
      chips.some((c) => /pp$/.test(c)),
      chips.slice(0, 6),
    )

    // --- the drag: real pointer events, with the address bar AND the history depth sampled
    //     mid-gesture. The contract is not "the URL holds still" — a drag debounces at 400ms,
    //     so a slow one does rewrite the address bar — it is that every write is a REPLACE:
    //     history never grows, so the back button leaves the page instead of replaying slider
    //     positions (README, spec §8.2). Depth is the observable that says which one happened.
    const slider = card.locator('input[type="range"][aria-label="Traditional 401(k) slider"]')
    // boundingBox() is viewport-relative and page.mouse takes viewport coordinates: without
    // this scroll the card sits below the fold and every "drag" lands on whatever is at those
    // coordinates instead — a silent no-op that reads as "release did not commit".
    await slider.scrollIntoViewIfNeeded()
    await page.waitForTimeout(400)
    const box = await slider.boundingBox()
    const before = url()
    if (box === null) {
      problem(`${theme} ${step}: the 401(k) slider has no box to drag`)
    } else {
      const depth = () => page.evaluate(() => window.history.length)
      const depthBefore = await depth()
      await page.mouse.move(box.x + box.width * 0.15, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2, { steps: 8 })
      await page.waitForTimeout(500)
      const midDrag = url()
      const depthMid = await depth()
      await page.mouse.move(box.x + box.width * 0.45, box.y + box.height / 2, { steps: 8 })
      await page.waitForTimeout(500)
      const midDrag2 = url()
      await page.mouse.up()
      await page.waitForTimeout(SETTLE)
      const depthAfter = await depth()
      check(
        theme,
        step,
        'a drag adds no history entries — every write is a replace',
        depthMid === depthBefore && depthAfter === depthBefore,
        { depthBefore, depthMid, depthAfter, before, midDrag, midDrag2 },
      )
      note(theme, step, 'the debounced mid-drag rewrites (replace-style, by design)', {
        before,
        midDrag,
        midDrag2,
      })
      check(theme, step, 'release commits the drag to the URL', url() !== before, {
        before,
        after: url(),
        sliderValue: await slider.inputValue(),
      })
      check(
        theme,
        step,
        'the table came back after the drag',
        (await card.locator('table.compare-table').count()) > 0,
        null,
      )
    }

    // --- Max 401(k): with no elective limit stored for the year the chip is DISABLED and
    //     says so in its title. Both branches are walked; which one ran is recorded.
    const max401 = presets.filter({ hasText: 'Max 401(k)' }).first()
    if ((await max401.count()) === 0) {
      problem(`${theme} ${step}: no "Max 401(k)" preset chip`)
    } else if (await max401.isDisabled()) {
      const title = await max401.getAttribute('title')
      check(
        theme,
        step,
        'a disabled Max 401(k) says which limit to enter and where',
        typeof title === 'string' && /limit|Settings/i.test(title),
        title,
      )
      note(
        theme,
        step,
        'DEV-DATA: no 401(k) elective limit for this year, so Max 401(k) is disabled',
        title,
      )
    } else {
      await max401.click()
      await page.waitForTimeout(SETTLE)
      check(
        theme,
        step,
        'Max 401(k) writes a computed percentage into the URL',
        /trad_401k_pct:/.test(url()),
        url(),
      )
    }

    // --- pin, reload, and watch the pinned column re-run.
    await card.locator('input[aria-label="Pin label"]').fill('Smoke pin')
    await card.locator('button', { hasText: 'Pin this scenario' }).first().click()
    await page.waitForTimeout(SETTLE)
    check(
      theme,
      step,
      'the pin appears as a chip',
      (await card.locator('.sandbox-pin-chip').count()) > 0,
      await card.locator('.sandbox-pin-chip').allInnerTexts(),
    )
    check(theme, step, 'the pin is NOT in the link', !/Smoke pin/.test(url()), url())
    const pinnedUrl = url()
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(SETTLE)
    const headsAfter = await card.locator('table.compare-table thead th').allInnerTexts()
    check(
      theme,
      step,
      'the pinned column survives a reload and re-runs',
      has(headsAfter, 'Smoke pin'),
      headsAfter,
    )
    check(theme, step, 'the reload kept the scenario', url() === pinnedUrl, {
      pinnedUrl,
      after: url(),
    })
    await shot('paycheck-tryit')

    // --- Apply: the seed pre-fills the profile form and focuses the date box. The form's own
    //     Add profile is NEVER clicked — the write fence would abort it anyway.
    const apply = card.locator('button', { hasText: 'Save as profile effective' }).first()
    check(
      theme,
      step,
      'the Apply door names the effective date it would seed',
      (await apply.count()) > 0,
      await apply.innerText().catch(() => null),
    )
    await apply.click()
    await page.waitForTimeout(SETTLE)
    const focused = await page.evaluate(() => document.activeElement?.id ?? null)
    check(
      theme,
      step,
      'Apply focuses the profile form date box',
      focused === 'paycheck-effective-date',
      focused,
    )
    const seeded = await page.evaluate(() => {
      const el = document.getElementById('paycheck-effective-date')
      return el instanceof HTMLInputElement ? el.value : null
    })
    check(
      theme,
      step,
      'the seeded date box carries a date',
      typeof seeded === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(seeded),
      seeded,
    )
    await shot('paycheck-apply-seed')
    drain(step)
  }

  // ---------------------------------------------------------------- Taxes: What if
  if (STEPS.includes('taxes')) {
    const step = 'taxes'
    // The legacy ticker alias: `?whatif=NVDA` must rewrite itself into the wire vocabulary.
    await visit(`/taxes?whatif=${TICKER}`, step)
    check(
      theme,
      step,
      'the legacy ?whatif=TICKER alias rewrites into a sale leg',
      /whatif=sale:\d+/.test(url()),
      url(),
    )
    check(theme, step, 'the card arrived OPEN', await isOpen(), await toggle.innerText())
    const rows = await card.locator('table.compare-table tbody tr').count()
    check(theme, step, 'the ten-row compare is showing', rows === 10, rows)
    check(
      theme,
      step,
      'there is no Run button — the panel runs itself',
      (await card.locator('button', { hasText: /^Run$/ }).count()) === 0,
      null,
    )

    // --- type a share count and blur; the tiles and the table follow with no Run.
    const shares = card.locator('input[aria-label*="shares"]').first()
    if ((await shares.count()) === 0) {
      problem(`${theme} ${step}: no share-count box on the sale leg`)
    } else {
      note(theme, step, 'the share box the walk drove', await shares.getAttribute('aria-label'))
      const totalBefore = await card.locator('table.compare-table tbody tr').last().innerText()
      const urlBefore = url()
      await shares.fill('12')
      await shares.blur()
      await page.waitForTimeout(SETTLE)
      check(
        theme,
        step,
        'a typed share count reaches the URL on blur',
        /whatif=sale:\d+:12/.test(url()),
        { before: urlBefore, after: url() },
      )
      const totalAfter = await card.locator('table.compare-table tbody tr').last().innerText()
      check(
        theme,
        step,
        'the compare table re-ran without a Run button',
        totalAfter !== totalBefore,
        { totalBefore: totalBefore.slice(0, 90), totalAfter: totalAfter.slice(0, 90) },
      )
    }

    // --- an override, then Max 401(k) on it.
    const addOverride = card.locator('button', { hasText: 'Add override' }).first()
    if ((await addOverride.count()) === 0) {
      problem(`${theme} ${step}: no "Add override" button`)
    } else {
      await addOverride.click()
      await page.waitForTimeout(600)
      const select = card.locator('select').last()
      const options = await select.locator('option').evaluateAll((els) => els.map((e) => e.value))
      const wanted = options.includes('trad_401k_contributions')
        ? 'trad_401k_contributions'
        : options.find((v) => v !== '')
      note(theme, step, 'the override key the walk chose', wanted)
      if (wanted !== undefined) {
        await select.selectOption(wanted)
        await page.waitForTimeout(600)
      }
      const max401 = presets.filter({ hasText: 'Max 401(k)' }).first()
      if ((await max401.count()) === 0) {
        note(theme, step, 'no Max 401(k) chip on this year', null)
      } else if (await max401.isDisabled()) {
        const title = await max401.getAttribute('title')
        check(
          theme,
          step,
          'a disabled Max 401(k) says which limit to enter and where',
          typeof title === 'string' && /limit|Settings/i.test(title),
          title,
        )
        note(
          theme,
          step,
          'DEV-DATA: no 401(k) elective limit for this year, so Max 401(k) is disabled',
          title,
        )
      } else {
        await max401.click()
        await page.waitForTimeout(SETTLE)
        check(
          theme,
          step,
          'Max 401(k) fills the override row from Settings › Limits',
          /trad_401k_contributions:/.test(url()),
          url(),
        )
      }
      // Give the override a value by hand so the Apply door opens even with no stored limit.
      const overrideBox = card.locator('input[aria-label*="verride"]').last()
      if ((await overrideBox.count()) > 0) {
        await overrideBox.fill('12000')
        await overrideBox.blur()
        await page.waitForTimeout(SETTLE)
      }
    }
    await shot('taxes-whatif')

    // --- Apply: the confirm must list before → after, and it is CANCELLED.
    const applyBtn = card.locator('button', { hasText: /^Apply \d+ override/ }).first()
    if ((await applyBtn.count()) === 0) {
      note(theme, step, 'no Apply door (the override never took a value on this data)', url())
    } else {
      const dialogsBefore = report.dialogs.length
      const writesBefore = report.blockedWrites.length
      await applyBtn.click()
      await page.waitForTimeout(1400)
      const fired = report.dialogs.slice(dialogsBefore)
      check(
        theme,
        step,
        'Apply asks before it writes, and the question lists before → after',
        fired.length > 0 && /→/.test(fired[0].message),
        fired.map((d) => d.message.slice(0, 220)),
      )
      check(
        theme,
        step,
        'cancelling the confirm writes nothing',
        report.blockedWrites.length === writesBefore,
        report.blockedWrites.slice(writesBefore),
      )
    }

    // --- pin, then switch the year; the pinned column re-runs against the new year.
    await card.locator('input[aria-label="Pin label"]').fill('Smoke tax pin')
    await card.locator('button', { hasText: 'Pin this scenario' }).first().click()
    await page.waitForTimeout(SETTLE)
    check(
      theme,
      step,
      'the tax pin appears as a chip',
      (await card.locator('.sandbox-pin-chip').count()) > 0,
      await card.locator('.sandbox-pin-chip').allInnerTexts(),
    )
    const yearChips = page.locator('.chip-row button.chip')
    const years = await yearChips.allInnerTexts()
    const selected = await yearChips
      .locator('xpath=self::button[@aria-pressed="true"]')
      .first()
      .innerText()
      .catch(() => null)
    const otherYear = years.find((y) => /^\d{4}$/.test(y) && y !== selected)
    if (otherYear === undefined) {
      note(theme, step, 'only one year on the page — no year switch to walk', years)
    } else {
      await yearChips
        .filter({ hasText: new RegExp(`^${otherYear}$`) })
        .first()
        .click()
      await page.waitForTimeout(SETTLE + 1400)
      const headsY = await card.locator('table.compare-table thead th').allInnerTexts()
      check(
        theme,
        step,
        'the pinned column re-runs against the switched year',
        has(headsY, 'Smoke tax pin'),
        { from: selected, to: otherYear, heads: headsY },
      )
      check(
        theme,
        step,
        'the year switch is in the URL and the entries rode along',
        /year=/.test(url()) && /whatif=/.test(url()),
        url(),
      )
    }
    await shot('taxes-pin-year')

    // --- the ESPP lot alias.
    await visit(`/taxes?whatif-lot=${ESPP_LOT}`, step)
    check(
      theme,
      step,
      'the legacy ?whatif-lot= alias rewrites into an espp leg',
      /whatif=espp:\d+/.test(url()),
      url(),
    )
    check(
      theme,
      step,
      'the card arrived OPEN from the lot link',
      await isOpen(),
      await toggle.innerText(),
    )

    // --- the assistant's own link shape: ?year= arrives with entries and is honoured.
    const linkYear =
      (await page.locator('.chip-row button.chip').allInnerTexts()).filter((y) =>
        /^\d{4}$/.test(y),
      )[0] ?? '2026'
    await visit(`/taxes?year=${linkYear}&whatif=qualified_dividends%3A2500`, step)
    check(
      theme,
      step,
      'a ?year= link picks the year AND runs the entries against it',
      new RegExp(`year=${linkYear}`).test(url()) && /whatif=qualified_dividends:2500/.test(url()),
      url(),
    )
    check(
      theme,
      step,
      'the card arrived OPEN from the assistant-shaped link',
      await isOpen(),
      await toggle.innerText(),
    )
    check(
      theme,
      step,
      'the ?year= link ran its scenario',
      (await card.locator('table.compare-table').count()) > 0,
      null,
    )
    await shot('taxes-year-link')
    drain(step)
  }

  // ---------------------------------------------------------------- Projection: Scenario
  if (STEPS.includes('projection')) {
    const step = 'projection'
    // --- the REFUSED link first. `retire:<person>:<month>` is 422'd on this dev book (the
    //     partner holds no paycheck profile, so there is no contribution to drop). What the
    //     browser can prove here is the SURFACE: the page keeps the derived run's figures and
    //     puts the server's sentence over them, rather than blanking — the frame's own
    //     Retry-means-reset branch needs `data === null` (no baseline either), which no link
    //     reaches on a healthy book, so ProjectionPage.test.tsx pins that one.
    await visit(
      `/projection?whatif=annual_return%3A0.06&whatif=retire%3A${RETIRE_PERSON}%3A2035-06`,
      step,
    )
    const refusal = await page
      .locator('.error-banner')
      .first()
      .innerText()
      .catch(() => null)
    if (refusal === null) {
      note(theme, step, 'this book ACCEPTS the retire entry — the refusal surface is not walked', url())
    } else {
      note(theme, step, 'DEV-DATA: the server refuses this retire entry', refusal.slice(0, 200))
      check(
        theme,
        step,
        'a refused scenario says why in a sentence rather than blanking',
        /retire|profile|person/i.test(refusal),
        refusal.slice(0, 200),
      )
      check(
        theme,
        step,
        'the refusal leaves the derived figures standing',
        (await page.locator('canvas').count()) > 0,
        await page.locator('canvas').count(),
      )
      check(
        theme,
        step,
        'a refused entry is not silently scrubbed from the link',
        /retire:/.test(url()),
        url(),
      )
      await shot('projection-refusal')
    }

    // --- then a link this book accepts, for the rest of the walk.
    await visit('/projection?whatif=annual_return%3A0.06', step)
    check(theme, step, 'the card arrived OPEN', await isOpen(), await toggle.innerText())
    const badges = await card.locator('.sandbox-badge').allInnerTexts()
    check(
      theme,
      step,
      'the untouched knobs are badged derived',
      badges.filter((b) => /derived/i.test(b)).length >= 5,
      badges,
    )
    const chips = await card.locator('.delta-chip').allInnerTexts()
    check(
      theme,
      step,
      'the return knob shows its delta against the echo',
      chips.length > 0,
      chips.slice(0, 6),
    )
    check(
      theme,
      step,
      'the scenario tiles and the compare table are drawn',
      (await card.locator('table.compare-table').count()) > 0,
      null,
    )
    check(
      theme,
      step,
      'the fan is drawn for the scenario',
      (await page.locator('canvas').count()) > 0,
      await page.locator('canvas').count(),
    )
    check(theme, step, 'the entry survived arrival', /annual_return:0.06/.test(url()), url())

    await card.locator('input[aria-label="Pin label"]').fill('Smoke proj pin')
    await card.locator('button', { hasText: 'Pin this scenario' }).first().click()
    await page.waitForTimeout(SETTLE + 1400)
    const heads = await card.locator('table.compare-table thead th').allInnerTexts()
    check(
      theme,
      step,
      'the pin joins the compare table as a column',
      has(heads, 'Smoke proj pin'),
      heads,
    )
    // The pin's dashed line is echarts canvas: the honest observable is that the investable
    // card is still painting after the pin joined it.
    note(
      theme,
      step,
      'canvas count after pinning',
      await page.locator('section.chart-card canvas').count(),
    )
    await shot('projection-scenario')

    await card
      .locator('button', { hasText: 'Reset to derived' })
      .first()
      .click()
    await page.waitForTimeout(SETTLE)
    check(theme, step, 'Reset to derived empties the URL', !/whatif=/.test(url()), url())
    check(
      theme,
      step,
      'the chart returns to the default run',
      (await page.locator('canvas').count()) > 0,
      await page.locator('canvas').count(),
    )
    await shot('projection-reset')
    drain(step)
  }

  // ---------------------------------------------------------------- Assistant: the chip
  if (STEPS.includes('assistant')) {
    const step = 'assistant'
    await visit('/taxes', step)
    const opener = page.locator('button[aria-label="Open assistant"]')
    if ((await opener.count()) === 0) {
      problem(`${theme} ${step}: no "Open assistant" button on the page`)
    } else {
      await opener.first().click()
      // The drawer's own controls, waited for rather than slept at: the catalog arrives over
      // the network, so a fixed pause reads an empty <select> on a slow beat and the walk then
      // asks the account's default model instead of the one it chose.
      const composer = page.locator('textarea[aria-label="Ask the assistant"]')
      const opened = await composer
        .waitFor({ state: 'visible', timeout: 20000 })
        .then(() => true)
        .catch(() => false)
      check(theme, step, 'the drawer opens with a composer', opened, opened)
      // A named model, because the account default is whatever was last chosen and a slow one
      // burns the whole budget on one answer. ASSISTANT_MODEL overrides; any tools-capable
      // entry works, and which one ran is recorded.
      const picker = page.locator('select.assistant-model-select')
      if ((await picker.count()) > 0) {
        await picker
          .locator('option')
          .nth(1)
          .waitFor({ state: 'attached', timeout: 20000 })
          .catch(() => {})
        const values = await picker.locator('option').evaluateAll((els) => els.map((e) => e.value))
        const wanted = process.env.ASSISTANT_MODEL ?? values.find((v) => /lightning/i.test(v))
        if (wanted !== undefined && values.includes(wanted)) await picker.selectOption(wanted)
        note(theme, step, 'the model the walk asked for', await picker.inputValue())
      }
      await composer.fill('what if I realized $2,500 of qualified dividends this year?')
      await composer.press('Enter')
      // A real model over a real network: give the tool loop a bounded budget, take the
      // drawer's own "Retry with <other model>" door once if the first answer times out, and
      // report a second timeout as "not exercised" rather than as a defect in the chip.
      const chip = page.locator('a.assistant-tool-link')
      let linkHref = null
      const waitForChip = async (ms) => {
        try {
          await chip.first().waitFor({ state: 'visible', timeout: ms })
          return await chip.first().getAttribute('href')
        } catch {
          return null
        }
      }
      linkHref = await waitForChip(150000)
      if (linkHref === null) {
        const fallback = page.locator('button', { hasText: /^Retry with / }).first()
        if ((await fallback.count()) > 0) {
          note(theme, step, 'the first answer timed out; taking the drawer\'s own fallback', await fallback.innerText())
          await fallback.click()
          linkHref = await waitForChip(150000)
        }
      }
      if (linkHref === null) {
        note(
          theme,
          step,
          'no tool link inside the budget — chip navigation NOT exercised (assistant-side, not a sandbox defect)',
          {
            transcript: await page
              .locator('[aria-label="Conversation"]')
              .innerText()
              .then((t) => t.slice(-900))
              .catch(() => null),
            toolChips: await page.locator('.assistant-tool-chip').allInnerTexts().catch(() => []),
          },
        )
      }
      await shot('assistant-drawer')
      if (linkHref !== null) {
        check(
          theme,
          step,
          'the tool chip carries an Open in What-if link',
          /whatif=/.test(linkHref),
          linkHref,
        )
        check(
          theme,
          step,
          'the chip label invites the jump',
          /What-if/i.test(await chip.first().innerText()),
          await chip.first().innerText(),
        )
        await chip.first().click()
        await page.waitForTimeout(SETTLE + 1000)
        check(
          theme,
          step,
          'the chip lands on Taxes with the entry in the URL',
          /^\/taxes/.test(new URL(page.url()).pathname) && /whatif=/.test(url()),
          url(),
        )
        check(
          theme,
          step,
          'the sandbox is open on arrival from the chip',
          await isOpen(),
          await toggle.innerText(),
        )
        await shot('assistant-arrival')
      }
    }
    drain(step)
  }

  await page.close()
  await ctx.close()
}

await browser.close()
report.files = files
writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1))
const failed = report.checks.filter((c) => c.ok === false).length
const passed = report.checks.filter((c) => c.ok === true).length
console.log(
  `\n${passed} checks passed, ${failed} failed; ${files.length} screenshots + report.json in ${out}`,
)
if (report.knownBenign.length > 0) {
  const rules = [...new Set(report.knownBenign.map((k) => k.rule))].join(', ')
  console.log(`known benign (recorded, not failed): ${rules} x${report.knownBenign.length}`)
}
console.log(
  `confirms dismissed: ${report.dialogs.length}; writes blocked: ${report.blockedWrites.length}; PATCH /prefs stubbed: ${report.prefsWrites.length}`,
)
if (report.problems.length > 0) {
  console.error(`\n${report.problems.length} PROBLEM(S):`)
  for (const p of report.problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('SANDBOX SMOKE OK')
