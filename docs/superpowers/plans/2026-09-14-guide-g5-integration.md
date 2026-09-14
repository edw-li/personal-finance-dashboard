# Lane G5 — Guide integration: palette group, fresh-database entry points, copy check, probes (2026-09-14 guide) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (one
> Opus implementer for this lane in its own worktree, TDD per task, then a spec-compliance review
> and a code-quality review, then a local merge to main — never pushed). Steps use `- [ ]`
> checkboxes.

**Spec:** `docs/superpowers/specs/2026-09-14-onboarding-guide-design.md` — this lane implements
**§6 (palette Guide group — the wiring half), §7 (fresh-database entry points), §10 (probe nav
walk), §11 (positional copy check)** and writes the guide probe **§9 step 3** runs. Read §0, §6,
§7, §9–§11 before Task 1. Depends on lane G0's `src/guide/palette.ts` (`guideEntries`) and
`src/guide/testing/fixtures.ts` (`FIXTURE_GUIDE`) being on `main`.

**Goal:** "add a card" typed into Ctrl/⌘+K lands on the guide task; an empty Overview shows a
*Start here* card; a zero-account wizard shows a pointer instead of a dead table; the two
positional sentences that point at another tab are rewritten; the manual probes know the
fourteenth nav link and a new read-only probe walks every guide link.

**Architecture:** `paletteRegistry.ts` gains a `'guide'` kind and a `'Guide'` group (last in
`GROUP_ORDER`) fed by `guideEntries()`; `OverviewPage.tsx` renders one conditional card at the
top of the agenda column; `MonthlyUpdatePage.tsx` renders one conditional `.empty-note` and hides
the empty table; two hint strings change; `tools/probes/guide-v/smoke.mjs` is a Playwright/Edge
walk in the house probe shape (node-version spoof, `TOKEN_FILE`, write fence).

**Tech stack:** React 19 + TypeScript 5.9 (`strict`; `import type`), react-router-dom 7, vitest 3 +
Testing Library (jsdom; no jest-dom matchers), Node 18 on the box (probes spoof 20 for
playwright-core from the npx cache), Microsoft Edge headless.

---

## Mechanics (read once)

- Worktree: `C:/Users/edyli/personal-finance-dashboard/.worktrees/guide-g5`, branch
  `guide/g5-integration`, cut from `main` **after G0 has merged**:
  `git worktree add -b guide/g5-integration .worktrees/guide-g5 main`; work ONLY inside it.
- Commands from the worktree root in Git Bash: `npx vitest run <paths>`, `npx tsc -b`,
  `npx eslint src`, `npm run build`. `node --check tools/probes/guide-v/smoke.mjs` syntax-checks
  the probe; **do not run the probe in this lane** (it needs the dev stack, which lane V owns).
- Files this lane may edit: `src/components/paletteRegistry.ts`, new
  `src/components/paletteRegistry.guide.test.ts`, `src/components/CommandPalette.tsx` (only if a
  kind switch needs the new kind — expected: no change), `src/pages/OverviewPage.tsx`,
  `src/pages/OverviewPage.css`, `src/pages/OverviewPage.test.tsx`,
  `src/components/overview/attention.ts` (one comment), `src/pages/MonthlyUpdatePage.tsx`,
  `src/pages/MonthlyUpdatePage.test.tsx`, `src/pages/SpendingPage.tsx` (one string),
  `src/components/paycheck/TryItPanel.tsx` (one string) and any test quoting those two strings,
  `tools/probes/motion-v/smoke.mjs` (the `NAV` array), new `tools/probes/guide-v/smoke.mjs`,
  `tools/probes/README.md` (one table row). Nothing else.
- Commit after every task. Never push.

## House rules this plan encodes

1. `paletteRegistry.test.ts:37-46` pins **exactly five actions** — guide entries are a new kind,
   not actions. The `'Guide'` group is **last** in `GROUP_ORDER` so pages, Settings cards and
   entities win an ambiguous query.
2. `OverviewPage.css` is pinned by `src/pages/overviewCss.test.ts` — add rules, change nothing
   existing. Colours via tokens; no literal durations.
3. `attention.ts`'s nudge gating stays; only its premise comment changes (spec §7.1).
4. Probes are dev-box tools: read-only by construction (a route fence answers every non-GET
   `/api/v1/**` from memory), output under the gitignored `scratchpad/`, never in the suites.
