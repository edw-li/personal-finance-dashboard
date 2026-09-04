# Motion & polish — Lane M4 (hints + errors) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans. Steps are checkboxes; every task ends with a mutation check and a commit.

**Goal:** spec `docs/superpowers/specs/2026-09-05-motion-polish-design.md` §8 + §9. A hint under the sticky scope row opens downward instead of behind it, its target is 24×24, and its sentence is read once; every load failure says `Couldn't load {noun} — {detail}` in the app's own words; a page that loads parts in parallel shows ONE banner with ONE Retry; Settings cards stop offering "Retry" for a typo; the wizard's failed load offers a Retry instead of a form seeded with nothing.

**Architecture:** one grammar, implemented once. `src/api/client.ts` gains `errorDetail(err, fallback?)` (the reason, mapped: 5xx → "the server had a problem (HTTP n)", status 0 → offline/timeout, anything else → the sentence the API already wrote), `describeError(err, noun)` (the whole sentence) and `describeLoadFailures(parts)` (many parts → one sentence plus one stale clause). Multi-feed pages store the *detail* per part, so their own prose keeps the raw reason, and compose the banner from it. `FeedBanner`'s `retry` prop is already the only way to show Retry — this lane pins that with a test instead of changing it. Nothing here adds `setState` to an effect body.

**Stack / worktree:** React 19, TS 5.9, vitest 3 + @testing-library/react (jsdom). `git worktree add .worktrees/motion-m4 -b motion-m4 main`, then inside it `cmd //c "mklink /J node_modules ..\..\node_modules"`; all commands from the worktree root. LF endings, one commit per task, **local commits only — never push**. House rules: tokens not literal colours; comments say *why*; no `setState` in an effect body; no new files.

**Done when:** `npx tsc -b`, `npx eslint .` and `npx vitest run` are green from the worktree root.

