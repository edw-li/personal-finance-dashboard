# Calendar C — The page: chip grammar, ARIA grid, day drawer, cash-flow strip, URL month, richer form, Up next — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the v2 payload legible and actionable on `/calendar` and on Overview per `docs/superpowers/specs/2026-09-03-calendar-design.md` §7–§10, §13–§14: chips colored by source with compact signed amounts, three per cell then "+N more", a `role="grid"` month with a roving tabindex and week gutters, a day drawer, a four-tile cash-flow strip in integer cents, `?month=YYYY-MM` through `useScope`, a Grid/List `Segmented` (`?view=list`), `?add=1&date=` arrivals, amount/direction/recurrence/until on the form, Mark done / Hide / Your figure on generated events, a source-health footer replacing the caveat prose, and Overview's ranked Up next with its 45-day line.

**Architecture:** Pure modules first (`calendarView.ts` for chip grammar and priority, `cashflow.ts` for cents arithmetic), then presentational components (`CalendarGrid`, `DayDrawer`, `EventDetails`, `CashflowStrip`, `SourceHealth`) that take events and callbacks, then `CalendarPage.tsx` wires state: the month comes from the URL (`useScope({ month: true })`, null = current month), data is fetched by an effect keyed on the month with the snapshot cache painting an already-seen month before its fetch lands, `busy` is DERIVED (no `setState` in an effect body), overrides go through `putCalendarOverride` and a refetch. `Up next` reuses `cashflow.windowSummary` and a `rankUpNext` that puts deadlines first and allows one payday.

**Tech Stack:** React 19, react-router 7 (`useSearchParams`), the shell primitives (`PageFrame`, `Segmented`, `useScope`, `FeedBanner`), `StatTile`, `AmountInput`, vitest + Testing Library.

**Worktree / commands:** Branch `calendar-c` from main AFTER Plan A merged; worktree `.worktrees/calendar-c` with a `node_modules` junction. Frontend only: `npx vitest run <file>` from the worktree root. Test hygiene: the repo's vitest config has no globals and no setup file — every new test file adds `afterEach(cleanup)`.

**Starting shape (after Plans 1c and 3):** `src/pages/CalendarPage.tsx` renders through `PageFrame` (`title="Calendar"`, `actions` = Add event with `ref={addEventBtnRef}` + "Add to calendar (.ics)" calling `downloadIcs(events)`, `resource={{ status, error, busy, retry: reload }}`, `skeleton={{ tiles: 0, cards: [{ span: 12, height: 420 }] }}`), `FeedBanner` for `formError`, `useArrivalParam('add', ADD_ARRIVALS, openAddForm)` with `openAddForm` in a `useCallback`, local `month` state with ‹ Today › handlers, a grid of `div`s with `.cal-chip` buttons and an anchored `.cal-popover`, a duplicate list card, a legend + caveat paragraph. Plan A's edit added the four money fields to the POST/Undo bodies. This plan REPLACES the page body; keep the "Add to calendar (.ics)" action exactly as it is (`downloadIcs(events)` from `src/utils/ics.ts`) — Plan E swaps it onto Lane B's server download.