5. Existing tests are updated, never deleted.

---

## Task 1 — palette Guide group (spec §6)

**Files:**
- Modify: `src/components/paletteRegistry.ts:8-38` (types, order), `:113-167` (`buildEntries`),
  `:254-259` (`titleOf`)
- Test: new `src/components/paletteRegistry.guide.test.ts`; `src/components/paletteRegistry.test.ts` (unchanged, must pass)

- [ ] **Step 1: Write the failing test**

`src/components/paletteRegistry.guide.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { FIXTURE_GUIDE } from '../guide/testing/fixtures'
import { buildEntries, groupMatches, matchEntries, type PaletteEntry } from './paletteRegistry'

// The real GUIDE is content the lanes are still writing; the fixture keeps this suite deterministic.
vi.mock('../guide/content', () => ({ GUIDE: FIXTURE_GUIDE }))

const noop = () => {}
const entries = buildEntries({ month: '2026-09-01', run: { refreshPrices: noop, askAssistant: noop } })

describe('paletteRegistry — Guide group (2026-09-14 guide spec §6)', () => {
  it('registers one guide entry per task with the guide anchor as destination', () => {
    const guide = entries.filter((e) => e.kind === 'guide')
    expect(guide.map((e) => e.id)).toEqual(expect.arrayContaining(['guide:update-close', 'guide:example-add', 'guide:example-export']))
    const add = guide.find((e) => e.id === 'guide:example-add')!
    expect(add.label).toBe('Add an example')
    expect(add.sub).toBe('Guide · Example')
    expect(add.to).toBe('/guide?section=pages#example-add')
    expect(guide.every((e) => e.to?.startsWith('/guide?section='))).toBe(true)
  })

  it('keeps the five actions exactly as they were', () => {
    expect(entries.filter((e) => e.kind === 'action')).toHaveLength(5)
  })

  it('a task title typed into the palette lands on the guide task, under a Guide group', () => {
    const hits = matchEntries('add an example', entries)
    expect(hits[0].id).toBe('guide:example-add')
    const grouped = groupMatches(hits)
    expect(grouped.some((g) => g.title === 'Guide')).toBe(true)
  })

  it('the Guide group sorts after every other group', () => {
    const synthetic: PaletteEntry[] = [
      { kind: 'guide', id: 'guide:x', label: 'X', keywords: [], to: '/guide?section=pages#x' },
      { kind: 'entity', id: 'card:y', label: 'Y', keywords: [], to: '/credit-cards?card=y', group: 'Cards' },
      { kind: 'page', id: 'nav:/', label: 'Overview', keywords: [], to: '/' },
    ]
    expect(groupMatches(synthetic).map((g) => g.title)).toEqual(['Pages', 'Cards', 'Guide'])
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/components/paletteRegistry.guide.test.ts`
Expected: FAIL — `'guide'` is not a `PaletteKind` (type error) / no guide entries.

- [ ] **Step 3: Implement**

`src/components/paletteRegistry.ts`:

```ts
import { guideEntries } from '../guide/palette'
```

```ts
export type PaletteKind = 'page' | 'section' | 'action' | 'entity' | 'guide'
```

```ts
export interface PaletteGroup {
  title: 'Actions' | 'Pages' | 'Settings' | 'Holdings' | 'Accounts' | 'Categories' | 'Cards' | 'Guide'
  items: PaletteEntry[]
}

// Guide last (2026-09-14 guide spec §6): a task title can share words with a page, a Settings
// card or a holding, and those are the destinations a reader means first.
const GROUP_ORDER: PaletteGroup['title'][] = [
  'Actions',
  'Pages',
  'Settings',
  'Holdings',
  'Accounts',
  'Categories',
  'Cards',
  'Guide',
]
```

In `buildEntries`, after `actions`:

```ts
  // One destination per guide task (src/guide/palette.ts builds them from GUIDE), so
  // "add a card" typed here lands on the how-to, not only on the Credit cards page.
  const guides: PaletteEntry[] = guideEntries().map((entry) => ({ kind: 'guide', ...entry }))
  return [...actions, ...pages, ...sections, ...guides]
```

In `titleOf`:

```ts
  if (entry.kind === 'section') return 'Settings'
  if (entry.kind === 'guide') return 'Guide'
  return entry.group ?? 'Holdings'
```