**Files this lane owns** (each task's **Files:** line is the authority): `components/InfoHint.tsx` + `panels.css`, `api/client.ts`, the five `settings/*Card.tsx`, `pages/{Espp,Paycheck,Comp,MonthlyUpdate}Page.tsx`, and the tests for those plus `shell/Feed.test.tsx` and the seven files that named an InfoHint button with a whole sentence.

## Coordination

- **M3 owns `Feed.tsx`'s body, skeleton and xfade.** Touch only the `FeedBanner` function and `Feed.test.tsx`'s `describe('FeedBanner')` block — a whitespace edit elsewhere turns a disjoint merge into a conflict.
- **M2 appends a reveal/stagger block to the END of `panels.css`** and owns the motion tokens (M4 needs none — nothing here animates); edit only the existing `/* InfoHint … */` block (~:367-410). Merge order M2 → M1 → M3 → M4; this lane builds and tests standalone on `main`.

### Task 1: the hint opens below a stuck row, and says its name once

**Files:** `src/components/InfoHint.tsx`, `src/components/panels.css`, `src/components/InfoHint.test.tsx`, plus the seven files in Step 4.

- [ ] **Step 1: Write the failing tests.** In `InfoHint.test.tsx` import `hintLabel` from `./InfoHint`; add `const LABEL = 'About Assets minus liabilities from…'` beside `TEXT`, with the reason above it (the BUTTON is named short; the sentence is the bubble's, and the bubble is what `aria-describedby` points at — so a screen reader hears it once, not twice); repoint the helper to `screen.getByRole('button', { name: LABEL })`; change the first test's `.toBe(TEXT)` to `.toBe(LABEL)`; and append:

```tsx
  it('names the button with four words and keeps short hints whole', () => {
    expect(hintLabel(TEXT)).toBe(LABEL)
    expect(hintLabel('What it shows.')).toBe('About What it shows.')
    render(<InfoHint text={TEXT} />)
    fireEvent.click(hintButton())
    // Focus opens the bubble, so the full sentence still arrives — once, as the description.
    expect(hintButton().getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id)
    expect(screen.getByRole('tooltip').textContent).toBe(TEXT)
  })

  it('opens BELOW when the sticky scope row would cover the bubble', () => {
    // The row pins at top:0 (shell.css); a hint in the first card opened upward INTO it and
    // was unreadable. jsdom lays nothing out, so the rect IS the input — one stub serves both.
    const at = (top: number) =>
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        left: 20, right: 36, top, bottom: top + 16, width: 16, height: 16, x: 20, y: top, toJSON: () => ({}),
      })
    document.body.innerHTML = '<div class="page-frame-scope"></div>'
    at(400)
    const { unmount } = render(<InfoHint text={TEXT} />)
    fireEvent.click(hintButton())
    expect(screen.getByRole('tooltip').className).not.toContain('is-below')
    unmount()
    at(0) // under the row: 0 < 96 (bubble) + 16 (row) + 8 (air)
    render(<InfoHint text={TEXT} />)
    fireEvent.click(hintButton())
    expect(screen.getByRole('tooltip').className).toContain('is-below')
  })
```

- [ ] **Step 2: Run and watch them fail.** `npx vitest run src/components/InfoHint.test.tsx` → FAIL (`hintLabel` is not exported; no `is-below`).
- [ ] **Step 3: Implement.** In `InfoHint.tsx`, under `BUBBLE_MAX_PX`:

```tsx
// The tallest a 280px bubble gets in practice (five lines + padding). Over-estimating only
// sends a borderline hint downward, which is readable; under-estimating hides it under the row.
const BUBBLE_EST_H_PX = 96
// The scope row (shell.css: position: sticky; top: 0; z-index: 8) covers the top of the
// page while pinned, so "does it fit above?" has to mean "above the ROW".
const STUCK_ROW_SELECTOR = '.page-frame-scope'
const EDGE_GAP_PX = 8 // air between the bubble and whatever it must clear

/** The button's NAME: four words, so the sentence is read once — as the bubble, through
 *  `aria-describedby`. The whole sentence here made a reader say it twice (spec §8). */
export function hintLabel(text: string): string {
  const words = text.split(/\s+/).filter((w) => w !== '')
  return words.length <= 4 ? `About ${text}` : `About ${words.slice(0, 4).join(' ')}…`
}
```

Add `const [below, setBelow] = useState(false)` beside `flip`, and widen `openNow` — still measured in the open path, so no setState from an effect body:

```tsx
  const openNow = useCallback(() => {
    const el = wrapRef.current
    if (el !== null) {
      const rect = el.getBoundingClientRect()
      setFlip(rect.left + BUBBLE_MAX_PX > window.innerWidth)
      // Measured, not assumed: pages without a scope row (Settings) have nothing to clear.
      const row = document.querySelector(STUCK_ROW_SELECTOR)?.getBoundingClientRect().height ?? 0
      setBelow(rect.top < BUBBLE_EST_H_PX + row + EDGE_GAP_PX)
    }
    setOpen(true)
  }, [])
```

Then `aria-label={hintLabel(text)}` on the button, and on the bubble ``className={`info-hint-bubble${flip ? ' is-flipped' : ''}${below ? ' is-below' : ''}`}``. In `panels.css`, inside the existing InfoHint block, replace `.info-hint`'s `margin-left: 0.35rem;` with

```css
  justify-content: center;
  /* A 13px glyph is a 13px target. Padded out to the 24×24 pointer minimum and the extra
     pulled back with negative block margin, so the eyebrow's line box is unchanged (§8). */
  min-width: 24px;
  min-height: 24px;
  margin: -5.5px 0 -5.5px 0.35rem;
```

…change the bubble's `z-index: 2` to `z-index: 9` and its comment to `/* Above the sticky scope row (8), below the drawer (15), palette (20) and toasts (30). */`, and after `.info-hint-bubble.is-flipped` add:

```css
/* Opened DOWNWARD, for a hint with no room above it — one that opened up into the pinned
   scope row was covered by it. */
.info-hint-bubble.is-below {
  bottom: auto;
  top: calc(100% + 6px);
}
```

- [ ] **Step 4: Repoint the seven files that named the button with a whole sentence.** Import `hintLabel` and wrap the expected string (`toBe(hintLabel(HINT))`, `{ name: hintLabel(OWNER_HINT) }`); where the expectation is a regex, anchor it on the new prefix (`/^About Annual spend ÷ withdrawal/`). `ChartCard.test.tsx:66` · `StatTile.test.tsx:107` · `shell/ScopeBar.test.tsx:159,163` · `OverviewPage.test.tsx:1532,1536` · `PortfolioPage.test.tsx:685` · `ProjectionPage.test.tsx:727` · `CreditCardsPage.test.tsx:612`.
- [ ] **Step 5: Run.** `npx vitest run src/components/InfoHint.test.tsx src/components/ChartCard.test.tsx src/components/StatTile.test.tsx src/components/shell/ScopeBar.test.tsx src/pages/OverviewPage.test.tsx src/pages/PortfolioPage.test.tsx src/pages/ProjectionPage.test.tsx src/pages/CreditCardsPage.test.tsx` → PASS.
- [ ] **Step 6: Mutation check.** Change the below-test to `rect.top < 0` and run `InfoHint.test.tsx`. Expected: FAIL — "opens BELOW…" gets no `is-below`. Revert; change `words.slice(0, 4)` to `slice(0, 5)`. Expected: FAIL — the label pin. Revert. Expected: PASS.
- [ ] **Step 7: Commit.** `npx tsc -b && npx eslint src/components/InfoHint.tsx src/components/InfoHint.test.tsx && git add -A && git commit -m "fix(hints): open below a stuck scope row, 24x24 target, sentence read once (motion spec §8)"`

### Task 2: one error grammar, and Retry only where a caller asked for it

**Files:** `src/api/client.ts`, `src/api/client.test.ts`, `src/components/shell/Feed.test.tsx`.

- [ ] **Step 1: Write the failing tests.** Append to `client.test.ts` (its import list gains `describeError`, `describeLoadFailures`, `errorDetail`):

```ts
const SERVER = 'the server had a problem (HTTP 503)'
const part = (noun: string, detail: string | null, stale = false) => ({ noun, detail, stale })
describe('the error grammar (motion spec §9)', () => {
  // A 4xx body is a sentence the API wrote FOR a human — paraphrasing it would lose the one
  // thing it knows (which row collided, which field was wrong). A 5xx body is the server
  // talking to itself, and status 0 is the client's own network signal.
  it.each([
    [new ApiError('lots unavailable', 503), SERVER],
    [new ApiError('boom', 500), 'the server had a problem (HTTP 500)'],
    [new ApiError("account 'checking' exists", 409), "account 'checking' exists"],
    [new ApiError('', 404), 'HTTP 404'], // HTTP/2 carries no reason phrase
    [new ApiError('Network error — is the server reachable?', 0), "you're offline or the server is unreachable"],
    [new ApiError('Request timed out', 0), 'the request timed out'],
    [new Error('kaboom'), 'kaboom'],
    ['a string nobody threw on purpose', 'something went wrong'],
  ] as [unknown, string][])('maps %o to its detail and its sentence', (err, detail) => {
    expect(errorDetail(err)).toBe(detail)
    expect(describeError(err, 'the lots')).toBe(`Couldn't load the lots — ${detail}`)
  })

  it('takes the caller fallback only for a non-Error', () => {
    expect(errorDetail('?', 'the model refused')).toBe('the model refused')
    expect(errorDetail(new Error('kaboom'), 'the model refused')).toBe('kaboom')
  })

  it('collapses parallel load failures into one sentence', () => {
    expect(describeLoadFailures([part('the lots', null)])).toBeNull()
    expect(describeLoadFailures([part('the lots', SERVER)])).toBe(`Couldn't load the lots — ${SERVER}`)
    // One reason is said once; two are named per part (one "server problem" over a 404 lies).
    expect(
      describeLoadFailures([part('the lots', SERVER), part('the offerings', null), part('the model', SERVER)]),
    ).toBe(`Couldn't load the lots and the model — ${SERVER}`)
    expect(describeLoadFailures([part('the lots', SERVER), part('the offerings', 'gone')])).toBe(
      `Couldn't load the lots and the offerings — the lots: ${SERVER}; the offerings: gone`,
    )
    // The reason's own trailing stop is absorbed — never "gone.. Showing".
    expect(describeLoadFailures([part('the lots', 'gone.', true), part('the model', 'gone.')])).toBe(
      "Couldn't load the lots and the model — gone. Showing earlier data for the lots.",
    )
  })
})
```

Add to `Feed.test.tsx`'s `describe('FeedBanner')`:

```tsx
  it('offers NO Retry without a retry prop — Retry is opt-in (motion spec §9)', () => {
    // A Retry here invites a re-send of a form the server already refused, and looks like a fix.
    render(<FeedBanner error="Account name is required." retryLabel="Retry loading accounts" />)
    expect(screen.getByRole('alert').textContent).toBe('Account name is required.')
    expect(screen.queryByRole('button')).toBeNull()
  })