**Shared-file hotspots (this lane's ONLY touches):** `src/pages/OverviewPage.tsx` (the Up next block, Task 8) and `src/components/overview/upNext.ts`. Nothing in `src/types/api.ts`, `SettingsPage.tsx`, `paletteRegistry.ts` or the backend.

**Contracts inherited from Plan A:** `CalendarEvent` (v2 fields incl. `source, key, short_label, amount, direction, basis, items, done, hidden, note, amount_overridden, recurrence, until, series_start`), `CalendarResponse { events, sources, quote_as_of }`, `SourceHealth`, `CustomEventBody` (+ `amount, direction, recurrence, until`), `CalendarOverrideBody`, `putCalendarOverride(key, body)`, `calendarEvent()` from `src/testing/calendarFixtures.ts`. From the shell: `useScope({ month: true })` → `{ scope: { month: 'YYYY-MM-01' | null }, setScope }`; `Segmented` props `variant, options, ariaLabel, value, onChange`; `PageFrame` props `title, actions, resource, skeleton, children`; `FeedBanner { error }`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/components/calendar/calendarView.ts` (+ test) (rewrite) | `SOURCE_COLORS/LABELS/ORDER`, `EVENT_TYPE_LABELS`, `CHIP_PRIORITY`, `DEADLINE_TYPES`, `CHIP_CAP`, `chipAmount`, `chipText`, `chipTitle`, `visibleEvents`, `sortForCell`, `groupByDate`, `eventKey`, `hrefLabel`, person suffix helpers |
| `src/components/calendar/cashflow.ts` (+ test) (new) | `toCents`, `fromCents`, `formatCompactCents`, `signedCompact`, `summarize`, `monthSummary`, `weekSummary`, `windowSummary`, `cashLine` |
| `src/components/calendar/CalendarGrid.tsx` (+ test) (new) | `role="grid"`, roving tabindex, chips, "+N more", week gutter, anchored popover slot |
| `src/components/calendar/DayDrawer.tsx` (+ test) (new) | the "+N more" / day-number surface |
| `src/components/calendar/EventDetails.tsx` (+ test) (rewrite) | items, amount, basis badge, Mark done / Hide / Your figure / Note, Edit/Delete |
| `src/components/calendar/CashflowStrip.tsx` (+ test) (new) | four tiles |
| `src/components/calendar/SourceHealth.tsx` (+ test) (new) | legend + health footer |
| `src/pages/CalendarPage.tsx` (+ test, css) (rewrite) | URL month, Grid/List, arrivals, form, overrides, land-on-save |
| `src/components/overview/upNext.ts` (+ test) (modify) | `rankUpNext`, `upNextLine` |
| `src/pages/OverviewPage.tsx` (+ test) (modify) | the Up next block |

---

### Task 1: `cashflow.ts` — integer cents, compact money, summaries

**Files:**
- Create: `src/components/calendar/cashflow.ts`, `src/components/calendar/cashflow.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/calendar/cashflow.test.ts
import { describe, expect, it } from 'vitest'
import { calendarEvent } from '../../testing/calendarFixtures'
import {
  cashLine,
  formatCompactCents,
  fromCents,
  monthSummary,
  signedCompact,
  summarize,
  toCents,
  weekSummary,
  windowSummary,
} from './cashflow'

const vest = calendarEvent({ date: '2026-09-16', type: 'rsu_vest', label: 'RSU vest — 4 grants', amount: '41200.00', direction: 'in', basis: 'estimated' })
const payday = calendarEvent({ date: '2026-09-15', type: 'payday', label: 'Payday', amount: '6812.44', direction: 'in' })
const q3 = calendarEvent({ date: '2026-09-15', type: 'tax_deadline', label: 'Tax deadline — Q3', amount: '395.00', direction: 'out', basis: 'estimated', done: true })
const fee = calendarEvent({ date: '2026-09-20', type: 'card_fee', label: 'Venture X annual fee', amount: '395.00', direction: 'out', basis: 'confirmed', hidden: true })
const unknown = calendarEvent({ date: '2026-09-03', type: 'ex_dividend', label: 'Ex-dividend — NVDA', amount: null, direction: 'in', basis: 'estimated' })
const october = calendarEvent({ date: '2026-10-15', type: 'payday', label: 'Payday', amount: '6812.44', direction: 'in' })

describe('cents', () => {
  it('converts 2dp strings to integer cents and back without floats', () => {
    expect(toCents('6812.44')).toBe(681244)
    expect(toCents('-0.05')).toBe(-5)
    expect(toCents('41200')).toBe(4120000)
    expect(toCents('12.5')).toBe(1250)
    expect(fromCents(681244)).toBe('6812.44')
    expect(fromCents(-5)).toBe('-0.05')
    expect(fromCents(0)).toBe('0.00')
    expect(() => toCents('1e3')).toThrow()
  })

  it('formats compact magnitudes and signed compacts with the estimate tilde', () => {
    expect(formatCompactCents(681244)).toBe('$6.8k')
    expect(formatCompactCents(39500)).toBe('$395')
    expect(formatCompactCents(4120000)).toBe('$41.2k')
    expect(formatCompactCents(123456789)).toBe('$1.2M')
    expect(signedCompact(4120000, 'in', true)).toBe('~+$41.2k')
    expect(signedCompact(39500, 'out', false)).toBe('−$395')
    expect(signedCompact(30000, 'neutral', false)).toBe('$300')
  })
})

describe('summaries', () => {
  it('sums cash in (non-rsu), cash out, net and vesting; hidden excluded, done included, unknown skipped', () => {
    const s = summarize([vest, payday, q3, fee, unknown])
    expect(s).toEqual({
      cashIn: 681244,
      cashOut: 39500,
      net: 641744,
      vesting: 4120000,
      estimated: { cashIn: false, cashOut: true, vesting: true },
      unknown: 1,
    })
  })

  it('month, week and window filters', () => {
    const all = [vest, payday, q3, october]
    expect(monthSummary(all, '2026-09-01').cashIn).toBe(681244)
    expect(monthSummary(all, '2026-10-01').cashIn).toBe(681244)
    expect(monthSummary(all, '2026-10-01').vesting).toBe(0)
    expect(weekSummary(all, ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19'])).toMatchObject({ cashIn: 681244, cashOut: 39500, vesting: 4120000 })
    expect(windowSummary(all, '2026-09-16', '2026-10-31')).toMatchObject({ cashIn: 681244, vesting: 4120000, cashOut: 0 })
  })

  it('renders the cash line with only the non-zero legs', () => {
    expect(cashLine(summarize([vest, payday, q3]))).toBe('+$6.8k in · ~−$395 out · ~$41.2k vesting')
    expect(cashLine(summarize([payday]))).toBe('+$6.8k in')
    expect(cashLine(summarize([unknown]))).toBe('amounts unknown')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/calendar/cashflow.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
// src/components/calendar/cashflow.ts
// Cash-flow arithmetic over fetched events (2026-09-03 calendar spec §10): INTEGER CENTS
// from the server's 2dp strings, never floats. Feeds the four tiles, the week gutters, the
// drawer's cash line and Overview's 45-day line — one module so they cannot disagree.
import type { CalendarDirection, CalendarEvent } from '../../types/api'

const CENTS_RE = /^(-?)(\d+)(?:\.(\d{1,2}))?$/

/** '6812.44' → 681244. Throws on anything that is not a plain decimal: the wire promises
 *  2dp strings, and an exponent here would be a bug worth hearing about. */
export function toCents(amount: string): number {
  const match = CENTS_RE.exec(amount.trim())
  if (match === null) throw new Error(`not a 2dp decimal: ${amount}`)
  const [, sign, whole, frac = ''] = match
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'))
  return sign === '-' ? -cents : cents
}

export function fromCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/** Unsigned compact magnitude: $395 · $6.8k · $41.2k · $1.2M. */
export function formatCompactCents(cents: number): string {
  const dollars = Math.abs(cents) / 100
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}k`
  return `$${Math.round(dollars)}`
}

const SIGN: Record<CalendarDirection, string> = { in: '+', out: '−', neutral: '' }

/** "+$6.8k" · "−$395" · "~+$41.2k" — direction is the sign, the tilde says estimate. */
export function signedCompact(cents: number, direction: CalendarDirection, estimated: boolean): string {
  return `${estimated ? '~' : ''}${SIGN[direction]}${formatCompactCents(cents)}`
}

export interface CashSummary {
  cashIn: number // direction in, source ≠ rsu
  cashOut: number
  net: number // cashIn − cashOut
  vesting: number // source rsu, gross
  estimated: { cashIn: boolean; cashOut: boolean; vesting: boolean }
  /** Events with money we cannot know (null amount) — the tiles say "n unknown". */
  unknown: number
}

/** Hidden events are excluded (they are not on the calendar); done deadlines are included
 *  (the money still moves); null amounts are counted, not summed. */
export function summarize(events: CalendarEvent[]): CashSummary {
  const s: CashSummary = { cashIn: 0, cashOut: 0, net: 0, vesting: 0, estimated: { cashIn: false, cashOut: false, vesting: false }, unknown: 0 }
  for (const event of events) {
    if (event.hidden) continue
    if (event.amount === null) {
      if (event.direction !== 'neutral' || event.source === 'rsu') s.unknown += 1
      continue
    }
    const cents = toCents(event.amount)
    const estimated = event.basis === 'estimated'
    if (event.source === 'rsu') {
      s.vesting += cents
      s.estimated.vesting ||= estimated
    } else if (event.direction === 'in') {
      s.cashIn += cents
      s.estimated.cashIn ||= estimated
    } else if (event.direction === 'out') {
      s.cashOut += cents
      s.estimated.cashOut ||= estimated
    }
  }
  s.net = s.cashIn - s.cashOut
  return s
}

export function monthSummary(events: CalendarEvent[], monthIso: string): CashSummary {
  const prefix = monthIso.slice(0, 7)
  return summarize(events.filter((e) => e.date.slice(0, 7) === prefix))
}

export function weekSummary(events: CalendarEvent[], days: readonly string[]): CashSummary {
  const set = new Set(days)
  return summarize(events.filter((e) => set.has(e.date)))
}

export function windowSummary(events: CalendarEvent[], startIso: string, endIso: string): CashSummary {
  return summarize(events.filter((e) => e.date >= startIso && e.date <= endIso))
}

/** "+$6.8k in · −$395 out · ~$41.2k vesting" — zero legs are left out. */
export function cashLine(s: CashSummary): string {
  const parts: string[] = []
  if (s.cashIn !== 0) parts.push(`${signedCompact(s.cashIn, 'in', s.estimated.cashIn)} in`)
  if (s.cashOut !== 0) parts.push(`${signedCompact(s.cashOut, 'out', s.estimated.cashOut)} out`)
  if (s.vesting !== 0) parts.push(`${signedCompact(s.vesting, 'neutral', s.estimated.vesting)} vesting`)
  if (parts.length === 0) return s.unknown > 0 ? 'amounts unknown' : 'nothing due'
  return parts.join(' · ')
}
```

- [ ] **Step 4: Run** — `npx vitest run src/components/calendar/cashflow.test.ts` → 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/components/calendar/cashflow.ts src/components/calendar/cashflow.test.ts
git commit -m "feat(calendar): cashflow — integer-cents summaries, compact signed money, cash line"
```

---

### Task 2: `calendarView.ts` — source colors, chip grammar, priority

**Files:**
- Rewrite: `src/components/calendar/calendarView.ts`, `src/components/calendar/calendarView.test.ts`

- [ ] **Step 1: Write the failing test** (replace the file)

```ts
// src/components/calendar/calendarView.test.ts
import { describe, expect, it } from 'vitest'
import { calendarEvent } from '../../testing/calendarFixtures'
import {
  CHIP_PRIORITY,
  DEADLINE_TYPES,
  EVENT_TYPE_LABELS,
  SOURCE_COLORS,
  SOURCE_LABELS,
  SOURCE_ORDER,
  chipText,
  chipTitle,
  eventKey,
  groupByDate,
  hrefLabel,
  personSuffix,
  sortForCell,
  stripPersonSuffix,
  visibleEvents,
} from './calendarView'

describe('SOURCE_COLORS', () => {
  it('is the FIXED source → slot map over --chart-1…7 with custom on --muted', () => {
    expect(SOURCE_COLORS).toEqual({
      rsu: 'var(--chart-1)', espp: 'var(--chart-2)', dividend: 'var(--chart-3)', payroll: 'var(--chart-4)',
      tax: 'var(--chart-5)', card: 'var(--chart-6)', ritual: 'var(--chart-7)', custom: 'var(--muted)',
    })
    expect(new Set(Object.values(SOURCE_COLORS)).size).toBe(8)
    expect(SOURCE_ORDER).toHaveLength(8)
    for (const source of SOURCE_ORDER) expect(SOURCE_LABELS[source].length).toBeGreaterThan(0)
    expect(Object.keys(EVENT_TYPE_LABELS)).toHaveLength(12)
  })
})

describe('chip grammar', () => {
  const vest = calendarEvent({ date: '2026-09-16', type: 'rsu_vest', label: 'RSU vest — 4 grants', short_label: 'RSU vest · 4 grants', amount: '41200.00', direction: 'in', basis: 'estimated' })
  const q3 = calendarEvent({ date: '2026-09-15', type: 'tax_deadline', label: 'Tax deadline — Q3 estimated payment', short_label: 'Q3 est. tax', amount: '2400.00', direction: 'out', basis: 'estimated' })
  const payday = calendarEvent({ date: '2026-09-15', type: 'payday', label: 'Payday', short_label: 'Payday', amount: '6812.44', direction: 'in' })
  const bare = calendarEvent({ date: '2026-09-15', type: 'ex_dividend', label: 'Ex-dividend — NVDA', short_label: 'Ex-div NVDA' })

  it('chipText is the short label plus the compact signed amount, tilde on estimates', () => {
    expect(chipText(vest)).toBe('RSU vest · 4 grants ~+$41.2k')
    expect(chipText(q3)).toBe('Q3 est. tax ~−$2.4k')
    expect(chipText(payday)).toBe('Payday +$6.8k')
    expect(chipText(bare)).toBe('Ex-div NVDA')
  })

  it('chipTitle is the full label · amount · basis', () => {
    expect(chipTitle(vest)).toBe('RSU vest — 4 grants · $41,200.00 · estimated')
    expect(chipTitle(bare)).toBe('Ex-dividend — NVDA · amount unknown · scheduled')
    expect(chipTitle({ ...payday, amount_overridden: true })).toBe('Payday · $6,812.44 · your figure')
  })

  it('sortForCell: hidden removed by visibleEvents, done deadlines last, priority then |amount|', () => {
    const custom = calendarEvent({ date: '2026-09-15', type: 'custom', label: 'Zoo', id: 3 })
    const doneQ3 = { ...q3, done: true }
    const hidden = calendarEvent({ date: '2026-09-15', type: 'card_fee', label: 'Fee', hidden: true })
    const bigDiv = calendarEvent({ date: '2026-09-15', type: 'ex_dividend', label: 'Ex-dividend — SCHD', amount: '900.00', direction: 'in' })
    const ordered = sortForCell(visibleEvents([bare, doneQ3, payday, hidden, custom, bigDiv]))
    expect(ordered.map((e) => e.label)).toEqual(['Zoo', 'Payday', 'Ex-dividend — SCHD', 'Ex-dividend — NVDA', 'Tax deadline — Q3 estimated payment'])
    expect(CHIP_PRIORITY[0]).toBe('custom')
    expect(CHIP_PRIORITY).toHaveLength(12)
    expect(DEADLINE_TYPES).toEqual(['tax_deadline', 'update_due', 'card_fee'])
  })

  it('eventKey is the server key; groupByDate keeps server order within a day', () => {
    expect(eventKey(vest)).toBe('rsu:vest:2026-09-16')
    const grouped = groupByDate([q3, payday, vest])
    expect([...grouped.keys()]).toEqual(['2026-09-15', '2026-09-16'])
    expect(grouped.get('2026-09-15')?.map((e) => e.type)).toEqual(['tax_deadline', 'payday'])
  })
})

describe('hrefLabel and the person suffix', () => {
  it('names the pages including credit cards', () => {
    expect(hrefLabel('/credit-cards')).toBe('Credit cards')
    expect(hrefLabel('/comp')).toBe('Comp')
    expect(hrefLabel('/nowhere')).toBe('page')
  })
  it('is the server grammar verbatim and peels only the trailing occurrence', () => {
    expect(personSuffix('Sam')).toBe(' — Sam')
    expect(stripPersonSuffix('Dentist — Sam', 'Sam')).toBe('Dentist')
    expect(stripPersonSuffix('Dentist — Sam', undefined)).toBe('Dentist — Sam')
    expect(stripPersonSuffix('Sam — Sam', 'Sam')).toBe('Sam')
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/components/calendar/calendarView.test.ts` → FAIL (`SOURCE_COLORS` not exported).

- [ ] **Step 3: Rewrite the module**

```ts
// src/components/calendar/calendarView.ts
// Pure calendar-page vocabulary — no React, no fetching (the attention.ts posture).
import type { CalendarEvent, CalendarEventType, CalendarSource } from '../../types/api'
import { formatCurrency } from '../../utils/format'
import { signedCompact, toCents } from './cashflow'

// FIXED source → palette-slot map (2026-09-03 calendar spec §7; charts/theme's slot
// discipline: fixed order IS the CVD mechanism — never reorder, never cycle). Spelled as CSS
// custom properties because every consumer is a DOM inline style (chip border, legend dot,
// drawer bar), never an ECharts option. Color is never the only channel: every chip carries
// its short label, and the health footer names the sources.
export const SOURCE_COLORS: Record<CalendarSource, string> = {
  rsu: 'var(--chart-1)',
  espp: 'var(--chart-2)',
  dividend: 'var(--chart-3)',
  payroll: 'var(--chart-4)',
  tax: 'var(--chart-5)',
  card: 'var(--chart-6)',
  ritual: 'var(--chart-7)',
  custom: 'var(--muted)', // entered, not derived
}

export const SOURCE_LABELS: Record<CalendarSource, string> = {
  rsu: 'RSU vests',
  espp: 'ESPP',
  dividend: 'Ex-dividends',
  payroll: 'Paydays',
  tax: 'Tax deadlines',
  card: 'Cards',
  ritual: 'Monthly update',
  custom: 'Your events',
}

export const SOURCE_ORDER: CalendarSource[] = ['rsu', 'espp', 'dividend', 'payroll', 'tax', 'card', 'ritual', 'custom']

export const EVENT_TYPE_LABELS: Record<CalendarEventType, string> = {
  rsu_vest: 'RSU vest',
  espp_purchase: 'ESPP purchase',
  espp_qualify: 'ESPP qualifying date',
  ex_dividend: 'Ex-dividend',
  payday: 'Payday',
  offering_start: 'ESPP offering start',
  tax_deadline: 'Tax deadline',
  update_due: 'Monthly update due',
  custom: 'Custom',
  card_fee: 'Card annual fee',
  card_credit: 'Card credit resets',
  card_anniversary: 'Card anniversary',
}

// Which chips win a crowded cell (spec §7); ties by |amount| descending.
export const CHIP_PRIORITY: CalendarEventType[] = [
  'custom', 'tax_deadline', 'update_due', 'card_fee', 'rsu_vest', 'espp_purchase', 'payday',
  'card_credit', 'card_anniversary', 'ex_dividend', 'espp_qualify', 'offering_start',
]
export const DEADLINE_TYPES: CalendarEventType[] = ['tax_deadline', 'update_due', 'card_fee']
export const CHIP_CAP = 3

export const HREF_LABELS: Record<string, string> = {
  '/comp': 'Comp',
  '/espp': 'ESPP',
  '/portfolio': 'Portfolio',
  '/paycheck': 'Paycheck',
  '/taxes': 'Taxes',
  '/update': 'Monthly update',
  '/credit-cards': 'Credit cards',
}

export function hrefLabel(href: string): string {
  return HREF_LABELS[href] ?? 'page'
}

/** React-key identity — the server's stable key, folded events included. */
export function eventKey(event: CalendarEvent): string {
  return event.key
}

export function isDeadline(event: CalendarEvent): boolean {
  return DEADLINE_TYPES.includes(event.type)
}

/** The compact signed amount for a chip or row, or null when unknowable. */
export function chipAmount(event: CalendarEvent): string | null {
  if (event.amount === null) return null
  return signedCompact(toCents(event.amount), event.direction, event.basis === 'estimated')
}

export function chipText(event: CalendarEvent): string {
  const amount = chipAmount(event)
  return amount === null ? event.short_label : `${event.short_label} ${amount}`
}

export function chipTitle(event: CalendarEvent): string {
  const amount = event.amount === null ? 'amount unknown' : formatCurrency(event.amount)
  return `${event.label} · ${amount} · ${event.amount_overridden ? 'your figure' : event.basis}`
}

/** Hidden events are removed before anything counts them (the cap, the strip, the grid). */
export function visibleEvents(events: CalendarEvent[]): CalendarEvent[] {
  return events.filter((e) => !e.hidden)
}

function absCents(event: CalendarEvent): number {
  return event.amount === null ? -1 : Math.abs(toCents(event.amount))
}

/** Cell order: open items first (a done deadline sorts last and renders struck through),
 *  then CHIP_PRIORITY, then |amount| descending, then the server order. */
export function sortForCell(events: CalendarEvent[]): CalendarEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const doneA = Number(a.event.done && isDeadline(a.event))
      const doneB = Number(b.event.done && isDeadline(b.event))
      if (doneA !== doneB) return doneA - doneB
      const pa = CHIP_PRIORITY.indexOf(a.event.type)
      const pb = CHIP_PRIORITY.indexOf(b.event.type)
      if (pa !== pb) return pa - pb
      const amount = absCents(b.event) - absCents(a.event)
      return amount !== 0 ? amount : a.index - b.index
    })
    .map((x) => x.event)
}

export function groupByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const grouped = new Map<string, CalendarEvent[]>()
  for (const event of events) {
    const bucket = grouped.get(event.date)
    if (bucket) bucket.push(event)
    else grouped.set(event.date, [event])
  }
  return grouped
}

// The person-tag grammar, mirroring the server's generators/payroll.person_suffix.
export function personSuffix(name: string): string {
  return ` — ${name}`
}

/** The label the user actually TYPED — peel the stamped suffix before a re-save. Nothing is
 *  stripped when the name is unknown: a stale suffix is recoverable, a truncated title is not. */
export function stripPersonSuffix(label: string, name: string | undefined): string {
  if (name === undefined) return label
  const suffix = personSuffix(name)
  return label.endsWith(suffix) ? label.slice(0, -suffix.length) : label
}
```

- [ ] **Step 4: Run** — `npx vitest run src/components/calendar/calendarView.test.ts` → 7 passed. `CalendarPage.tsx` and `EventDetails.tsx` still import `EVENT_COLORS`/`EVENT_TYPE_ORDER` — they go RED at `tsc` until Tasks 4 and 6 replace them; expected inside this lane.

- [ ] **Step 5: Commit**

```bash
git add src/components/calendar/calendarView.ts src/components/calendar/calendarView.test.ts
git commit -m "feat(calendar): source colors, chip text/title grammar, cell priority"
```

---

### Task 3: `CalendarGrid` — ARIA grid, roving tabindex, chips, "+N more", week gutter

**Files:**
- Create: `src/components/calendar/CalendarGrid.tsx`, `src/components/calendar/CalendarGrid.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/calendar/CalendarGrid.test.tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { calendarEvent } from '../../testing/calendarFixtures'
import type { CalendarEvent } from '../../types/api'
import CalendarGrid, { gutterText, shiftMonth } from './CalendarGrid'
import { summarize } from './cashflow'

afterEach(cleanup)

const SEP15 = '2026-09-15'
const fixtures: CalendarEvent[] = [
  calendarEvent({ date: SEP15, type: 'payday', label: 'Payday', short_label: 'Payday', amount: '6812.44', direction: 'in' }),
  calendarEvent({ date: SEP15, type: 'tax_deadline', label: 'Tax deadline — Q3 estimated payment', short_label: 'Q3 est. tax', amount: '395.00', direction: 'out', basis: 'estimated' }),
  calendarEvent({ date: SEP15, type: 'ex_dividend', label: 'Ex-dividend — NVDA', short_label: 'Ex-div NVDA' }),
  calendarEvent({ date: SEP15, type: 'custom', label: 'Zoo', id: 3 }),
  calendarEvent({ date: SEP15, type: 'espp_qualify', label: 'ESPP lot qualifies — 2024-08-30', short_label: 'ESPP lot qualifies' }),
  calendarEvent({ date: '2026-09-16', type: 'rsu_vest', label: 'RSU vest — 4 grants', short_label: 'RSU vest · 4 grants', amount: '41200.00', direction: 'in', basis: 'estimated' }),
  calendarEvent({ date: '2026-09-02', type: 'update_due', label: 'Monthly update — enter August 2026', short_label: 'Monthly update', done: true }),
]

function mount(over: Partial<Parameters<typeof CalendarGrid>[0]> = {}) {
  const handlers = {
    onActiveDay: vi.fn(),
    onOpenDay: vi.fn(),
    onToggleEvent: vi.fn(),
    onMonthStep: vi.fn(),
  }
  render(
    <CalendarGrid
      month="2026-09-01"
      events={fixtures}
      today="2026-09-03"
      activeDay={SEP15}
      focusTick={0}
      openKey={null}
      popoverRef={createRef<HTMLDivElement>()}
      renderDetails={(event) => <span>details for {event.label}</span>}
      {...handlers}
      {...over}
    />,
  )
  return handlers
}

const cell = (day: string) => document.querySelector(`[role="gridcell"][data-day="${day}"]`) as HTMLElement

describe('CalendarGrid', () => {
  it('is an ARIA grid with one tab stop on the active day and a Week header', () => {
    mount()
    expect(screen.getByRole('grid', { name: 'Sep 2026 calendar' })).toBeTruthy()
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Week'])
    const cells = screen.getAllByRole('gridcell').filter((c) => c.hasAttribute('data-day'))
    expect(cells.filter((c) => c.getAttribute('tabindex') === '0')).toHaveLength(1)
    expect(cell(SEP15).getAttribute('aria-selected')).toBe('true')
    expect(cell('2026-09-16').getAttribute('aria-selected')).toBe('false')
    // Chips in the active cell are tabbable; elsewhere they are not.
    expect(cell(SEP15).querySelector('button.cal-chip')?.getAttribute('tabindex')).toBe('0')
    expect(cell('2026-09-16').querySelector('button.cal-chip')?.getAttribute('tabindex')).toBe('-1')
  })

  it('caps a day at three slots: two chips plus "+N more" in priority order', () => {
    const handlers = mount()
    const chips = Array.from(cell(SEP15).querySelectorAll('button.cal-chip')).map((c) => c.textContent)
    expect(chips).toEqual(['Zoo', 'Q3 est. tax ~−$395'])
    const more = cell(SEP15).querySelector('button.cal-more') as HTMLElement
    expect(more.textContent).toBe('+3 more')
    fireEvent.click(more)
    expect(handlers.onOpenDay).toHaveBeenCalledWith(SEP15)
    // A three-event day shows all three, no overflow button.
    expect(cell('2026-09-16').querySelectorAll('button.cal-chip')).toHaveLength(1)
    expect(cell('2026-09-16').querySelector('button.cal-more')).toBeNull()
  })

  it('renders chip text, title, source color and the done strike-through', () => {
    mount()
    const vest = cell('2026-09-16').querySelector('button.cal-chip') as HTMLElement
    expect(vest.textContent).toBe('RSU vest · 4 grants ~+$41.2k')
    expect(vest.getAttribute('title')).toBe('RSU vest — 4 grants · $41,200.00 · estimated')
    expect(vest.getAttribute('style')).toContain('border-left-color: var(--chart-1)')
    expect(cell('2026-09-02').querySelector('button.cal-chip')?.classList.contains('is-done')).toBe(true)
  })

  it('day number opens the day; a chip toggles its event with the anchor', () => {
    const handlers = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Open Sep 16, 2026' }))
    expect(handlers.onOpenDay).toHaveBeenCalledWith('2026-09-16')
    const chip = cell('2026-09-16').querySelector('button.cal-chip') as HTMLElement
    fireEvent.click(chip)
    expect(handlers.onToggleEvent).toHaveBeenCalledWith(fixtures[5], chip)
  })

  it('shows the anchored popover for the open key', () => {
    mount({ openKey: 'rsu:vest:2026-09-16' })
    const dialog = screen.getByRole('dialog', { name: 'RSU vest — 4 grants' })
    expect(dialog.textContent).toContain('details for RSU vest — 4 grants')
    expect(cell('2026-09-16').querySelector('button.cal-chip')?.getAttribute('aria-expanded')).toBe('true')
  })

  it('moves the active day with the keyboard and steps the month at the edges', () => {
    const handlers = mount()
    const active = cell(SEP15)
    fireEvent.keyDown(active, { key: 'ArrowRight' })
    expect(handlers.onActiveDay).toHaveBeenLastCalledWith('2026-09-16')
    fireEvent.keyDown(active, { key: 'ArrowDown' })
    expect(handlers.onActiveDay).toHaveBeenLastCalledWith('2026-09-22')
    fireEvent.keyDown(active, { key: 'Home' })
    expect(handlers.onActiveDay).toHaveBeenLastCalledWith('2026-09-13')
    fireEvent.keyDown(active, { key: 'End' })
    expect(handlers.onActiveDay).toHaveBeenLastCalledWith('2026-09-19')
    expect(handlers.onMonthStep).not.toHaveBeenCalled()
    fireEvent.keyDown(active, { key: 'PageDown' })
    expect(handlers.onMonthStep).toHaveBeenLastCalledWith(1)
    expect(handlers.onActiveDay).toHaveBeenLastCalledWith('2026-10-15')
    fireEvent.keyDown(active, { key: 'Enter' })
    expect(handlers.onOpenDay).toHaveBeenCalledWith(SEP15)
  })

  it('an arrow off the last day of the month steps the month', () => {
    const handlers = mount({ activeDay: '2026-09-30' })
    fireEvent.keyDown(cell('2026-09-30'), { key: 'ArrowRight' })
    expect(handlers.onMonthStep).toHaveBeenCalledWith(1)
    expect(handlers.onActiveDay).toHaveBeenCalledWith('2026-10-01')
  })

  it('every row ends with a Week totals gutter reading in / out', () => {
    mount()
    const gutters = screen.getAllByRole('gridcell', { name: 'Week totals' })
    expect(gutters).toHaveLength(5) // September 2026 spans five Sunday-first rows
    expect(gutters[2].textContent).toBe('+$6.8k / ~−$395') // the week of Sep 13–19
    expect(gutters[4].textContent).toBe('—') // Sep 27 – Oct 3: nothing
  })

  it('helpers: shiftMonth clamps to month end; gutterText', () => {
    expect(shiftMonth('2026-01-31', 1)).toBe('2026-02-28')
    expect(shiftMonth('2026-03-15', -1)).toBe('2026-02-15')
    expect(shiftMonth('2026-12-31', 1)).toBe('2027-01-31')
    expect(gutterText(summarize([]))).toBe('—')
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/components/calendar/CalendarGrid.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Write the component**

```tsx
// src/components/calendar/CalendarGrid.tsx
import { useEffect, useRef } from 'react'
import type { KeyboardEvent, ReactNode, RefObject } from 'react'
import type { CalendarEvent } from '../../types/api'
import { formatDate, formatMonth } from '../../utils/format'
import { addDays, addMonths, isoWeekday, monthGrid } from '../../utils/months'
import { CHIP_CAP, SOURCE_COLORS, chipText, chipTitle, groupByDate, sortForCell } from './calendarView'
import { signedCompact, weekSummary } from './cashflow'
import type { CashSummary } from './cashflow'

// The month grid as a real ARIA grid (2026-09-03 calendar spec §8): rows of gridcells, one
// tab stop (the active day) with a roving tabindex, arrows ±1/±7, Home/End across the week,
// PageUp/PageDown across months, Enter/Space opening the day drawer. Chips are buttons in
// the active cell's tab order only. Every row ends with a week-totals gutter. The grid owns
// no data: events, the active day, the open popover key and every verb come from the page.
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export interface CalendarGridProps {
  /** First-of-month ISO date. */
  month: string
  /** VISIBLE events for the fetched window (hidden already removed by the page). */
  events: CalendarEvent[]
  today: string
  activeDay: string
  /** Bump to pull focus back to the active cell (the drawer's Escape does). */
  focusTick: number
  /** The event whose anchored popover is open, by key. */
  openKey: string | null
  popoverRef: RefObject<HTMLDivElement | null>
  renderDetails: (event: CalendarEvent) => ReactNode
  onActiveDay: (day: string) => void
  onOpenDay: (day: string) => void
  onToggleEvent: (event: CalendarEvent, anchor: HTMLElement) => void
  onMonthStep: (delta: 1 | -1) => void
}

/** The same day of month one month over, clamped to that month's last day. */
export function shiftMonth(dayIso: string, delta: number): string {
  const target = addMonths(`${dayIso.slice(0, 7)}-01`, delta)
  const lastDay = Number(addDays(addMonths(target, 1), -1).slice(8, 10))
  const day = Math.min(Number(dayIso.slice(8, 10)), lastDay)
  return `${target.slice(0, 7)}-${String(day).padStart(2, '0')}`
}

/** "+$6.8k / −$395" for the week gutter; an em dash when nothing moves. */
export function gutterText(summary: CashSummary): string {
  if (summary.cashIn === 0 && summary.cashOut === 0) return '—'
  return `${signedCompact(summary.cashIn, 'in', summary.estimated.cashIn)} / ${signedCompact(summary.cashOut, 'out', summary.estimated.cashOut)}`
}

export default function CalendarGrid({
  month,
  events,
  today,
  activeDay,
  focusTick,
  openKey,
  popoverRef,
  renderDetails,
  onActiveDay,
  onOpenDay,
  onToggleEvent,
  onMonthStep,
}: CalendarGridProps) {
  const cellRefs = useRef(new Map<string, HTMLDivElement>())
  // Focus follows the active day only after a KEYBOARD move or an explicit tick — a mouse
  // click on a cell already carries focus, and the initial render must not steal it.
  const pendingFocus = useRef(false)
  const seenTick = useRef(focusTick)
  useEffect(() => {
    if (pendingFocus.current || seenTick.current !== focusTick) {
      pendingFocus.current = false
      seenTick.current = focusTick
      cellRefs.current.get(activeDay)?.focus()
    }
  })

  const weeks = monthGrid(month)
  const byDate = groupByDate(events)
  const shownMonth = month.slice(0, 7)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    let next: string | null = null
    switch (e.key) {
      case 'ArrowLeft':
        next = addDays(activeDay, -1)
        break
      case 'ArrowRight':
        next = addDays(activeDay, 1)
        break
      case 'ArrowUp':
        next = addDays(activeDay, -7)
        break
      case 'ArrowDown':
        next = addDays(activeDay, 7)
        break
      case 'Home':
        next = addDays(activeDay, -isoWeekday(activeDay))
        break
      case 'End':
        next = addDays(activeDay, 6 - isoWeekday(activeDay))
        break
      case 'PageUp':
        next = shiftMonth(activeDay, -1)
        break
      case 'PageDown':
        next = shiftMonth(activeDay, 1)
        break
      case 'Enter':
      case ' ':
        // Only the CELL opens the drawer — a chip or button handles its own Enter.
        if (target.getAttribute('role') === 'gridcell') {
          e.preventDefault()
          onOpenDay(activeDay)
        }
        return
      default:
        return
    }
    e.preventDefault()
    pendingFocus.current = true
    if (next.slice(0, 7) !== shownMonth) onMonthStep(next > activeDay ? 1 : -1)
    onActiveDay(next)
  }

  return (
    <div className="cal-grid" role="grid" aria-label={`${formatMonth(month)} calendar`} onKeyDown={onKeyDown}>
      <div role="row" className="cal-grid-row">
        {DOW.map((dow) => (
          <div key={dow} role="columnheader" className="cal-dow">
            {dow}
          </div>
        ))}
        <div role="columnheader" className="cal-dow cal-gutter-head">
          Week
        </div>
      </div>
      {weeks.map((week, weekIndex) => (
        <div role="row" className="cal-grid-row" key={week[0]}>
          {week.map((day, dayIndex) => {
            const outside = day.slice(0, 7) !== shownMonth
            const active = day === activeDay
            const sorted = sortForCell(byDate.get(day) ?? [])
            // Three slots: all three chips, or two chips and the overflow button (spec §7).
            const overflow = sorted.length > CHIP_CAP ? sorted.length - (CHIP_CAP - 1) : 0
            const shown = overflow > 0 ? sorted.slice(0, CHIP_CAP - 1) : sorted
            const tab = active ? 0 : -1
            return (
              <div
                key={day}
                role="gridcell"
                data-day={day}
                aria-selected={active}
                aria-label={`${formatDate(day)}, ${sorted.length} ${sorted.length === 1 ? 'event' : 'events'}`}
                tabIndex={tab}
                ref={(el) => {
                  if (el) cellRefs.current.set(day, el)
                  else cellRefs.current.delete(day)
                }}
                className={`cal-day${outside ? ' cal-day-outside' : ''}${day === today ? ' cal-day-today' : ''}${active ? ' cal-day-active' : ''}`}
                onClick={() => onActiveDay(day)}
              >
                <button
                  type="button"
                  className="cal-day-number"
                  tabIndex={tab}
                  aria-label={`Open ${formatDate(day)}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenDay(day)
                  }}
                >
                  {Number(day.slice(8, 10))}
                </button>
                {shown.map((event) => {
                  const isOpen = openKey === event.key
                  return (
                    <div key={event.key} className="cal-chip-slot">
                      <button
                        type="button"
                        className={`cal-chip${event.done ? ' is-done' : ''}`}
                        tabIndex={tab}
                        aria-expanded={isOpen}
                        aria-haspopup="dialog"
                        title={chipTitle(event)}
                        style={{ borderLeftColor: SOURCE_COLORS[event.source] }}
                        onClick={(e) => {
                          e.stopPropagation()
                          onToggleEvent(event, e.currentTarget)
                        }}
                      >
                        {chipText(event)}
                      </button>
                      {isOpen && (
                        <div
                          ref={popoverRef}
                          role="dialog"
                          aria-label={event.label}
                          tabIndex={-1}
                          className={`cal-popover${dayIndex >= 5 ? ' cal-popover-right' : ''}`}
                        >
                          {renderDetails(event)}
                        </div>
                      )}
                    </div>
                  )
                })}
                {overflow > 0 && (
                  <button
                    type="button"
                    className="cal-more"
                    tabIndex={tab}
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenDay(day)
                    }}
                  >
                    +{overflow} more
                  </button>
                )}
              </div>
            )
          })}
          <div role="gridcell" className="cal-gutter" aria-label="Week totals" tabIndex={-1} key={`gutter-${weekIndex}`}>
            {gutterText(weekSummary(events, week))}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run** — `npx vitest run src/components/calendar/CalendarGrid.test.tsx` → 9 passed. If the gutter count is off, `monthGrid('2026-09-01')` is Sunday-first: Sep 1 2026 is a Tuesday, so the month spans Aug 30 – Oct 3, five rows.

- [ ] **Step 5: Commit**

```bash
git add src/components/calendar/CalendarGrid.tsx src/components/calendar/CalendarGrid.test.tsx
git commit -m "feat(calendar): CalendarGrid — ARIA grid, roving tabindex, three-slot cells, week gutters"
```

---

### Task 4: `EventDetails` (items, amount, overrides) and `DayDrawer`

**Files:**
- Rewrite: `src/components/calendar/EventDetails.tsx`; Create: `src/components/calendar/EventDetails.test.tsx`
- Create: `src/components/calendar/DayDrawer.tsx`, `src/components/calendar/DayDrawer.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/calendar/EventDetails.test.tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { calendarEvent } from '../../testing/calendarFixtures'
import type { CalendarEvent } from '../../types/api'
import EventDetails from './EventDetails'

afterEach(cleanup)

function mount(event: CalendarEvent) {
  const handlers = { onEdit: vi.fn(), onDelete: vi.fn(), onOverride: vi.fn() }
  render(
    <MemoryRouter>
      <EventDetails event={event} deleting={false} saving={false} {...handlers} />
    </MemoryRouter>,
  )
  return handlers
}

const q3 = calendarEvent({ date: '2026-09-15', type: 'tax_deadline', label: 'Tax deadline — Q3 estimated payment', detail: 'Shortfall $2,400.00 to the prior-year leg', amount: '1200.00', direction: 'out', basis: 'estimated' })

describe('EventDetails', () => {
  it('shows the amount with its basis badge, the detail and the Open link', () => {
    mount(q3)
    expect(screen.getByText('Tax deadline · Sep 15, 2026')).toBeTruthy()
    expect(screen.getByText('$1,200.00 out')).toBeTruthy()
    expect(screen.getByText('estimated')).toBeTruthy()
    expect(screen.getByText('Shortfall $2,400.00 to the prior-year leg')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open Taxes →' }).getAttribute('href')).toBe('/taxes')
  })

  it('Mark done and Hide PUT the full override body', () => {
    const handlers = mount(q3)
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    expect(handlers.onOverride).toHaveBeenCalledWith(q3, { done: true, hidden: false, note: null, amount: null })
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
    expect(handlers.onOverride).toHaveBeenCalledWith(q3, { done: false, hidden: true, note: null, amount: null })
  })

  it('a done deadline offers Reopen; a hidden event offers Unhide', () => {
    mount({ ...q3, done: true, hidden: true })
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Unhide' })).toBeTruthy()
  })

  it('Your figure saves an amount and a note, and "Use the estimate" clears it', () => {
    const handlers = mount(q3)
    fireEvent.click(screen.getByRole('button', { name: 'Your figure' }))
    fireEvent.change(screen.getByLabelText('Amount you paid'), { target: { value: '1250' } })
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: ' paid via EFTPS ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save figure' }))
    expect(handlers.onOverride).toHaveBeenCalledWith(q3, { done: false, hidden: false, note: 'paid via EFTPS', amount: '1250' })
    cleanup()
    const overridden = { ...q3, amount: '1250.00', basis: 'confirmed' as const, amount_overridden: true, note: 'paid via EFTPS' }
    const again = mount(overridden)
    expect(screen.getByText('your figure')).toBeTruthy()
    expect(screen.getByText('Note: paid via EFTPS')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use the estimate' }))
    expect(again.onOverride).toHaveBeenCalledWith(overridden, { done: false, hidden: false, note: 'paid via EFTPS', amount: null })
  })

  it('a folded vest lists its items', () => {
    mount(calendarEvent({
      date: '2026-09-16', type: 'rsu_vest', label: 'RSU vest — 2 grants', amount: '17500.00', direction: 'in', basis: 'estimated',
      items: [{ label: '2025 offer', amount: '12500.00', person_id: null, detail: '25 sh' }, { label: '2026 refresh', amount: '5000.00', person_id: null, detail: '10 sh' }],
    }))
    const items = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual(['2025 offer$12,500.00 · 25 sh', '2026 refresh$5,000.00 · 10 sh'])
    expect(screen.queryByRole('button', { name: 'Mark done' })).toBeNull() // not a deadline
    expect(screen.getByRole('button', { name: 'Hide' })).toBeTruthy()
  })

  it('a custom event offers Edit/Delete and says how it repeats; no override buttons', () => {
    const handlers = mount(calendarEvent({ date: '2026-08-12', type: 'custom', label: 'Piano lesson', id: 8, recurrence: 'weekly', until: '2026-08-19', series_start: '2026-08-05', amount: '60.00', direction: 'out', basis: 'confirmed' }))
    expect(screen.getByText('Repeats weekly until Aug 19, 2026')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(handlers.onEdit).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(handlers.onDelete).toHaveBeenCalled()
  })
})
```

```tsx
// src/components/calendar/DayDrawer.test.tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { calendarEvent } from '../../testing/calendarFixtures'
import DayDrawer from './DayDrawer'

afterEach(cleanup)

const events = [
  calendarEvent({ date: '2026-09-15', type: 'custom', label: 'Zoo membership', id: 3, amount: '120.00', direction: 'out', basis: 'confirmed' }),
  calendarEvent({ date: '2026-09-15', type: 'payday', label: 'Payday', amount: '6812.44', direction: 'in' }),
  calendarEvent({ date: '2026-09-15', type: 'tax_deadline', label: 'Tax deadline — Q3 estimated payment', amount: '395.00', direction: 'out', basis: 'estimated' }),
]

function mount() {
  const handlers = { onClose: vi.fn(), onAddOnDay: vi.fn() }
  render(<DayDrawer day="2026-09-15" events={events} renderDetails={(e) => <span>details: {e.label}</span>} {...handlers} />)
  return handlers
}

describe('DayDrawer', () => {
  it('is a dialog on the assistant drawer shell with the date, the cash line and one row per event', () => {
    mount()
    const dialog = screen.getByRole('dialog', { name: 'Sep 15, 2026 — 3 events' })
    expect(dialog.classList.contains('assistant-drawer')).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Sep 15, 2026' }))
    expect(screen.getByText('+$6.8k in · ~−$515 out')).toBeTruthy()
    const rows = screen.getAllByRole('button', { expanded: false })
    expect(rows.map((r) => r.textContent)).toEqual(['Zoo membership−$120', 'Payday+$6.8k', 'Tax deadline — Q3 estimated payment~−$395est.'])
  })

  it('a row expands to the details; Escape closes; the footer adds on the day', () => {
    const handlers = mount()
    fireEvent.click(screen.getByRole('button', { name: /^Payday/ }))
    expect(screen.getByText('details: Payday')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add event on Sep 15, 2026' }))
    expect(handlers.onAddOnDay).toHaveBeenCalledWith('2026-09-15')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(handlers.onClose).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close the day' }))
    expect(handlers.onClose).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/components/calendar/EventDetails.test.tsx src/components/calendar/DayDrawer.test.tsx` → FAIL.

- [ ] **Step 3: Write both components**

```tsx
// src/components/calendar/EventDetails.tsx
import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import type { CalendarEvent, CalendarOverrideBody } from '../../types/api'
import { canonicalAmount, isAmount } from '../../utils/amount'
import { formatCurrency, formatDate } from '../../utils/format'
import AmountInput from '../AmountInput'
import { EVENT_TYPE_LABELS, SOURCE_COLORS, hrefLabel, isDeadline } from './calendarView'

interface Props {
  event: CalendarEvent
  onEdit: (event: CalendarEvent) => void
  onDelete: (event: CalendarEvent) => void
  deleting: boolean
  /** Generated events only: the FULL override body (spec §13 — PUT is a full replace). */
  onOverride: (event: CalendarEvent, body: CalendarOverrideBody) => void
  saving: boolean
}

/** What the server currently holds for this event — every button edits ONE field of it. */
function overlayOf(event: CalendarEvent): CalendarOverrideBody {
  return { done: event.done, hidden: event.hidden, note: event.note, amount: event.amount_overridden ? event.amount : null }
}

// The one details body (spec §7, §13), shared by the grid popover, the day drawer and the
// list expansion: type · date, label, amount with its basis, items, detail, the series, the
// note, then the verbs — Open, Edit/Delete for custom rows, Mark done / Hide / Your figure
// for generated ones.
export default function EventDetails({ event, onEdit, onDelete, deleting, onOverride, saving }: Props) {
  const [figureOpen, setFigureOpen] = useState(false)
  const [figureBox, setFigureBox] = useState(event.amount_overridden ? (event.amount ?? '') : '')
  const [noteBox, setNoteBox] = useState(event.note ?? '')
  const generated = event.id === null
  const overlay = overlayOf(event)
  const figureValid = figureBox.trim() === '' || isAmount(figureBox, { expressions: false })

  const saveFigure = () => {
    if (!figureValid) return
    const amount = figureBox.trim() === '' ? null : canonicalAmount(figureBox, { expressions: false })
    const note = noteBox.trim() === '' ? null : noteBox.trim()
    onOverride(event, { ...overlay, amount, note })
    setFigureOpen(false)
  }

  return (
    <div className="cal-event-details">
      <div className="cal-event-type">
        <span className="cal-legend-dot" style={{ backgroundColor: SOURCE_COLORS[event.source] }} aria-hidden="true" />
        {EVENT_TYPE_LABELS[event.type]} · {formatDate(event.date)}
      </div>
      <div className={`cal-event-label${event.done ? ' is-done' : ''}`}>{event.label}</div>
      <div className="cal-event-amount">
        {event.amount === null ? (
          <span className="cal-event-unknown">Amount unknown</span>
        ) : (
          <>
            <span className="num">
              {formatCurrency(event.amount)}
              {event.direction === 'neutral' ? '' : ` ${event.direction}`}
            </span>{' '}
            <span className="badge">{event.amount_overridden ? 'your figure' : event.basis}</span>
          </>
        )}
      </div>
      {event.items.length > 0 && (
        <ul className="cal-event-items">
          {event.items.map((item) => (
            <li key={`${item.label}-${item.person_id ?? ''}`}>
              {item.label}
              <span className="num">{item.amount === null ? '—' : formatCurrency(item.amount)}</span>
              {item.detail !== null && ` · ${item.detail}`}
            </li>
          ))}
        </ul>
      )}
      {event.detail !== null && event.detail !== event.label && <div className="cal-event-detail">{event.detail}</div>}
      {event.recurrence !== null && (
        <div className="cal-event-detail">
          Repeats {event.recurrence}
          {event.until !== null ? ` until ${formatDate(event.until)}` : ''}
        </div>
      )}
      {event.note !== null && <div className="cal-event-note">Note: {event.note}</div>}
      <div className="cal-event-actions">
        {event.href !== null && (
          <NavLink to={event.href} className="cal-event-open">
            Open {hrefLabel(event.href)} →
          </NavLink>
        )}
        {!generated && (
          <>
            <button type="button" className="button" onClick={() => onEdit(event)}>
              Edit
            </button>
            <button type="button" className="button" disabled={deleting} onClick={() => onDelete(event)}>
              Delete
            </button>
          </>
        )}
        {generated && isDeadline(event) && (
          <button type="button" className="button" disabled={saving} onClick={() => onOverride(event, { ...overlay, done: !event.done })}>
            {event.done ? 'Reopen' : 'Mark done'}
          </button>
        )}
        {generated && (
          <button type="button" className="button" disabled={saving} onClick={() => onOverride(event, { ...overlay, hidden: !event.hidden })}>
            {event.hidden ? 'Unhide' : 'Hide'}
          </button>
        )}
        {generated && !figureOpen && (
          <button type="button" className="button" disabled={saving} onClick={() => setFigureOpen(true)}>
            Your figure
          </button>
        )}
        {generated && event.amount_overridden && (
          <button type="button" className="button" disabled={saving} onClick={() => onOverride(event, { ...overlay, amount: null })}>
            Use the estimate
          </button>
        )}
      </div>
      {generated && figureOpen && (
        <form
          className="cal-figure-form"
          onSubmit={(e) => {
            e.preventDefault()
            saveFigure()
          }}
        >
          <label>
            Amount you paid
            <AmountInput kind="money" value={figureBox} onValueChange={setFigureBox} aria-label="Amount you paid" placeholder="$0.00" />
          </label>
          <label>
            Note
            <input className="field-input cal-form-input" aria-label="Note" maxLength={300} value={noteBox} onChange={(e) => setNoteBox(e.target.value)} />
          </label>
          <button type="submit" className="button button-primary" disabled={saving || !figureValid}>
            Save figure
          </button>
          <button type="button" className="button" onClick={() => setFigureOpen(false)}>
            Cancel
          </button>
        </form>
      )}
    </div>
  )
}
```

```tsx
// src/components/calendar/DayDrawer.tsx
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { CalendarEvent } from '../../types/api'
import { formatDate } from '../../utils/format'
import '../assistant/assistant.css'
import { SOURCE_COLORS, chipAmount } from './calendarView'
import { cashLine, summarize } from './cashflow'

export interface DayDrawerProps {
  day: string
  /** That day's VISIBLE events in cell order (the page sorts them). */
  events: CalendarEvent[]
  onClose: () => void
  onAddOnDay: (day: string) => void
  renderDetails: (event: CalendarEvent) => ReactNode
}

// The "+N more" / day-number surface (spec §7): the assistant drawer's shell, the date, a
// cash line, every event as a row expanding to EventDetails, "Add event on {date}" at the
// bottom. Escape closes; the PAGE returns focus to the grid cell.
export default function DayDrawer({ day, events, onClose, onAddOnDay, renderDetails }: DayDrawerProps) {
  const [open, setOpen] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    headingRef.current?.focus()
  }, [day])

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    onClose()
  }

  return (
    <aside className="assistant-drawer cal-drawer" role="dialog" aria-label={`${formatDate(day)} — ${events.length} ${events.length === 1 ? 'event' : 'events'}`} onKeyDown={onKeyDown}>
      <div className="assistant-header">
        <h2 ref={headingRef} tabIndex={-1} className="assistant-title cal-drawer-title">
          {formatDate(day)}
        </h2>
        <button type="button" className="assistant-icon-button" aria-label="Close the day" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="cal-drawer-cash">{cashLine(summarize(events))}</p>
      <div className="cal-drawer-rows">
        {events.length === 0 && <p className="empty-note">Nothing on this day.</p>}
        {events.map((event) => {
          const isOpen = open === event.key
          return (
            <div key={event.key} className="cal-drawer-item">
              <button type="button" className={`cal-drawer-row${event.done ? ' is-done' : ''}`} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : event.key)}>
                <span className="cal-drawer-bar" aria-hidden="true" style={{ backgroundColor: SOURCE_COLORS[event.source] }} />
                <span className="cal-drawer-label">{event.label}</span>
                <span className="cal-drawer-amount num">{chipAmount(event) ?? '—'}</span>
                {event.basis === 'estimated' && event.amount !== null && <span className="badge">est.</span>}
              </button>
              {isOpen && <div className="cal-drawer-expansion">{renderDetails(event)}</div>}
            </div>
          )
        })}
      </div>
      <div className="cal-drawer-footer">
        <button type="button" className="button" onClick={() => onAddOnDay(day)}>
          Add event on {formatDate(day)}
        </button>
      </div>
    </aside>
  )
}
```

- [ ] **Step 4: Run** — `npx vitest run src/components/calendar/EventDetails.test.tsx src/components/calendar/DayDrawer.test.tsx` → 8 passed. If the "Your figure" test's amount arrives as `'1250'` vs `'1250.00'`: `canonicalAmount` returns the typed canonical form (`'1250'`); the server quantizes — the test pins the client's contract, not the server's.

- [ ] **Step 5: Commit**

```bash
git add src/components/calendar/EventDetails.tsx src/components/calendar/EventDetails.test.tsx src/components/calendar/DayDrawer.tsx src/components/calendar/DayDrawer.test.tsx
git commit -m "feat(calendar): EventDetails with items, basis and overrides; DayDrawer on the drawer shell"
```

---

### Task 5: `CashflowStrip` and `SourceHealth`

**Files:**
- Create: `src/components/calendar/CashflowStrip.tsx`, `src/components/calendar/CashflowStrip.test.tsx`, `src/components/calendar/SourceHealth.tsx`, `src/components/calendar/SourceHealth.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/calendar/CashflowStrip.test.tsx
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { calendarEvent } from '../../testing/calendarFixtures'
import CashflowStrip from './CashflowStrip'

afterEach(cleanup)

const events = [
  calendarEvent({ date: '2026-09-15', type: 'payday', label: 'Payday', amount: '6812.44', direction: 'in' }),
  calendarEvent({ date: '2026-09-30', type: 'payday', label: 'Payday', amount: '6812.44', direction: 'in' }),
  calendarEvent({ date: '2026-09-15', type: 'tax_deadline', label: 'Q3', amount: '395.00', direction: 'out', basis: 'estimated' }),
  calendarEvent({ date: '2026-09-16', type: 'rsu_vest', label: 'RSU vest — 4 grants', amount: '41200.00', direction: 'in', basis: 'estimated' }),
  calendarEvent({ date: '2026-09-20', type: 'card_fee', label: 'Fee', amount: '95.00', direction: 'out', basis: 'confirmed', hidden: true }),
  calendarEvent({ date: '2026-10-15', type: 'payday', label: 'Payday', amount: '6812.44', direction: 'in' }),
]

describe('CashflowStrip', () => {
  it('shows four tiles for the visible month, tildes on estimated legs, hidden excluded', () => {
    render(<CashflowStrip events={events} month="2026-09-01" quoteAsOf="2026-09-02T20:00:00Z" />)
    const tiles = screen.getAllByRole('group').map((tile) => tile.textContent)
    expect(tiles[0]).toContain('Cash in')
    expect(tiles[0]).toContain('$13,624.88')
    expect(tiles[1]).toContain('Cash out')
    expect(tiles[1]).toContain('~$395.00')
    expect(tiles[2]).toContain('Net')
    expect(tiles[2]).toContain('$13,229.88')
    expect(tiles[3]).toContain('Vesting')
    expect(tiles[3]).toContain('~$41,200.00')
    expect(screen.getByText(/quote as of Sep 2, 2026/)).toBeTruthy()
  })

  it('reads a negative net and an empty month honestly', () => {
    render(<CashflowStrip events={[events[2]]} month="2026-09-01" quoteAsOf={null} />)
    expect(screen.getAllByRole('group')[2].textContent).toContain('−$395.00')
    cleanup()
    render(<CashflowStrip events={[]} month="2026-09-01" quoteAsOf={null} />)
    expect(screen.getAllByRole('group')[0].textContent).toContain('$0.00')
  })
})
```

```tsx
// src/components/calendar/SourceHealth.test.tsx
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import SourceHealth from './SourceHealth'

afterEach(cleanup)

describe('SourceHealth', () => {
  it('lists every source in the fixed order with its color dot, status and note', () => {
    render(
      <SourceHealth
        sources={[
          { source: 'payroll', status: 'partial', note: 'Sam: paid on another cadence — paydays omitted' },
          { source: 'rsu', status: 'ok', note: 'valued at the NVDA quote' },
          { source: 'card', status: 'off', note: 'no cards entered' },
        ]}
      />,
    )
    const items = screen.getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual([
      'RSU vests — valued at the NVDA quote',
      'Paydays partial — Sam: paid on another cadence — paydays omitted',
      'Cards off — no cards entered',
    ])
    expect(items[0].querySelector('.cal-legend-dot')?.getAttribute('style')).toContain('var(--chart-1)')
    expect(screen.getByRole('list', { name: 'Sources' })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/components/calendar/CashflowStrip.test.tsx src/components/calendar/SourceHealth.test.tsx` → FAIL.

- [ ] **Step 3: Write both components**

```tsx
// src/components/calendar/CashflowStrip.tsx
import type { CalendarEvent } from '../../types/api'
import { formatCurrency, formatDate } from '../../utils/format'
import StatTile from '../StatTile'
import { fromCents, monthSummary } from './cashflow'

// Four tiles for the VISIBLE month (2026-09-03 calendar spec §10), integer cents from the
// 2dp strings. A tile whose inputs include an estimate wears the tilde and names the quote
// date in its hint. Hidden events are excluded; done deadlines are included.
export default function CashflowStrip({ events, month, quoteAsOf }: { events: CalendarEvent[]; month: string; quoteAsOf: string | null }) {
  const s = monthSummary(events, month)
  const asOf = quoteAsOf === null ? '' : ` (quote as of ${formatDate(quoteAsOf)})`
  const estimateHint = `Includes estimates${asOf}`
  const money = (cents: number, estimated: boolean) => `${estimated ? '~' : ''}${cents < 0 ? '−' : ''}${formatCurrency(fromCents(Math.abs(cents)))}`
  const netEstimated = s.estimated.cashIn || s.estimated.cashOut
  return (
    <div className="kpi-row cal-strip" aria-label={`Cash flow for ${formatDate(month).slice(0, 3)}`}>
      <div role="group" aria-label="Cash in">
        <StatTile label="Cash in" value={money(s.cashIn, s.estimated.cashIn)} hint={s.estimated.cashIn ? estimateHint : 'Paydays, dividends and your own inflows this month — vests are counted separately.'} />
      </div>
      <div role="group" aria-label="Cash out">
        <StatTile label="Cash out" value={money(s.cashOut, s.estimated.cashOut)} hint={s.estimated.cashOut ? estimateHint : 'Fees, estimated tax payments and your own outflows this month.'} />
      </div>
      <div role="group" aria-label="Net">
        <StatTile label="Net" value={money(s.net, netEstimated)} tone={s.net < 0 ? 'negative' : s.net > 0 ? 'positive' : 'neutral'} hint="Cash in minus cash out." />
      </div>
      <div role="group" aria-label="Vesting">
        <StatTile label="Vesting" value={money(s.vesting, s.estimated.vesting)} hint={`Gross value of the month's RSU vests at the latest employer quote${asOf}; sell-to-cover is taken before it reaches you.`} />
      </div>
      {s.unknown > 0 && (
        <p className="drill-hint cal-strip-unknown">
          {s.unknown} {s.unknown === 1 ? 'event has' : 'events have'} no knowable amount.
        </p>
      )}
    </div>
  )
}
```

```tsx
// src/components/calendar/SourceHealth.tsx
import type { SourceHealth as SourceHealthRow } from '../../types/api'
import { SOURCE_COLORS, SOURCE_LABELS, SOURCE_ORDER } from './calendarView'

// The legend AND the health footer in one list (spec §3 "source-health footer replaces the
// caveat prose"): every family the server reported, in the fixed palette order, with its
// dot, its status when it is not plainly on, and the server's own note.
export default function SourceHealth({ sources }: { sources: SourceHealthRow[] }) {
  const rows = SOURCE_ORDER.flatMap((source) => sources.filter((row) => row.source === source))
  return (
    <ul className="cal-health" aria-label="Sources">
      {rows.map((row) => (
        <li key={row.source} className={`cal-health-${row.status}`}>
          <span className="cal-legend-dot" style={{ backgroundColor: SOURCE_COLORS[row.source] }} aria-hidden="true" />
          {SOURCE_LABELS[row.source]}
          {row.status !== 'ok' && <span className="badge cal-health-badge">{row.status}</span>}
          {row.note !== null && <span className="cal-health-note"> — {row.note}</span>}
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 4: Run** — `npx vitest run src/components/calendar/CashflowStrip.test.tsx src/components/calendar/SourceHealth.test.tsx` → 3 passed. (The `SourceHealth` badge text renders adjacent to the label with no space: the expected strings above are `Paydays partial — …`; if `StatTile` renders its value inside an element the `textContent` still concatenates label + value.)

- [ ] **Step 5: Commit**

```bash
git add src/components/calendar/CashflowStrip.tsx src/components/calendar/CashflowStrip.test.tsx src/components/calendar/SourceHealth.tsx src/components/calendar/SourceHealth.test.tsx
git commit -m "feat(calendar): cash-flow strip tiles and the source-health footer"
```

---

### Task 6: `CalendarPage` — URL month, Grid/List, arrivals, the richer form, overrides, land-on-save

**Files:**
- Rewrite: `src/pages/CalendarPage.tsx`, `src/pages/CalendarPage.test.tsx`
- Modify: `src/pages/CalendarPage.css` (Task 8 carries the CSS block)

- [ ] **Step 1: Write the failing tests** (replace the file — the v1 popover/list/person-tag cases are re-expressed below on the v2 surfaces)

```tsx
// src/pages/CalendarPage.test.tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { clearSnapshots, setSnapshot } from '../api/snapshotCache'
import ToastProvider from '../components/ToastProvider'
import { calendarEvent } from '../testing/calendarFixtures'
import type { CalendarEvent, CalendarResponse } from '../types/api'
import { formatDate, formatMonth } from '../utils/format'
import { addDays, addMonths, currentMonthIso } from '../utils/months'
import CalendarPage from './CalendarPage'

vi.mock('../api/calendar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/calendar')>()),
  fetchCalendar: vi.fn(),
  createCustomEvent: vi.fn(),
  updateCustomEvent: vi.fn(),
  deleteCustomEvent: vi.fn(),
  putCalendarOverride: vi.fn(),
}))
vi.mock('../utils/ics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/ics')>()),
  downloadIcs: vi.fn(),
}))
vi.mock('../api/household', () => ({ fetchHousehold: vi.fn() }))
import { createCustomEvent, deleteCustomEvent, fetchCalendar, putCalendarOverride, updateCustomEvent } from '../api/calendar'
import { fetchHousehold } from '../api/household'
import { downloadIcs } from '../utils/ics'

// Wall-clock-proof fixtures: the page boots on the current month, so every date derives
// from the run's real month.
const MONTH = currentMonthIso()
const PREV = addMonths(MONTH, -1)
const NEXT = addMonths(MONTH, 1)
const DAY_15 = `${MONTH.slice(0, 8)}15`
const DAY_16 = `${MONTH.slice(0, 8)}16`
const Q3_KEY = `tax:2026-q3:${DAY_15}`

function fixtureEvents(): CalendarEvent[] {
  return [
    calendarEvent({ date: DAY_16, type: 'rsu_vest', label: 'RSU vest — 4 grants', short_label: 'RSU vest · 4 grants', amount: '41200.00', direction: 'in', basis: 'estimated', items: [{ label: '2025 offer', amount: '41200.00', person_id: null, detail: '50 sh' }] }),
    calendarEvent({ date: DAY_15, type: 'payday', label: 'Payday', short_label: 'Payday', amount: '6812.44', direction: 'in' }),
    calendarEvent({ date: DAY_15, type: 'tax_deadline', label: 'Tax deadline — Q3 estimated payment', short_label: 'Q3 est. tax', entity_ref: '2026-q3', amount: '2400.00', direction: 'out', basis: 'estimated' }),
    calendarEvent({ date: DAY_15, type: 'ex_dividend', label: 'Ex-dividend — NVDA', short_label: 'Ex-div NVDA' }),
    calendarEvent({ date: DAY_15, type: 'custom', label: 'Car insurance', short_label: 'Car insurance', detail: 'policy 8841', id: 41 }),
  ]
}

const SOURCES: CalendarResponse['sources'] = [
  { source: 'rsu', status: 'ok', note: 'valued at the NVDA quote' },
  { source: 'payroll', status: 'ok', note: null },
]

function payload(events = fixtureEvents()): CalendarResponse {
  return { events, sources: SOURCES, quote_as_of: null }
}

function windowFor(monthIso: string): [string, string] {
  return [addMonths(monthIso, -1), addDays(addMonths(monthIso, 2), -1)]
}

function Url() {
  const location = useLocation()
  return <span data-testid="url">{location.pathname + location.search}</span>
}

function renderPage(events: CalendarEvent[] = fixtureEvents(), entry = '/calendar') {
  vi.mocked(fetchCalendar).mockResolvedValue(payload(events))
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <Routes>
          <Route path="*" element={<><CalendarPage /><Url /></>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

const url = () => screen.getByTestId('url').textContent
const cell = (day: string) => document.querySelector(`[role="gridcell"][data-day="${day}"]`) as HTMLElement
const chipIn = (day: string, prefix: string) =>
  Array.from(cell(day).querySelectorAll('button.cal-chip')).find((c) => c.textContent?.startsWith(prefix)) as HTMLElement
const v2Body = { amount: null, direction: 'neutral', recurrence: 'none', until: null }

beforeEach(() => {
  vi.clearAllMocks()
  clearSnapshots()
  vi.mocked(fetchHousehold).mockResolvedValue({
    people: [{ id: 1, name: 'Ed', is_primary: true }, { id: 2, name: 'Sam', is_primary: false }],
    marriage_date: null,
  })
  vi.mocked(putCalendarOverride).mockResolvedValue({ key: Q3_KEY, done: true, hidden: false, note: null, amount: null })
})
afterEach(cleanup)

describe('CalendarPage — month, views, grid', () => {
  it('fetches the month ± one and renders the ARIA grid with priced, capped chips', async () => {
    renderPage()
    await screen.findByRole('grid')
    expect(fetchCalendar).toHaveBeenCalledWith(...windowFor(MONTH))
    expect(chipIn(DAY_16, 'RSU vest').textContent).toBe('RSU vest · 4 grants ~+$41.2k')
    expect(cell(DAY_15).querySelectorAll('button.cal-chip')).toHaveLength(2)
    expect(cell(DAY_15).querySelector('button.cal-more')?.textContent).toBe('+2 more')
    expect(screen.queryByText(/confirmed announcements only/)).toBeNull() // the caveat prose is gone
    expect(screen.getByRole('list', { name: 'Sources' }).textContent).toContain('RSU vests — valued at the NVDA quote')
  })

  it('?month=YYYY-MM drives the fetch; ‹ › and Today write the URL', async () => {
    renderPage(fixtureEvents(), `/calendar?month=${PREV.slice(0, 7)}`)
    await screen.findByRole('grid')
    expect(fetchCalendar).toHaveBeenCalledWith(...windowFor(PREV))
    expect(screen.getByRole('heading', { name: formatMonth(PREV) })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(url()).toBe('/calendar') // the current month is never written
    await waitFor(() => expect(vi.mocked(fetchCalendar).mock.calls.at(-1)).toEqual(windowFor(MONTH)))
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(url()).toBe(`/calendar?month=${PREV.slice(0, 7)}`)
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(url()).toBe('/calendar')
  })

  it('accepts a legacy YYYY-MM-DD month link and the month input jumps', async () => {
    renderPage(fixtureEvents(), `/calendar?month=${PREV}`)
    await screen.findByRole('grid')
    await waitFor(() => expect(url()).toBe(`/calendar?month=${PREV.slice(0, 7)}`))
    fireEvent.change(screen.getByLabelText('Jump to month'), { target: { value: '2027-03' } })
    expect(url()).toBe('/calendar?month=2027-03')
    await waitFor(() => expect(vi.mocked(fetchCalendar).mock.calls.at(-1)).toEqual(windowFor('2027-03-01')))
  })

  it('?view=list renders the accessible list with amounts instead of the grid', async () => {
    renderPage(fixtureEvents(), '/calendar?view=list')
    await screen.findByText('Payday')
    expect(screen.queryByRole('grid')).toBeNull()
    const list = document.querySelector('.cal-list') as HTMLElement
    expect(list.textContent).toContain('+$6.8k')
    expect(list.textContent).toContain('2025 offer')
    fireEvent.click(screen.getByRole('button', { name: 'Grid' }))
    expect(url()).toBe('/calendar')
    await screen.findByRole('grid')
  })

  it('the strip totals the visible month', async () => {
    renderPage()
    await screen.findByRole('grid')
    expect(screen.getByRole('group', { name: 'Cash in' }).textContent).toContain('$6,812.44')
    expect(screen.getByRole('group', { name: 'Cash out' }).textContent).toContain('~$2,400.00')
    expect(screen.getByRole('group', { name: 'Vesting' }).textContent).toContain('~$41,200.00')
  })

  it('"+N more" and the day number open the drawer; Escape returns focus to the cell', async () => {
    renderPage()
    await screen.findByRole('grid')
    fireEvent.click(cell(DAY_15).querySelector('button.cal-more') as HTMLElement)
    const dialog = screen.getByRole('dialog', { name: `${formatDate(DAY_15)} — 4 events` })
    expect(dialog.textContent).toContain('Ex-dividend — NVDA')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(cell(DAY_15))
    fireEvent.click(screen.getByRole('button', { name: `Open ${formatDate(DAY_16)}` }))
    expect(screen.getByRole('dialog', { name: `${formatDate(DAY_16)} — 1 event` })).toBeTruthy()
  })

  it('exports the fetched window (Plan E swaps this onto the server renderer)', async () => {
    renderPage()
    await screen.findByRole('grid')
    fireEvent.click(screen.getByRole('button', { name: 'Add to calendar (.ics)' }))
    expect(downloadIcs).toHaveBeenCalledWith(fixtureEvents())
  })

  it('shows the frame error with Retry on a failed first load', async () => {
    vi.mocked(fetchCalendar).mockRejectedValueOnce(new ApiError('calendar down', 500))
    vi.mocked(fetchCalendar).mockResolvedValueOnce(payload())
    render(<MemoryRouter><ToastProvider><CalendarPage /></ToastProvider></MemoryRouter>)
    expect((await screen.findByRole('alert')).textContent).toContain('calendar down')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('grid')
  })
})

describe('CalendarPage — form, arrivals, land-on-save', () => {
  it('?add=1&date= opens the form prefilled and is consumed with a replace', async () => {
    renderPage(fixtureEvents(), `/calendar?add=1&date=${DAY_16}`)
    expect(await screen.findByRole('heading', { name: 'Add event' })).toBeTruthy()
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe(DAY_16)
    await waitFor(() => expect(url()).toBe('/calendar'))
  })

  it('Add event defaults to the first of the viewed month and posts every v2 field', async () => {
    vi.mocked(createCustomEvent).mockResolvedValue({ id: 99, date: MONTH, label: 'Rent', detail: null, person_id: null, amount: '2400', direction: 'out', recurrence: 'monthly', until: addMonths(MONTH, 3) })
    renderPage()
    await screen.findByRole('grid')
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe(MONTH)
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: ' Rent ' } })
    fireEvent.change(screen.getByLabelText('Amount (optional)'), { target: { value: '2400' } })
    fireEvent.change(screen.getByLabelText('Direction'), { target: { value: 'out' } })
    fireEvent.change(screen.getByLabelText('Repeats'), { target: { value: 'monthly' } })
    fireEvent.change(screen.getByLabelText('Until (optional)'), { target: { value: addMonths(MONTH, 3) } })
    fireEvent.click(screen.getByRole('button', { name: 'Save event' }))
    expect(createCustomEvent).toHaveBeenCalledWith({
      date: MONTH, label: 'Rent', detail: null, person_id: null,
      amount: '2400', direction: 'out', recurrence: 'monthly', until: addMonths(MONTH, 3),
    })
    await waitFor(() => expect(vi.mocked(fetchCalendar)).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('button', { name: 'Save event' })).toBeNull()
  })

  it('saving into another month lands the grid there', async () => {
    const day = `${NEXT.slice(0, 8)}10`
    vi.mocked(createCustomEvent).mockResolvedValue({ id: 99, date: day, label: 'Trip', detail: null, person_id: null, amount: null, direction: 'neutral', recurrence: 'none', until: null })
    renderPage()
    await screen.findByRole('grid')
    fireEvent.click(screen.getByRole('button', { name: 'Add event' }))
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: day } })
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Trip' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save event' }))
    await waitFor(() => expect(url()).toBe(`/calendar?month=${NEXT.slice(0, 7)}`))
    await waitFor(() => expect(vi.mocked(fetchCalendar).mock.calls.at(-1)).toEqual(windowFor(NEXT)))
    expect(cell(day).getAttribute('tabindex')).toBe('0')
  })

  it('Edit prefills from the popover and PATCHes the whole row', async () => {
    vi.mocked(updateCustomEvent).mockResolvedValue({ id: 41, date: DAY_15, label: 'Renewal', detail: 'policy 8841', person_id: null, ...v2Body })
    renderPage()
    await screen.findByRole('grid')
    fireEvent.click(chipIn(DAY_15, 'Car insurance'))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Car insurance')
    expect((screen.getByLabelText('Repeats') as HTMLSelectElement).value).toBe('none')
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Renewal' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(updateCustomEvent).toHaveBeenCalledWith(41, { date: DAY_15, label: 'Renewal', detail: 'policy 8841', person_id: null, ...v2Body })
  })

  it('STRIPS a stamped person suffix before editing', async () => {
    renderPage([calendarEvent({ date: DAY_15, type: 'custom', label: 'Dentist — Sam', short_label: 'Dentist — Sam', id: 41, person_id: 2 })])
    await screen.findByRole('grid')
    fireEvent.click(chipIn(DAY_15, 'Dentist'))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Dentist')
    expect((screen.getByLabelText('Person') as HTMLSelectElement).value).toBe('2')
  })

  it('Delete offers Undo that re-POSTs the v2 body', async () => {
    vi.mocked(deleteCustomEvent).mockResolvedValue(undefined)
    vi.mocked(createCustomEvent).mockResolvedValue({ id: 77, date: DAY_15, label: 'Car insurance', detail: 'policy 8841', person_id: null, ...v2Body })
    renderPage()
    await screen.findByRole('grid')
    fireEvent.click(chipIn(DAY_15, 'Car insurance'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(deleteCustomEvent).toHaveBeenCalledWith(41)
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(createCustomEvent).toHaveBeenCalledWith({ date: DAY_15, label: 'Car insurance', detail: 'policy 8841', person_id: null, ...v2Body })
  })
})

describe('CalendarPage — overrides', () => {
  it('Mark done PUTs the full override body and refetches', async () => {
    renderPage()
    await screen.findByRole('grid')
    fireEvent.click(chipIn(DAY_15, 'Q3 est. tax'))
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    expect(putCalendarOverride).toHaveBeenCalledWith(Q3_KEY, { done: true, hidden: false, note: null, amount: null })
    await waitFor(() => expect(vi.mocked(fetchCalendar)).toHaveBeenCalledTimes(2))
  })

  it('Hide toasts with an Undo that unhides', async () => {
    renderPage()
    await screen.findByRole('grid')
    fireEvent.click(chipIn(DAY_15, 'Q3 est. tax'))
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
    expect(putCalendarOverride).toHaveBeenCalledWith(Q3_KEY, { done: false, hidden: true, note: null, amount: null })
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(putCalendarOverride).toHaveBeenLastCalledWith(Q3_KEY, { done: false, hidden: false, note: null, amount: null })
  })

  it('a hidden event is off the grid but Unhide-able from the list', async () => {
    renderPage([{ ...fixtureEvents()[2], hidden: true }, fixtureEvents()[1]], '/calendar?view=list')
    await screen.findByText('Payday')
    const hiddenRow = screen.getByRole('button', { name: /Tax deadline — Q3/ })
    expect(hiddenRow.classList.contains('is-hidden')).toBe(true)
    fireEvent.click(hiddenRow)
    expect(screen.getByRole('button', { name: 'Unhide' })).toBeTruthy()
  })
})

describe('CalendarPage — snapshot cache', () => {
  it('paints a seeded month instantly and pages to a seen month before its fetch resolves', async () => {
    setSnapshot(`calendar:${MONTH}`, payload())
    setSnapshot(`calendar:${NEXT}`, payload([calendarEvent({ date: `${NEXT.slice(0, 8)}09`, type: 'custom', label: 'Next-month seed', short_label: 'Next-month seed', id: 77 })]))
    vi.mocked(fetchCalendar).mockReturnValue(new Promise(() => {}))
    render(<MemoryRouter><ToastProvider><CalendarPage /></ToastProvider></MemoryRouter>)
    expect(chipIn(DAY_15, 'Payday')).toBeTruthy()
    expect(fetchCalendar).toHaveBeenCalledWith(...windowFor(MONTH))
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    await screen.findByRole('heading', { name: formatMonth(NEXT) })
    expect(chipIn(`${NEXT.slice(0, 8)}09`, 'Next-month seed')).toBeTruthy()
    await waitFor(() => expect(fetchCalendar).toHaveBeenCalledTimes(2))
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/pages/CalendarPage.test.tsx` → FAIL on the v2 surfaces (no `role="grid"`, no `Jump to month`, …).

- [ ] **Step 3: Rewrite the page**

```tsx
// src/pages/CalendarPage.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { createCustomEvent, deleteCustomEvent, fetchCalendar, putCalendarOverride, updateCustomEvent } from '../api/calendar'
import { fetchHousehold } from '../api/household'
import { getSnapshot, setSnapshot } from '../api/snapshotCache'
import AmountInput from '../components/AmountInput'
import CalendarGrid from '../components/calendar/CalendarGrid'
import CashflowStrip from '../components/calendar/CashflowStrip'
import DayDrawer from '../components/calendar/DayDrawer'
import EventDetails from '../components/calendar/EventDetails'
import SourceHealth from '../components/calendar/SourceHealth'
import { chipAmount, eventKey, groupByDate, sortForCell, stripPersonSuffix, visibleEvents } from '../components/calendar/calendarView'
import { FeedBanner } from '../components/shell/Feed'
import PageFrame from '../components/shell/PageFrame'
import Segmented from '../components/shell/Segmented'
import { useScope } from '../components/shell/useScope'
import { useToast } from '../components/ToastProvider'
import type { CalendarDirection, CalendarEvent, CalendarOverrideBody, CalendarRecurrence, CalendarResponse, CustomEventBody, PersonOut } from '../types/api'
import { canonicalAmount, isAmount } from '../utils/amount'
import { formatDate, formatMonth } from '../utils/format'
import { downloadIcs } from '../utils/ics'
import { addDays, addMonths, currentMonthIso, todayIso } from '../utils/months'
import '../components/panels.css'
import './CalendarPage.css'

// The fetched window: the shown month plus one either side, so ‹/› already have their
// out-of-month chips before the next fetch lands.
function windowFor(monthIso: string): { start: string; end: string } {
  return { start: addMonths(monthIso, -1), end: addDays(addMonths(monthIso, 2), -1) }
}

// One snapshot per shown month — the fetched window is derived from it (2026-08-27 §1).
function calendarKey(monthIso: string): string {
  return `calendar:${monthIso}`
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const ISO_MONTH = /^\d{4}-\d{2}$/
type ViewMode = 'grid' | 'list'
type FormState = { mode: 'add' } | { mode: 'edit'; id: number } | null
interface Fields {
  date: string
  label: string
  detail: string
  person: string // '' = Household; a tag is always deliberate
  amount: string
  direction: CalendarDirection
  recurrence: CalendarRecurrence
  until: string
}
const EMPTY_FIELDS: Fields = { date: '', label: '', detail: '', person: '', amount: '', direction: 'neutral', recurrence: 'none', until: '' }
const VIEW_OPTIONS = [{ value: 'grid' as const, label: 'Grid' }, { value: 'list' as const, label: 'List' }]

export default function CalendarPage() {
  // The visible month lives in the URL (2026-09-03 calendar spec §9): null = the current
  // month, never written. No ScopeBar ribbon — ‹ Today › and the month input sit in the card.
  const { scope, setScope } = useScope({ month: true })
  const month = scope.month ?? currentMonthIso()
  const [searchParams, setSearchParams] = useSearchParams()
  const view: ViewMode = searchParams.get('view') === 'list' ? 'list' : 'grid'

  const [data, setData] = useState<{ month: string; payload: CalendarResponse } | null>(() => {
    const seeded = getSnapshot<CalendarResponse>(calendarKey(month))
    return seeded === undefined ? null : { month, payload: seeded }
  })
  const [revalidating, setRevalidating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seqRef = useRef(0)
  const [openKey, setOpenKey] = useState<string | null>(null) // the grid's anchored popover
  const [openListKey, setOpenListKey] = useState<string | null>(null) // the list's accordion
  const [drawerDay, setDrawerDay] = useState<string | null>(null)
  const [activeDay, setActiveDay] = useState<string>(() => {
    const today = todayIso()
    return today.slice(0, 7) === month.slice(0, 7) ? today : month
  })
  const [focusTick, setFocusTick] = useState(0)
  const [form, setForm] = useState<FormState>(null)
  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS)
  const [people, setPeople] = useState<PersonOut[]>([])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [overriding, setOverriding] = useState(false)
  const anchorRef = useRef<HTMLElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const addEventBtnRef = useRef<HTMLButtonElement | null>(null)
  const toast = useToast()
  // Undo closures and the arrival handler can outlive a month change: they read the month
  // on screen through this ref (unkeyed effect, not a render-time assignment).
  const monthRef = useRef(month)
  useEffect(() => {
    monthRef.current = month
  })

  useEffect(() => {
    fetchHousehold()
      .then((household) => setPeople(household.people))
      .catch(() => setPeople([]))
  }, [])

  const load = (monthIso: string) => {
    const seq = ++seqRef.current
    const { start, end } = windowFor(monthIso)
    fetchCalendar(start, end)
      .then((payload) => {
        if (seq !== seqRef.current) return
        setSnapshot(calendarKey(monthIso), payload)
        setError(null)
        // Identical payload for the same month: nothing re-renders (the snapshot rule).
        setData((current) =>
          current !== null && current.month === monthIso && JSON.stringify(current.payload) === JSON.stringify(payload)
            ? current
            : { month: monthIso, payload },
        )
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(err instanceof ApiError ? err.message : 'Could not load the calendar.')
      })
      .finally(() => {
        if (seq === seqRef.current) setRevalidating(false)
      })
  }

  // The URL is the month's source of truth, so the fetch follows it — back/forward, a deep
  // link, ‹ ›, PageDown and land-on-save all arrive here. `load` is a plain function over
  // stable setters (the house idiom).
  useEffect(() => {
    load(month)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month])

  // What is on screen: this month's payload, else its snapshot (paged-to before its fetch
  // lands), else the previous month's payload dimmed under `busy`. Derived, never seeded
  // from an effect.
  const shown: CalendarResponse | null =
    data !== null && data.month === month ? data.payload : (getSnapshot<CalendarResponse>(calendarKey(month)) ?? data?.payload ?? null)
  const busy = revalidating || data === null || data.month !== month
  const visible = shown === null ? [] : visibleEvents(shown.events)
  const byDate = groupByDate(visible)

  const revalidate = (monthIso: string) => {
    setRevalidating(true)
    load(monthIso)
  }

  const showMonth = (next: string) => {
    setOpenKey(null)
    setDrawerDay(null)
    setScope({ month: next === currentMonthIso() ? null : next })
  }

  const setView = (next: ViewMode) => {
    const params = new URLSearchParams(searchParams)
    if (next === 'list') params.set('view', 'list')
    else params.delete('view')
    setSearchParams(params, { replace: true })
  }

  // Popover lifecycle (the v1 grammar): focus on open, Escape closes and refocuses the chip,
  // an outside mousedown closes.
  useEffect(() => {
    if (openKey === null) return
    popoverRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpenKey(null)
      anchorRef.current?.focus()
    }
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (popoverRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      setOpenKey(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [openKey])

  const toggleEvent = (event: CalendarEvent, anchor: HTMLElement) => {
    if (openKey === event.key) {
      setOpenKey(null)
      return
    }
    anchorRef.current = anchor
    setDrawerDay(null)
    setOpenKey(event.key)
  }

  const openDay = (day: string) => {
    setOpenKey(null)
    setActiveDay(day)
    setDrawerDay(day)
  }

  const closeDrawer = () => {
    setDrawerDay(null)
    setFocusTick((tick) => tick + 1) // the grid pulls focus back to the active cell
  }

  const orderedPeople = [...people].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.id - b.id)
  const ownerName = new Map(people.map((p) => [p.id, p.name]))
  const rawLabel = (event: CalendarEvent): string =>
    event.person_id === null ? event.label : stripPersonSuffix(event.label, ownerName.get(event.person_id))

  // Defaults to the VIEWED month's first day, or the day handed in (spec §8). useCallback
  // over stable setters and a ref: the arrival effect depends on it.
  const openAddForm = useCallback((day?: string) => {
    setForm({ mode: 'add' })
    setFields({ ...EMPTY_FIELDS, date: day ?? monthRef.current })
    setFormError(null)
    setOpenKey(null)
    setDrawerDay(null)
  }, [])

  // ?add=1 (the palette) opens the form; ?add=1&date=YYYY-MM-DD prefills it and views that
  // month. Both are consumed with ONE replace so neither write drops the other's key.
  const rawAdd = searchParams.get('add')
  const rawDate = searchParams.get('date')
  useEffect(() => {
    if (rawAdd === null) return
    const day = rawDate !== null && ISO_DAY.test(rawDate) ? rawDate : undefined
    if (rawAdd === '1') openAddForm(day)
    const next = new URLSearchParams(searchParams)
    next.delete('add')
    next.delete('date')
    if (day !== undefined && day.slice(0, 7) !== monthRef.current.slice(0, 7)) {
      if (day.slice(0, 7) === currentMonthIso().slice(0, 7)) next.delete('month')
      else next.set('month', day.slice(0, 7))
    }
    setSearchParams(next, { replace: true })
  }, [rawAdd, rawDate, openAddForm, searchParams, setSearchParams])

  const startEdit = (event: CalendarEvent) => {
    if (event.id === null) return
    setForm({ mode: 'edit', id: event.id })
    setFields({
      date: event.series_start ?? event.date, // a series edits from its start (whole-series edits only)
      label: rawLabel(event),
      detail: event.detail ?? '',
      person: event.person_id === null ? '' : String(event.person_id),
      amount: event.amount ?? '',
      direction: event.direction,
      recurrence: event.recurrence ?? 'none',
      until: event.until ?? '',
    })
    setFormError(null)
    setOpenKey(null)
    setOpenListKey(null)
    setDrawerDay(null)
  }

  // Land on the saved date: the grid moves there and the window containing it is fetched.
  const landOn = (day: string) => {
    setActiveDay(day)
    const target = `${day.slice(0, 7)}-01`
    if (target !== monthRef.current) showMonth(target)
    else revalidate(target)
  }

  const saveForm = () => {
    if (form === null) return
    const amountText = fields.amount.trim()
    if (amountText !== '' && !isAmount(amountText, { expressions: false })) {
      setFormError('Amount must be a plain number.')
      return
    }
    if (fields.recurrence !== 'none' && fields.until !== '' && fields.until < fields.date) {
      setFormError('Until must be on or after the date.')
      return
    }
    const detail = fields.detail.trim()
    const body: CustomEventBody = {
      date: fields.date,
      label: fields.label.trim(),
      detail: detail === '' ? null : detail,
      person_id: fields.person === '' ? null : Number(fields.person),
      amount: amountText === '' ? null : canonicalAmount(amountText, { expressions: false }),
      direction: amountText === '' ? 'neutral' : fields.direction,
      recurrence: fields.recurrence,
      until: fields.recurrence === 'none' || fields.until === '' ? null : fields.until,
    }
    setSaving(true)
    const call = form.mode === 'add' ? createCustomEvent(body) : updateCustomEvent(form.id, body)
    call
      .then(() => {
        setForm(null)
        landOn(body.date)
      })
      .catch((err: unknown) => setFormError(err instanceof ApiError ? err.message : 'Could not save the event.'))
      .finally(() => setSaving(false))
  }

  const removeEvent = (event: CalendarEvent) => {
    if (event.id === null) return
    setDeleting(true)
    deleteCustomEvent(event.id)
      .then(() => {
        setOpenKey(null)
        setDrawerDay(null)
        addEventBtnRef.current?.focus()
        revalidate(monthRef.current)
        toast.success(`Deleted ${event.label}`, {
          action: {
            label: 'Undo',
            onAction: () => {
              createCustomEvent({
                date: event.series_start ?? event.date,
                label: rawLabel(event),
                detail: event.detail,
                person_id: event.person_id,
                amount: event.amount,
                direction: event.direction,
                recurrence: event.recurrence ?? 'none',
                until: event.until,
              })
                .then(() => revalidate(monthRef.current))
                .catch(() => toast.error(`Could not restore ${event.label}`))
            },
          },
        })
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Could not delete the event.'))
      .finally(() => setDeleting(false))
  }

  // Generated events: the user's edits are an overlay keyed by the event key (spec §13).
  const applyOverride = (event: CalendarEvent, body: CalendarOverrideBody) => {
    setOverriding(true)
    putCalendarOverride(event.key, body)
      .then(() => {
        revalidate(monthRef.current)
        if (body.hidden && !event.hidden) {
          setOpenKey(null)
          toast.success(`Hidden ${event.label}`, {
            action: {
              label: 'Undo',
              onAction: () => {
                putCalendarOverride(event.key, { ...body, hidden: false })
                  .then(() => revalidate(monthRef.current))
                  .catch(() => toast.error(`Could not unhide ${event.label}`))
              },
            },
          })
        }
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Could not save the change.'))
      .finally(() => setOverriding(false))
  }

  const renderDetails = (event: CalendarEvent) => (
    <EventDetails event={event} onEdit={startEdit} onDelete={removeEvent} deleting={deleting} onOverride={applyOverride} saving={overriding} />
  )

  const field = <K extends keyof Fields>(key: K) => (value: Fields[K]) => setFields((current) => ({ ...current, [key]: value }))
  // The list shows the SHOWN month only, hidden rows included (dimmed) so Unhide is reachable.
  const monthEvents = (shown?.events ?? []).filter((e) => e.date.slice(0, 7) === month.slice(0, 7))
  const listGroups = [...groupByDate(monthEvents).entries()]

  return (
    <div className="page calendar-page">
      <PageFrame
        title="Calendar"
        actions={
          <>
            <button type="button" className="button" ref={addEventBtnRef} onClick={() => openAddForm()}>
              Add event
            </button>
            <button type="button" className="button" disabled={shown === null || shown.events.length === 0} onClick={() => shown !== null && downloadIcs(shown.events)}>
              Add to calendar (.ics)
            </button>
          </>
        }
        resource={{
          status: shown === null ? (error !== null ? 'error' : 'loading') : 'ready',
          error,
          busy,
          retry: () => revalidate(month),
        }}
        skeleton={{ tiles: 4, cards: [{ span: 12, height: 420 }] }}
      >
        {shown !== null && (
          <>
            <CashflowStrip events={visible} month={month} quoteAsOf={shown.quote_as_of} />
            <div className="card-grid">
              {form !== null && (
                <section className="card span-12">
                  <h2 className="eyebrow">{form.mode === 'add' ? 'Add event' : 'Edit event'}</h2>
                  <FeedBanner error={formError} />
                  <div className="cal-form">
                    <label className="cal-form-field">
                      Date
                      <input type="date" className="field-input cal-form-input" value={fields.date} onChange={(e) => field('date')(e.target.value)} />
                    </label>
                    <label className="cal-form-field">
                      Title
                      <input className="field-input cal-form-input" value={fields.label} maxLength={120} onChange={(e) => field('label')(e.target.value)} />
                    </label>
                    <label className="cal-form-field cal-form-note">
                      Note (optional)
                      <input className="field-input cal-form-input" value={fields.detail} maxLength={300} onChange={(e) => field('detail')(e.target.value)} />
                    </label>
                    {orderedPeople.length > 1 && (
                      <label className="cal-form-field">
                        Person
                        <select className="field-input cal-form-input" value={fields.person} onChange={(e) => field('person')(e.target.value)}>
                          <option value="">Household</option>
                          {orderedPeople.map((person) => (
                            <option key={person.id} value={String(person.id)}>
                              {person.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="cal-form-field">
                      Amount (optional)
                      <AmountInput kind="money" className="cal-form-input" value={fields.amount} onValueChange={field('amount')} aria-label="Amount (optional)" placeholder="$0.00" />
                    </label>
                    <label className="cal-form-field">
                      Direction
                      <select className="field-input cal-form-input" value={fields.direction} onChange={(e) => field('direction')(e.target.value as CalendarDirection)}>
                        <option value="neutral">No direction</option>
                        <option value="in">Money in</option>
                        <option value="out">Money out</option>
                      </select>
                    </label>
                    <label className="cal-form-field">
                      Repeats
                      <select className="field-input cal-form-input" value={fields.recurrence} onChange={(e) => field('recurrence')(e.target.value as CalendarRecurrence)}>
                        <option value="none">Never</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                        <option value="yearly">Yearly</option>
                      </select>
                    </label>
                    {fields.recurrence !== 'none' && (
                      <label className="cal-form-field">
                        Until (optional)
                        <input type="date" className="field-input cal-form-input" value={fields.until} onChange={(e) => field('until')(e.target.value)} />
                      </label>
                    )}
                    <button type="button" className="button button-primary" disabled={saving || fields.label.trim() === '' || fields.date === ''} onClick={saveForm}>
                      {form.mode === 'add' ? 'Save event' : 'Save changes'}
                    </button>
                    <button type="button" className="button" onClick={() => setForm(null)}>
                      Cancel
                    </button>
                  </div>
                </section>
              )}
              <section className="card span-12">
                <div className="cal-controls">
                  <button type="button" className="button" aria-label="Previous month" onClick={() => showMonth(addMonths(month, -1))}>
                    ‹
                  </button>
                  <button type="button" className="button" onClick={() => showMonth(currentMonthIso())}>
                    Today
                  </button>
                  <button type="button" className="button" aria-label="Next month" onClick={() => showMonth(addMonths(month, 1))}>
                    ›
                  </button>
                  <input
                    type="month"
                    className="field-input cal-month-input"
                    aria-label="Jump to month"
                    value={month.slice(0, 7)}
                    onChange={(e) => {
                      if (ISO_MONTH.test(e.target.value)) showMonth(`${e.target.value}-01`)
                    }}
                  />
                  <h2 className="cal-title">{formatMonth(month)}</h2>
                  <div className="spacer" />
                  <Segmented variant="toggle" ariaLabel="Calendar view" options={VIEW_OPTIONS} value={view} onChange={setView} />
                </div>
                {view === 'grid' ? (
                  <CalendarGrid
                    month={month}
                    events={visible}
                    today={todayIso()}
                    activeDay={activeDay}
                    focusTick={focusTick}
                    openKey={openKey}
                    popoverRef={popoverRef}
                    renderDetails={renderDetails}
                    onActiveDay={setActiveDay}
                    onOpenDay={openDay}
                    onToggleEvent={toggleEvent}
                    onMonthStep={(delta) => showMonth(addMonths(month, delta))}
                  />
                ) : listGroups.length === 0 ? (
                  <p className="empty-note">Nothing this month.</p>
                ) : (
                  <ul className="cal-list">
                    {listGroups.map(([day, dayEvents]) => (
                      <li key={day}>
                        <span className="cal-list-date">{formatDate(day)}</span>
                        <ul>
                          {dayEvents.map((event) => {
                            const key = eventKey(event)
                            const isOpen = openListKey === key
                            return (
                              <li key={key}>
                                <button type="button" className={`row-toggle cal-list-item${event.hidden ? ' is-hidden' : ''}${event.done ? ' is-done' : ''}`} aria-expanded={isOpen} onClick={() => setOpenListKey(isOpen ? null : key)}>
                                  {event.label}
                                  {event.hidden && <span className="cal-list-detail"> (hidden)</span>}
                                  {chipAmount(event) !== null && <span className="cal-list-amount num"> {chipAmount(event)}</span>}
                                  {event.items.length > 0 && (
                                    <span className="cal-list-detail"> — {event.items.map((i) => `${i.label} ${i.amount === null ? '—' : `$${i.amount}`}`).join(', ')}</span>
                                  )}
                                </button>
                                {isOpen && <div className="cal-list-expansion">{renderDetails(event)}</div>}
                              </li>
                            )
                          })}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
                <SourceHealth sources={shown.sources} />
                {shown.events.length === 0 && (
                  <p className="empty-note">
                    No events in this window — vests, purchases, paydays and card dates appear once grants, periods, a
                    paycheck profile and cards are entered. Add your own with Add event.
                  </p>
                )}
              </section>
            </div>
          </>
        )}
      </PageFrame>
      {drawerDay !== null && (
        <DayDrawer
          day={drawerDay}
          events={sortForCell(byDate.get(drawerDay) ?? [])}
          onClose={closeDrawer}
          onAddOnDay={(day) => {
            closeDrawer()
            openAddForm(day)
          }}
          renderDetails={renderDetails}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run** — `npx vitest run src/pages/CalendarPage.test.tsx` → all passed. Likely snags: (a) the drawer's Escape test — the page's document-level Escape listener is registered only while a popover is open, so the drawer's own handler closes it; (b) `Jump to month` — `fireEvent.change` on an `<input type="month">` works in jsdom with a string value; (c) the land-on-save test's `cell(day)` needs the fetch for NEXT to resolve — the mocked `fetchCalendar` returns the same payload for any window, which is fine because the grid renders the month from the URL.

- [ ] **Step 5: Lint, commit**

```bash
npx tsc -b && npx eslint src/pages/CalendarPage.tsx src/components/calendar
git add src/pages/CalendarPage.tsx src/pages/CalendarPage.test.tsx
git commit -m "feat(calendar): the page — URL month, Grid/List, day drawer, strip, health footer, money form, overrides, land-on-save"
```

---

### Task 7: Overview "Up next" — ranking, one payday, the 45-day line

**Files:**
- Modify: `src/components/overview/upNext.ts`, `src/components/overview/upNext.test.ts`, `src/pages/OverviewPage.tsx`, `src/pages/OverviewPage.test.tsx`

- [ ] **Step 1: Write the failing test** (replace `upNext.test.ts`)

```ts
// src/components/overview/upNext.test.ts
import { describe, expect, it } from 'vitest'
import { calendarEvent } from '../../testing/calendarFixtures'
import { UP_NEXT_LIMIT, UP_NEXT_WINDOW_DAYS, rankUpNext, upNextLine } from './upNext'

const TODAY = '2026-08-24'
const payday = (date: string) => calendarEvent({ date, type: 'payday', label: 'Payday', amount: '6812.44', direction: 'in' })

describe('rankUpNext', () => {
  it('puts deadlines due within 14 days first, then dates ascending, at most one payday, five total', () => {
    const events = [
      payday('2026-08-31'),
      payday('2026-09-15'),
      calendarEvent({ date: '2026-08-25', type: 'ex_dividend', label: 'Ex-dividend — NVDA' }),
      calendarEvent({ date: '2026-09-15', type: 'tax_deadline', label: 'Tax deadline — Q3', amount: '1200.00', direction: 'out', basis: 'estimated' }), // 22 days out: not "soon"
      calendarEvent({ date: '2026-09-01', type: 'update_due', label: 'Monthly update — enter August 2026' }), // 8 days out: soon
      calendarEvent({ date: '2026-09-16', type: 'rsu_vest', label: 'RSU vest — 4 grants', amount: '41200.00', direction: 'in', basis: 'estimated' }),
      calendarEvent({ date: '2026-09-03', type: 'espp_qualify', label: 'ESPP lot qualifies' }),
    ]
    const picked = rankUpNext(events, TODAY)
    expect(picked.map((e) => e.label)).toEqual([
      'Monthly update — enter August 2026', // the only deadline due within 14 days
      'Ex-dividend — NVDA',
      'Payday', // Aug 31 — the ONE payday
      'ESPP lot qualifies',
      'Tax deadline — Q3',
    ])
    expect(picked).toHaveLength(UP_NEXT_LIMIT)
  })

  it('drops hidden and done events and anything before today', () => {
    const picked = rankUpNext(
      [
        { ...payday('2026-08-20') },
        { ...payday('2026-08-31'), hidden: true },
        { ...calendarEvent({ date: '2026-08-26', type: 'tax_deadline', label: 'Done deadline' }), done: true },
        payday('2026-09-15'),
      ],
      TODAY,
    )
    expect(picked.map((e) => e.date)).toEqual(['2026-09-15'])
  })

  it('upNextLine sums the next 45 days from today in cents', () => {
    const line = upNextLine(
      [payday('2026-08-31'), payday('2026-09-15'), calendarEvent({ date: '2026-09-15', type: 'tax_deadline', label: 'Q3', amount: '1200.00', direction: 'out', basis: 'estimated' }), payday('2026-10-15')],
      TODAY,
    )
    expect(line).toBe('Next 45 days: +$13.6k in · ~−$1.2k out')
    expect(upNextLine([], TODAY)).toBe('Next 45 days: nothing due')
    expect(UP_NEXT_WINDOW_DAYS).toBe(45)
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/components/overview/upNext.test.ts` → FAIL (`rankUpNext` missing).

- [ ] **Step 3: Rewrite `upNext.ts`**

```ts
// src/components/overview/upNext.ts
// Pure Up-next math for the overview strip (2026-09-03 calendar spec §14; attention.ts's
// charter: no React, no fetching, todayIso injectable). Fed from the same GET /calendar the
// page uses (today → +45 days).
import { DEADLINE_TYPES } from '../calendar/calendarView'
import { cashLine, windowSummary } from '../calendar/cashflow'
import type { CalendarEvent } from '../../types/api'
import { addDays } from '../../utils/months'

export const UP_NEXT_LIMIT = 5
export const UP_NEXT_WINDOW_DAYS = 45
export const SOON_DAYS = 14

/** Not hidden, not done, not past; deadlines due within 14 days first, then by date; at most
 *  ONE payday (two a month would crowd out everything else); the strip's five. */
export function rankUpNext(events: CalendarEvent[], todayIso: string): CalendarEvent[] {
  const soonEdge = addDays(todayIso, SOON_DAYS)
  const live = events.filter((e) => !e.hidden && !e.done && e.date >= todayIso)
  const soonDeadline = (e: CalendarEvent) => DEADLINE_TYPES.includes(e.type) && e.date <= soonEdge
  const ordered = [...live].sort((a, b) => Number(soonDeadline(b)) - Number(soonDeadline(a)) || a.date.localeCompare(b.date))
  const picked: CalendarEvent[] = []
  let paydays = 0
  for (const event of ordered) {
    if (event.type === 'payday') {
      if (paydays === 1) continue
      paydays += 1
    }
    picked.push(event)
    if (picked.length === UP_NEXT_LIMIT) break
  }
  return picked
}

/** "Next 45 days: +$X in · −$Y out" from the same cents arithmetic as the calendar strip. */
export function upNextLine(events: CalendarEvent[], todayIso: string): string {
  const summary = windowSummary(events, todayIso, addDays(todayIso, UP_NEXT_WINDOW_DAYS))
  const line = cashLine({ ...summary, vesting: 0 }) // vesting is not cash; the calendar strip carries it
  return `Next ${UP_NEXT_WINDOW_DAYS} days: ${line}`
}

/** Kept for callers that only trim (the assistant's context builder mirrors it server-side). */
export function upNextItems(events: CalendarEvent[], todayIso: string): CalendarEvent[] {
  return rankUpNext(events, todayIso)
}
```

- [ ] **Step 4: The Overview block** — in `src/pages/OverviewPage.tsx` change the import to `import { UP_NEXT_WINDOW_DAYS, rankUpNext, upNextLine } from '../components/overview/upNext'`, add `import { chipAmount } from '../components/calendar/calendarView'`, and replace the `<div className="up-next">` block's body from the `upNextFailed ?` ternary through `</ul>` with:

```tsx
            {upNextFailed ? (
              <p className="drill-hint">Couldn&apos;t load upcoming events.</p>
            ) : upNext === null ? null : rankUpNext(upNext, todayIso()).length === 0 ? (
              <p className="drill-hint">
                Nothing scheduled in the next {UP_NEXT_WINDOW_DAYS} days.
              </p>
            ) : (
              <>
                <ul className="up-next-list">
                  {rankUpNext(upNext, todayIso()).map((event) => {
                    const amount = chipAmount(event)
                    const row = (
                      <>
                        <span className="up-next-date">{formatDate(event.date)}</span> {event.label}
                        {amount !== null && <span className="up-next-amount num">{amount}</span>}
                      </>
                    )
                    return (
                      <li key={eventKey(event)}>
                        {event.href !== null ? (
                          <NavLink to={event.href} className="up-next-link">
                            {row}
                          </NavLink>
                        ) : (
                          // Custom events are informational — no page to open (spec §9.2).
                          <span className="up-next-link up-next-plain">{row}</span>
                        )}
                      </li>
                    )
                  })}
                </ul>
                <p className="drill-hint up-next-line">{upNextLine(upNext, todayIso())}</p>
              </>
            )}
```

Append to `src/pages/OverviewPage.css`:

```css
/* Up next amounts sit right-aligned in the row (2026-09-03 calendar spec §14). */
.up-next-link {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
}

.up-next-amount {
  margin-left: auto;
  color: var(--muted);
  font-size: 0.8rem;
}

.up-next-line {
  margin-top: 0.35rem;
}
```

- [ ] **Step 5: Overview tests** — in `src/pages/OverviewPage.test.tsx` the `upNextEvents()` builder already uses `calendarEvent` (Plan A); give it amounts (`amount: '6812.44', direction: 'in'`) and add to the Up next describe:

```tsx
  it('ranks Up next with one payday and prints the 45-day line with amounts', async () => {
    const today = todayIso()
    vi.mocked(fetchCalendar).mockResolvedValue({
      events: [
        calendarEvent({ date: addDays(today, 3), type: 'payday', label: 'Payday', amount: '6812.44', direction: 'in' }),
        calendarEvent({ date: addDays(today, 18), type: 'payday', label: 'Payday', amount: '6812.44', direction: 'in' }),
        calendarEvent({ date: addDays(today, 10), type: 'tax_deadline', label: 'Tax deadline — Q3', amount: '1200.00', direction: 'out', basis: 'estimated' }),
      ],
      sources: [],
      quote_as_of: null,
    })
    renderPage()
    const list = await screen.findByRole('list', { name: /up next/i }).catch(() => document.querySelector('.up-next-list') as HTMLElement)
    const items = Array.from((list ?? document.querySelector('.up-next-list'))!.querySelectorAll('li')).map((li) => li.textContent)
    expect(items).toHaveLength(2) // the second payday is dropped
    expect(items[0]).toContain('Tax deadline — Q3') // a deadline within 14 days leads
    expect(items[0]).toContain('~−$1.2k')
    expect(screen.getByText('Next 45 days: +$6.8k in · ~−$1.2k out')).toBeTruthy()
  })
```

(`renderPage` is the file's existing helper; if the list has no accessible name, the `.catch` fallback query is what runs — keep whichever the file's other Up next tests already use and drop the other.) Existing Up next assertions that counted `UP_NEXT_LIMIT` paydays must now expect ONE payday row: adjust their fixture to five distinct types or their expectation to 1 — the one-payday rule is the spec's (§14).

- [ ] **Step 6: Run, lint, commit**

Run: `npx tsc -b && npx eslint src/components/overview src/pages/OverviewPage.tsx && npx vitest run src/components/overview src/pages/OverviewPage.test.tsx`
Expected: clean; all green.

```bash
git add src/components/overview/upNext.ts src/components/overview/upNext.test.ts src/pages/OverviewPage.tsx src/pages/OverviewPage.css src/pages/OverviewPage.test.tsx
git commit -m "feat(overview): Up next ranks deadlines first, allows one payday, prints the 45-day cash line"
```

---

### Task 8: Page CSS, lane gate

**Files:**
- Modify: `src/pages/CalendarPage.css` (append; the v1 rules stay — `.cal-chip`, `.cal-popover`, `.cal-form*`, `.cal-list*`, `.cal-legend-dot` are still used)

- [ ] **Step 1: Append the v2 rules**

```css
/* ── Calendar v2 (2026-09-03 calendar spec §7–§10) ───────────────────────── */

/* Eight columns: seven days and the week gutter. Rows are ARIA rows with display: contents
   so the grid's columns still govern their cells. */
.cal-grid {
  grid-template-columns: repeat(7, minmax(0, 1fr)) 84px;
}

.cal-grid-row {
  display: contents;
}

.cal-gutter-head {
  text-align: right;
}

.cal-gutter {
  min-height: 92px;
  padding: 4px 6px;
  border: 1px dashed var(--surface-2);
  border-radius: 8px;
  font-size: 0.7rem;
  color: var(--muted);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.cal-day:focus-visible,
.cal-day-active {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

/* The day number is now a BUTTON that opens the drawer — reset its chrome to the old text. */
.cal-day-number {
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  font-size: 0.7rem;
  color: var(--muted);
  cursor: pointer;
}

.cal-day-number:hover {
  color: var(--text);
}

.cal-chip.is-done,
.cal-drawer-row.is-done .cal-drawer-label,
.cal-list-item.is-done,
.cal-event-label.is-done {
  text-decoration: line-through;
  color: var(--muted);
}

.cal-list-item.is-hidden {
  opacity: 0.55;
}

.cal-more {
  display: block;
  width: 100%;
  margin-top: 3px;
  padding: 1px 5px;
  border: 1px dashed var(--border);
  border-radius: 4px;
  background: none;
  color: var(--muted);
  font-family: inherit;
  font-size: 0.68rem;
  text-align: left;
  cursor: pointer;
}

.cal-more:hover {
  color: var(--text);
  border-color: var(--muted);
}

.cal-more:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.cal-month-input {
  width: 9.5rem;
  text-align: left;
  font-family: inherit;
}

.cal-list-amount {
  color: var(--muted);
  font-size: 0.8rem;
}

/* The strip sits above the card grid, the frame's kpi-row grammar. */
.cal-strip {
  margin-bottom: 1rem;
}

.cal-strip-unknown {
  grid-column: 1 / -1;
}

/* The health footer replaces the legend + caveat prose: one line per source. */
.cal-health {
  list-style: none;
  margin: 0.75rem 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 1rem;
  font-size: 0.75rem;
  color: var(--muted);
}

.cal-health li {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.cal-health-off {
  opacity: 0.6;
}

.cal-health-badge {
  margin-left: 2px;
}

/* Event details additions. */
.cal-event-amount {
  margin-top: 0.3rem;
  font-size: 0.85rem;
}

.cal-event-unknown,
.cal-event-note {
  color: var(--muted);
  font-size: 0.8rem;
}

.cal-event-items {
  list-style: none;
  margin: 0.3rem 0 0;
  padding: 0;
  font-size: 0.8rem;
}

.cal-event-items li {
  display: flex;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 1px 0;
}

.cal-figure-form {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.cal-figure-form label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: var(--muted);
}

/* The day drawer rides the assistant drawer's shell (position, surface, shadow) and adds
   its own rows. Narrower than the assistant: a day is a list, not a conversation. */
.cal-drawer {
  width: min(380px, 100vw);
}

.cal-drawer-title:focus {
  outline: none;
}

.cal-drawer-cash {
  margin: 0;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--border);
  font-size: 0.8rem;
  color: var(--muted);
}

.cal-drawer-rows {
  flex: 1;
  overflow-y: auto;
}

.cal-drawer-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: none;
  border-bottom: 1px solid var(--surface-2);
  background: none;
  color: var(--text);
  font: inherit;
  font-size: 0.85rem;
  text-align: left;
  cursor: pointer;
}

.cal-drawer-row:hover {
  background: var(--surface-2);
}

.cal-drawer-row:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.cal-drawer-bar {
  width: 3px;
  align-self: stretch;
  border-radius: 2px;
}

.cal-drawer-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cal-drawer-amount {
  color: var(--muted);
  font-size: 0.8rem;
}

.cal-drawer-expansion {
  padding: 0.25rem 0.75rem 0.75rem 1.4rem;
  border-bottom: 1px solid var(--surface-2);
}

.cal-drawer-footer {
  padding: 0.6rem 0.75rem;
  border-top: 1px solid var(--border);
}

@media (max-width: 720px) {
  .cal-gutter {
    display: none;
  }
}
```

- [ ] **Step 2: Lane gate** — `npx tsc -b && npx eslint . && npx vitest run` → clean, all green. Then `npm run build` once (no new echarts, so the chunk limit is untouched).

- [ ] **Step 3: Commit**

```bash
git add src/pages/CalendarPage.css
git commit -m "style(calendar): grid gutters, drawer rows, strip, health footer, figure form"
```

Leave the branch for Plan E to merge (C merges LAST of the three lanes).

---

## Self-review

**Spec coverage:** §7 chip text/title with compact signed amounts and the tilde, color by source over `--chart-1…7` + `--muted`, color never the only channel, three-chip cap with "+N more", `CHIP_PRIORITY` with |amount| ties, done deadlines last and struck through, hidden removed before counting, day drawer on the assistant shell with the cash line, rows, `EventDetails`, Mark done, "Add event on {date}", single-chip anchored popover kept → Tasks 1–6; §8 `role="grid"`/rows/gridcells/`aria-selected`, one tab stop, roving tabindex, ← → ↑ ↓ Home End PageUp PageDown Enter Space Escape, chips tabbable only in the active cell, week gutter "Week totals", Grid/List `Segmented` with `?view=list`, list as the accessible fallback with amounts and items, Add-event defaults (first of viewed month / clicked day), land-on-save, `?add=1` and `?add=1&date=` consumed with a replace → Tasks 3, 6; §9 `useScope({ month: true })`, null = current month unwritten, ‹ › / PageUp/Down write `?month=`, Today writes null, legacy `YYYY-MM-DD` accepted (useScope), no `ScopeBar`, native month input in the control row, snapshot key `calendar:<month>`, window month ± one → Task 6; §10 four tiles in integer cents (in ≠ rsu, out, net, vesting), tilde + quote as-of, hidden excluded, done included, `weekSummary` gutters, `windowSummary` for Overview → Tasks 1, 5, 7; §13 Mark done / Hide / Your figure / Note through `PUT /calendar/overrides/{key}` full replace, "your figure" wording → Tasks 4, 6; §14 `rankUpNext` (not hidden/done, deadlines within 14 days first, one payday, five), compact amounts right-aligned, "Next 45 days: +$X in · −$Y out" → Task 7; §17 vitest list (`calendarView`, `cashflow`, `CalendarGrid`, `DayDrawer`, `CalendarPage`, `SourceHealth`, `upNext`) → Tasks 1–7. Deferred by design: the "Add to calendar (.ics)" swap onto the server download (Plan E), `src/utils/ics.ts` retirement (end of night), the weekly in/out bar (chart grammar follow-on).

**Placeholders:** none — every component, test and CSS block is written out.

**Type consistency:** `CalendarGridProps` (`month, events, today, activeDay, focusTick, openKey, popoverRef, renderDetails, onActiveDay, onOpenDay, onToggleEvent, onMonthStep`) match between Task 3 and the page; `DayDrawerProps` (`day, events, onClose, onAddOnDay, renderDetails`) between Task 4 and the page; `EventDetails` props (`event, onEdit, onDelete, deleting, onOverride, saving`) between Task 4, the page's `renderDetails` and the tests; `CashflowStrip { events, month, quoteAsOf }` and `SourceHealth { sources }` between Task 5 and the page; `cashflow` exports (`toCents, fromCents, formatCompactCents, signedCompact, summarize, monthSummary, weekSummary, windowSummary, cashLine`, `CashSummary`) used by `calendarView`, `CalendarGrid`, `DayDrawer`, `CashflowStrip`, `upNext`; `calendarView` exports (`SOURCE_COLORS, SOURCE_LABELS, SOURCE_ORDER, EVENT_TYPE_LABELS, CHIP_PRIORITY, DEADLINE_TYPES, CHIP_CAP, chipAmount, chipText, chipTitle, visibleEvents, sortForCell, groupByDate, eventKey, isDeadline, hrefLabel, personSuffix, stripPersonSuffix`) match every importer; `putCalendarOverride(key, body)` and `CalendarOverrideBody` are Plan A's; `Segmented` is called with `variant="toggle"`, `options`, `ariaLabel`, `value`, `onChange` (the shell contract).