Check `CommandPalette.tsx` for any `switch`/map over `PaletteGroup['title']` or `PaletteKind`
that must be exhaustive (grep `'Cards'` and `kind ===`); the current file only prints
`group.title` and `item.sub`, so no change is expected. If a `Record<PaletteGroup['title'], …>`
exists anywhere, add the `Guide` key.

- [ ] **Step 4: Run the palette suites**

Run: `npx vitest run src/components/paletteRegistry.guide.test.ts src/components/paletteRegistry.test.ts src/components/CommandPalette.test.tsx && npx tsc -b`
Expected: PASS; tsc silent.

- [ ] **Step 5: Commit**

```bash
git add src/components/paletteRegistry.ts src/components/paletteRegistry.guide.test.ts
git commit -m "feat(palette): Guide group — one destination per guide task, sorted last (spec §6)"
```

---

## Task 2 — Overview *Start here* card (spec §7.1)

**Files:**
- Modify: `src/pages/OverviewPage.tsx:2` (import), `:686` (agenda column), `src/pages/OverviewPage.css`,
  `src/components/overview/attention.ts:50-51` (comment)
- Test: `src/pages/OverviewPage.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/pages/OverviewPage.test.tsx` (inside the outer `describe`, using the file's own
`serve`, `renderPage`, `timeseriesOut` helpers):

```tsx
  describe('Start here (2026-09-14 guide spec §7.1)', () => {
    const emptyBook = () =>
      serve({
        ts: timeseriesOut({ months: [], net_worth: [], mom_pct: [], notes: [] }),
        yearly: { years: [] },
        dividends: [],
      })

    it('shows the Start here card with its three doors when no month exists', async () => {
      emptyBook()
      renderPage()
      const card = (await screen.findByRole('heading', { name: 'Start here' })).closest('section') as HTMLElement
      expect(card.className).toContain('overview-start')
      const hrefs = Array.from(card.querySelectorAll('a')).map((a) => a.getAttribute('href'))
      expect(hrefs).toEqual([
        '/settings?section=household#accounts',
        '/settings?section=data#import',
        '/update',
        '/guide',
        '/guide?section=routines#routine-monthly',
      ])
    })

    it('is absent once a month exists', async () => {
      serve()
      renderPage()
      await screen.findByText('Up next')
      expect(screen.queryByRole('heading', { name: 'Start here' })).toBeNull()
    })

    it('is absent under a person scope — the empty-scope note owns that case', async () => {
      emptyBook()
      renderPage('/?owner=2')
      await screen.findByText('Up next')
      expect(screen.queryByRole('heading', { name: 'Start here' })).toBeNull()
    })
  })
```

