# Lane B — Paycheck & Projection frontend (ESPP pace + employer match) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the ESPP row's purchase-year window and practical cap, and the employer 401(k) match, on every frontend surface that already talks about contributions.

**Architecture:** Frontend only. Every figure on screen is the server's; the client picks clauses and positions on a track (`fillPct`'s existing licence). Wire types land first so the rest typechecks; each later task is one surface. Tests mock the API, so this lane runs beside lane A (backend) and merges after it.

**Tech Stack:** React 19 + TypeScript, vitest + @testing-library/react (jsdom), plain CSS on the app's tokens.

**Spec:** `docs/superpowers/specs/2026-09-06-pace-match-settings-movers-design.md` §0, §1.6–§1.8, §2.3, §2.4, §6. Out of lane: backend (A), Settings page (C), Net Worth movers (D).

**Decisions already taken — do not re-litigate:**
1. The spec's `ProfileOut` / `ProfileIn` / `ProfileOverrides` are backend names; the TS ones are `PaycheckProfileOut`, `PaycheckProfileCreate` (`PaycheckProfileUpdate` is `Partial<>` of it) and `PaycheckPreviewOverrides`.
2. §1.7's "At your current {pct}%" prints the SERVER's `current_rate` (the ESPP percentage the projection used, a 9dp fraction added to the wire by lane A, coordinator decision 2026-09-06) — never a client re-derivation. When the field is absent (pre-batch snapshot) the sentence falls back to "At your current rate, …"; the zero variant keys off `projected_full_year === 0`, a state read.
3. New `PaceItem` fields are optional (`?:`) — this page paints from warm localStorage snapshots written before this batch. The four profile match columns are required, as `hsa_coverage` was.
4. `.pace-overflow-tick` keys off `Number(ratio) > 1` (the fill was clamped), not `tone === 'over'`: tone now follows `soft_ratio`, so an ESPP row can be "over" mid-track. Unchanged for every other row.
5. The Projection's arithmetic line lives in `src/components/projection/ScenarioPanel.tsx`, not `ProjectionPage.tsx` (the spec's file map is one level off).
6. The match boxes are one ordered table (rate 1, band 1, rate 2, band 2) driving the form's render, its validation and Try-it's knobs — the policy reads in the order it applies, and the three cannot drift.

**Every task:** write the test, watch it fail, implement, watch it pass, commit. Comments in the snippets below are the minimum; match the house's density when you paste.

---

### Task 1: Wire types

**Files:** modify `src/types/api.ts`; repair fixtures in `src/components/paycheck/{paycheckScenario.test.ts,TryItPanel.test.tsx,paycheckSankeyOptions.test.ts}`, `src/pages/{PaycheckPage,ProjectionPage}.test.tsx`, `src/charts/fixtures/paycheckSankey.fixture.ts`, `src/components/projection/ScenarioPanel.test.tsx`, `src/api/paycheck.test.ts`.

- [ ] **Step 1: Replace the `PaceItem` block (~line 1989)**

```ts
/** One half of the ESPP purchase-year window (spec §1.3). `amount` is the server's figure;
 *  `source` says whether the user typed it or the paydays implied it. */
export interface PaceHalf {
  label: string
  start: string
  end: string
  amount: string
  source: 'entered' | 'estimated'
  basis: 'paydays' | 'months'
}

// One contribution line annualized from the profile in force, against the year's entered
// cap. `limit`/`ratio` are null together when nothing has been entered for that key — the
// strip then links to Settings rather than drawing a fabricated 100 %.
// The 2026-09-06 fields are OPTIONAL, not required-nullable: a warm snapshot written before
// that batch is a legal payload for this page to paint from.
export interface PaceItem {
  key: string
  label: string
  annualized: string
  limit: string | null
  ratio: string | null // 4dp fraction, e.g. "0.9500" — the tone was judged on THIS value
  tone: 'ok' | 'warn' | 'over'
  /** What `annualized` holds: a full-year projection, or the purchase-year window's total. */
  measure?: 'annualized' | 'window'
  /** ESPP only: the most contribution dollars the §423 cap buys at the plan discount. */
  soft_limit?: string | null
  soft_ratio?: string | null // 4dp — the tone and the printed percentage follow THIS one
  window_label?: string | null
  halves?: PaceHalf[] | null
  backfilled_from?: string | null
  projected_full_year?: string | null
  projected_excess?: string | null
  /** ESPP only: the percentage the projection used, a 9dp fraction ("0.120000000"). */
  current_rate?: string | null
  /** 415(c) only: the employer match already inside `annualized` (spec §2.3). */
  employer_match?: string | null
}
```

- [ ] **Step 2: Add the match columns, `in_force`, the overrides and the employer legs**

In `PaycheckProfileOut` after `hsa_coverage`, and the same four as optional (`?:`) in `PaycheckProfileCreate` after its `hsa_coverage?:`:

```ts
  // The employer 401(k) match policy, per person and effective-dated (spec §2.1). Rates are
  // 9dp fractions ("1.000000000" = a full match); bands are dollars of elective deferral.
  // Zero bands mean "no match". NOT NULL server-side, server_default '0'.
  match_rate_1: string
  match_band_1: string
  match_rate_2: string
  match_band_2: string
```

Then: end of `PaycheckProfileOut`, after `notes` — `/** In force today (spec §2.3), the server's one rule. Absent on a pre-batch snapshot. */` + `in_force?: boolean`. `PaycheckPreviewOverrides` after `hsa_coverage?:` — the same four names as `?: string`. `PaycheckBreakdownOut` after `monthly_net` — `/** This check's employer match — NOT a waterfall line: it is not part of the pay the eleven lines add up to (spec §2.3). */` + `employer_match: string`. `PayrollSavingOut` after `monthly` — `employer_monthly: string`. `ContributionBreakdownOut` after `payroll` — `employer: string`.

