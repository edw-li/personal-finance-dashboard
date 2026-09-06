# Lane C — Settings: five sections and a sticky chip rail

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regroup `/settings` into the five sections of the 2026-09-06 spec §3 under a sticky chip rail, with two new cards, the whitespace closed and no loss of function.

**Architecture:** `SettingsPage` keeps its two `loadedOnce` fragments and gains five `<h2 class="settings-section">` bands inside the same `.card-grid`; `SettingsRail` rides `PageFrame`'s `scopeRow`. The inline "App settings" form becomes `PlanAssumptionsCard` (SWR, ESPP ticker, ESPP discount, read-only employer-match summary); the cron plus the four scheduler facts lifted off `SystemCard` become `PriceRefreshCard`. Each new card owns its own fetch and saves alone through lane A's partial PUT.

**Tech Stack:** React 19 + TypeScript, react-router-dom, vitest + @testing-library/react (jsdom), plain CSS.

**Lane contract.** Lane A ships the backend; this lane's tests mock the API, so it runs in parallel with lanes B and D and merges after A.

- `AppSettingsUpdate`: every field optional.
- `AppSettingsOut` gains `espp_discount_pct`, a plain-notation fraction string (`"0.15"`).
- `GET /paycheck/profiles` items gain `in_force: boolean`.
- **The partial PUT tells an absent field from an explicit null through `exclude_unset`.** So a card sends **only the fields it owns** — never `null` for the ones it does not show, which would clear them. `espp_ticker: null` still clears the ticker, exactly as today, and it is the one place this lane sends a null on purpose.

**House rules the code below obeys:** every card owns its fetch and error state (the SystemCard posture); `load` is a plain function over stable setters, `seqRef`-guarded, called from a mount-only effect and from the banner's Retry — never a `useCallback`, which trips preserve-manual-memoization; Appearance stays outside both `loadedOnce` gates; boxes re-seed from the PUT response, never from what was typed; a keystroke retires the saved note and the form error; percent boxes gate on `isPlainDecimal` **before** `Number()`, because `Decimal("1e-3")` is legal server-side and no 422 sits behind it; jsdom has neither `scrollIntoView` nor `IntersectionObserver`, so both are guarded.

## File structure

| File | Responsibility |
|---|---|
| `src/types/api.ts`, `src/api/paycheck.ts` | discount, all-optional update, `PaycheckProfileListItem` |
| `src/components/settings/SettingsRail.tsx` (new) | five chips, scroll-to-band, scroll-spy |
| `src/components/settings/PlanAssumptionsCard.tsx` (new) | three knobs + read-only match summary |
| `src/components/usePriceRefresh.ts` (new) | the refresh chain Portfolio and Settings share |
| `src/components/settings/PriceRefreshCard.tsx` (new) | cron, scheduler facts, Refresh now |
| `src/pages/SettingsPage.tsx` | bands, card order, skeleton, `#sec-*` arrival |
| `src/components/settings/{SystemCard,AppearanceCard,CalendarFeedCard,ActivityCard}.tsx` | trim, grids, spans, scroll cap |
| `src/components/settings/settings.css`, `src/pages/SettingsPage.css` | band, form and fact rules |
| `src/components/paletteRegistry.ts` | `plan-assumptions` + `price-refresh` |

**Left alone deliberately (spec §3.4):** `.card-grid` keeps `align-items: stretch` — the pairing in §3.1 and the scroll caps on Accounts, Categories, Calendar and Activity are what bound the tall cards. The permanently present `.restore-arm` row on the Restore card stays: it is the safety affordance, not padding.

---

### Task 1: Wire types

**Files:**
- Modify: `src/types/api.ts:1177-1195,1732-1744`, `src/api/paycheck.ts:12-14`
- Test: `src/pages/SettingsPage.test.tsx:142,426`, `src/components/settings/CalendarFeedCard.test.tsx:16`

- [ ] **Step 1: Replace the app-settings types** (`src/types/api.ts:1732-1744`)

```ts
export interface AppSettingsOut {
  swr_pct: string
  espp_ticker: string | null
  price_refresh_cron: string
  /** Day of month (1–28) the monthly-update reminder lands on (2026-09-03 calendar spec §12). */
  calendar_update_due_day: number
  /** The plan's ESPP purchase discount as a plain-notation FRACTION ("0.15"), like swr_pct
   *  (2026-09-06 spec §1.5). 0.15 is the §423 ceiling and the server's fallback. */
  espp_discount_pct: string
}

// PUT is PARTIAL (spec §3.5): the server reads it with exclude_unset, so an ABSENT key leaves
// the stored value and only a key that is actually sent is written. Three cards therefore
// write this endpoint while each sends nothing but its own fields — a card must never send
// null for a field it does not show, which would clear it. An explicit null for espp_ticker
// is the one deliberate exception: it is how the ticker is cleared, and it survives
// JSON.stringify where an undefined would be dropped and read as "keep".
export type AppSettingsUpdate = Partial<AppSettingsOut>
```

- [ ] **Step 2: Add the match columns and the list-item type** — after `PaycheckProfileOut`'s `notes` field, and after the interface's closing brace:

```ts
  notes: string | null
  /** Employer 401(k) match policy (2026-09-06 spec §2.1): four NOT NULL columns with a '0'
   *  server default. Optional HERE only so the paycheck fixtures written before the columns
   *  existed still type-check; the server always sends all four. */
  match_rate_1?: string
  match_band_1?: string
  match_rate_2?: string
  match_band_2?: string
}

/** `GET /paycheck/profiles` items only (spec §2.3). `in_force` is the `_default_profile` rule
 *  computed server-side in one place, and the breakdown and preview routes echo the schema
 *  default — so the flag is meaningful on the LIST alone, and the type says so rather than
 *  making every profile fixture in the repo carry a field it cannot mean. */
export interface PaycheckProfileListItem extends PaycheckProfileOut {
  in_force: boolean
}
```

*Conflict note:* lane B lands the same four match fields, possibly as required. On a merge conflict keep lane B's declaration and drop this hunk — Task 4's readers use `?? '0'` and compile against either.

- [ ] **Step 3: Widen `fetchProfiles`** (`src/api/paycheck.ts:12-14`) — add `PaycheckProfileListItem` to the type import and change both the return type and the `api<…>` argument:

```ts
export function fetchProfiles(): Promise<PaycheckProfileListItem[]> {
  return api<PaycheckProfileListItem[]>('/paycheck/profiles')
}
```