```

- [ ] **Step 2: Run and watch it fail.** `npx vitest run src/api/client.test.ts src/components/shell/Feed.test.tsx` → FAIL (`errorDetail` is not exported; the Feed pin already passes and must keep passing).
- [ ] **Step 3: Implement.** Append to `src/api/client.ts`, under the `ApiError` class:

```ts
/** The detail half of the house's error sentence, in words this app owns. A 5xx body is the
 *  server talking to itself; status 0 is this module's own network/timeout signal (see
 *  requestWithHeaders). Everything else is already a sentence the API wrote for a human and
 *  passes through — it names the row or field that failed, which no paraphrase can. */
export function errorDetail(err: unknown, fallback = 'something went wrong'): string {
  if (err instanceof ApiError) {
    if (err.status >= 500) return `the server had a problem (HTTP ${err.status})`
    if (err.status === 0)
      return err.message === 'Request timed out'
        ? 'the request timed out'
        : "you're offline or the server is unreachable"
    return err.message === '' ? `HTTP ${err.status}` : err.message
  }
  return err instanceof Error && err.message !== '' ? err.message : fallback
}

/** One grammar for every load failure in the app (2026-09-05 motion spec §9): the noun the
 *  user was waiting for, then why. `noun` carries its own article — "the lots". */
