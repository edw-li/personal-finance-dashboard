// tools/probes/budget-seed/smoke.mjs - the Budget card seed + Projection preset smoke (2026-09-07 spec).
// Recipe: tools/probes/README.md. READ-ONLY BY CONSTRUCTION: every non-GET /api/v1 call is fenced and
// answered from memory, so a click on Confirm here cannot write; the WRITE path is proven by the plan's
// API walk (seed → matrix → undo) and by the unit tests. Run it TWICE around that walk: once with budgets
// on the book (the re-seed row, the Projection preset) and once without (the empty state's action). The
// seeded run needs a book whose budgets DIFFER from the seeds — hand-set one budget at the focused month
// first — because a book seeded moments ago has nothing left to write, and the card offers no Re-seed then.
// Env: SMOKE_OUT, TOKEN_FILE, APP_BASE, API_BASE, EDGE_PATH, PLAYWRIGHT_CORE, ONLY_THEME.
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
const OUT = process.env.SMOKE_OUT ?? path.join(process.cwd(), 'scratchpad', 'budget-seed-smoke')
mkdirSync(OUT, { recursive: true })
const TOKEN = readFileSync(process.env.TOKEN_FILE ?? path.join(OUT, 'token.txt'), 'utf8').trim()
const BASE = process.env.APP_BASE ?? 'http://localhost:5173'
const API = process.env.API_BASE ?? 'http://127.0.0.1:8000'
const EDGE = process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const THEMES = ['dark', 'light'].filter((t) => !process.env.ONLY_THEME || t === process.env.ONLY_THEME)
const NOISE = /favicon|DevTools|\[vite\]|@vite\/client|React DevTools|React Router Future Flag/i
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const report = { generatedAt: new Date().toISOString(), base: BASE, themes: THEMES, checks: [], writesBlocked: [], problems: [], files: [] }
const problem = (m) => report.problems.push(m)
const check = (theme, name, ok, observed) => { report.checks.push({ theme, name, ok, observed }); if (!ok) problem(`${theme}: ${name} — observed ${JSON.stringify(observed)}`); return ok }
const note = (theme, name, observed) => report.checks.push({ theme, name, ok: null, observed })