Consumers holding `PaycheckProfileOut[]` (PaycheckPage's state) still compile — an array of a subtype is assignable to an array of its supertype here.

- [ ] **Step 4: Feed the three fixtures the new required field** — add `espp_discount_pct: '0.150000',` to the `SETTINGS` object at `src/pages/SettingsPage.test.tsx:142`, to the `putAppSettings` mock payload at `src/pages/SettingsPage.test.tsx:426`, and to `SETTINGS` at `src/components/settings/CalendarFeedCard.test.tsx:16`.

- [ ] **Step 5: Verify** — `npx tsc -b` (expected: exit 0, no output) and `npx vitest run src/pages/SettingsPage.test.tsx src/components/settings/CalendarFeedCard.test.tsx` (expected: all pass — the CalendarFeed PUT pins carry `espp_discount_pct` through their spread).

- [ ] **Step 6: Commit**

```bash
git add src/types/api.ts src/api/paycheck.ts src/pages/SettingsPage.test.tsx src/components/settings/CalendarFeedCard.test.tsx
git commit -m "feat(types): espp discount, partial settings PUT, in-force profiles"
```

---

### Task 2: SettingsRail

**Files:**
- Create: `src/components/settings/SettingsRail.tsx`, `src/components/settings/SettingsRail.test.tsx`
- Modify: `src/components/settings/settings.css`

- [ ] **Step 1: Write the failing test** (`src/components/settings/SettingsRail.test.tsx`)

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SettingsRail from './SettingsRail'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const chip = (name: string) => screen.getByRole('button', { name })

describe('SettingsRail', () => {
  it('offers the five sections as chips, the first one active', () => {
    render(<SettingsRail sectionsReady={false} />)
    const rail = screen.getByRole('group', { name: 'Settings sections' })
    expect([...rail.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Household',
      'Planning',
      'Account',
      'Integrations',
      'Data',
    ])
    // Plain buttons, so every chip is in the tab order by default (spec §3.2).
    expect(chip('Household').getAttribute('aria-pressed')).toBe('true')
  })

  it('scrolls the chosen band into view and marks its chip at once', () => {
    const scrollIntoView = vi.fn()
    const band = document.createElement('h2')
    band.id = 'sec-planning'
    band.scrollIntoView = scrollIntoView
    document.body.appendChild(band)
    render(<SettingsRail sectionsReady />)

    fireEvent.click(chip('Planning'))

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
    // Marked by the CLICK, not by the observer: a smooth scroll can outlast the press, and a
    // chip that lights a beat late reads as a dropped click.
    expect(chip('Planning').getAttribute('aria-pressed')).toBe('true')
    band.remove()
  })

  it('does nothing but mark the chip when the band is not on the page', () => {
    render(<SettingsRail sectionsReady />)
    // A section still gated behind a failed settings load has no band to scroll to. The
    // optional call is what keeps that a no-op rather than a crash.
    fireEvent.click(chip('Integrations'))
    expect(chip('Integrations').getAttribute('aria-pressed')).toBe('true')
  })

  // jsdom ships no IntersectionObserver: an unguarded `new` would crash every test that
  // renders the Settings page, and a chip must still answer a click without one.
  it('renders and answers clicks where there is no IntersectionObserver at all', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    render(<SettingsRail sectionsReady />)
    fireEvent.click(chip('Data'))
    expect(chip('Data').getAttribute('aria-pressed')).toBe('true')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/settings/SettingsRail.test.tsx`
Expected: FAIL — "Failed to resolve import ./SettingsRail".

- [ ] **Step 3: Write the component** (`src/components/settings/SettingsRail.tsx`)

```tsx
import { useEffect, useState } from 'react'
import Segmented from '../shell/Segmented'
import '../panels.css'
import './settings.css'

// The Settings chip rail (2026-09-06 spec §3.2). It rides PageFrame's scopeRow, so it is
// sticky and measured into --sticky-inset for free; the bands carry the matching
// scroll-margin-top (settings.css) so a chip lands its section BELOW the pinned row.
export const RAIL_SECTIONS = [
  { value: 'sec-household', label: 'Household' },
  { value: 'sec-planning', label: 'Planning' },
  { value: 'sec-account', label: 'Account' },
  { value: 'sec-integrations', label: 'Integrations' },
  { value: 'sec-data', label: 'Data' },
] as const

export type RailSection = (typeof RAIL_SECTIONS)[number]['value']

/** The line a band has to cross to become current: the viewport's upper third. */
const UPPER_THIRD = 1 / 3

export default function SettingsRail({ sectionsReady }: { sectionsReady: boolean }) {
  const [active, setActive] = useState<RailSection>('sec-household')

  // Keyed on `sectionsReady`, not on mount: the bands land in the commit AFTER this row (they
  // live behind the page's loadedOnce gates), so an observer set up at mount would find
  // nothing to watch and the chip would never follow the scroll.
  useEffect(() => {
    if (!sectionsReady || typeof IntersectionObserver === 'undefined') return
    const bands = RAIL_SECTIONS.map((s) => document.getElementById(s.value)).filter(
      (el): el is HTMLElement => el !== null,
    )
    if (bands.length === 0) return
    // The entries say which band CROSSED the line; the active chip is a fact about all five
    // (the lowest one still at or above it), so the callback re-measures rather than trusting
    // whichever band happened to move.
    const mark = () => {
      const line = window.innerHeight * UPPER_THIRD
      let current: RailSection = RAIL_SECTIONS[0].value
      for (const section of RAIL_SECTIONS) {
        const el = document.getElementById(section.value)
        if (el !== null && el.getBoundingClientRect().top <= line) current = section.value
      }
      setActive(current)
    }
    const observer = new IntersectionObserver(mark, {
      rootMargin: `0px 0px -${Math.round((1 - UPPER_THIRD) * 100)}% 0px`,
    })
    for (const el of bands) observer.observe(el)
    return () => observer.disconnect()
  }, [sectionsReady])

  const go = (next: RailSection) => {
    // Set directly rather than waiting on the observer: a smooth scroll can take longer than
    // the click feels, and a chip that lights late reads as a dropped press.
    setActive(next)
    // Optional-call, the house idiom: jsdom has no scrollIntoView, and a section still gated
    // behind a failed load has no band to scroll to.
    document.getElementById(next)?.scrollIntoView?.({ block: 'start' })
  }

  return (
    <Segmented
      variant="chips"
      ariaLabel="Settings sections"
      value={active}
      onChange={go}
      options={RAIL_SECTIONS.map((s) => ({ value: s.value, label: s.label }))}
    />
  )
}
```

- [ ] **Step 4: Add the band CSS** (append to `src/components/settings/settings.css`)

```css
/* --- section bands and the chip rail (2026-09-06 spec §3.1–§3.2) --- */

/* A band across the whole grid, NOT a .card: it takes no entrance animation and no arrival
   ring, and the reveal timeline has nothing to catch on it. It carries its own span rather
   than wearing .span-12, which is card vocabulary. */
.card-grid > .settings-section {
  grid-column: 1 / -1;
  margin: 0.75rem 0 0;
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted);
  /* A chip scrolls a band to the top of the scrollport, which the sticky scope row covers.
     PageFrame MEASURES that row into --sticky-inset on .page-frame-body and these bands
     inherit it, so the band lands below the row instead of under it. */
  scroll-margin-top: calc(var(--sticky-inset, 0px) + 0.75rem);
}

.card-grid > .settings-section:first-child {
  margin-top: 0;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/components/settings/SettingsRail.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/SettingsRail.tsx src/components/settings/SettingsRail.test.tsx src/components/settings/settings.css
git commit -m "feat(settings): a five-chip section rail for the settings page"
```

---

### Task 3: Section bands, card order, skeleton, `#sec-*` arrival

**Files:**
- Modify: `src/pages/SettingsPage.tsx:133,323-330,340-592`, `src/components/settings/SystemCard.tsx:193`, `src/components/settings/ActivityCard.tsx:119`, `src/components/settings/CalendarFeedCard.tsx:131`
- Test: `src/pages/SettingsPage.test.tsx:511,941-954,993-1003,1056-1064,1077-1086`, plus the arrival describe

- [ ] **Step 1: Write the failing order suite.** Delete the four adjacency `it`s — the System pairing one (941–954), the Backups/Restore one (993–1003), the Appearance one (1056–1064) and the health/activity one (1077–1086). Keep every *gating* `it` beside them untouched. Add this suite:

```tsx
describe('SettingsPage — section order (2026-09-06 spec §3.1)', () => {
  // Resolved by id, never by accessible name: the band headings and the card headings collide
  // on "Household", "Accounts", "Restore", "System" and "Activity".
  const el = (id: string) => document.getElementById(id) as HTMLElement

  it('lays the five sections out in order, each with its cards', async () => {
    renderPage()
    await screen.findByRole('region', { name: 'Plan assumptions' })
    expectInDocumentOrder(
      el('sec-household'), el('household'), el('categories'), el('accounts'),
      el('sec-planning'), el('limits'), el('plan-assumptions'),
      el('sec-account'), el('appearance'), el('password'),
      el('sec-integrations'), el('price-refresh'), el('assistant'), el('calendar'),
      el('sec-data'), el('import'), el('backups'), el('restore'), el('health'),
      el('system'), el('activity'),
    )
  })

  it('makes each band a span of the grid, not a card', async () => {
    renderPage()
    await screen.findByRole('region', { name: 'Plan assumptions' })
    for (const id of ['sec-household', 'sec-planning', 'sec-account', 'sec-integrations', 'sec-data']) {
      expect(el(id).tagName).toBe('H2')
      // Not a .card: the arrival ring and the entrance stagger are both card-scoped, and a
      // heading must take neither.
      expect(el(id).classList.contains('card')).toBe(false)
      expect(el(id).classList.contains('settings-section')).toBe(true)
    }
  })

  it('mounts the rail in the sticky scope row', async () => {
    renderPage()
    await screen.findByRole('region', { name: 'Plan assumptions' })
    const row = document.querySelector('.page-frame-scope') as HTMLElement
    expect(row).not.toBeNull()
    expect(within(row).getByRole('group', { name: 'Settings sections' })).toBeTruthy()
  })

  it('keeps the Account band and Appearance outside the loadedOnce gates', async () => {
    vi.mocked(fetchAppSettings).mockRejectedValue(new ApiError('settings unavailable', 503))
    renderPage()

    expect(await screen.findByText('settings unavailable')).toBeTruthy()
    // Appearance owns no fetch, so theme, density and the palette's #appearance jump keep
    // working when the API is unreachable — and its band comes with it.
    expect(document.getElementById('appearance')).not.toBeNull()
    expect(document.getElementById('sec-account')).not.toBeNull()
    // The other four bands are gated with their cards: a heading over cards that are not
    // coming would promise what the API cannot give.
    expect(document.getElementById('sec-data')).toBeNull()
    expect(document.getElementById('sec-household')).toBeNull()
  })
})
```

- [ ] **Step 2: Re-pin the skeleton count** (`src/pages/SettingsPage.test.tsx:511`)

```tsx
    // Five ghosts, the section-1 shape: Household 6 · Categories 6 · Accounts 12 ·
    // Limits 6 · Plan assumptions 6 (spec §3.6).
    expect(document.querySelectorAll('.page-skeleton .card')).toHaveLength(5)
```

- [ ] **Step 3: Add the `#sec-*` arrival test** to the first arrival describe, right after the `#limits` test:

```tsx
  it('scrolls to a section band without ringing it', async () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      value: scrollIntoView,
      configurable: true,
      writable: true,
    })
    try {
      render(
        <MemoryRouter initialEntries={['/settings#sec-planning']}>
          <SettingsPage />
        </MemoryRouter>,
      )
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
      // A band is not a card: an outline round a bare heading rings nothing the reader asked
      // for (spec §3.2). Card hashes keep today's ring — the tests above still pin that.
      expect(document.getElementById('sec-planning')?.classList.contains('is-highlighted')).toBe(
        false,
      )
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run src/pages/SettingsPage.test.tsx`
Expected: FAIL — no `Plan assumptions` region, skeleton count 3 (expected 5), and `#sec-planning` never scrolled.

- [ ] **Step 5: Restructure the page** (`src/pages/SettingsPage.tsx`)

1. Add `import SettingsRail from '../components/settings/SettingsRail'` alongside the other settings imports.
2. Add to `<PageFrame>`, immediately after `title="Settings"`:

```tsx
        scopeRow={<SettingsRail sectionsReady={loadedOnce} />}
```

3. Replace the `skeleton` prop (323–330) with:

```tsx
        // The page's own shape: the Household section's three cards over the Planning
        // section's pair (spec §3.6).
        skeleton={{
          tiles: 0,
          cards: [
            { span: 6, height: 220 },
            { span: 6, height: 220 },
            { span: 12, height: 260 },
            { span: 6, height: 240 },
            { span: 6, height: 240 },
          ],
        }}
```

4. Gate the arrival ring — replace line 133 (`el.classList.add('is-highlighted')`) with:

```tsx
    // Section bands take the scroll and NOT the ring (spec §3.2): they are not cards, and an
    // outline round a heading rings nothing the reader asked for. The two `classList.remove`
    // calls below stay unconditional — taking off a class that was never added is a no-op.
    if (!hash.startsWith('#sec-')) el.classList.add('is-highlighted')
```

5. Re-lay the `.card-grid` body (340–592) as below. Two blocks are **moved verbatim, not rewritten**: cut today's lines 347–410 (`<section className="card span-12" id="import">` through its closing `</section>`) and today's lines 498–558 (`<section className="card span-6" id="password">` through its closing `</section>`) and paste them at the two marked points, unchanged. `<section className="card span-6" id="app-settings">` (429–496) is deleted whole in Task 4. The `people` relay is unchanged.

```tsx
        <div className="card-grid">
          {loadedOnce && (
            <>
              <h2 className="settings-section" id="sec-household">Household</h2>
              {/* people is lifted out of HouseholdCard so the Accounts owner select is never a
                  render behind the roster: a partner added above is selectable below without
                  a reload. Unchanged relay, new seat. */}
              <HouseholdCard onPeopleChange={setPeople} />
              <CategoriesCard />
              <AccountsCard people={people} />

              <h2 className="settings-section" id="sec-planning">Planning</h2>
              <LimitsCard />
              <PlanAssumptionsCard />
            </>
          )}

          {/* Account: the pair about this browser and this login. The BAND is ungated with the
              card under it — Appearance owns no fetch, so theme, density and the palette's
              #appearance jump still work when the API is unreachable, which is one of the
              moments a reader most wants the light theme back. */}
          <h2 className="settings-section" id="sec-account">Account</h2>
          <AppearanceCard />

          {loadedOnce && (
            <>
              {/* ↓ today's lines 498–558, the <section className="card span-6" id="password">
                  block, pasted here verbatim ↓ */}

              <h2 className="settings-section" id="sec-integrations">Integrations</h2>
              <PriceRefreshCard />
              <AssistantCard />
              <CalendarFeedCard />

              <h2 className="settings-section" id="sec-data">Data</h2>
              {/* ↓ today's lines 347–410, the <section className="card span-12" id="import">
                  block, pasted here verbatim ↓ */}
              <BackupsCard />
              <RestoreCard />
              <HealthCard />
              <SystemCard />
              <ActivityCard />
            </>
          )}
        </div>
```

6. Three spans, so §3.1's height pairing holds: `SystemCard.tsx:193` `span-12` → `span-6`; `ActivityCard.tsx:119` `span-6` → `span-12`; `CalendarFeedCard.tsx:131` `span-6` → `span-12`.

**Anchors that must survive this reorder, and do, because no card `id` changes:** the Overview attention strip and the backend health checks link to `/settings#backups` (`src/components/overview/attention.ts:171,177`); `BackupsCard.tsx:114` links to `/settings?restore=…#restore`. The rest of the arrival suite (`SettingsPage.test.tsx:1098-1275`) is left exactly as written — `#limits`, `#calendar`, `#restore`, `#backups`, the ResizeObserver chase, the anchor-moves case and the `?restore=` hand-off all keep passing — and this task only *adds* the `#sec-planning` case to it.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/pages/SettingsPage.test.tsx`
Expected: the order, band, rail, gate, skeleton and `#sec-planning` tests pass, except the `el('plan-assumptions')` and `el('price-refresh')` terms, which Tasks 4 and 5 land. If you are committing this task on its own, comment those two terms out with `// Task 4/5 restores this` and restore them in Task 5, Step 7.

- [ ] **Step 7: Commit**

```bash
git add src/pages/SettingsPage.tsx src/pages/SettingsPage.test.tsx src/components/settings/SystemCard.tsx src/components/settings/ActivityCard.tsx src/components/settings/CalendarFeedCard.tsx
git commit -m "feat(settings): five section bands, the rail in the scope row, a matching skeleton"
```

---

### Task 4: PlanAssumptionsCard

**Files:**
- Create: `src/components/settings/PlanAssumptionsCard.tsx`, `src/components/settings/PlanAssumptionsCard.test.tsx`
- Modify: `src/pages/SettingsPage.tsx:36-45,55-60,82-101,163-220,429-496`, `src/components/settings/settings.css`
- Test: `src/pages/SettingsPage.test.tsx:155-182,339-497,613-651`

- [ ] **Step 1: Write the failing test** (`src/components/settings/PlanAssumptionsCard.test.tsx`)

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'

vi.mock('../../api/settings', () => ({ fetchAppSettings: vi.fn(), putAppSettings: vi.fn() }))
vi.mock('../../api/paycheck', () => ({ fetchProfiles: vi.fn() }))
vi.mock('../../api/household', () => ({ fetchHousehold: vi.fn() }))
import { fetchHousehold } from '../../api/household'
import { fetchProfiles } from '../../api/paycheck'
import { fetchAppSettings, putAppSettings } from '../../api/settings'
import PlanAssumptionsCard from './PlanAssumptionsCard'

const SETTINGS = {
  swr_pct: '0.045000',
  espp_ticker: 'NVDA',
  price_refresh_cron: '10 13 * * mon-fri',
  calendar_update_due_day: 1,
  espp_discount_pct: '0.150000',
}
const PROFILE = {
  id: 1, person_id: 1, effective_date: '2026-01-01', annual_salary: '188930.00',
  pay_periods_per_year: 24, trad_401k_pct: '0.130000000', roth_401k_pct: '0.000000000',
  after_tax_401k_pct: '0.030000000', espp_pct: '0.120000000', withholding_pct: '0.220000000',
  dental_vision_per_check: '40.00', hsa_per_check: '150.00', hsa_coverage: 'family' as const,
  notes: null, in_force: true,
  match_rate_1: '1.000000000', match_band_1: '6000.00',
  match_rate_2: '0.500000000', match_band_2: '11000.00',
}
const ME = { id: 1, name: 'Me', is_primary: true }

const mount = () => render(<MemoryRouter><PlanAssumptionsCard /></MemoryRouter>)
const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement
// Anchored at both ends, this file's family convention: a bare /^sav/i would also match the
// other settings cards' buttons once the page mounts them together.
const save = () => screen.getByRole('button', { name: /^sav(e assumptions|ing…)$/i })
const type = (el: HTMLInputElement, value: string) => fireEvent.change(el, { target: { value } })

beforeEach(() => {
  vi.mocked(fetchAppSettings).mockResolvedValue(SETTINGS)
  vi.mocked(putAppSettings).mockResolvedValue(SETTINGS)
  vi.mocked(fetchProfiles).mockResolvedValue([PROFILE])
  vi.mocked(fetchHousehold).mockResolvedValue({ people: [ME], marriage_date: null })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PlanAssumptionsCard', () => {
  it('seeds the three boxes from the stored settings, percent-shifted for display', async () => {
    mount()
    expect(await screen.findByRole('region', { name: 'Plan assumptions' })).toBeTruthy()
    expect(document.getElementById('plan-assumptions')).toBeTruthy()
    // The columns store fractions; the boxes speak percent. Number() trims the stored
    // quantizer's trailing zeros, and the box round-trips through shiftPoint on save, so no
    // float ever reaches the wire.
    expect(box('Withdrawal rate (% / year)').value).toBe('4.5')
    expect(box('ESPP ticker').value).toBe('NVDA')
    expect(box('ESPP discount (%)').value).toBe('15')
  })

  it('states each person’s in-force match in words, with a link to the Paycheck page', async () => {
    mount()
    expect(
      await screen.findByText('Me: 100% of the first $6,000, then 50% of the next $11,000'),
    ).toBeTruthy()
    // Read-only here on purpose: the policy is effective-dated on the profile, and two places
    // to edit one number is how they drift.
    expect(
      screen.getByRole('link', { name: 'Set it on the Paycheck page' }).getAttribute('href'),
    ).toBe('/paycheck')
  })

  it('says so plainly when there is no match, and when there is no profile at all', async () => {
    vi.mocked(fetchProfiles).mockResolvedValue([
      { ...PROFILE, match_rate_1: '0.000000000', match_band_1: '0.00', match_rate_2: '0.000000000', match_band_2: '0.00' },
    ])
    vi.mocked(fetchHousehold).mockResolvedValue({
      people: [ME, { id: 2, name: 'Sam', is_primary: false }],
      marriage_date: null,
    })
    mount()
    expect(await screen.findByText('Me: no match entered')).toBeTruthy()
    expect(screen.getByText('Sam: no paycheck profile yet')).toBeTruthy()
  })

  it('sends ONLY its own three fields, so the partial PUT leaves the rest standing', async () => {
    mount()
    await screen.findByLabelText('ESPP ticker')

    type(box('Withdrawal rate (% / year)'), '3.75')
    // As TYPED: the server owns normalization (it uppercases), and a client that pre-empted it
    // would be a second opinion about the same string.
    type(box('ESPP ticker'), 'msft')
    type(box('ESPP discount (%)'), '10')
    fireEvent.click(save())

    await waitFor(() => expect(putAppSettings).toHaveBeenCalledTimes(1))
    // No price_refresh_cron and no calendar_update_due_day — not even as nulls. The server
    // reads the body with exclude_unset, so an absent key keeps its stored value while a null
    // would clear it.
    expect(vi.mocked(putAppSettings).mock.calls[0][0]).toEqual({
      swr_pct: '0.0375',
      espp_ticker: 'msft',
      espp_discount_pct: '0.1',
    })
    expect(await screen.findByText('Saved.')).toBeTruthy()

    // The sentence is about the values that WERE saved — the next keystroke moves on.
    type(box('ESPP ticker'), 'nvda')
    expect(screen.queryByText('Saved.')).toBeNull()
  })

  it('re-seeds the boxes from the PUT RESPONSE, not from what was typed', async () => {
    vi.mocked(putAppSettings).mockResolvedValue({
      ...SETTINGS,
      swr_pct: '0.037500',
      espp_ticker: 'MSFT',
      espp_discount_pct: '0.100000',
    })
    mount()
    await screen.findByLabelText('ESPP ticker')

    type(box('Withdrawal rate (% / year)'), '3.7500')
    type(box('ESPP ticker'), 'msft')
    type(box('ESPP discount (%)'), '10')
    fireEvent.click(save())

    // The server answers with what it STORED (quantized rate, uppercased ticker). Keeping the
    // typed text would leave the form reading as unsaved work against values that are already
    // in the database.
    await waitFor(() => expect(box('ESPP ticker').value).toBe('MSFT'))
    expect(box('Withdrawal rate (% / year)').value).toBe('3.75')
    expect(box('ESPP discount (%)').value).toBe('10')
  })

  it('sends espp_ticker: null EXPLICITLY when the ticker box is emptied', async () => {
    mount()
    await screen.findByLabelText('ESPP ticker')

    type(box('ESPP ticker'), '   ')
    fireEvent.click(save())

    await waitFor(() => expect(putAppSettings).toHaveBeenCalledTimes(1))
    const body = vi.mocked(putAppSettings).mock.calls[0][0]
    // The key must SURVIVE JSON.stringify: an undefined value is dropped from the JSON, and
    // under the partial PUT a dropped key means "keep the stored ticker" — so "clear it" and
    // "I forgot to send it" would arrive as the same request. Null says it on purpose.
    expect(Object.keys(body)).toContain('espp_ticker')
    expect(body.espp_ticker).toBeNull()
    expect(JSON.parse(JSON.stringify(body)).espp_ticker).toBeNull()
  })

  it('refuses exponent text and out-of-range values without spending a request', async () => {
    mount()
    await screen.findByLabelText('ESPP ticker')

    // Exponent AND out of range (1e3 is 1000): the two gates disagree about this box, so the
    // message names which ran FIRST. Only plain-decimal-before-Number() is correct.
    type(box('Withdrawal rate (% / year)'), '1e3')
    fireEvent.click(save())
    expect(await screen.findByText('Enter a plain decimal (no exponents).')).toBeTruthy()

    type(box('Withdrawal rate (% / year)'), '150')
    fireEvent.click(save())
    // The box is labelled in PERCENT, so it says 100 — not the server's "between 0 and 1",
    // which is the stored fraction's vocabulary and would read as the opposite advice.
    expect(await screen.findByText('Must be between 0 and 100.')).toBeTruthy()

    type(box('Withdrawal rate (% / year)'), '4')
    type(box('ESPP discount (%)'), '20')
    fireEvent.click(save())
    expect(await screen.findByText('Must be between 0 and 15 — the §423 maximum.')).toBeTruthy()

    expect(putAppSettings).not.toHaveBeenCalled()
  })

  it('renders a PUT rejection verbatim in the form-level error slot', async () => {
    const detail = 'ticker must be 1-20 characters of A-Z, 0-9, dot or dash, starting alphanumeric'
    vi.mocked(putAppSettings).mockRejectedValue(new ApiError(detail, 422))
    mount()
    await screen.findByLabelText('ESPP ticker')

    type(box('ESPP ticker'), '$$$')
    fireEvent.click(save())

    // Form-level on purpose: the ticker 422 is NOT field-prefixed, so there is nothing
    // reliable to map the message onto a single box with.
    expect(await screen.findByText(detail)).toBeTruthy()
    expect(screen.queryByText('Saved.')).toBeNull()
  })

  it('banners a failed load and refetches on Retry, offering no form to save', async () => {
    vi.mocked(fetchProfiles).mockRejectedValue(new ApiError('profiles unavailable', 503))
    mount()

    expect(await screen.findByText('profiles unavailable')).toBeTruthy()
    // A first load that failed knows nothing about the stored settings, and a form seeded with
    // blanks would offer to save them.
    expect(screen.queryByLabelText('ESPP ticker')).toBeNull()

    vi.mocked(fetchProfiles).mockResolvedValue([PROFILE])
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading the plan assumptions' }))
    expect(await screen.findByLabelText('ESPP ticker')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/settings/PlanAssumptionsCard.test.tsx`
Expected: FAIL — "Failed to resolve import ./PlanAssumptionsCard".

- [ ] **Step 3: Write the card** (`src/components/settings/PlanAssumptionsCard.tsx`)

```tsx
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { fetchHousehold } from '../../api/household'
import { fetchProfiles } from '../../api/paycheck'
import { fetchAppSettings, putAppSettings } from '../../api/settings'
import type { AppSettingsOut, PaycheckProfileListItem, PersonOut } from '../../types/api'
import { isPlainDecimal, shiftPoint } from '../../utils/percent'
import InfoHint from '../InfoHint'
import { FeedBanner } from '../shell/Feed'
import '../panels.css'
import './settings.css'

// The boxes a payload seeds, as pure string math at MODULE scope (SettingsPage's old
// boxesFor, moved with the form): a component-scope helper would make `load` reactive and the
// mount effect would owe it a dependency.
function boxesFor(s: AppSettingsOut) {
  return {
    // Display percent: "0.045000" -> "4.5". Number() only trims the stored quantizer's
    // trailing zeros; the box round-trips through shiftPoint on save, so no float ever
    // reaches the wire.
    swr: String(Number(shiftPoint(s.swr_pct, 2))),
    ticker: s.espp_ticker ?? '',
    discount: String(Number(shiftPoint(s.espp_discount_pct, 2))),
  }
}

type Boxes = ReturnType<typeof boxesFor>

// Whole dollars: a match band is a round policy number, and cents on it read as precision the
// policy does not have.
const BAND = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const ratePct = (raw: string) => `${Number((Number(raw) * 100).toFixed(4))}%`

/** The profile form's own sentence (spec §2.3), so the two surfaces describe one policy in one
 *  voice. `?? '0'` covers a snapshot restored from before the columns existed. */
export function matchWords(p: PaycheckProfileListItem): string {
  const first =
    Number(p.match_rate_1 ?? '0') > 0 && Number(p.match_band_1 ?? '0') > 0
      ? `${ratePct(p.match_rate_1 ?? '0')} of the first ${BAND.format(Number(p.match_band_1))}`
      : ''
  const next =
    Number(p.match_rate_2 ?? '0') > 0 && Number(p.match_band_2 ?? '0') > 0
      ? `${ratePct(p.match_rate_2 ?? '0')} of the next ${BAND.format(Number(p.match_band_2))}`
      : ''
  if (first === '' && next === '') return 'no match entered'
  if (first === '' || next === '') return `${first}${next}`
  return `${first}, then ${next}`
}

/**
 * Plan assumptions (2026-09-06 spec §3.3), replacing the page's inline App settings form: the
 * three knobs the Projection, ESPP and Paycheck pages derive from, saved with a PARTIAL PUT so
 * this card never re-sends the cron or the reminder day it does not show, plus a READ-ONLY
 * per-person employer-match summary — the policy lives on the paycheck profile, and two places
 * to edit one number is how they drift.
 */
export default function PlanAssumptionsCard() {
  const [settings, setSettings] = useState<AppSettingsOut | null>(null)
  const [people, setPeople] = useState<PersonOut[]>([])
  const [profiles, setProfiles] = useState<PaycheckProfileListItem[]>([])
  const [boxes, setBoxes] = useState<Boxes>({ swr: '', ticker: '', discount: '' })
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState(false)
  const seqRef = useRef(0)

  // A plain function over stable setters, called from the effect and from Retry (the
  // LimitsCard idiom — a useCallback here trips preserve-manual-memoization). All-or-nothing,
  // the SystemCard contract: this card is ONE reading of the plan, and a match summary
  // standing on a profile read that failed beside a fresh settings read would be a card of two
  // instants.
  const load = () => {
    const seq = ++seqRef.current
    Promise.all([fetchAppSettings(), fetchProfiles(), fetchHousehold()])
      .then(([stored, rows, household]) => {
        if (seq !== seqRef.current) return
        setSettings(stored)
        setBoxes(boxesFor(stored))
        setProfiles(rows)
        setPeople(household.people)
        setLoadError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setLoadError(err instanceof ApiError ? err.message : 'Could not load the plan assumptions.')
      })
  }

  useEffect(() => {
    load()
    // mount-only: a plain function over stable setters (house idiom)
  }, [])

  // Every keystroke retires both sentences under the form: they describe the values that WERE
  // in the boxes.
  const edit = (key: keyof Boxes) => (value: string) => {
    setBoxes((current) => ({ ...current, [key]: value }))
    setSavedNote(false)
    setFormError(null)
  }

  const save = () => {
    // BEFORE Number(): shiftPoint hands "1e-3" back untouched and Decimal("1e-3") is a
    // perfectly legal 0.001 server-side, so the box would silently store a rate 100x off with
    // no 422 anywhere on the round trip (src/utils/percent.ts).
    if (!isPlainDecimal(boxes.swr) || !isPlainDecimal(boxes.discount)) {
      setFormError('Enter a plain decimal (no exponents).')
      return
    }
    const rate = Number(boxes.swr)
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      // Worded in the BOX's vocabulary. The server says "must be a fraction between 0 and 1",
      // which is the stored value's — quoted here it would call a 4.5 too big.
      setFormError('Must be between 0 and 100.')
      return
    }
    const discount = Number(boxes.discount)
    if (!Number.isFinite(discount) || discount < 0 || discount > 15) {
      setFormError('Must be between 0 and 15 — the §423 maximum.')
      return
    }
    // Explicitly null, never undefined: JSON.stringify drops an undefined value, and under the
    // partial PUT a dropped key means "keep" — so "clear the ticker" and "I forgot to send it"
    // would arrive as the same request. The non-empty value travels AS TYPED.
    const ticker = boxes.ticker.trim() === '' ? null : boxes.ticker
    setSaving(true)
    setFormError(null)
    setSavedNote(false)
    // ONLY this card's three fields (spec §3.5). The cron and the reminder day belong to other
    // cards; sending them — even as nulls — would revert or clear what those cards saved.
    putAppSettings({
      swr_pct: shiftPoint(boxes.swr, -2),
      espp_ticker: ticker,
      espp_discount_pct: shiftPoint(boxes.discount, -2),
    })
      .then((saved) => {
        // Re-seeded from the RESPONSE, not from what was typed: the server answers with what
        // it stored (quantized rate, uppercased ticker), and boxes left holding the typed text
        // would read as unsaved work against values already in the database.
        setSettings(saved)
        setBoxes(boxesFor(saved))
        setSavedNote(true)
      })
      .catch((err: unknown) => {
        // Verbatim: the ticker 422 is NOT field-prefixed, so the slot is form-level.
        setFormError(err instanceof ApiError ? err.message : 'Could not save the assumptions.')
      })
      .finally(() => setSaving(false))
  }

  return (
    <section className="card span-6" id="plan-assumptions" role="region" aria-label="Plan assumptions">
      <h2 className="eyebrow">
        Plan assumptions
        <InfoHint text="The knobs the Projection, ESPP and Paycheck pages derive from. The employer match is set per person on the Paycheck page." />
      </h2>
      <FeedBanner error={loadError} retry={load} retryLabel="Retry loading the plan assumptions" />
      {settings === null && loadError === null && <p className="empty-note">Loading…</p>}
      {settings !== null && (
        <form
          className="settings-card-form"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          {/* All three boxes go read-only for the in-flight window, because the PUT response
              RE-SEEDS them: text typed while saving would be overwritten by the echo of the
              older values, next to a fresh "Saved". */}
          <label>
            Withdrawal rate (% / year)
            <input
              className="field-input"
              inputMode="decimal"
              value={boxes.swr}
              disabled={saving}
              onChange={(e) => edit('swr')(e.target.value)}
            />
          </label>
          <label>
            ESPP ticker
            <input
              className="field-input"
              value={boxes.ticker}
              disabled={saving}
              onChange={(e) => edit('ticker')(e.target.value)}
            />
          </label>
          <label>
            ESPP discount (%)
            <input
              className="field-input"
              inputMode="decimal"
              value={boxes.discount}
              disabled={saving}
              onChange={(e) => edit('discount')(e.target.value)}
            />
          </label>
          <p className="settings-note">
            Blank ticker = ESPP page shows &apos;no ticker configured&apos;. The discount prices
            the ESPP modeler, the paycheck pace tick and the tax what-if; 15 % is the §423
            maximum.
          </p>
          <div className="settings-card-actions">
            <button type="submit" className="button button-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save assumptions'}
            </button>
          </div>
          <FeedBanner error={formError} />
          {savedNote && (
            <p className="settings-note" role="status">
              Saved.
            </p>
          )}
        </form>
      )}
      <div className="settings-field">
        <span className="eyebrow">Employer 401(k) match</span>
        <ul className="plan-match-list">
          {people.map((person) => {
            const profile = profiles.find((p) => p.in_force && p.person_id === person.id)
            return (
              <li key={person.id} className="settings-note">
                {person.name}:{' '}
                {profile === undefined ? 'no paycheck profile yet' : matchWords(profile)}
              </li>
            )
          })}
        </ul>
        <p className="settings-note">
          Read-only here — the policy is effective-dated on each person&apos;s paycheck profile.{' '}
          <Link to="/paycheck">Set it on the Paycheck page</Link>
        </p>
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Add the list rule** (append to `src/components/settings/settings.css`)

```css
/* One line per person, read as sentences rather than as a table (spec §3.3). */
.plan-match-list {
  list-style: none;
  margin: 0 0 0.5rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
```

- [ ] **Step 5: Retire the inline App settings form** (`src/pages/SettingsPage.tsx`)

Delete: the whole `<section className="card span-6" id="app-settings">` block (429–496); `boxesFor` (36–45); the `swrPctBox` / `tickerBox` / `cronBox` / `formError` / `saving` / `savedNote` state (55–60); `editSetting` (163–167); `save` (169–220). Drop the now-unused imports `putAppSettings`, `isPlainDecimal` and `shiftPoint` — keep `fetchAppSettings`. Add `import PlanAssumptionsCard from '../components/settings/PlanAssumptionsCard'`. In `load`, replace the three `set*Box` calls:

```tsx
    fetchAppSettings()
      .then(() => {
        if (seq !== seqRef.current) return
        // The page reads /settings for ONE reason now: it is the gate. A GET that failed means
        // the API is unreachable, and cards that could only fail are not worth offering. The
        // three boxes moved to PlanAssumptionsCard, which reads it for itself.
        setError(null)
        setLoadedOnce(true)
      })
```

- [ ] **Step 6: Repair the page test** (`src/pages/SettingsPage.test.tsx`)

- Delete the `CRON_HINT` and `SAVED_NOTE` constants (155–163) and the `swrBox` / `tickerBox` / `cronBox` / `saveButton` helpers (166–182).
- Delete the whole `describe('SettingsPage — app settings')` block **except** its last three `it`s — "ghosts the page through the frame while the FIRST load is in flight", "offers Retry on the first-failure banner, under a name of its own" and "banners a failed load and refetches on Retry" — which stay, under a `describe('SettingsPage — lifecycle')` header. In the two that probe the form, swap `screen.queryByLabelText('ESPP ticker')` for `screen.queryByRole('region', { name: 'Plan assumptions' })` and `await screen.findByLabelText('ESPP ticker')` for `await screen.findByRole('region', { name: 'Plan assumptions' })`; delete the `expect(swrBox().value).toBe('4.5')` line; re-pin the retry test's count to `expect(vi.mocked(fetchAppSettings)).toHaveBeenCalledTimes(4)` — the page's failure, the page's retry, then Plan assumptions' and Calendar feed's own reads once `loadedOnce` lets the cards mount. (Task 5 adds Price refresh and makes it 5.)
- Add, in place of the deleted seeding test:

```tsx
  it('reads /settings once per card that owns one of its fields', async () => {
    renderPage()
    await screen.findByRole('region', { name: 'Plan assumptions' })
    // The page's own gate, then Plan assumptions and Calendar feed reading for themselves —
    // the price of three cards saving independently under the partial PUT. `waitFor`, not a
    // bare expect: a card mounts in the `loadedOnce` commit and its passive effect (and so its
    // fetch) can land a microtask later. (Task 5 makes it 4.)
    await waitFor(() => expect(vi.mocked(fetchAppSettings)).toHaveBeenCalledTimes(3))
    // The balance-suggestions mapping card was removed end to end (spec §5.2 amendment).
    expect(screen.queryByText(/Balance suggestions/)).toBeNull()
  })
```

- In "disables each submit while its OWN request is in flight" (613–651), replace both `saveButton()` calls with `screen.getByRole('button', { name: /^sav(e assumptions|ing…)$/i })`. The rest of that test is unchanged: it still proves a settings save does not lock the password form.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/components/settings/PlanAssumptionsCard.test.tsx src/pages/SettingsPage.test.tsx`
Expected: PASS, except the `el('price-refresh')` term in the order suite, which Task 5 lands.

- [ ] **Step 8: Commit**

```bash
git add src/components/settings/PlanAssumptionsCard.tsx src/components/settings/PlanAssumptionsCard.test.tsx src/components/settings/settings.css src/pages/SettingsPage.tsx src/pages/SettingsPage.test.tsx
git commit -m "feat(settings): Plan assumptions replaces the App settings form"
```

---

### Task 5: usePriceRefresh, PriceRefreshCard, and the System card's trim

**Files:**
- Create: `src/components/usePriceRefresh.ts`, `src/components/settings/PriceRefreshCard.tsx`, `src/components/settings/PriceRefreshCard.test.tsx`
- Modify: `src/pages/PortfolioPage.tsx:16,68-104,238-239,371-385`, `src/components/settings/SystemCard.tsx:1-25,71-82,106-123,196`, `src/pages/SettingsPage.tsx`
- Test: `src/components/settings/SystemCard.test.tsx`, `src/pages/SettingsPage.test.tsx`, `src/pages/PortfolioPage.test.tsx` (must stay green **unedited**)

- [ ] **Step 1: Write the failing card test** (`src/components/settings/PriceRefreshCard.test.tsx`)

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'

vi.mock('../../api/settings', () => ({ fetchAppSettings: vi.fn(), putAppSettings: vi.fn() }))
vi.mock('../../api/system', () => ({ fetchSystemStatus: vi.fn() }))
vi.mock('../../api/prices', () => ({ refreshPrices: vi.fn() }))
import { refreshPrices } from '../../api/prices'
import { fetchAppSettings, putAppSettings } from '../../api/settings'
import { fetchSystemStatus } from '../../api/system'
import PriceRefreshCard from './PriceRefreshCard'

const SETTINGS = {
  swr_pct: '0.045000',
  espp_ticker: 'NVDA',
  price_refresh_cron: '10 13 * * mon-fri',
  calendar_update_due_day: 1,
  espp_discount_pct: '0.150000',
}
const STATUS = {
  prices: { last: null, next_run_at: '2026-09-07T13:10:00+00:00', scheduler_running: true },
  database: { size_bytes: 1024, alembic_head: null },
  backup: null,
  environment: 'dev',
}

const cronBox = () => screen.getByLabelText('Price refresh cron') as HTMLInputElement
const saveButton = () => screen.getByRole('button', { name: /^sav(e schedule|ing…)$/i })
const refreshButton = () => screen.getByRole('button', { name: /^refresh(ing…| now)$/i })

beforeEach(() => {
  vi.mocked(fetchAppSettings).mockResolvedValue(SETTINGS)
  vi.mocked(putAppSettings).mockResolvedValue(SETTINGS)
  vi.mocked(fetchSystemStatus).mockResolvedValue(STATUS)
  vi.mocked(refreshPrices).mockResolvedValue({
    updated: ['NVDA'],
    failed: {},
    skipped_manual: [],
    duration_ms: 2400,
    dividends_ingested: 0,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PriceRefreshCard', () => {
  it('seeds the cron box and shows the four scheduler facts', async () => {
    render(<PriceRefreshCard />)
    expect(await screen.findByRole('region', { name: 'Price refresh' })).toBeTruthy()
    expect(document.getElementById('price-refresh')).toBeTruthy()
    await waitFor(() => expect(cronBox().value).toBe('10 13 * * mon-fri'))
    // The four rows moved off the System card (spec §3.3), beside the schedule that makes them.
    for (const label of ['Last price refresh', 'Next scheduled run', 'Scheduler', 'Recent refreshes']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    expect(screen.getByText('No refresh recorded yet')).toBeTruthy()
    expect(screen.getByText('Running')).toBeTruthy()
  })

  it('saves the cron ALONE and re-reads the facts the save just moved', async () => {
    render(<PriceRefreshCard />)
    await waitFor(() => expect(cronBox().value).toBe('10 13 * * mon-fri'))

    fireEvent.change(cronBox(), { target: { value: '30 14 * * mon-fri' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(putAppSettings).toHaveBeenCalledTimes(1))
    // Nothing but the cron — not even nulls for the fields this card does not show. The server
    // reads the body with exclude_unset, so an absent key keeps its stored value.
    expect(vi.mocked(putAppSettings).mock.calls[0][0]).toEqual({
      price_refresh_cron: '30 14 * * mon-fri',
    })
    expect(await screen.findByText('Saved — the schedule is applied immediately.')).toBeTruthy()
    // The save HOT-APPLIES the schedule, so "Next scheduled run" has just moved.
    await waitFor(() => expect(fetchSystemStatus).toHaveBeenCalledTimes(2))
  })

  it('retires the saved note on the next keystroke', async () => {
    render(<PriceRefreshCard />)
    await waitFor(() => expect(cronBox().value).toBe('10 13 * * mon-fri'))
    fireEvent.click(saveButton())
    expect(await screen.findByText('Saved — the schedule is applied immediately.')).toBeTruthy()
    fireEvent.change(cronBox(), { target: { value: '30 15 * * mon-fri' } })
    expect(screen.queryByText('Saved — the schedule is applied immediately.')).toBeNull()
  })

  it('runs a refresh, reports what it did and re-reads the facts', async () => {
    render(<PriceRefreshCard />)
    await screen.findByText('Next scheduled run')

    fireEvent.click(refreshButton())

    await waitFor(() => expect(refreshPrices).toHaveBeenCalledTimes(1))
    // The Portfolio page's own sentence, from the shared hook.
    expect(await screen.findByText(/1 updated in 2s/)).toBeTruthy()
    await waitFor(() => expect(fetchSystemStatus).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(refreshButton().hasAttribute('disabled')).toBe(false))
  })

  it('renders a refused save and a failed refresh verbatim', async () => {
    vi.mocked(putAppSettings).mockRejectedValue(
      new ApiError('cron must not fire more often than hourly', 422),
    )
    vi.mocked(refreshPrices).mockRejectedValue(new ApiError('provider unavailable', 502))
    render(<PriceRefreshCard />)
    await waitFor(() => expect(cronBox().value).toBe('10 13 * * mon-fri'))

    fireEvent.click(saveButton())
    expect(await screen.findByText('cron must not fire more often than hourly')).toBeTruthy()
    expect(screen.queryByText('Saved — the schedule is applied immediately.')).toBeNull()

    fireEvent.click(refreshButton())
    expect(await screen.findByText('provider unavailable')).toBeTruthy()
  })

  it('banners a failed load and refetches on Retry', async () => {
    vi.mocked(fetchSystemStatus).mockRejectedValue(new ApiError('status unavailable', 503))
    render(<PriceRefreshCard />)

    expect(await screen.findByText('status unavailable')).toBeTruthy()
    expect(screen.queryByText('Next scheduled run')).toBeNull()

    vi.mocked(fetchSystemStatus).mockResolvedValue(STATUS)
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading the refresh schedule' }))
    expect(await screen.findByText('Next scheduled run')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/settings/PriceRefreshCard.test.tsx`
Expected: FAIL — "Failed to resolve import ./PriceRefreshCard".

- [ ] **Step 3: Lift the refresh chain into a shared hook** (`src/components/usePriceRefresh.ts`)

```ts
import { useState } from 'react'
import { ApiError } from '../api/client'
import { refreshPrices } from '../api/prices'
import type { RefreshResult } from '../types/api'

// Two surfaces run the same manual refresh (2026-09-06 spec §3.3): Portfolio's toolbar button
// and the Settings Price-refresh card. The CHAIN is the shared part — the sentence a run
// earns, the in-flight flag, and the caller's own follow-up work.
const MAX_FAILED_SHOWN = 5

export interface RefreshNote {
  text: string
  detail: string
  failed: number
}

export const NO_NOTE: RefreshNote = { text: '', detail: '', failed: 0 }

export function describeRefresh(result: RefreshResult): RefreshNote {
  const failed = Object.entries(result.failed)
  // `listed`, not `shown`: PortfolioPage's `shown` ref is the rendered snapshot, and two
  // different meanings under one name is how a future edit picks the wrong one.
  const listed = failed.slice(0, MAX_FAILED_SHOWN).map(([ticker]) => ticker)
  const more = failed.length - listed.length
  return {
    text:
      `${result.updated.length} updated` +
      (failed.length > 0
        ? `, ${failed.length} failed (${listed.join(', ')}${more > 0 ? `, +${more} more` : ''})`
        : '') +
      (result.skipped_manual.length > 0
        ? `, ${result.skipped_manual.length} manual skipped`
        : '') +
      // Only when the run actually wrote some: a steady-state refresh between ex-dates ingests
      // nothing, and ", 0 dividends logged" would read as a failure.
      (result.dividends_ingested > 0 ? `, ${result.dividends_ingested} dividends logged` : '') +
      ` in ${Math.round(result.duration_ms / 1000)}s`,
    // Per-ticker reasons ride in the title attribute — React escapes attribute values, so
    // provider error text cannot inject markup.
    detail: failed.map(([ticker, reason]) => `${ticker}: ${reason}`).join('\n'),
    failed: failed.length,
  }
}

export interface RefreshOptions {
  /** Work that must land before the button re-enables — Portfolio's own reload. */
  after?: () => Promise<unknown> | void
  /** Where a failure goes. Absent, it stays in the hook's own `error`. */
  onError?: (message: string) => void
}

export function usePriceRefresh() {
  const [refreshing, setRefreshing] = useState(false)
  const [note, setNote] = useState<RefreshNote>(NO_NOTE)
  const [error, setError] = useState<string | null>(null)

  const refresh = ({ after, onError }: RefreshOptions = {}): Promise<void> => {
    setRefreshing(true)
    setNote(NO_NOTE)
    setError(null)
    return refreshPrices()
      .then((result) => {
        setNote(describeRefresh(result))
        // Returned, not fired-and-forgotten: the button re-enables only once the fresh prices
        // are actually on screen.
        return after?.()
      })
      .then(() => undefined)
      .catch((err: unknown) => {
        const message = err instanceof ApiError ? err.message : 'Price refresh failed'
        if (onError === undefined) setError(message)
        else onError(message)
      })
      .finally(() => setRefreshing(false))
  }

  return { refreshing, note, error, refresh }
}
```

- [ ] **Step 4: Point Portfolio at the hook, behaviour unchanged** (`src/pages/PortfolioPage.tsx`)

Delete lines 68–104 (`MAX_FAILED_SHOWN`, `interface RefreshNote`, `NO_NOTE`, `describeRefresh`) — they are the source of the hook above, moved rather than rewritten. Drop `refreshPrices` from the `../api/prices` import and `RefreshResult` from the type import; add `import { usePriceRefresh } from '../components/usePriceRefresh'`. Replace the two state lines (238–239) with:

```tsx
  const { refreshing, note: refreshNote, refresh } = usePriceRefresh()
```

And replace `onRefresh` (371–385) with:

```tsx
  const onRefresh = () => {
    setError(null)
    // The page keeps the failure in its OWN banner, exactly as before; the hook's `error` is
    // for callers that have nowhere else to put it.
    refresh({ after: load, onError: setError })
  }
```

- [ ] **Step 5: Write the card** (`src/components/settings/PriceRefreshCard.tsx`). `refreshLine` and `refreshRunsLine` are **moved** from `SystemCard.tsx:17-25` and `:71-82`; the runs one is re-typed to take the whole status.

```tsx
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { fetchAppSettings, putAppSettings } from '../../api/settings'
import { fetchSystemStatus } from '../../api/system'
import type { SystemStatus } from '../../types/api'
import { formatDateTime } from '../../utils/format'
import InfoHint from '../InfoHint'
import { FeedBanner } from '../shell/Feed'
import { usePriceRefresh } from '../usePriceRefresh'
import '../panels.css'
import './settings.css'

// The four scheduler facts, moved off the System card (spec §3.3) — the same sentences,
// printed beside the schedule that produces them.
function refreshLine(status: SystemStatus): string {
  const last = status.prices.last
  if (last === null) return 'No refresh recorded yet'
  const failedCount = Object.keys(last.failed).length
  return `${formatDateTime(last.at)} (${last.trigger}) · ${last.updated} updated${
    failedCount > 0 ? ` · ${failedCount} failed` : ''
  }`
}

function refreshRunsLine(status: SystemStatus): string {
  const runs = status.refresh_runs ?? []
  if (runs.length === 0) return '—'
  return runs
    .slice(0, 5)
    .map(
      (run) =>
        `${formatDateTime(run.at)} ${run.updated} updated${
          run.failed_count > 0 ? `, ${run.failed_count} failed` : ''
        }`,
    )
    .join(' · ')
}

/**
 * Price refresh (2026-09-06 spec §3.3): the cron the scheduler runs on, the four facts about
 * what it has been doing, and the manual door. ONE read answers all of it — `/system/status`'s
 * `prices` block IS `/prices/refresh-status` plus `scheduler_running` (SystemPricesStatus
 * extends RefreshStatus), so a second endpoint would only be a second clock to disagree with.
 */
export default function PriceRefreshCard() {
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [cronBox, setCronBox] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState(false)
  const seqRef = useRef(0)
  const { refreshing, note, error: refreshError, refresh } = usePriceRefresh()

  const load = () => {
    const seq = ++seqRef.current
    Promise.all([fetchSystemStatus(), fetchAppSettings()])
      .then(([current, stored]) => {
        if (seq !== seqRef.current) return
        setStatus(current)
        setCronBox(stored.price_refresh_cron)
        setLoadError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setLoadError(err instanceof ApiError ? err.message : 'Could not load the refresh schedule.')
      })
  }

  useEffect(() => {
    load()
    // mount-only: a plain function over stable setters (house idiom)
  }, [])

  const save = () => {
    setSaving(true)
    setFormError(null)
    setSavedNote(false)
    // The cron ALONE (spec §3.5): this card shows no other field, and a full form would revert
    // whatever Plan assumptions or Calendar feed saved a minute ago.
    putAppSettings({ price_refresh_cron: cronBox })
      .then((saved) => {
        // Re-seeded from the RESPONSE (the server strips it), and the facts are re-read because
        // the save hot-applies the schedule — "Next scheduled run" has just moved.
        setCronBox(saved.price_refresh_cron)
        setSavedNote(true)
        load()
      })
      .catch((err: unknown) => {
        setFormError(err instanceof ApiError ? err.message : 'Could not save the schedule.')
      })
      .finally(() => setSaving(false))
  }

  return (
    <section className="card span-6" id="price-refresh" role="region" aria-label="Price refresh">
      <h2 className="eyebrow">
        Price refresh
        <InfoHint text="5-field cron, America/Los_Angeles, day NAMES (e.g. 10 13 * * mon-fri). Applied to the live schedule on save. Must not fire more often than hourly. The Monday run also records the weekly performance point — keep Mondays covered." />
      </h2>
      <FeedBanner error={loadError} retry={load} retryLabel="Retry loading the refresh schedule" />
      <form
        className="settings-card-form"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <label>
          Price refresh cron
          {/* .field-input is already monospaced, which is what a cron expression wants. */}
          <input
            className="field-input"
            value={cronBox}
            disabled={saving}
            onChange={(e) => {
              setCronBox(e.target.value)
              // Every keystroke retires both sentences: they describe the value that WAS in
              // the box (the settings family's rule).
              setSavedNote(false)
              setFormError(null)
            }}
          />
        </label>
        <div className="settings-card-actions">
          <button type="submit" className="button button-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save schedule'}
          </button>
          <button
            type="button"
            className="button"
            disabled={refreshing}
            onClick={() => refresh({ after: load })}
          >
            {refreshing ? 'Refreshing…' : 'Refresh now'}
          </button>
        </div>
        <FeedBanner error={formError} />
        <FeedBanner error={refreshError} />
        {savedNote && (
          <p className="settings-note" role="status">
            Saved — the schedule is applied immediately.
          </p>
        )}
        {note.text !== '' && (
          <p className="settings-note" role="status" title={note.detail || undefined}>
            {note.text}
          </p>
        )}
      </form>
      {status !== null && (
        <dl className="system-facts">
          <div className="system-fact">
            <dt>Last price refresh</dt>
            <dd>{refreshLine(status)}</dd>
          </div>
          <div className="system-fact">
            <dt>Next scheduled run</dt>
            <dd>
              {status.prices.next_run_at ? formatDateTime(status.prices.next_run_at) : 'Not scheduled'}
            </dd>
          </div>
          <div className="system-fact">
            <dt>Scheduler</dt>
            <dd>{status.prices.scheduler_running ? 'Running' : 'Not running'}</dd>
          </div>
          <div className="system-fact">
            <dt>Recent refreshes</dt>
            <dd>{refreshRunsLine(status)}</dd>
          </div>
        </dl>
      )}
    </section>
  )
}
```

- [ ] **Step 6: Trim the System card** (`src/components/settings/SystemCard.tsx`)

Delete the four `<div className="system-fact">` blocks for "Last price refresh", "Next scheduled run", "Scheduler" and "Recent refreshes" (106–123), the now-unused `refreshLine` (17–25) and `refreshRunsLine` (71–82), and `RefreshRun` from the type import. Reword the InfoHint at `:196` to:

```
Operational status: which month each hand-entered feed reaches, the nightly backup marker recorded by the backup script — with whether last night's dump restored — and the database's size and migration head. The refresh schedule lives on the Price refresh card; snapshots and downloads on Backups.
```

In `src/components/settings/SystemCard.test.tsx`, delete every assertion naming those four rows and add:

```tsx
  it('leaves the scheduler facts to the Price refresh card (2026-09-06 spec §3.3)', async () => {
    mount()
    await screen.findByText('Data through')
    for (const label of ['Last price refresh', 'Next scheduled run', 'Scheduler', 'Recent refreshes']) {
      expect(screen.queryByText(label)).toBeNull()
    }
    // The six that stay.
    for (const label of ['Data through', 'Last backup', 'Recent backups', 'Database size', 'Alembic head', 'Environment']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
  })
```

- [ ] **Step 7: Mount the card on the page** — add `import PriceRefreshCard from '../components/settings/PriceRefreshCard'` to `src/pages/SettingsPage.tsx` (the `<PriceRefreshCard />` mount is already in Task 3's Integrations block); restore the `el('price-refresh')` term in the order suite; re-pin the two settings-read counts in `src/pages/SettingsPage.test.tsx` to `5` (the retry test: page failure, page retry, then Plan assumptions, Price refresh and Calendar feed) and `4` (the reads-once-per-card test).

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/components/settings/PriceRefreshCard.test.tsx src/components/settings/SystemCard.test.tsx src/pages/PortfolioPage.test.tsx src/pages/SettingsPage.test.tsx`
Expected: all four files PASS, and **`PortfolioPage.test.tsx` passes with no edits at all** — if it does not, the lift changed behaviour, so fix the hook rather than the test.

- [ ] **Step 9: Commit**

```bash
git add src/components/usePriceRefresh.ts src/components/settings/PriceRefreshCard.tsx src/components/settings/PriceRefreshCard.test.tsx src/components/settings/SystemCard.tsx src/components/settings/SystemCard.test.tsx src/pages/PortfolioPage.tsx src/pages/SettingsPage.tsx src/pages/SettingsPage.test.tsx
git commit -m "feat(settings): a Price refresh card sharing Portfolio's refresh chain"
```

---

### Task 6: Appearance two-by-two, Calendar feed side by side, Activity capped

**Files:**
- Modify: `src/components/settings/AppearanceCard.tsx:45-94`, `src/components/settings/CalendarFeedCard.tsx:111-118,140-198,241-287`, `src/components/settings/ActivityCard.tsx:130-169`, `src/components/settings/settings.css`
- Test: `src/components/settings/{AppearanceCard,CalendarFeedCard,ActivityCard}.test.tsx`

- [ ] **Step 1: Write the failing pins**

In `AppearanceCard.test.tsx`, inside the first `it`, after the region assertion:

```tsx
    // Four fields in a two-by-two grid (spec §3.3), not a 420px column with half a card of
    // air beside it.
    expect(document.querySelector('.settings-fields')?.querySelectorAll('.settings-field')).toHaveLength(4)
```

In `CalendarFeedCard.test.tsx`, a new `it`:

```tsx
  it('stands the token form and the reminder-day form side by side', async () => {
    mount()
    await screen.findByLabelText('Monthly update reminder day')
    // The card is span-12 now: the two forms pair, the token table runs full width below them.
    expect(document.querySelector('.feed-forms')?.querySelectorAll('form')).toHaveLength(2)
  })
```

In `ActivityCard.test.tsx`, a new `it`. Give its `fetchActivity` mock a `next_before: '2026-09-01T00:00:00+00:00'` in the file's `beforeEach` so the Load more button renders:

```tsx
  it('caps the feed with a scroll region that carries Load more inside it', async () => {
    mount()
    await screen.findByRole('region', { name: 'Activity' })
    const scroll = document.querySelector('.settings-scroll')
    expect(scroll?.querySelector('.activity-list')).not.toBeNull()
    // Inside, not under: a Load more that sits below a 420px scroll box is a button the reader
    // has to leave the list to reach.
    expect(scroll?.querySelector('button')).not.toBeNull()
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/components/settings/AppearanceCard.test.tsx src/components/settings/CalendarFeedCard.test.tsx src/components/settings/ActivityCard.test.tsx`
Expected: three FAILs on the null container queries.

- [ ] **Step 3: Wrap the three regions**

- `AppearanceCard.tsx`: wrap the four `<div className="settings-field">` blocks (45–94) in `<div className="settings-fields"> … </div>`. The trailing `.settings-note` stays outside, below.
- `CalendarFeedCard.tsx`: wrap the fresh-token panel / create form (140–198) **and** the reminder-day form (241–287) in one `<div className="feed-forms"> … </div>`. The token table and the two `.settings-note` paragraphs stay outside it, below.
- `ActivityCard.tsx`: wrap the `<ul className="activity-list">` block (130–164) and the `Load more` button (165–169) together in `<div className="settings-scroll"> … </div>`. The report panel (170–180) stays outside — it opens below the list.

- [ ] **Step 4: Drop the read-then-merge** (`src/components/settings/CalendarFeedCard.tsx:111-118`) — replace the comment and the `fetchAppSettings().then(...)` chain with:

```tsx
    // The PUT is PARTIAL now (2026-09-06 spec §3.5): the server reads it with exclude_unset, so
    // an absent key leaves the stored value. The day travels alone, and the re-read this card
    // used to make — to avoid reverting a withdrawal rate the App settings card had changed a
    // minute ago — has nothing left to protect against.
    putAppSettings({ calendar_update_due_day: day })
```

Then in `CalendarFeedCard.test.tsx`: change the first save test's pin (100–106) to `expect(putAppSettings).toHaveBeenCalledWith({ calendar_update_due_day: 5 })`, and REPLACE the "re-reads the settings before the full-form PUT" test (110–128) with:

```tsx
  it('sends the day alone, so nothing this card cannot see is re-written', async () => {
    mount()
    const box = (await screen.findByLabelText('Monthly update reminder day')) as HTMLInputElement
    fireEvent.change(box, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save reminder day' }))
    await waitFor(() => expect(putAppSettings).toHaveBeenCalledTimes(1))
    // One read at mount, and none at save time: the partial PUT retired the re-read dance.
    expect(fetchAppSettings).toHaveBeenCalledTimes(1)
    expect(Object.keys(vi.mocked(putAppSettings).mock.calls[0][0])).toEqual(['calendar_update_due_day'])
  })
```

- [ ] **Step 5: Add the layout rules** (append to `src/components/settings/settings.css`)

```css
/* Appearance's four controls, two by two (spec §3.3): a single column left half the card
   empty beside them. */
.settings-fields {
  display: grid;
  gap: 0.9rem 1.25rem;
}

.settings-fields > .settings-field {
  margin-bottom: 0;
}

/* The Calendar feed card is span-12 now: its two forms sit side by side above the table. */
.feed-forms {
  display: grid;
  gap: 0.75rem 1.25rem;
  align-items: start;
}

/* The activity feed is unbounded — a busy month made this card taller than the rest of the
   page put together. .settings-scroll caps it at 420px and Load more rides INSIDE, so the
   reader never leaves the list to extend it. */
.settings-scroll .activity-list {
  margin-bottom: 0.5rem;
}

@media (min-width: 721px) {
  .settings-fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .feed-forms {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/components/settings`
Expected: PASS. The standing id / region pins keep passing untouched: `ActivityCard.test.tsx:54-55`, `AppearanceCard.test.tsx:19,47`, `BackupsCard.test.tsx:51,72-73`, `CalendarFeedCard.test.tsx:48`, `HealthCard.test.tsx:71-72`, `LimitsCard.test.tsx:206`, `RestoreCard.test.tsx:120,137-138`.

- [ ] **Step 7: Commit**

```bash
git add src/components/settings
git commit -m "feat(settings): appearance two-by-two, feed forms paired, activity capped"
```

---

### Task 7: Form whitespace

**Files:** Modify `src/pages/SettingsPage.css:22-26`, `src/components/settings/settings.css:106-111` and after `:98`

- [ ] **Step 1: Widen the two form sheets.** Replace `SettingsPage.css`'s `.settings-form` rule (22–26) and `settings.css`'s `.settings-card-form` rule (106–111), keeping each file's "deliberate near-twin" comment above it:

```css
/* src/pages/SettingsPage.css */
/* No 420px cap (2026-09-06 spec §3.4): in a span-12 card that single column left two thirds
   of the card empty. Fields flow into as many 240px tracks as the card can hold. */
.settings-form {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}

/* Notes, action rows and banners are sentences about the WHOLE form, never a column of it. */
.settings-form > :not(label) {
  grid-column: 1 / -1;
}

/* A field is a control, not a canvas: even alone in a twelve-column card it stays readable.
   This is the spec's single-field 320px cap, put on the FIELD rather than the form so the
   sentences beside it still run the card's full width. */
.settings-form label {
  max-width: 320px;
}
```

```css
/* src/components/settings/settings.css */
.settings-card-form {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  margin-bottom: 0.9rem;
}

.settings-card-form > :not(label) {
  grid-column: 1 / -1;
}

.settings-card-form label {
  max-width: 320px;
}
```

- [ ] **Step 2: Two-column facts** (append to `settings.css` after the existing `@media (max-width: 720px)` block at 93–98)

```css
/* Six facts down a half-width card is a long thin list; two columns fill it (spec §3.3), and
   the label track has to give inside the narrower column. */
@media (min-width: 721px) {
  .system-facts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.45rem 1.5rem;
  }

  .system-facts .system-fact {
    grid-template-columns: minmax(110px, 40%) 1fr;
  }
}
```

- [ ] **Step 3: Run the suites**

Run: `npx vitest run src/pages/SettingsPage.test.tsx src/components/settings`
Expected: PASS. CSS carries no assertions; this step proves nothing regressed.

- [ ] **Step 4: Commit**

```bash
git add src/pages/SettingsPage.css src/components/settings/settings.css
git commit -m "style(settings): forms flow to the card, facts pair up"
```

---

### Task 8: Palette registry

**Files:** Modify `src/components/paletteRegistry.ts:51-55`; Test `src/components/paletteRegistry.test.ts`

- [ ] **Step 1: Write the failing test** — add after the data-lifecycle `it` (95–104):

```tsx
  it('anchors the two new Settings cards and retires app-settings (2026-09-06 spec §3.6)', () => {
    expect(SETTINGS_SECTIONS.some((s) => s.id === 'app-settings')).toBe(false)
    for (const [query, id] of [
      ['withdrawal rate', 'plan-assumptions'],
      ['espp discount', 'plan-assumptions'],
      ['employer match', 'plan-assumptions'],
      ['cron', 'price-refresh'],
      ['refresh prices', 'price-refresh'],
    ] as const) {
      expect(matchEntries(query, entries).some((e) => e.to === `/settings#${id}`), query).toBe(true)
    }
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/paletteRegistry.test.ts`
Expected: FAIL — `app-settings` is still in `SETTINGS_SECTIONS`.

- [ ] **Step 3: Swap the entries** — replace the `app-settings` object (51–55) with:

```ts
  {
    id: 'plan-assumptions',
    label: 'Plan assumptions',
    keywords: ['withdrawal rate', 'swr', 'espp ticker', 'espp discount', 'employer match'],
  },
  {
    id: 'price-refresh',
    label: 'Price refresh',
    keywords: ['cron', 'schedule', 'refresh prices', 'scheduler'],
  },
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/components/paletteRegistry.test.ts`
Expected: PASS, including the standing "every anchored Settings section has a card wearing that id" test — it reads `SettingsPage.tsx` and every `settings/*.tsx` and both new cards carry `id="plan-assumptions"` / `id="price-refresh"` literally — and the untouched `/settings#password`, `#system` (via 'backup'), `#limits` and `section:calendar` pins.

- [ ] **Step 5: Commit**

```bash
git add src/components/paletteRegistry.ts src/components/paletteRegistry.test.ts
git commit -m "feat(palette): plan-assumptions and price-refresh replace app-settings"
```

---

### Task 9: Whole-lane verification

- [ ] **Step 1: Types** — `npx tsc -b`. Expected: exit 0, no output.
- [ ] **Step 2: Lint** — `npx eslint src/pages/SettingsPage.tsx src/components/settings src/components/paletteRegistry.ts src/components/usePriceRefresh.ts src/pages/PortfolioPage.tsx`. Expected: exit 0. The likely findings are imports left behind by Tasks 4 and 5 (`putAppSettings`, `isPlainDecimal`, `shiftPoint` on the page; `refreshPrices`, `RefreshResult` on Portfolio). Delete them; do not silence them.
- [ ] **Step 3: Full suite** — `npx vitest run`. Expected: green. Beyond this lane's own files, the ones it can break are `src/pages/PortfolioPage.test.tsx` (the hook lift), `src/components/settings/SystemCard.test.tsx` (the four facts) and `src/components/paletteRegistry.test.ts` (the id set).
- [ ] **Step 4: Build** — `npm run build`. Expected: exit 0.
- [ ] **Step 5: Commit anything verification moved**

```bash
git add -A
git commit -m "chore(settings): lane C verification fixes"
```

---

## Carry-overs for lane V

- Four `GET /settings` per mount (the page's gate, Plan assumptions, Price refresh, Calendar feed) and two `GET /system/status` (System, Price refresh): the price of cards that save independently under the partial PUT, and of each card owning one reading of the system.
- Real-browser eyeball: a chip landing its band below the sticky row at both densities, the two-column `.system-facts` at 721 px and at 1400 px, and the Activity scroll cap with a long feed.
- Not in this lane: the backend partial PUT, `espp_discount_pct` and `in_force` (lane A); the four match columns and the paycheck profile form's match fieldset (lanes A/B).