- [ ] **Step 3: `npx tsc -b`** → FAIL: "Property 'match_rate_1' is missing" / "'employer_match' is missing" / "'employer' is missing".
- [ ] **Step 4: Repair every fixture tsc names.** Into each `PaycheckProfileOut` literal (`paycheckScenario.test.ts:14`, `TryItPanel.test.tsx:23`, `PaycheckPage.test.tsx`'s `profile2026` and `profile2025`, `paycheckSankey.fixture.ts:24`, `paycheckSankeyOptions.test.ts:23`, `api/paycheck.test.ts` if named):

```ts
  match_rate_1: '1.000000000',
  match_band_1: '6000.00',
  match_rate_2: '0.500000000',
  match_band_2: '11000.00',
```

Into each `PaycheckBreakdownOut` literal (`TryItPanel.test.tsx:53`, `PaycheckPage.test.tsx`'s `breakdownOf` base, `paycheckSankey.fixture.ts`, `paycheckSankeyOptions.test.ts`): `employer_match: '479.17',`. Into `ProjectionPage.test.tsx:246` and `ScenarioPanel.test.tsx:206`: `employer: '0.00',` plus `employer_monthly: '0.00',` on each `by_person` row.

- [ ] **Step 5: `npx tsc -b`** → clean. Commit: `git add -A && git commit -m "types(paycheck): pace window/soft-cap fields, the match columns and the employer legs"`

---

### Task 2: The ESPP row's window, practical cap and tick

**Files:** modify `src/components/paycheck/PacePanel.tsx`, `src/components/paycheck/pace.css`; test `src/components/paycheck/PacePanel.test.tsx`. `TryItPanel` already renders this component from `result.pace.scenario` and gets the new row for free — spec §1.7 gives it no controls of its own, so do not add any.

- [ ] **Step 1: Add the fixture after `MISSING`, and the three tests at the end of the file**

```tsx
// Production's golden row (spec §1.4): 11 % then 12 % of 188,930 across the two halves.
const ESPP: PaceItem = {
  key: 'limit_espp_423',
  label: 'ESPP §423 annual',
  annualized: '20861.02',
  limit: '25000.00',
  ratio: '0.8344',
  tone: 'warn',
  measure: 'window',
  soft_limit: '21250.00',
  soft_ratio: '0.9817',
  window_label: 'Sep 2025 – Aug 2026 purchases',
  halves: [
    { label: 'Feb 2026', start: '2025-09-01', end: '2026-02-27', amount: '10391.15', source: 'estimated', basis: 'paydays' },
    { label: 'Aug 2026', start: '2026-03-01', end: '2026-08-31', amount: '10469.87', source: 'estimated', basis: 'paydays' },
  ],
  backfilled_from: null,
  projected_full_year: '22671.60',
  projected_excess: '1421.60',
  current_rate: '0.120000000',
}

it('grades the ESPP row against the PRACTICAL cap, not the §423 one', () => {
  renderPanel([ESPP])
  const meter = screen.getByRole('meter')
  // Both caps out loud: the one the verdict used, and the statutory one it derives from —
  // a reader who only heard "21,250" would think the law said so.
  expect(meter.getAttribute('aria-valuetext')).toBe(
    '$20,861.02 of $21,250.00 practical cap; §423 cap $25,000.00',
  )
  expect(screen.getByText('$20,861.02 / $21,250.00 practical')).toBeTruthy()
  // The printed percentage is soft_ratio's, so it cannot contradict the tone beside it.
  expect(screen.getByText('98.17%')).toBeTruthy()
  expect(screen.getByText('near the cap')).toBeTruthy()
  expect(screen.getByText('Sep 2025 – Aug 2026 purchases')).toBeTruthy()
})

it('marks the practical cap on the §423 track', () => {
  renderPanel([ESPP])
  const meter = screen.getByRole('meter')
  // 21,250 / 25,000 — a POSITION, which is what the client may compute. CSSOM canonicalizes
  // the written "85.00%" on read-back, as it does the fill's width.
  expect((meter.querySelector('.pace-soft-tick') as HTMLElement).style.left).toBe('85%')
  // The fill still runs on the §423 ratio: the track is the statutory cap, end to end.
  expect((meter.querySelector('.pace-fill') as HTMLElement).style.width).toBe('83.44%')
})

it('draws the overflow tick for a clamped FILL, never for a soft-capped verdict', () => {
  // Over the practical cap, nowhere near the §423 one: nothing overflowed the track, so a
  // tick past its end would describe something that did not happen.
  renderPanel([{ ...ESPP, soft_ratio: '1.0400', tone: 'over', annualized: '22100.00' }])
  expect(screen.getByRole('meter').querySelector('.pace-overflow-tick')).toBeNull()
  expect(screen.getByText('over')).toBeTruthy()
  cleanup()
  renderPanel([OVER])
  expect(screen.getByRole('meter').querySelector('.pace-overflow-tick')).toBeTruthy()
})
```

- [ ] **Step 2: `npx vitest run src/components/paycheck/PacePanel.test.tsx`** → FAIL: valuetext reads `of $25,000.00`, no `.pace-soft-tick`, the overflow tick shows on the soft-capped row.
- [ ] **Step 3: Add `tickPct` beside `fillPct`**

```tsx
// The practical cap's POSITION on the §423 track (spec §1.7) — fillPct's licence: a position
// is the client's to compute, the dollars beside it are always the server's.
function tickPct(soft: string, limit: string): number {
  return Math.min(Math.max((Number(soft) / Number(limit)) * 100, 0), 100)
}
```

- [ ] **Step 4: Replace the whole `items.map(...)` with this block form.** Keep the file's existing long comments on `aria-valuenow` and on the verdict's 2dp — they still apply verbatim.

```tsx
        {items.map((item) => {
          // Present together or not at all: the ESPP row is the only one the server sends a
          // practical cap for, so every other row falls through unchanged.
          const softLimit = item.soft_limit ?? null
          const softRatio = item.soft_ratio ?? null
          const figures =
            softLimit !== null
              ? `${formatCurrency(item.annualized)} / ${formatCurrency(softLimit)} practical`
              : `${formatCurrency(item.annualized)} / ${formatCurrency(item.limit)}`
          const valueText =
            softLimit !== null
              ? `${formatCurrency(item.annualized)} of ${formatCurrency(softLimit)} practical cap; §423 cap ${formatCurrency(item.limit)}`
              : `${formatCurrency(item.annualized)} of ${formatCurrency(item.limit)}`
          return (
            <div className="pace-row" key={item.key}>
              <span className="pace-name">
                {item.label}
                {item.window_label != null && <span className="pace-window">{item.window_label}</span>}
              </span>
              {item.limit === null || item.ratio === null ? (
                <>
                  <span className="pace-figures">{formatCurrency(item.annualized)}</span>
                  <span className="pace-cta">
                    <Link to="/settings">enter this year&apos;s limit</Link>
                  </span>
                </>
              ) : (
                <>
                  <div
                    className="pace-meter"
                    role="meter"
                    aria-label={`${item.label} ${item.measure === 'window' ? 'window total' : 'annualized'} vs limit`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.min(Math.round(Number(item.ratio) * 100), 100)}
                    aria-valuetext={valueText}
                  >
                    <div
                      className={`pace-fill is-${item.tone}`}
                      style={{ width: `${fillPct(item.ratio).toFixed(2)}%` }}
                    />
                    {softLimit !== null && (
                      <span
                        className="pace-soft-tick"
                        aria-hidden="true"
                        style={{ left: `${tickPct(softLimit, item.limit).toFixed(2)}%` }}
                      />
                    )}
                    {/* The FILL's clamp, not the tone: the ESPP row's tone is judged on the
                        practical cap, so an "over" row can sit mid-track — and a tick past
                        the end would then describe an overflow that never happened. */}
                    {Number(item.ratio) > 1 && <span className="pace-overflow-tick" aria-hidden="true" />}
                  </div>
                  <span className={`pace-figures tone-${item.tone}`}>{figures}</span>
                  <span className={`pace-verdict tone-${item.tone}`}>
                    {/* soft_ratio where there is one: the ratio the TONE was judged on. */}
                    {`${(Number(softRatio ?? item.ratio) * 100).toFixed(2)}%`}
                    <span className="pace-verdict-word">{TONE_WORD[item.tone]}</span>
                  </span>
                </>
              )}
            </div>
          )
        })}
```

- [ ] **Step 5: Append to `pace.css`** — the name cell becomes a column so a windowless row lays out as before; the tick restates `sandbox.css`'s `.slider-box-tick` rather than importing it.

```css
.pace-name { display: flex; flex-direction: column; gap: 0.1rem; }
.pace-window { font-size: 0.72rem; color: var(--muted); }
.pace-soft-tick {
  position: absolute;
  top: 0;
  width: 2px;
  height: 100%;
  background: var(--muted);
  transform: translateX(-1px);
  pointer-events: none;
  opacity: 0.7;
}
```

- [ ] **Step 6: `npx vitest run src/components/paycheck/PacePanel.test.tsx`** → PASS, including the eight tests already there. Commit: `git add -A && git commit -m "feat(pace): the ESPP row grades its purchase-year window against the practical cap"`

---

### Task 3: The note line, the 415(c) match suffix and the card's hint

**Files:** modify `src/components/paycheck/PacePanel.tsx`, `src/components/paycheck/pace.css`; test `src/components/paycheck/PacePanel.test.tsx`.

- [ ] **Step 1: Add `fireEvent` to the testing-library import and these tests; delete the old `it('names the employer-match caveat the server put in the label', …)` (~lines 101–104), whose successor is here**

```tsx
// The card's hint is a disclosure: click the ⓘ, read the bubble, Escape (OverviewPage's helper).
function hintText(name: RegExp): string {
  fireEvent.click(screen.getByRole('button', { name }))
  const text = screen.getByRole('tooltip').textContent ?? ''
  fireEvent.keyDown(window, { key: 'Escape' })
  return text
}

it('says where each half of the window came from, and what a full purchase year costs', () => {
  renderPanel([ESPP])
  expect(
    screen.getByText(
      'Feb 2026 estimated · Aug 2026 estimated. At your current 12%, a full purchase year is $22,671.60, which is $1,421.60 over the practical cap; the plan refunds the excess after the purchase.',
    ),
  ).toBeTruthy()
})

it('names the backfill and the per-month approximation, and stops projecting at a zero rate', () => {
  renderPanel([
    {
      ...ESPP,
      halves: [{ ...ESPP.halves![0], source: 'entered' }, { ...ESPP.halves![1], basis: 'months' }],
      backfilled_from: '2026-01-01',
      projected_full_year: '18000.00',
      projected_excess: '0.00',
    },
  ])
  expect(
    screen.getByText(
      'Feb 2026 entered · Aug 2026 estimated · before Jan 1, 2026 assumes your earliest profile · estimated by month. At your current 12%, a full purchase year is $18,000.00.',
    ),
  ).toBeTruthy()
  cleanup()
  // A pre-batch snapshot has no current_rate: the sentence still reads, without the number.
  renderPanel([{ ...ESPP, current_rate: undefined }])
  expect(screen.getByText(/At your current rate, a full purchase year is \$22,671\.60/)).toBeTruthy()
  cleanup()
  renderPanel([{ ...ESPP, projected_full_year: '0.00', projected_excess: '0.00' }])
  expect(
    screen.getByText('Feb 2026 estimated · Aug 2026 estimated. You are not contributing now.'),
  ).toBeTruthy()
})

it('prints the employer match inside the 415(c) figure, under whichever label the server sent', () => {
  renderPanel([{ ...MISSING, label: '415(c) total additions (incl. employer match)', employer_match: '11500.00' }])
  expect(screen.getByText(/incl\. \$11,500\.00 match/)).toBeTruthy()
  expect(screen.getByText(/incl\. employer match/)).toBeTruthy()
  cleanup()
  // No policy, no suffix — never "incl. $0.00" — and the server's other label prints too.
  renderPanel([MISSING])
  expect(screen.queryByText(/incl\./)).toBeNull()
  expect(screen.getByText(/excludes employer match/)).toBeTruthy()
})

it('sends the reader to the profile for the match, and to the ESPP page for the chained figures', () => {
  renderPanel([OK])
  const text = hintText(/^About Each contribution line/)
  expect(text).toContain('set your 401(k) match on your paycheck profile')
  expect(text).not.toContain('Employer 401(k) match and employer HSA contributions')
  expect(text).toContain('autumn checks count toward next year')
})
```

- [ ] **Step 2: `npx vitest run src/components/paycheck/PacePanel.test.tsx`** → FAIL: no note text, no `incl.` suffix, the hint still says "not modeled".
- [ ] **Step 3: Add `formatDate` to the `../../utils/format` import, add `import { shiftPoint } from '../../utils/percent'`, and this composer above `PacePanel`**

```tsx
/**
 * The ESPP row's provenance and forward sentences (spec §1.7). Every figure is the server's
 * — the client only picks clauses, and a zero is a state read, not a computation. The
 * percentage is the server's `current_rate` (a 9dp fraction) shifted to percent for display;
 * a pre-batch snapshot without it falls back to "your current rate" rather than deriving one.
 */
function paceNote(item: PaceItem): string | null {
  const halves = item.halves ?? null
  if (halves === null || halves.length === 0) return null
  const parts = halves.map((half) => `${half.label} ${half.source}`)
  if (item.backfilled_from != null) {
    parts.push(`before ${formatDate(item.backfilled_from)} assumes your earliest profile`)
  }
  // One clause for the whole window: the basis is the profile's cadence, and saying it twice
  // would read as two different approximations.
  if (halves.some((half) => half.basis === 'months')) parts.push('estimated by month')
  const projected = item.projected_full_year
  if (projected == null) return `${parts.join(' · ')}.`
  if (Number(projected) === 0) return `${parts.join(' · ')}. You are not contributing now.`
  // Number() drops the 9dp tail ("12.0000000" → 12) without touching the digits that matter.
  const rate = item.current_rate != null ? `${Number(shiftPoint(item.current_rate, 2))}%` : 'rate'
  const excess =
    item.projected_excess != null && Number(item.projected_excess) > 0
      ? `, which is ${formatCurrency(item.projected_excess)} over the practical cap; the plan refunds the excess after the purchase`
      : ''
  return `${parts.join(' · ')}. At your current ${rate}, a full purchase year is ${formatCurrency(projected)}${excess}.`
}
```

- [ ] **Step 4: Render them.** In the `items.map` body, after `valueText`:

```tsx
          const note = paceNote(item)
          // Muted inside the figures cell: a component of the figure, not a second verdict.
          const matchSuffix =
            item.employer_match == null ? null : (
              <span className="pace-match">{` incl. ${formatCurrency(item.employer_match)} match`}</span>
            )
```

CTA branch: `<span className="pace-figures">{formatCurrency(item.annualized)}{matchSuffix}</span>`. Meter branch: ``<span className={`pace-figures tone-${item.tone}`}>{figures}{matchSuffix}</span>``. Last child of `.pace-row`, after the ternary's `)}`: `{note !== null && <p className="pace-note">{note}</p>}`.

- [ ] **Step 5: Replace the `<h2>`'s InfoHint `text` with this exact sentence run**

```tsx
        <InfoHint text="Each contribution line annualized from the paycheck profile in force, against the caps you entered in Settings. A projection at today's percentages — not a year-to-date total, which this app has no per-paycheck ledger to compute. Employer HSA contributions are not modeled; set your 401(k) match on your paycheck profile. The ESPP row grades the purchases that fall in this calendar year, so autumn checks count toward next year. Its cap is the most contribution dollars the §423 limit can buy at your plan discount; the exact chained figures live on the ESPP page." />
```

- [ ] **Step 6: Append to `pace.css`** — the note is full width under the four columns; the suffix keeps its own colour so the cell's tone cannot claim it as a verdict.

```css
.pace-note {
  grid-column: 1 / -1;
  margin: 0;
  font-size: 0.72rem;
  line-height: 1.45;
  color: var(--muted);
}
.pace-match { color: var(--muted); font-size: 0.72rem; }
```

- [ ] **Step 7: `npx vitest run src/components/paycheck/PacePanel.test.tsx`** → PASS. Commit: `git add -A && git commit -m "feat(pace): the ESPP row's provenance line and the 415(c) row's employer match"`

---

### Task 4: The profile form's match fieldset

**Files:** modify `src/pages/PaycheckPage.tsx`, `src/pages/PaycheckPage.css`, `src/components/paycheck/paycheckScenario.ts`; test `src/pages/PaycheckPage.test.tsx`, `src/components/paycheck/paycheckScenario.test.ts`.

- [ ] **Step 1: Add these to the profile-form `describe` in `PaycheckPage.test.tsx`**

```tsx
  it('carries the match policy forward into the next profile, in the box’s own words', async () => {
    render(<PaycheckPage />, { wrapper: MemoryRouter })
    await screen.findByText('$3,384.16')
    // The stored fraction is 1.000000000; the box holds a percent, like every other rate.
    expect(field('First match rate %').value).toBe('100%')
    expect(field('First match band').value).toBe('$6,000.00')
    expect(field('Second match rate %').value).toBe('50%')
    expect(field('Second match band').value).toBe('$11,000.00')
    expect(screen.getByText('100% of the first $6,000.00, then 50% of the next $11,000.00')).toBeTruthy()
  })

  it('says a household with no policy has no match, rather than printing zeros', async () => {
    vi.mocked(fetchProfiles).mockResolvedValue([
      { ...profile2026, match_rate_1: '0.000000000', match_band_1: '0.00', match_rate_2: '0.000000000', match_band_2: '0.00' },
    ])
    render(<PaycheckPage />, { wrapper: MemoryRouter })
    await screen.findByText('$3,384.16')
    expect(await screen.findByText('No employer match entered.')).toBeTruthy()
  })

  it('posts the match rates as fractions and the bands as money', async () => {
    render(<PaycheckPage />, { wrapper: MemoryRouter })
    await screen.findByText('$3,384.16')
    type('Effective date', '2026-07-01')
    type('First match rate %', '75')
    type('Second match band', '9000')
    fireEvent.click(screen.getByRole('button', { name: 'Add profile' }))
    await waitFor(() => expect(vi.mocked(createProfile)).toHaveBeenCalledTimes(1))
    const body = vi.mocked(createProfile).mock.calls[0][0]
    expect(body.match_rate_1).toBe('0.75')
    expect(body.match_band_1).toBe('6000.00')
    expect(body.match_rate_2).toBe('0.5')
    expect(body.match_band_2).toBe('9000')
  })

  it('bounds a match rate at a full doubling, in the box’s vocabulary', async () => {
    render(<PaycheckPage />, { wrapper: MemoryRouter })
    await screen.findByText('$3,384.16')
    type('Effective date', '2026-07-01')
    // The server's fence is the stored fraction's [0, 2]; this box says percents, so its
    // sentence says 200 — quoting the column's would call a legal 100 out of range.
    type('First match rate %', '250')
    fireEvent.click(screen.getByRole('button', { name: 'Add profile' }))
    expect(await screen.findByText('First match rate % must be between 0 and 200')).toBeTruthy()
    expect(vi.mocked(createProfile)).not.toHaveBeenCalled()
    type('First match rate %', '100')
    type('First match band', '-5')
    fireEvent.click(screen.getByRole('button', { name: 'Add profile' }))
    expect(await screen.findByText('First match band must be >= 0')).toBeTruthy()
    expect(vi.mocked(createProfile)).not.toHaveBeenCalled()
  })
```

Extend the `toEqual` body in `it('posts the full profile with every percent shifted, never divided')` with `match_rate_1: '1', match_band_1: '6000.00', match_rate_2: '0.5', match_band_2: '11000.00',`.

- [ ] **Step 2: `npx vitest run src/pages/PaycheckPage.test.tsx`** → FAIL: "Unable to find a label with the text of: First match rate %".
- [ ] **Step 3: Extend the form's state, its table and its seeds (`PaycheckPage.tsx`).** Add to `ProfileFormState` after `hsa_coverage`: `match_rate_1: string` (`// percent form — "100" for a full match, never "1.000000000"`), `match_band_1: string`, `match_rate_2: string`, `match_band_2: string`. Below `PCT_FIELDS`:

```ts
type MatchField = 'match_rate_1' | 'match_band_1' | 'match_rate_2' | 'match_band_2'

// ONE table in the order the policy applies, read by the boxes, the range check and the
// sentence — so the three cannot drift. The rates may NOT join PCT_FIELDS: that loop's
// fence is 0–100, and a match rate may double the deferral.
const MATCH_FIELDS: { field: MatchField; label: string; rate: boolean }[] = [
  { field: 'match_rate_1', label: 'First match rate %', rate: true },
  { field: 'match_band_1', label: 'First match band', rate: false },
  { field: 'match_rate_2', label: 'Second match rate %', rate: true },
  { field: 'match_band_2', label: 'Second match band', rate: false },
]

/** The policy in words (spec §2.3), read back from the FORM's own state — typed input, not a
 *  server figure re-derived. Zero bands are the stored way to say "no match". */
function matchWords(form: ProfileFormState): string {
  const num = (text: string) => Number(canonicalAmount(text.trim() || '0', { expressions: false }))
  const band1 = num(form.match_band_1)
  const band2 = num(form.match_band_2)
  if (band1 <= 0 && band2 <= 0) return 'No employer match entered.'
  const first = `${form.match_rate_1.trim() || '0'}% of the first ${formatCurrency(String(band1))}`
  if (band2 <= 0) return `${first}.`
  return `${first}, then ${form.match_rate_2.trim() || '0'}% of the next ${formatCurrency(String(band2))}`
}
```

Add `match_rate_1: '', match_band_1: '', match_rate_2: '', match_band_2: '',` to `EMPTY_PROFILE`; to `formFrom`, `match_rate_1: shiftPoint(profile.match_rate_1, 2)`, `match_band_1: profile.match_band_1`, and the same pair for `_2`. `newProfileForm` needs no edit — it spreads `formFrom(latest)`, so the policy carries forward with everything that is not the date or the note.

- [ ] **Step 4: Validate and post.** After the `PCT_FIELDS` loop in `submit`:

```ts
    for (const { field, label, rate } of MATCH_FIELDS) {
      const text = form[field].trim()
      // Percent boxes refuse expressions and exponents, exactly as the five pcts do.
      if (text !== '' && !isAmount(text, rate ? { expressions: false } : undefined)) {
        setError(`${label} must be a number`)
        return
      }
      const value = Number(canonicalAmount(text || '0', rate ? { expressions: false } : undefined))
      if (value < 0) {
        setError(`${label} must be >= 0`)
        return
      }
      if (rate && value > 200) {
        setError(`${label} must be between 0 and 200`)
        return
      }
    }
```

In the `body` literal, after `hsa_coverage` — the same shift as the five pcts, because 75 / 100 is exact only as string math, and blank is a real zero here too:

```ts
      match_rate_1: shiftPoint(canonicalAmount(form.match_rate_1.trim() || '0', { expressions: false }), -2),
      match_band_1: canonicalAmount(form.match_band_1.trim() || '0'),
      match_rate_2: shiftPoint(canonicalAmount(form.match_rate_2.trim() || '0', { expressions: false }), -2),
      match_band_2: canonicalAmount(form.match_band_2.trim() || '0'),
```

- [ ] **Step 5: Render the fieldset** between the HSA-coverage `<label>` and the Notes one — one rule around four boxes, because the match is a POLICY, not four unrelated columns:

```tsx
        <fieldset className="paycheck-match">
          <legend>Employer 401(k) match</legend>
          {MATCH_FIELDS.map(({ field, label, rate }) => (
            <label key={field}>
              {label}
              <AmountInput
                kind={rate ? 'percent' : 'money'}
                value={form[field]}
                onValueChange={set(field)}
              />
            </label>
          ))}
          <p className="paycheck-match-words">{matchWords(form)}</p>
        </fieldset>
```

- [ ] **Step 6: Append to `src/pages/PaycheckPage.css`**

```css
.paycheck-form .paycheck-match {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.6rem;
  align-items: end;
  margin: 0;
  padding: 0.5rem 0.75rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.paycheck-form .paycheck-match legend {
  padding: 0 0.35rem;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--muted);
}
.paycheck-match-words { grid-column: 1 / -1; margin: 0; font-size: 0.75rem; color: var(--muted); }
```

- [ ] **Step 7: Keep the Apply seed in the form's shape (`paycheckScenario.ts`).** The panel seeds its state from `ApplySeed`, so it must carry every box: add the four `string` fields to the interface after `hsa_coverage`, and to `applySeedFor`'s object `match_rate_1: shiftPoint(profile.match_rate_1, 2)`, `match_band_1: profile.match_band_1` and the `_2` pair (Task 6 makes them scenario-aware — it cannot be done yet, the four are not knobs until then). Add the same four keys — `'100'`, `'6000.00'`, `'50'`, `'11000.00'` — to the seed's `toEqual` in `paycheckScenario.test.ts` (~line 191).
- [ ] **Step 8: `npx vitest run src/pages/PaycheckPage.test.tsx src/components/paycheck/paycheckScenario.test.ts`** → PASS. Commit: `git add -A && git commit -m "feat(paycheck): the profile form carries an employer 401(k) match policy"`

---

### Task 5: The breakdown's employer-match line

**Files:** modify `src/pages/PaycheckPage.tsx` (`BreakdownPanel`); test `src/pages/PaycheckPage.test.tsx`.

- [ ] **Step 1: Write the test**

```tsx
it('names the employer match under the waterfall, outside the pay it adds up', async () => {
  vi.mocked(fetchBreakdown).mockResolvedValue(breakdownOf(profile2026, { employer_match: '479.17' }))
  render(<PaycheckPage />, { wrapper: MemoryRouter })
  expect(await screen.findByText('Employer match +$479.17 per check, not part of your pay.')).toBeTruthy()
  cleanup()
  // No policy, no line — "+$0.00" would be a deduction-shaped nothing.
  vi.mocked(fetchBreakdown).mockResolvedValue(breakdownOf(profile2026, { employer_match: '0.00' }))
  render(<PaycheckPage />, { wrapper: MemoryRouter })
  await screen.findByText('$3,384.16')
  expect(screen.queryByText(/Employer match/)).toBeNull()
})
```

- [ ] **Step 2: `npx vitest run src/pages/PaycheckPage.test.tsx`** → FAIL: "Unable to find an element with the text: Employer match +$479.17 per check…".
- [ ] **Step 3: Render it right after the closing `</dl>` of `.paycheck-waterfall`**

```tsx
      {/* NOT a waterfall line: the match never passes through this check, so listing it
          would make the eleven lines add up to something that is not the pay. */}
      {Number(data.employer_match) !== 0 && (
        <p className="drill-hint">
          Employer match +{formatCurrency(data.employer_match)} per check, not part of your pay.
        </p>
      )}
```

- [ ] **Step 4: `npx vitest run src/pages/PaycheckPage.test.tsx`** → PASS. Commit: `git add -A && git commit -m "feat(paycheck): the per-check breakdown names the employer match beside the pay"`

---

### Task 6: Try-it's employer-match disclosure

**Files:** modify `src/components/paycheck/paycheckScenario.ts`, `src/components/paycheck/TryItPanel.tsx`, `src/sandbox/sandbox.css`; test both paycheck test files.

- [ ] **Step 1: Write the tests.** In `paycheckScenario.test.ts`:

```ts
  it('carries the match knobs with their own fences — rates to 2, bands only non-negative', () => {
    expect(decodePaycheck(['match_rate_1:1.5', 'match_band_1:6000', 'match_rate_2:2.5', 'match_band_2:-1'])).toEqual({
      match_rate_1: '1.5',
      match_band_1: '6000',
    })
    expect(toOverrides({ match_rate_1: '1', match_band_1: '6000' })).toEqual({ match_rate_1: '1', match_band_1: '6000' })
    // A rate prints as a percent like every other rate here; a band is money. KNOBS is
    // alphabetical, so the band is the first of the two changed knobs.
    expect(labelForPaycheck({ match_rate_1: '1', match_band_1: '6000' })).toBe('Match band 1 $6,000.00 · Match 1 100%')
  })
```

In `TryItPanel.test.tsx`, in the same `describe` as `it('the coverage toggle and the salary box are knobs too')` — `mount`, `toggle` and `url` are that block's helpers, and focus/change/blur is how this file commits a `BoxKnob`:

```tsx
  it('offers the match policy as knobs, under its own disclosure', async () => {
    mount()
    fireEvent.click(toggle())
    await waitFor(() => expect(previewPaycheck).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Employer match')).toBeTruthy()
    const band = screen.getByLabelText('First match band') as HTMLInputElement
    fireEvent.focus(band)
    fireEvent.change(band, { target: { value: '8000' } })
    fireEvent.blur(band)
    // The knob reaches the server through the URL, like every other one on this panel.
    expect(url()).toBe('/paycheck?whatif=match_band_1%3A8000')
  })
```

- [ ] **Step 2: `npx vitest run src/components/paycheck/paycheckScenario.test.ts src/components/paycheck/TryItPanel.test.tsx`** → FAIL: the codec drops the knobs; no "Employer match" text.
- [ ] **Step 3: Add the knobs to the codec (`paycheckScenario.ts`).** In `KNOBS`, alphabetical (canonical) order, after `'hsa_per_check',`: `'match_band_1', 'match_band_2', 'match_rate_1', 'match_rate_2',` — one per line. `KNOB_MAX` after `after_tax_401k_pct`: `match_rate_1: '2', match_rate_2: '2',` (a full doubling is the slider's end). In `acceptKnob`, straight after `if (!isWireDecimal(value)) return false`:

```ts
  // The match's own fences: a rate may double the deferral (the server's [0, 2]); a band is
  // dollars, so nothing caps it here — the column's 422 is the backstop.
  if (key === 'match_rate_1' || key === 'match_rate_2') {
    return compareDecimals(value, '0') >= 0 && compareDecimals(value, '2') <= 0
  }
  if (key === 'match_band_1' || key === 'match_band_2') return compareDecimals(value, '0') >= 0
```

`SHORT`: `match_rate_1: 'Match 1', match_band_1: 'Match band 1', match_rate_2: 'Match 2', match_band_2: 'Match band 2',`. In `labelForPaycheck`, before the final `else`: `else if (key === 'match_rate_1' || key === 'match_rate_2') parts.push(`${SHORT[key]} ${shiftPoint(value, 2)}%`)`. In `applySeedFor`, make Task 4's four lines scenario-aware — `shiftPoint(scenario.match_rate_1 ?? profile.match_rate_1, 2)`, `scenario.match_band_1 ?? profile.match_band_1`, and the `_2` pair. `toOverrides` needs nothing: the four are plain strings, so its generic copy already carries them.

- [ ] **Step 4: Render the disclosure in `TryItPanel.tsx`**, after the periods `BoxKnob` and before the closing `drill-hint`. Behind a disclosure because the match is a policy that changes once a year, not a knob to drag — but it is the one input the 415(c) row cannot be reasoned about without.

```tsx
      <details className="sandbox-disclosure">
        <summary>Employer match</summary>
        <div className="sandbox-disclosure-grid">
          <SliderBox id="tryit-match-rate-1" label="First match rate" kind="percent" value={scenario.match_rate_1 ?? ''} actual={profile.match_rate_1} min="0" max={KNOB_MAX.match_rate_1} step="0.05" onChange={knob('match_rate_1')} />
          <BoxKnob id="tryit-match-band-1" label="First match band" kind="money" value={scenario.match_band_1 ?? ''} actual={profile.match_band_1} validate={(text) => (acceptKnob('match_band_1', text) ? null : 'First match band must be a plain amount, like 6000')} onCommit={knob('match_band_1')} />
          <SliderBox id="tryit-match-rate-2" label="Second match rate" kind="percent" value={scenario.match_rate_2 ?? ''} actual={profile.match_rate_2} min="0" max={KNOB_MAX.match_rate_2} step="0.05" onChange={knob('match_rate_2')} />
          <BoxKnob id="tryit-match-band-2" label="Second match band" kind="money" value={scenario.match_band_2 ?? ''} actual={profile.match_band_2} validate={(text) => (acceptKnob('match_band_2', text) ? null : 'Second match band must be a plain amount, like 11000')} onCommit={knob('match_band_2')} />
        </div>
      </details>
```

- [ ] **Step 5: Append to `src/sandbox/sandbox.css`** — the `<details>` keeps its default display (grid on the element breaks the closed state in some engines), so the grid lives on the child.

```css
.sandbox-disclosure { grid-column: 1 / -1; }
.sandbox-disclosure > summary {
  cursor: pointer;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--muted);
}
.sandbox-disclosure-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 0.9rem 1.25rem;
  margin-top: 0.75rem;
}
```

- [ ] **Step 6: `npx vitest run src/components/paycheck/paycheckScenario.test.ts src/components/paycheck/TryItPanel.test.tsx`** → PASS (jsdom does not hide a closed `<details>`'s children, so the boxes are queryable without opening it). Commit: `git add -A && git commit -m "feat(paycheck): Try it models the employer match under its own disclosure"`

---

### Task 7: The Projection's employer leg

**Files:** modify `src/components/projection/ScenarioPanel.tsx`; test `src/components/projection/ScenarioPanel.test.tsx`, `src/pages/ProjectionPage.test.tsx`.

- [ ] **Step 1: Write the tests.** In `ScenarioPanel.test.tsx` set the ~206 fixture to `total: '4500.00'`, `employer: '500.00'`, `by_person: [{ person_id: 1, name: 'Edward', monthly: '2400.00', employer_monthly: '500.00' }]`, and the ~221 assertion to:

```ts
      'derived: $1,200.00 cash savings + $2,800.00 payroll deductions + $500.00 employer match = $4,500.00 (Edward $2,400.00 + $500.00 match)',
```

In `ProjectionPage.test.tsx` keep the zero-match fixture (`employer: '0.00'`, both rows `employer_monthly: '0.00'`) and extend `it('spells out how a derived contribution was built')`:

```ts
    const note = await screen.findByText(/derived: \$4,000\.00 cash savings \+ \$400\.00 payroll/)
    // No policy, no leg — but the sum is still spelled out, so the reader can check it.
    expect(note.textContent).toContain('= $4,400.00 (Me $250.00 · Alex $150.00)')
    expect(note.textContent).not.toContain('employer match')
```

- [ ] **Step 2: `npx vitest run src/components/projection/ScenarioPanel.test.tsx src/pages/ProjectionPage.test.tsx`** → FAIL: the line has no employer term and no total.
- [ ] **Step 3: Replace the `.projection-derived` block (~line 186)**

```tsx
              <span className="projection-derived">
                derived: {formatCurrency(breakdown.cash)} cash savings +{' '}
                {formatCurrency(breakdown.payroll)} payroll deductions
                {Number(breakdown.employer) !== 0 &&
                  ` + ${formatCurrency(breakdown.employer)} employer match`}
                {' = '}
                {formatCurrency(breakdown.total)}
                {breakdown.by_person.length > 0 &&
                  ` (${breakdown.by_person
                    .map((row) =>
                      Number(row.employer_monthly) === 0
                        ? `${row.name} ${formatCurrency(row.monthly)}`
                        : `${row.name} ${formatCurrency(row.monthly)} + ${formatCurrency(row.employer_monthly)} match`,
                    )
                    .join(' · ')})`}
              </span>
```

- [ ] **Step 4: Keep the two prose sentences honest.** In the derivation hint (~line 40) replace `plus every earner's payroll deductions — 401(k), ESPP and HSA.` with `plus every earner's payroll deductions — 401(k), ESPP and HSA — and their employer 401(k) match.`; in the retirement `drill-hint` (~line 230) replace `CURRENT monthly take-home and payroll` + `deductions` with `CURRENT monthly take-home, payroll` + `deductions and employer match`.
- [ ] **Step 5: `npx vitest run src/components/projection/ScenarioPanel.test.tsx src/pages/ProjectionPage.test.tsx`** → PASS. Commit: `git add -A && git commit -m "feat(projection): the derived contribution names its employer-match leg"`

---

### Task 7b: The ESPP page prints the discount it was priced with (spec §1.5)

**Files:** modify `src/types/api.ts` (`ModelerOut`), `src/pages/EsppPage.tsx` (the Purchase-modeler card's InfoHint, ~line 966, which says "a 15% discount on the lower of it and the FMV" verbatim); test `src/pages/EsppPage.test.tsx`.

Lane A's `GET /espp/modeler` now echoes `discount_pct` (a 6dp fraction string such as `"0.150000"`), so the page prints the figure it was priced with instead of a hardcoded 15.

- [ ] **Step 1: Types.** In `src/types/api.ts`, in `ModelerOut` after `carry_forward`: `/** The plan discount these purchase prices were computed with (spec §1.5), a fraction. */` + `discount_pct: string`. `npx tsc -b` → FAIL naming every `ModelerOut` literal in `src/pages/EsppPage.test.tsx` (and any fixture under `src/charts/fixtures/` or `src/components/assistant/` that builds one); add `discount_pct: '0.100000',` to each — 10, not 15, so the test below cannot pass by accident.
- [ ] **Step 2: Write the failing test** — in `EsppPage.test.tsx`, beside `'renders the chain, the provenance line and the $25k gauge'`, using that test's own render/await pattern and the house InfoHint disclosure (click the card's ⓘ button, read `role="tooltip"`):

```tsx
it('names the discount the modeler priced with, never a hardcoded 15%', async () => {
  renderPage()
  await screen.findByText(/Purchase modeler/)
  fireEvent.click(screen.getByRole('button', { name: /About Purchase modeler/ }))
  const text = screen.getByRole('tooltip').textContent ?? ''
  expect(text).toContain('a 10% discount on the lower of it and the FMV')
  expect(text).not.toContain('15%')
})
```

(If the file's render helper or the InfoHint button's accessible name differs, use the file's own — the assertion is the contract.)

- [ ] **Step 3: `npx vitest run src/pages/EsppPage.test.tsx`** → FAIL: the hint still says 15%.
- [ ] **Step 4: Print the echo.** In `EsppPage.tsx` add `import { shiftPoint } from '../utils/percent'` and, in `ModelerCard`, above its `return`:

```tsx
  // The SERVER's discount, echoed with the chain it priced (spec §1.5) — the page never
  // re-derives it, and before the first echo the sentence stays generic rather than guessing.
  const discountWords = data === null ? 'the plan discount' : `a ${Number(shiftPoint(data.discount_pct, 2))}% discount`
```

and replace the literal `a 15% discount` inside the InfoHint text with `${discountWords}` (turning that `text="…"` attribute into a template literal). Every other occurrence of "15" on the page is the statutory §423 figure or a price and stays.

- [ ] **Step 5: `npx vitest run src/pages/EsppPage.test.tsx`** → PASS (the whole file, including the snapshot-cache suite). Commit: `git add -A && git commit -m "feat(espp): the modeler's hint prints the discount it was priced with"`

---

### Task 8: Typecheck, lint, whole suite

- [ ] **Step 1: `npx tsc -b`** → clean exit. A failure here is a fixture that still predates Task 1: fix the fixture, never widen a type.
- [ ] **Step 2: `npx eslint src/components/paycheck src/pages/PaycheckPage.tsx src/components/projection src/types/api.ts src/sandbox`** → no errors. An unescaped `'` in JSX *text* is the likely finding; use `&apos;` (strings inside `text=` attributes and TS constants are fine as written).
- [ ] **Step 3: `npx vitest run`** → every file passes. `paycheckPresets` is untouched by this lane: it sizes "Max ESPP" from the row's `limit` (the §423 cap) through `limitFor` and never sees `soft_limit`, and its unchanged tests passing is that proof.
- [ ] **Step 4:** Commit anything those three moved: `git add -A && git commit -m "chore(paycheck): typecheck, lint and suite green for the pace/match frontend"`