export function describeError(err: unknown, noun: string, fallback?: string): string {
  return `Couldn't load ${noun} — ${errorDetail(err, fallback)}`
}

/** One part of a page that loads several in parallel: `detail` is an `errorDetail` string
 *  (null = it answered, and the page keeps it for its own prose), `stale` = still on screen. */
export interface LoadFailure {
  noun: string
  detail: string | null
  stale?: boolean
}

/** …and one banner for all of them: which parts failed, why, and what is now stale. Three
 *  alerts stacked down a page read as three outages; they are almost always one. */
export function describeLoadFailures(parts: LoadFailure[]): string | null {
  const failed = parts.filter((p): p is LoadFailure & { detail: string } => p.detail !== null)
  if (failed.length === 0) return null
  const reasons = [...new Set(failed.map((p) => p.detail))]
  const why =
    reasons.length === 1 ? reasons[0] : failed.map((p) => `${p.noun}: ${p.detail}`).join('; ')
  const head = `Couldn't load ${joinNouns(failed.map((p) => p.noun))} — ${why}`
  const stale = failed.filter((p) => p.stale === true).map((p) => p.noun)
  if (stale.length === 0) return head
  // The reason may end in a stop of its own (the server does); absorbing it stops "gone.. Showing".
  return `${head.replace(/[.\s]+$/, '')}. Showing earlier data for ${joinNouns(stale)}.`
}