// The book's state, read over GETs, decides which face of the card is expected.
const get = async (p) => { const r = await fetch(API + p, { headers: { Authorization: `Bearer ${TOKEN}` } }); if (!r.ok) throw new Error(`${p} → ${r.status}`); return r.json() }
const matrix = await get('/api/v1/spending/matrix')
const suggestions = await get('/api/v1/spending/budgets/suggestions')
const projection = await get('/api/v1/projection').catch((e) => ({ error: String(e) }))
const last = matrix.months.length - 1
// The card meters ACTIVE categories only, so a budget left on a retired one is not a budget it shows.
const activeIds = new Set(matrix.categories.filter((c) => c.is_active).map((c) => c.id))
const hasBudgets = matrix.series.some((s) => activeIds.has(s.category_id) && s.budgets[last] !== null)
const seedable = suggestions.suggestions.filter((s) => s.seed !== null).length
// The panel's own rule (seedCounts in src/components/spending/budgetSeed.ts): a seed whose resolved budget
// at the focused month ALREADY equals it is skipped as unchanged, so both affordances turn on `writes`, not
// on `seedable`. A book seeded moments ago has seedable > 0 and writes === 0 — and no Re-seed button.
const budgetAt = new Map(matrix.series.map((s) => [s.category_id, s.budgets[last] ?? null]))
const writes = suggestions.suggestions.filter((s) => {
  if (s.seed === null) return false
  const resolved = budgetAt.get(s.category_id) ?? null
  return resolved === null || Number(resolved) !== Number(s.seed)
}).length
const enoughHistory = (suggestions.window?.months ?? 0) >= 3
note('book', 'state', { months: matrix.months.length, focused: matrix.months[last], hasBudgets, seedable, writes, window: suggestions.window, budget_annual_spend: projection.budget_annual_spend ?? null, projectionError: projection.error ?? null })

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'] })
try {
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
    await ctx.addInitScript(([t, th]) => { localStorage.setItem('finance_token', t); localStorage.setItem('finance.theme', th); localStorage.setItem('finance.chartDecals', 'off') }, [TOKEN, theme])
    const themeEntry = { value: theme, updated_at: new Date().toISOString() }
    await ctx.route('**/api/v1/**', async (route) => { const req = route.request(); const m = req.method()
      if (/\/api\/v1\/prefs/.test(req.url())) {
        if (m === 'GET') { let body = { prefs: {} }; try { body = await (await route.fetch()).json() } catch { /* answered below */ } body.prefs = { ...body.prefs, theme: themeEntry }; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }) }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ prefs: { theme: themeEntry } }) }) }
      if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return route.continue()
      report.writesBlocked.push({ theme, method: m, url: req.url() })
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }) })
    const page = await ctx.newPage()
    const errors = []
    page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    const shot = async (name, locator) => { const file = path.join(OUT, `${theme}-${name}.png`); await (locator ? locator.screenshot({ path: file }) : page.screenshot({ path: file })); report.files.push(path.basename(file)) }

    // A. /spending — the Budget card wears the face the book calls for.
    await page.goto(BASE + '/spending', { waitUntil: 'networkidle' }); await sleep(2500)
    const card = page.locator('section.card', { has: page.locator('h2.eyebrow', { hasText: 'Budgets' }) }).first()
    check(theme, 'the Budget card is on the page', (await card.count()) === 1, await card.count())
    await card.scrollIntoViewIfNeeded(); await sleep(1200)
    if (hasBudgets) {
      const reseed = card.getByRole('button', { name: 'Re-seed from averages' })
      const expected = enoughHistory && writes > 0 ? 1 : 0
      check(theme, 'a budgeted card offers Re-seed exactly when the book can seed', (await reseed.count()) === expected, { count: await reseed.count(), enoughHistory, writes })
      if (await reseed.count()) {
        await reseed.click(); await sleep(300)
        const confirm = await card.locator('.budget-reseed-confirm').textContent().catch(() => null)
        check(theme, 'Re-seed asks first, counting rewrites and new ones', /Rewrites \d+ existing budgets? and sets \d+ new ones? from /.test(confirm ?? ''), confirm)
        await shot('spending-reseed-confirm', card)
        await card.getByRole('button', { name: 'Cancel' }).click(); await sleep(200)
        check(theme, 'Cancel puts the confirm line away', (await card.locator('.budget-reseed-confirm').count()) === 0, null)
      }
    } else {
      const start = card.getByRole('button', { name: 'Start from my averages' })
      check(theme, 'the empty card offers Start from my averages', (await start.count()) === 1, await start.count())
      const disabled = (await start.count()) ? await start.isDisabled() : null
      check(theme, 'the seed is enabled exactly when the window has three months and something to write', disabled === !(enoughHistory && writes > 0), { disabled, enoughHistory, writes })
      const hint = await card.locator('.budget-seed-hint').textContent().catch(() => null)
      check(theme, 'the hint names the effective month, or the reason', /effective from|Not yet|Nothing to seed|Loading/.test(hint ?? ''), hint)
    }
    // B. One editor open: the chips and the cue ride in the control row.
    const firstEditor = card.locator('details.budget-editor').first()
    if (await firstEditor.count()) {
      await firstEditor.evaluate((el) => { el.open = true }); await sleep(300)
      const chips = await firstEditor.locator('.budget-chip').count()
      const withFigures = suggestions.suggestions.filter((s) => s.mean !== null).length
      check(theme, 'an open editor shows suggestion chips when the book has figures', withFigures === 0 || chips >= 1, { chips, withFigures })
      note(theme, 'first editor cue', await firstEditor.locator('.budget-suggest-cue').textContent().catch(() => null))
    }
    await shot('spending-budget-card', card)
    // C. /projection — the preset shows exactly when the echo carries a budget figure.
    await page.goto(BASE + '/projection', { waitUntil: 'networkidle' }); await sleep(3000)
    const preset = page.getByRole('button', { name: /Use my budgets|using your budgets/ })
    const expectPreset = projection.budget_annual_spend != null
    check(theme, 'Projection offers Use my budgets iff the echo has budget_annual_spend', (await preset.count()) === (expectPreset ? 1 : 0), { count: await preset.count(), expectPreset, echo: projection.budget_annual_spend ?? null })
    if (expectPreset && (await preset.count())) { await preset.scrollIntoViewIfNeeded(); await sleep(400); await shot('projection-preset', page.locator('.slider-box', { has: preset }).first()) }
    if (errors.length) problem(`${theme}: console — ${errors.slice(0, 4).join(' | ')}`)
    await ctx.close()
  }
} finally {
  await browser.close()
  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
}
if (report.problems.length) { console.error('BUDGET SEED SMOKE FAILED\n' + report.problems.join('\n')); process.exit(1) }
console.log(`BUDGET SEED SMOKE OK — ${report.checks.filter((c) => c.ok === true).length} checks, ${report.writesBlocked.length} writes fenced, files: ${report.files.join(', ')}`)