If `'Up next'` is not a stable text in the fixture (it is the agenda card's eyebrow), wait on any
existing stable heading the other tests use (`await screen.findByText(/Net worth — /)`).

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/pages/OverviewPage.test.tsx -t "Start here"`
Expected: 3 FAIL — no heading "Start here".

- [ ] **Step 3: Implement**

`src/pages/OverviewPage.tsx` — extend the router import:

```ts
import { Link, NavLink } from 'react-router-dom'
```

Compute the condition beside `emptyScope` (`:287`):

```ts
  // An empty book — no snapshot at all — gets one card that says what to do first (2026-09-14
  // guide spec §7.1). Household scope only: a person or joint scope with nothing in it is the
  // empty-scope note's case, and a book with months but no accounts cannot exist.
  const emptyBook = owner === null && data.ts !== undefined && data.ts.months.length === 0
```

At the top of `<aside className="overview-agenda-column">` (`:686`), before the *Up next* card:

```tsx
              {emptyBook && (
                <section className="card overview-start" aria-labelledby="overview-start-title">
                  <h2 className="eyebrow" id="overview-start-title">Start here</h2>
                  <p>This dashboard is empty. Three steps get it going:</p>
                  <ol className="overview-start-steps">
                    <li>
                      <Link to="/settings?section=household#accounts">Add your household and accounts</Link> — every
                      balance needs an account to live in.
                    </li>
                    <li>
                      <Link to="/settings?section=data#import">Import your workbook</Link> or{' '}
                      <Link to="/update">enter your first month</Link>.
                    </li>
                    <li>
                      <Link to="/guide">Read the guide</Link> — setup order, the monthly routine, every page.
                    </li>
                  </ol>
                  <p className="drill-hint">
                    After that: one <Link to="/guide?section=routines#routine-monthly">monthly update</Link> in the
                    first days of each month.
                  </p>
                </section>
              )}
```

`src/pages/OverviewPage.css` — append:

```css
/* Start here (2026-09-14 guide spec §7.1): the empty book's one card. */
.overview-start p {
  margin: 0 0 0.5rem;
}

.overview-start-steps {
  margin: 0 0 0.6rem 1.1rem;
  padding: 0;
  display: grid;
  gap: 0.3rem;
}
```

`src/components/overview/attention.ts:50-51` — replace the comment:

```ts
  // Monthly update — only once a first month exists. The empty book is the Overview's own
  // "Start here" card (2026-09-14 guide spec §7.1); a nudge on top of it would double-message.
```

- [ ] **Step 4: Run the Overview suites and the CSS pin**

Run: `npx vitest run src/pages/OverviewPage.test.tsx src/pages/overviewCss.test.ts src/components/overview && npx tsc -b && npx eslint src/pages/OverviewPage.tsx`
Expected: PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add src/pages/OverviewPage.tsx src/pages/OverviewPage.css src/pages/OverviewPage.test.tsx src/components/overview/attention.ts
git commit -m "feat(overview): Start here card on an empty book — accounts, import or first month, the guide (spec §7.1)"
```

---

## Task 3 — wizard zero-accounts pointer (spec §7.2)

**Files:**
- Modify: `src/pages/MonthlyUpdatePage.tsx` (balances step, before the `entry-table`, around `:1437`)
- Test: `src/pages/MonthlyUpdatePage.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/pages/MonthlyUpdatePage.test.tsx` (the file's `beforeEach` seeds one account; these
tests override `fetchAccounts` and use the file's `renderWizard()` helper — read `:140-215` first):

```tsx
describe('zero accounts (2026-09-14 guide spec §7.2)', () => {
  it('points at Settings and the guide instead of an empty table', async () => {
    vi.mocked(netWorthApi.fetchAccounts).mockResolvedValue([])
    renderWizard()
    const note = await screen.findByText(/No accounts yet/)
    const links = Array.from(note.closest('p')!.querySelectorAll('a')).map((a) => a.getAttribute('href'))
    expect(links).toEqual(['/settings?section=household#accounts', '/guide?section=start#start-setup'])
    expect(document.querySelector('table.entry-table')?.hasAttribute('hidden')).toBe(true)
    expect((screen.getByRole('button', { name: 'Next: spending' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('is absent with one account', async () => {
    renderWizard()
    await screen.findByRole('button', { name: 'Next: spending' })
    expect(screen.queryByText(/No accounts yet/)).toBeNull()
    expect(document.querySelector('table.entry-table')?.hasAttribute('hidden')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/pages/MonthlyUpdatePage.test.tsx -t "zero accounts"`
Expected: FAIL — no "No accounts yet" text.

- [ ] **Step 3: Implement**

In `src/pages/MonthlyUpdatePage.tsx`, immediately before `<table className="data-table entry-table">`
(the comment block "One table, not a card per group…" stays above it):

```tsx
            {/* A book with no accounts: the table would be a header with nothing under it and a
                disabled Next with no reason (2026-09-14 guide spec §7.2). accounts.length === 0
                after a finished load means exactly that — a failed load renders the error view
                instead of this step. */}
            {!loading && accounts.length === 0 && (
              <p className="empty-note">
                No accounts yet —{' '}
                <Link to="/settings?section=household#accounts">add them in Settings → Household → Accounts</Link>, or{' '}
                <Link to="/guide?section=start#start-setup">start with the guide</Link>.
              </p>
            )}
            <table className="data-table entry-table" hidden={!loading && accounts.length === 0}>
```

`Link` is already imported (`:3`). Confirm in the file that a failed accounts load shows the error
branch rather than this step (search `Retry` near `:1329-1338`); if the step can render with a
failed load and an empty roster, add `&& loadError === null` (whatever the file's error state is
named) to both conditions.

- [ ] **Step 4: Run the wizard suite**

Run: `npx vitest run src/pages/MonthlyUpdatePage.test.tsx && npx tsc -b && npx eslint src/pages/MonthlyUpdatePage.tsx`
Expected: PASS (the file is large; allow a minute); clean.

- [ ] **Step 5: Commit**

```bash
git add src/pages/MonthlyUpdatePage.tsx src/pages/MonthlyUpdatePage.test.tsx
git commit -m "feat(wizard): zero accounts shows a pointer to Settings and the guide instead of an empty table (spec §7.2)"
```

---

## Task 4 — positional copy rewrites (spec §11)

**Files:**
- Modify: `src/pages/SpendingPage.tsx:537`, `src/components/paycheck/TryItPanel.tsx:257`
- Test: any test quoting the old sentences

- [ ] **Step 1: Find quoting tests**

Run: `grep -rn "chart below draws\|profile shown above" src`
Expected: the two component sites and possibly a test line each.

- [ ] **Step 2: Rewrite**

`src/pages/SpendingPage.tsx:537` — the *Savings rate — cash* tile hint ends
`… — the chart below draws both readings.`; the Savings rate chart lives in the **Trends** panel.
New ending: `… — the Savings rate chart on Trends draws both readings.`

`src/components/paycheck/TryItPanel.tsx:257` — `hint="Move a percentage or an amount and see the
check the server computes for it, against the profile shown above — nothing is saved."` becomes
`hint="Move a percentage or an amount and see the check the server computes for it, against the
profile named in this card's title — nothing is saved."`

Update any test that quoted the old text to the new text (same assertion, new string).

- [ ] **Step 3: Run the two suites**

Run: `npx vitest run src/pages/SpendingPage.test.tsx src/components/paycheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/pages/SpendingPage.tsx src/components/paycheck/TryItPanel.tsx $(git diff --name-only -- '*.test.tsx')
git commit -m "fix(copy): two hints name the view instead of a direction — savings chart on Trends, try-it profile in the card title (spec §11)"
```

---

## Task 5 — probes: nav walk + the guide walk (spec §9 step 3, §10)

**Files:**
- Modify: `tools/probes/motion-v/smoke.mjs:50-51`
- Create: `tools/probes/guide-v/smoke.mjs`
- Modify: `tools/probes/README.md` (one table row)

- [ ] **Step 1: The motion probe's nav list**

```js
// 14 links, the sidebar's own order (src/components/navItems.ts).
const NAV = ['Overview', 'Monthly update', 'Net worth', 'Portfolio', 'Spending', 'Credit cards', 'Paycheck', 'Comp', 'ESPP', 'Taxes', 'Projection', 'Calendar', 'Guide', 'Settings']
```

- [ ] **Step 2: Write the guide walk**

`tools/probes/guide-v/smoke.mjs`:

```js
// tools/probes/guide-v/smoke.mjs — the Guide page walk (lane V, 2026-09-14 guide spec §9 step 3).
// Recipe: tools/probes/README.md. READ-ONLY BY CONSTRUCTION: every non-GET /api/v1 call is fenced
// and answered from memory, so nothing persists and there is nothing to sweep.
// What it proves, in both themes: the sidebar has 14 links with Guide before Settings; /guide
// renders four tabs; every link rendered inside the guide (Open …, Go →, body links, chip row)
// lands — same pathname, the ?section tab selected where present, the #hash target focused or in
// view — with a clean console; the palette answers "add a card" with a Guide group; screenshots of
// each chapter at 1440×900 and 1920×1080.
// Env: SMOKE_OUT, TOKEN_FILE, APP_BASE, EDGE_PATH, PLAYWRIGHT_CORE, ONLY_THEME, MAX_LINKS.
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
const OUT = process.env.SMOKE_OUT ?? path.join(process.cwd(), 'scratchpad', 'guide-smoke')
mkdirSync(OUT, { recursive: true })
const TOKEN = readFileSync(process.env.TOKEN_FILE ?? path.join(OUT, 'token.txt'), 'utf8').trim()
const BASE = process.env.APP_BASE ?? 'http://localhost:5173'
const EDGE = process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const THEMES = ['dark', 'light'].filter((t) => !process.env.ONLY_THEME || t === process.env.ONLY_THEME)
const MAX_LINKS = Number(process.env.MAX_LINKS ?? 0) // 0 = all
const NOISE = /favicon|DevTools|\[vite\]|@vite\/client|React DevTools|React Router Future Flag|Failed to load resource/i
const CHAPTERS = ['start', 'routines', 'pages', 'reference']
const report = { generatedAt: new Date().toISOString(), base: BASE, themes: THEMES, checks: [], links: [], consoleErrors: [], writesBlocked: [], problems: [] }
const problem = (m) => report.problems.push(m)
const check = (theme, name, ok, observed) => { report.checks.push({ theme, name, ok, observed }); if (!ok) problem(`${theme}: ${name} — ${JSON.stringify(observed)}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ executablePath: EDGE, headless: true })
try {
  for (const theme of THEMES) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    // Token + theme before first paint: the shell reads finance_token and finance.theme from
    // localStorage in index.html's inline script.
    await context.addInitScript(([token, t]) => { localStorage.setItem('finance_token', token); localStorage.setItem('finance.theme', JSON.stringify(t)) }, [TOKEN, theme])
    // Write fence: no non-GET reaches the server.
    await context.route('**/api/v1/**', (route) => {
      const req = route.request()
      if (req.method() === 'GET') return route.continue()
      report.writesBlocked.push(`${req.method()} ${req.url()}`)
      return route.fulfill({ status: 204, body: '' })
    })
    const page = await context.newPage()
    page.on('console', (msg) => { if (msg.type() === 'error' && !NOISE.test(msg.text())) report.consoleErrors.push({ theme, url: page.url(), text: msg.text() }) })
    page.on('pageerror', (err) => report.consoleErrors.push({ theme, url: page.url(), text: String(err) }))

    // 1. Sidebar: 14 links, Guide before Settings.
    await page.goto(`${BASE}/guide`, { waitUntil: 'networkidle' })
    const navLabels = await page.$$eval('nav[aria-label="Primary"] a', (as) => as.map((a) => a.textContent.trim()))
    check(theme, 'sidebar has 14 links with Guide before Settings', navLabels.length === 14 && navLabels[12] === 'Guide' && navLabels[13] === 'Settings', navLabels)
    check(theme, 'theme stamped', (await page.getAttribute('html', 'data-theme')) === theme, await page.getAttribute('html', 'data-theme'))

    // 2. Four tabs; collect every link rendered inside the guide across the chapters.
    const tabs = await page.$$eval('[role="tab"]', (ts) => ts.map((t) => t.textContent.trim()))
    check(theme, 'four chapter tabs', JSON.stringify(tabs) === JSON.stringify(['Start here', 'Routines', 'Pages', 'Reference']), tabs)
    const links = new Set()
    for (const chapter of CHAPTERS) {
      await page.goto(`${BASE}/guide?section=${chapter}`, { waitUntil: 'networkidle' })
      await page.$$eval('details.guide-more', (ds) => ds.forEach((d) => { d.open = true }))
      await sleep(150)
      const hrefs = await page.$$eval('.guide-page [role="tabpanel"]:not([hidden]) a[href^="/"]', (as) => as.map((a) => a.getAttribute('href')))
      hrefs.forEach((h) => links.add(h))
      for (const [w, h] of [[1440, 900], [1920, 1080]]) {
        await page.setViewportSize({ width: w, height: h })
        await sleep(150)
        await page.screenshot({ path: path.join(OUT, `${theme}-${chapter}-${w}.png`), fullPage: true })
      }
      await page.setViewportSize({ width: 1440, height: 900 })
    }
    check(theme, 'guide renders links', links.size > 0, links.size)

    // 3. Walk every link once.
    const list = Array.from(links).sort()
    const walk = MAX_LINKS > 0 ? list.slice(0, MAX_LINKS) : list
    for (const href of walk) {
      const url = new URL(href, BASE)
      const wantSection = url.searchParams.get('section')
      const wantHash = url.hash.slice(1)
      const before = report.consoleErrors.length
      await page.goto(url.toString(), { waitUntil: 'networkidle' })
      await sleep(400) // arrival effects (rAF + MutationObserver retry) settle
      const landed = new URL(page.url())
      const samePath = landed.pathname === url.pathname
      const tabSelected = wantSection
        ? await page.$eval('[role="tab"][aria-selected="true"]', (t) => !!t).catch(() => false)
        : true
      const sectionKept = wantSection ? landed.searchParams.get('section') === wantSection : true
      const target = wantHash
        ? await page.evaluate((id) => {
            const el = document.getElementById(id)
            if (!el) return { exists: false }
            const r = el.getBoundingClientRect()
            return { exists: true, focused: document.activeElement === el, inView: r.top >= 0 && r.top < window.innerHeight }
          }, wantHash)
        : { exists: true, focused: true, inView: true }
      const mainFilled = await page.$eval('#main', (m) => m.textContent.trim().length > 0).catch(() => false)
      const ok = samePath && tabSelected && sectionKept && target.exists && (target.focused || target.inView) && mainFilled && report.consoleErrors.length === before
      report.links.push({ theme, href, landed: page.url(), ok, samePath, tabSelected, sectionKept, target, mainFilled })
      if (!ok) problem(`${theme}: link ${href} → ${page.url()} ${JSON.stringify({ samePath, tabSelected, sectionKept, target, mainFilled, newErrors: report.consoleErrors.length - before })}`)
    }

    // 4. The palette answers a how-to with a Guide group.
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await page.keyboard.press('Control+KeyK')
    await page.fill('[role="combobox"], .palette input', 'add a card')
    await sleep(300)
    const groups = await page.$$eval('.palette-group-title', (gs) => gs.map((g) => g.textContent.trim()))
    check(theme, 'palette shows a Guide group for "add a card"', groups.includes('Guide'), groups)
    await page.keyboard.press('Escape')

    await context.close()
  }
} finally {
  await browser.close()
}
report.consoleErrors.forEach((e) => problem(`console ${e.theme} ${e.url}: ${e.text}`))
writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
if (report.problems.length) {
  console.error(report.problems.join('\n'))
  console.error(`GUIDE SMOKE FAILED — ${report.problems.length} problem(s); report: ${path.join(OUT, 'report.json')}`)
  process.exit(1)
}
console.log(`GUIDE SMOKE OK — ${report.links.length} link visits, ${report.checks.length} checks, ${report.writesBlocked.length} writes blocked; report: ${path.join(OUT, 'report.json')}`)
```

Adjust two selectors after reading the source: the palette input (`CommandPalette.tsx` — find the
`<input>`'s role/class; the file uses combobox ARIA) and the theme storage format
(`ThemeProvider.tsx` — whether `finance.theme` is stored as a bare string or JSON; use whatever
`setTheme` writes).

- [ ] **Step 3: Syntax-check and document**

Run: `node --check tools/probes/guide-v/smoke.mjs`
Expected: silent.

Add to the table in `tools/probes/README.md`:

```
| `guide-v/smoke.mjs` | The Guide page (2026-09-14): 14 sidebar links with Guide before Settings, four chapter tabs, every link rendered inside the guide walked once (same path, `?section` tab selected, `#hash` target focused or in view, `#main` filled, clean console), the palette's Guide group for "add a card", screenshots per chapter in both themes at 1440 and 1920. READ-ONLY BY CONSTRUCTION — a write fence, not a sweep | needs the dev stack — see below |
```

- [ ] **Step 4: Commit**

```bash
git add tools/probes/motion-v/smoke.mjs tools/probes/guide-v/smoke.mjs tools/probes/README.md
git commit -m "probe(guide): read-only guide walk (links, tabs, hash targets, palette group, screenshots); motion nav walk counts 14 links (spec §9–10)"
```

---

## Task 6 — gates and hand-off

- [ ] **Step 1: Full gates** — `npx tsc -b && npx eslint . && npx vitest run && npm run build`.
Expected: green.

- [ ] **Step 2: Results** — append `## Results (implementer, <date>)`: commits, gate counts,
deviations (selector adjustments in the probe are expected — record the final selectors), hand-offs.

### Hand-offs

- **V:** run `tools/probes/guide-v/smoke.mjs` against the dev stack after all content lanes merge;
  the palette check needs the `cards-add` task (lane G2) on main.

## Self-review (done while writing)

- Spec §6 → Task 1 (kind, group title, order, `buildEntries`, `titleOf`, tests incl. the
  five-action pin). §7.1 → Task 2 (condition, markup, CSS, comment, three tests). §7.2 → Task 3
  (note, hidden table, two tests). §11 → Task 4. §10 + §9 step 3's driver → Task 5.
- Types: `guideEntries` from `src/guide/palette.ts` returns `{ id, label, sub, keywords, to }`;
  spreading under `kind: 'guide'` yields a `PaletteEntry` ✓. `FIXTURE_GUIDE` ids (`update-close`,
  `example-add`, `example-export`) match G0's fixture ✓.