function joinNouns(nouns: string[]): string {
  if (nouns.length <= 1) return nouns[0] ?? ''
  return `${nouns.slice(0, -1).join(', ')} and ${nouns[nouns.length - 1]}`
}
```

- [ ] **Step 4: Audit the opt-in Retry.** `grep -rn "FeedBanner" src --include=*.tsx | grep -v test` — every banner offering Retry passes `retry`; no banner over a validation error or a failed write does. The tree already holds; the offenders are the Settings cards' shared `error`, which Task 3 splits. Fix any drift, and never add a default to `FeedBanner`.
- [ ] **Step 5: Run.** `npx vitest run src/api/client.test.ts src/components/shell/Feed.test.tsx` → PASS.
- [ ] **Step 6: Mutation check.** Give `FeedBanner` a `retry = () => {}` default; run `Feed.test.tsx`. Expected: FAIL — "offers NO Retry without a retry prop". Revert; change `err.status >= 500` to `> 500` and run `client.test.ts`. Expected: FAIL — the HTTP 500 row. Revert; drop the `.replace(/[.\s]+$/, '')`. Expected: FAIL — "gone.. Showing". Revert. Expected: PASS.
- [ ] **Step 7: Commit.** `npx tsc -b && npx eslint src/api/client.ts src/api/client.test.ts src/components/shell/Feed.test.tsx && git add -A && git commit -m "feat(errors): one load-failure grammar in the api client, Retry stays opt-in (motion spec §9)"`

### Task 3: Settings cards split what a Retry can fix from what it cannot

**Files:** `AccountsCard`, `CategoriesCard`, `HouseholdCard`, `LimitsCard`, `AssistantCard` under `src/components/settings/`, and each one's `.test.tsx`. Each holds ONE `error` today, rendered in a banner that always offers Retry — so "Account name is required." arrives with a button that re-runs the fetch and changes nothing.

- [ ] **Step 1: Write the failing tests** — one per card. AccountsCard, in full:

```tsx
it('renders a validation error inline with no Retry beside it (motion spec §9)', async () => {
  render(<AccountsCard people={[ME]} />)
  await screen.findByRole('table', { name: 'Net-worth accounts' })
  fireEvent.click(screen.getByRole('button', { name: 'Add account' }))

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('Account name is required.')
  // Retry re-runs the FETCH: here it would invite a re-send of a form the client refused.
  expect(within(alert).queryByRole('button')).toBeNull()
})

it('names the card in the load banner and keeps Retry there', async () => {
  vi.mocked(fetchAccounts)
    .mockRejectedValueOnce(new ApiError('accounts unavailable', 503))
    .mockResolvedValue([CHECKING])
  render(<AccountsCard people={[ME]} />)
  expect(
    await screen.findByText("Couldn't load the accounts — the server had a problem (HTTP 503)"),
  ).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading accounts' }))
  expect(await screen.findByRole('table', { name: 'Net-worth accounts' })).toBeTruthy()
})
```

The other four take the first test with their own trigger and message, rendered the way their file already renders the card:

| Card | trigger | expected `alert.textContent` |
|---|---|---|
| `CategoriesCard` | click `Add category`, name box empty | `Category name is required.` |
| `HouseholdCard` | click `Add member`, box empty | `Enter a name for the new household member.` |
| `LimitsCard` | reject `putLimits` with `new ApiError('limit must be positive', 422)`, click `Save limits` | `limit must be positive` |
| `AssistantCard` | reject `putAssistantSettings` with `new ApiError('key rejected', 422)`, type a key, Save | `key rejected` |

(The last two have no client-side validation — a refused WRITE is the same class: a Retry cannot fix it either.) Also update `HouseholdCard.test.tsx:115`: `'household unavailable'` becomes `"Couldn't load the household — the server had a problem (HTTP 503)"`, and its Retry query becomes `{ name: 'Retry loading the household' }`.

- [ ] **Step 2: Run and watch them fail.** `npx vitest run src/components/settings` → FAIL (the alert still carries a Retry; the load sentences are bare).
- [ ] **Step 3: Implement — the same five edits in each card.**
  1. `const [error, setError] = useState<string | null>(null)` becomes two, with the reason above them: `// Two slots, because they have two different answers (2026-09-05 motion spec §9): a load failure is fixed by asking again; a refused save or a typo is not.` → `const [loadError, setLoadError] = useState<string | null>(null)` and `const [formError, setFormError] = useState<string | null>(null)`.
  2. The `load` chain's `.then` clears `setLoadError(null)`; its `.catch` becomes `setLoadError(describeError(err, '<noun>'))`, importing `describeError` from `'../../api/client'`. Nouns: `the accounts` (and `the portfolio accounts` for that card's second feed), `the categories`, `the household`, `the contribution limits`, `the assistant settings`.
  3. Every other `setError` — validation guards, write `.catch`es, and the "a keystroke retires the sentence" `setError(null)` calls — becomes `setFormError`. The card's local `message(err, fallback)` helper stays: a refused write's sentence is the server's, not a load grammar.
  4. The card-top banner becomes `<FeedBanner error={loadError} retry={load} retryLabel="Retry loading <noun>" />` (LimitsCard keeps `retry={() => load(year)}`), and the guard beside it becomes `{!loaded && loadError === null && …}`.
  5. `<FeedBanner error={formError} />` goes inline, immediately after the `</div>` that closes `.settings-card-actions` and before `</form>` — the `SettingsPage.tsx:489` idiom. HouseholdCard is the exception: two forms share one slot, so its banner goes between them, right after the members `</form>` (~:202), where it is inline for both.
- [ ] **Step 4: Run.** `npx vitest run src/components/settings src/pages/SettingsPage.test.tsx` → PASS.
- [ ] **Step 5: Mutation check.** In `AccountsCard.tsx` point the inline banner at `loadError` and give it `retry={load}`; run its test file. Expected: FAIL — "renders a validation error inline…" finds a button. Revert; change the load catch's noun to `'accounts'`. Expected: FAIL — the load-sentence pin. Revert. Expected: PASS.
- [ ] **Step 6: Commit.** `npx tsc -b && npx eslint src/components/settings && git add -A && git commit -m "fix(settings): split loadError from formError in the five CRUD cards (motion spec §9)"`

### Task 4: the three multi-feed pages get one banner and one Retry each

**Files:** `src/pages/EsppPage.tsx` (three feeds), `PaycheckPage.tsx` and `CompPage.tsx` (two each), and their three `.test.tsx`. ESPP leads; the other two are the same shape.

- [ ] **Step 1: Write the failing tests.** Rewrite two expectations — "offers a retry when the lots load fails" expects `"Couldn't load the lots — the server had a problem (HTTP 503)"` with the button `{ name: 'Retry' }` (one banner needs no disambiguating label); "says the table may be behind when a RELOAD fails" expects `"Couldn't load the lots — the server had a problem (HTTP 503). Showing earlier data for the lots."` — and add:

```tsx
  it('collapses two failed loads into one banner with one Retry', async () => {
    vi.mocked(fetchLots).mockRejectedValueOnce(new ApiError('lots unavailable', 503))
    vi.mocked(fetchOfferings).mockRejectedValueOnce(new ApiError('offerings gone', 404))
    renderPage()
    // One alert, not three: three stacked banners read as three outages.
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(
      "Couldn't load the lots and the offerings — the lots: the server had a problem " +
        '(HTTP 503); the offerings: offerings gone Retry',
    )
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(vi.mocked(fetchLots)).toHaveBeenCalledTimes(2))
    expect(vi.mocked(fetchOfferings)).toHaveBeenCalledTimes(2)
  })
```

- [ ] **Step 2: Run and watch it fail.** `npx vitest run src/pages/EsppPage.test.tsx` → FAIL (three banners, old sentences).
- [ ] **Step 3: Implement.** Import `describeLoadFailures, errorDetail` from `'../api/client'`. The three load `.catch`es now store the DETAIL, not a sentence — `setLotsError(errorDetail(err))`, `setOfferingsError(errorDetail(err))`, `setModelerError(errorDetail(err))`, dropping the old fallback strings — and the three state declarations get a comment saying so. Above the `return`:

```tsx
  // ONE banner for three parallel loads (spec §9): only the parts that failed, and only the
  // ones still showing earlier data.
  const loadBanner = describeLoadFailures([
    { noun: 'the lots', detail: lotsError, stale: lots !== null },
    { noun: 'the offerings', detail: offeringsError, stale: offerings !== null },
    { noun: 'the model', detail: modelerError, stale: modeler !== null },
  ])

  // …and ONE Retry for every part that failed: the user asked for the page, not for a feed.
  // An offerings retry re-prices the chain, so it covers the modeler too.
  const retryFailedLoads = () => {
    if (lotsError !== null) reloadLots()
    if (offeringsError !== null) onOfferingsChanged()
    else if (modelerError !== null) runModeler()
  }
```

Render `<FeedBanner error={loadBanner} retry={retryFailedLoads} />` as the FIRST child of `<PageFrame>`, above the $25k tile; delete the standalone modeler banner (~:1418); drop `error`, `retry` and `retryLabel` from both `<Feed>` elements (`staleNoun` and `skeleton` stay — M3 owns those).

- [ ] **Step 4: Paycheck and Comp, same shape.** Every existing 503 expectation in `PaycheckPage.test.tsx` (`:445, 809, 813, 830`) and `CompPage.test.tsx` (`:699, 704, 718, 1257, 1266, 1274, 1276, 1279, 1293, 1300, 1302`) is rewritten mechanically: `<x> unavailable` becomes `Couldn't load {noun} — the server had a problem (HTTP 503)`, and a stale variant (`… may be showing earlier data.`) gains `. Showing earlier data for {noun}.` instead; nouns are `the breakdown`, `the profiles`, `the comp events`, `the vesting schedule`. Retry queries become `{ name: 'Retry' }`; `Comp:1257` compares the alert's `textContent`, so it keeps its trailing ` Retry`; `Comp:1276`'s regex becomes `/Showing earlier data/`. `Paycheck:399,416` (`no paycheck profiles — add one below…`, `paycheck profile not found — choose a profile below.`) must stay green untouched: the 404's own sentence is what the empty state prints, and `errorDetail` passes it through. Add to `CompPage.test.tsx`:

```tsx
  it('collapses both failed loads into one banner with one Retry', async () => {
    vi.mocked(fetchEvents).mockRejectedValueOnce(new ApiError('comp unavailable', 503))
    vi.mocked(fetchVestingSchedule).mockRejectedValueOnce(new ApiError('comp unavailable', 503))
    render(<CompPage />)
    // One reason behind both, so it is said once — above the tiles it disclaims.
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(
      "Couldn't load the vesting schedule and the comp events — the server had a problem " +
        '(HTTP 503) Retry',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(vi.mocked(fetchEvents)).toHaveBeenCalledTimes(2))
    expect(vi.mocked(fetchVestingSchedule)).toHaveBeenCalledTimes(2)
  })
```

- [ ] **Step 5: Implement both, the same shape.** `PaycheckPage.tsx`'s load `.catch`es store details (`setProfilesError(errorDetail(err))`, `setBreakdownError(errorDetail(err))`; the 404 branch keeps setting `breakdownMissing` and nulling `breakdown`), then:

```tsx
  const loadBanner = describeLoadFailures([
    // A 404 is not recoverable here: the empty state carries it, and a Retry over "add a profile"
    // answers the wrong question.
    { noun: 'the breakdown', detail: breakdownMissing ? null : breakdownError, stale: breakdown !== null },
    { noun: 'the profiles', detail: profilesError, stale: profiles !== null },
  ])
  const retryFailedLoads = () => {
    if (!breakdownMissing && breakdownError !== null) reselect(selection.profileId)
    if (profilesError !== null) reloadProfiles()
  }
```

`CompPage.tsx` renames `error`/`setError` to `eventsError`/`setEventsError` (two feeds; the bare name no longer says which), stores details in both `.catch`es, and:

```tsx
  // The schedule leads: its tiles are the page's most prominent stale surface (2026-08-31 review).
  const loadBanner = describeLoadFailures([
    { noun: 'the vesting schedule', detail: scheduleError, stale: schedule !== null },
    { noun: 'the comp events', detail: eventsError, stale: events !== null },
  ])
  const retryFailedLoads = () => {
    if (scheduleError !== null) reloadSchedule()
    if (eventsError !== null) reload()
  }
```

In both pages render `<FeedBanner error={loadBanner} retry={retryFailedLoads} />` as the FIRST child of `<PageFrame>`, and drop `error`, `retry` and `retryLabel` from every `<Feed>` on the page.

- [ ] **Step 6: Run.** `npx vitest run src/pages/EsppPage.test.tsx src/pages/PaycheckPage.test.tsx src/pages/CompPage.test.tsx` → PASS.
- [ ] **Step 7: Mutation check.** Change ESPP's lots part to `stale: false`; run its file. Expected: FAIL — the RELOAD test loses "Showing earlier data for the lots." Revert; drop the `breakdownMissing ? null :` guard in `PaycheckPage.tsx`. Expected: FAIL — the 404 empty state now also raises a load banner and the "no stale cue" assertions break. Revert; swap the two entries in Comp's `describeLoadFailures` array. Expected: FAIL — the new Comp test (nouns in the wrong order). Revert. Expected: PASS.
- [ ] **Step 8: Commit.** `npx tsc -b && npx eslint src/pages/EsppPage.tsx src/pages/PaycheckPage.tsx src/pages/CompPage.tsx && git add -A && git commit -m "fix(espp,paycheck,comp): one load banner with one Retry per page (motion spec §9)"`

### Task 5: the wizard's failed load offers a Retry, not a dead form

**Files:** `src/pages/MonthlyUpdatePage.tsx`, `src/pages/MonthlyUpdatePage.test.tsx`.

- [ ] **Step 1: Write the failing test.**

```tsx
it('offers a Retry instead of a dead form when the month fails to load', async () => {
  vi.mocked(netWorthApi.fetchAccounts).mockRejectedValueOnce(new ApiError('accounts unavailable', 503))
  renderWizard()
  expect(
    await screen.findByText("Couldn't load this month — the server had a problem (HTTP 503)"),
  ).toBeTruthy()
  // The dead form is the bug: boxes seeded with nothing, offering to save them over a real
  // month. Nothing below the banner until the load answers.
  expect(screen.queryByLabelText('Checking')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(((await screen.findByLabelText('Checking')) as HTMLInputElement).value).toBe('1500.00')
})
```

- [ ] **Step 2: Run and watch it fail.** `npx vitest run src/pages/MonthlyUpdatePage.test.tsx` → FAIL (bare message; the form renders anyway).
- [ ] **Step 3: Implement.** Import `describeError` from `'../api/client'`. Beside the existing `error` state (~:296) add `const [loadError, setLoadError] = useState<string | null>(null)`; the load effect's `.then` clears it beside the existing `setError(null)` (~:401) and its `.catch` becomes `setLoadError(describeError(err, 'this month'))` — `error` keeps carrying save failures only. Then:

```tsx
  // A failed load leaves NO seed, so the form would be empty boxes offering to save themselves
  // over a real month (PortfolioPage rule); the nonce re-runs the [month, loadNonce] effect.
  const retryLoad = () => {
    setLoadError(null)
    setLoading(true)
    setLoadNonce((n) => n + 1)
  }
```

…and the `resource` prop (~:1174), replacing the "wizard is a FORM" comment:

```tsx
        // The wizard is a FORM, not a feed — its SAVE failures are banners inside it. Its
        // LOAD is a lifecycle like any other page's, so it goes through the frame.
        resource={
          loadError !== null
            ? { status: 'error', error: loadError, retry: retryLoad }
            : { status: 'ready' }
        }
```

- [ ] **Step 4: Run.** `npx vitest run src/pages/MonthlyUpdatePage.test.tsx` → PASS. (`PageFrame` renders children only while `status === 'ready'`, so the form, the step bodies and the save buttons all go behind the alert.)
- [ ] **Step 5: Mutation check.** Force `resource={{ status: 'ready' }}` and render the failure as `<FeedBanner error={loadError} retry={retryLoad} />`; run the file. Expected: FAIL — `queryByLabelText('Checking')` finds the dead form. Revert; drop `setLoadNonce` from `retryLoad`. Expected: FAIL — Retry never refetches. Revert. Expected: PASS.
- [ ] **Step 6: Commit.** `npx tsc -b && npx eslint src/pages/MonthlyUpdatePage.tsx src/pages/MonthlyUpdatePage.test.tsx && git add -A && git commit -m "fix(wizard): a failed month load goes through the frame with a Retry (motion spec §9)"`

### Task 6: lane gate

- [ ] **Step 1: Full suite.** From the worktree root: `npx tsc -b`, `npx eslint .`, `npx vitest run` — all green, nothing skipped. A failure outside this lane's files is a real regression, not a flake.
- [ ] **Step 2: Grammar sweep.** `grep -rn "Failed to load\|Could not load" src --include=*.tsx --include=*.ts | grep -v test` returns nothing from the nine files this lane owns; every one of their load `.catch`es goes through `errorDetail` or `describeError`. Survivors elsewhere belong to other pages — note them, do not widen this lane.
- [ ] **Step 3: Merge contract.** `git diff --stat main` touches only the files listed at the top; `git diff main -- src/components/shell/Feed.tsx` is EMPTY (M3 owns it — M4 changed only its test); `git diff main -- src/components/panels.css` is confined to the InfoHint block with nothing appended at the end (M2's region).
- [ ] **Step 4: Report.** Hand back the suites and counts, the sentences now on screen (one per surface), and anything deferred. Do not merge, do not push — lane V verifies on `main` after M2 → M1 → M3 → M4 land.
