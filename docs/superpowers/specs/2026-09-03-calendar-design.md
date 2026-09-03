# Calendar as the forward engine — design

**Date:** 2026-09-03
**Status:** draft for the overnight run (recommendations pre-approved by the owner)
**Source:** `docs/superpowers/specs/2026-09-02-fresh-eyes-dashboard-audit.md` §10 (friction and ideas
1–3, 8–9), §13 T8, post-fix ranking item 11; feeders from §7 (card ideas 2–3, 9), §8 (ideas 8, 15) and
§4 (idea 14). Builds on the 2026-08-24 calendar spec and the shell grammar spec
(`2026-09-03-shell-grammar-design.md` §5–§6); Plan 3 Task 6 moves the page onto `PageFrame` with the
actions "Add event" and "Add to calendar (.ics)". The chart grammar spec
(`2026-09-03-chart-grammar-design.md`) defines no calendar chart; §10 names the one hook this spec
leaves for it.

## 1. Context and goals

The calendar knows every forward date the household cares about and says nothing about the money
attached to any of them: its schemas declare "no money fields"; chips are ICS identity strings ("Tax
deadline — Q3 estimated payment" in a one-seventh-width cell); Sep 16 in production carries four
unpriced "RSU vest" chips, one per grant; paydays draw one chip per person; the ICS download churns UIDs
and can never retract; `opened_on` is NULL on all six cards so nothing card-shaped reaches the grid; the
list card duplicates the grid. Net pay per check, vest value, ESPP contribution, safe-harbor shortfall
and card fees are all computed elsewhere and never travel here.

Goals: money on events, read back as a cash-flow summary; legible days (one chip per vest date with its
total, folded paydays, "+N more" with a day drawer); amount, direction and recurrence on custom events;
card events; a subscription feed calendar apps can hold without churn; a configurable ritual reminder;
Overview "Up next" and the assistant fed from the same engine; the visible month in the URL.

## 2. Decisions

| Question | Decision |
|---|---|
| Generated events: stored or computed? | **Computed on read, with a thin user-overlay table** (§4, approach C). No derived value is ever stored — the codebase's standing law |
| Where money is derived | In the generators, from the services the owning pages already use (`paycheck_calc.breakdown`, `rsu_vesting.schedule` × the employer quote, the ESPP modeler, the withholding/safe-harbor computation, card rows) |
| Folding | **Server-side**, per `(type, date)`, constituents in `items[]`; grid, drawer, ICS, Up next and the assistant share one shape |
| Chip color | By **source family** (seven families + custom = the eight palette slots) |
| Visible month in the URL | **Yes — `?month=YYYY-MM` through `useScope({ month: true })`**, no `ScopeBar` ribbon (it is coverage-bounded and stops at the current month) |
| Owner scope | Not in v1 (per-person Comp/ESPP arrives with T10) |
| ICS | **One builder, server-side**, shared by the download and the feed; `src/utils/ics.ts` is deleted |
| Feed credential | `calendar_feed_tokens` table (hash at rest, label, last used, revoke from Settings), not a `users` column |
| Recurrence | rrule-lite for custom events (`weekly` / `monthly` / `yearly` + `until`), expanded server-side, native `RRULE` in ICS, whole-series edits only |
| Ritual reminder | A recurring event on a configurable day (`app_settings['calendar_update_due_day']`, default 1) |
| Assistant | `propose_calendar_event` returns a proposal; the client confirms via the normal `POST /calendar/events`. Design only; lands with T9 |
| List card | Replaced by a `Segmented` Grid / List toggle (`?view=list`) |

## 3. Scope

**In:** the event model with money and stable keys; per-source generators (vests, paydays, ESPP,
ex-dividends, tax deadlines with amounts, card fee / credit-reset / anniversary, ritual, custom with
recurrence); folding and chip grammar; day drawer and keyboard grid; `?month=`; cash-flow strip with
week gutters; server ICS builder, authenticated download, token feed, Settings card; overrides;
source-health footer; Up next ranking; assistant seam design.

**Out:** mobile, transaction-level spending, XIRR, external calendar OAuth sync, email or push
reminders, owner scope, agenda view, holidays on the grid, dividend pay dates, contribution-cap events,
exceptions to recurring custom events, a chart in the strip (chart grammar's job).

## 4. The central question: where generated events live

**A. Materialise.** A scheduler job and every source mutation write `calendar_events` rows; GET is a
SELECT; edits attach to real ids. Costs: a second truth beside `/comp`, `/paycheck`, `/taxes`;
quote-dependent amounts stale between runs; every mutation path in the shell spec's invalidation table
must trigger regeneration or the calendar lies; a backfill migration; idempotency engineered by hand.

**B. Compute on read (today).** `compose()` grows money and folding. Always current, one truth, nothing
to invalidate — but a generated event has no id, so "mark done" and "hide" have nowhere to live.

**C. Compute on read + overlay (pick).** B, plus `calendar_event_overrides` keyed by the event's stable
`key`, holding only what the user typed (done / hidden / note / amount), applied after folding.
Idempotency is a property of the key function, not of a job. A feed poll costs eight or so SELECTs, and
an `ETag` from the body turns most polls into a 304. An override whose source vanishes is silently
unmatched — harmless. This keeps the `rsu_grants` and `credit_cards` docstrings true ("vest rows are
never stored", "nothing here stores a computed value").

## 5. Architecture and module map

```
backend/app/services/calendar/
  __init__.py            compose(window, sources, overrides) → list[Event]; the only public entry
  model.py               Event, Item, Sources; EVENT_TYPES, SOURCE_FAMILIES, key()
  fold.py                fold_same_day(events) — vests and paydays → one event with items
  generators/            one pure module per family: rsu espp dividends payroll cards taxes ritual custom
  recurrence.py          expand(rule, start, until, window) — rrule-lite
  overrides.py           apply(events, overrides)
  ics.py                 render(events, *, calname, public_url) → str; fold_line(); escaping
backend/app/api/calendar.py      loaders + compose; export.ics; feed.ics; tokens; overrides
backend/app/models/calendar.py   CustomEvent (+money, recurrence), CalendarEventOverride, CalendarFeedToken
backend/app/schemas/calendar.py  v2 wire shapes (additive)

src/components/calendar/
  calendarView.ts        SOURCE_COLORS, labels, CHIP_PRIORITY, groupByDate, chipText
  cashflow.ts            monthSummary / weekSummary / windowSummary — integer cents
  CalendarGrid.tsx       role="grid", roving tabindex, chips, overflow, week gutter
  DayDrawer.tsx          the "+N more" / day-number surface
  EventDetails.tsx       gains items, amount, basis badge, Mark done
  CashflowStrip.tsx      four tiles for the visible month
  SourceHealth.tsx       replaces the caveat prose
src/pages/CalendarPage.tsx                     useScope month, Grid|List, richer form
src/components/settings/CalendarFeedCard.tsx   tokens (create / copy once / revoke), due day
src/components/overview/upNext.ts              rankUpNext(), windowSummary
```

Deleted: `src/utils/ics.ts` and its test, the duplicate list card, the caveat paragraph.
`services/calendar_events.py` becomes the package above; its tests move with it.

## 6. The event model with money

### Wire shape (`CalendarEventOut`, additive over v1)

```ts
interface CalendarEvent {
  date: string
  type: CalendarEventType      // the nine v1 types + card_fee | card_credit | card_anniversary
  source: 'rsu' | 'espp' | 'dividend' | 'payroll' | 'tax' | 'card' | 'ritual' | 'custom'
  key: string                  // "<source>:<entity_ref>:<date>" — stable identity, the ICS UID stem
  entity_ref: string           // no colons: "vest", "payday", "7-fee", "credit-5", "2026-q3", "12"
  label: string                // full sentence: drawer, list, ICS SUMMARY
  short_label: string          // ≤ 24 chars for the chip: "RSU vest · 4 grants", "Q3 est. tax"
  detail: string | null
  amount: string | null        // 2dp decimal string; null = unknowable
  direction: 'in' | 'out' | 'neutral'
  basis: 'confirmed' | 'scheduled' | 'estimated'   // stored fact · stored parameter · quote or model
  items: { label: string; amount: string | null; person_id: number | null; detail: string | null }[]
  href: string | null
  id: number | null            // custom rows only
  person_id: number | null
  done: boolean                // overlay
  note: string | null          // overlay
}
```

`key` is a pure function of source facts, never of the label, so a rename cannot churn a UID. The
grouped-vest key is `rsu:vest:2026-09-16`; when Comp becomes per-person (T10) it gains `-p<id>` once.
The ritual key is month-keyed (`ritual:2026-08:2026-09-01`), closing the audit's UID-churn finding.

### How each family derives its events

| Family | Dates | `amount` / `direction` / `basis` | Notes |
|---|---|---|---|
| rsu | `rsu_vesting.schedule(grant)` tranches, **folded per date** | Σ shares × latest employer quote (comp.py's `_espp_quote` link) / in / estimated; null without a quote | `items` one per grant (label, shares, value). Detail adds "≈ $Y after sell-to-cover" from `withholding_calc`'s legs — gross is the `amount` |
| payroll | `semi_monthly_paydays` per in-force profile (router rule unchanged), **folded per date across people** | Σ `breakdown(profile)['net_pay']` / in / scheduled | `items` one per person; a non-semi-monthly earner is still omitted and named in the health footer |
| espp | `plan_year_rows` period ends; unsold lots' qualifying dates; offering starts | purchase: the modeler's `PeriodResult.contribution` / neutral / estimated; others null | A purchase converts already-deducted pay, hence neutral |
| dividend | `securities.next_ex_div_date` on held securities | held shares × latest stored `per_share` / in / estimated; null when none | Pay dates stay out |
| tax | Jan 15 · Apr 15 · Jun 15 · Sep 15 · Oct 15, forward-adjusted | current-year payment dates: `max(0, effective_threshold − total_projected)` split evenly across the remaining dates / out / estimated; Apr 15 filing: the prior year's positive `balance_projected`; extension null | Detail is the verdict: "Safe harbor met — no payment needed" or "Shortfall $X to the {prior-year, current-year} leg" |
| card | `opened_on` anniversaries → `card_fee` (`annual_fee > 0`) and `card_anniversary`; counted `card_credits` → `card_credit` on the reset date | fee: `annual_fee` / out / confirmed; credit: `annual_value` / neutral / confirmed; anniversary null | `card_credits.reset_cadence`: `calendar` (Jan 1) or `anniversary`. Year two's detail says "falls off 5/24". No `opened_on` → nothing, counted in the health footer |
| ritual | `calendar_update_due_day` of each month in the window | null / neutral / scheduled | "Monthly update — enter {previous month}". Overdue → re-dated to today in the warn tone, key unchanged; entered months emit nothing |
| custom | stored date, expanded by `recurrence` to `until` (inclusive) or the window end | stored `amount` / `direction` / confirmed | `key = custom:<id>:<occurrence>`; monthly clamps the 29th–31st to month end; weekly steps seven days |

Generated events are never written. User edits on them are overrides (§13): `done`, `hidden`, `note`,
`amount` (the estimated payment actually sent). An override wins and the drawer says "your figure".

## 7. Folding, chip grammar and density

- **Fold rule (server):** same `(type, date)` events in the rsu and payroll families merge into one;
  `items` keeps the constituents sorted by label; `amount` sums, or is null when any constituent is
  null (a partial sum would read as a total). `short_label` becomes "RSU vest · 4 grants" or "Payday"
  ("Payday · 2" when two people fold). Other families never fold — a fee and a credit on the same card
  the same day are two facts.
- **Chip text:** `short_label` plus the compact signed amount ("Vest +$41.2k", "Q3 est. tax −$2.4k");
  `title` = full label · amount · basis. Estimates wear a tilde ("~+$41.2k").
- **Color:** by `source` — `SOURCE_COLORS` over `--chart-1…7`, custom on `--muted`; the legend lists
  sources. Color is never the only channel.
- **Capacity:** at most three chips per cell; beyond that the third slot is a "+N more" button.
  `CHIP_PRIORITY` = custom, tax_deadline, update_due, card_fee, rsu_vest, espp_purchase, payday,
  card_credit, card_anniversary, ex_dividend, espp_qualify, offering_start; ties by |amount| descending.
  A `done` deadline sorts last and renders struck through; `hidden` events are removed before counting.
- **Day drawer** (`DayDrawer.tsx`, the assistant drawer's shell class), opened by "+N more" or the day
  number: the date, a cash line ("+$6.8k in · −$395 out · ~$41.2k vesting"), every event as a row
  (source bar, label, right-aligned amount, "est." badge) expanding to `EventDetails` with its items,
  "Mark done" on deadline types, "Add event on {date}" at the bottom. A single-chip click keeps today's
  anchored popover.

## 8. Month grid, list, and the keyboard model

The grid becomes `role="grid"` (rows `role="row"`, cells `role="gridcell"`, `aria-selected` on the
active day) with one tab stop and a roving `tabindex`: ← → ±1 day, ↑ ↓ ±7, Home/End first/last day of
the week, PageUp/PageDown ±1 month (writes `?month=`), Enter/Space opens the day drawer, Escape closes it
and returns focus to the cell. Chips in the active cell are in the tab order; elsewhere `tabindex=-1`.
Each row ends with a **week gutter** cell (`aria-label="Week totals"`) reading "+$6.8k / −$395" from
`cashflow.weekSummary`.

A Grid / List `Segmented` toggle replaces the duplicate card; List is the existing date-grouped
accordion, now with amounts and folded items, and remains the accessible fallback. `?view=list` keeps
the choice in the URL.

Add-event defaults to the **viewed month's first day** (or the clicked day), refetches the window
containing the saved date and navigates the grid to it. `?add=1` (palette) opens the form;
`?add=1&date=YYYY-MM-DD` prefills it; both are consumed with a `replace`.

## 9. The visible month in the URL

`useScope({ month: true })` supplies `scope.month` (`YYYY-MM-01` internally, `YYYY-MM` in the URL,
legacy `YYYY-MM-DD` accepted) and `setScope({ month })`. Null means the current month and is not
written, so `/calendar` stays clean by default; ‹ › and PageUp/Down write `?month=`; Today writes null.
Month is never remembered (the shell rule), so Spending's drill does not leak here. `PageFrame` receives
no `scope` prop (no ribbon); ‹ Today › and a native `<input type="month">` sit in the grid card's control
row. The snapshot-cache key stays `calendar:<month>`; the fetched window stays the month ± one.

## 10. Cash-flow summary strip

`CashflowStrip` shows four tiles for the visible month, computed client-side by `cashflow.monthSummary`
over the fetched events in integer cents from the 2dp strings (never floats): **Cash in** (direction
`in`, source ≠ rsu), **Cash out**, **Net**, **Vesting** (source rsu, gross). A tile whose inputs include
an estimate shows the tilde and the quote's as-of date. Hidden events are excluded; `done` deadlines
are included (money still moves). The same module feeds the week gutters and the Overview 45-day line.
A later weekly in/out bar under the tiles would be a `ChartCard` with that spec's tooltip grammar and
`todayRule`, fed by `weekSummary` — a follow-on; nothing here depends on it.

## 11. ICS: one builder, a download and a feed

`services/calendar/ics.py` renders the events into RFC 5545 text; both routes call it.

- **Calendar properties:** `VERSION:2.0`, `PRODID:-//finance-dashboard//calendar//EN`,
  `METHOD:PUBLISH`, `X-WR-CALNAME:Finance dashboard`, `REFRESH-INTERVAL;VALUE=DURATION:PT12H`,
  `X-PUBLISHED-TTL:PT12H`.
- **Per event:** `UID:<key>@finance-dashboard`; deterministic `DTSTAMP` (the event date at `T000000Z`,
  so identical inputs render identical bytes — what makes the ETag work); `DTSTART;VALUE=DATE`;
  `SUMMARY` = label plus amount ("Payday · +$6,812.44"); `DESCRIPTION` = amount line with direction and
  basis, one line per item, the note, then the page link (`settings.public_url` + `href`; a path when
  unset); `CATEGORIES:<type>`; `STATUS:CONFIRMED` for confirmed/scheduled, `TENTATIVE` for estimated.
  A recurring custom event renders **one** VEVENT with `RRULE:FREQ=…;UNTIL=…`.
- **Alarms:** deadline types (`tax_deadline`, `update_due`, `card_fee`) carry a `VALARM`
  (`ACTION:DISPLAY`, `TRIGGER:-P2DT15H` — 09:00 three days before an all-day start). `done` events omit
  the alarm; `hidden` events are omitted entirely.
- **Line folding:** lines over 75 octets fold with CRLF + one space on UTF-8 character boundaries.
  `escapeIcsText` moves server-side unchanged.
- **Download:** `GET /calendar/export.ics?start&end` (bearer, the 400-day fence); the "Add to calendar
  (.ics)" action fetches it and saves the blob through `download.ts`.
- **Feed:** `GET /calendar/feed.ics?token=<t>` — the token is the credential. Window 30 days back, 365
  forward. Lookup by `sha256(token)` in `calendar_feed_tokens`; unknown or revoked → 404 "feed not
  found" (no oracle for token existence); `last_used_at` bumped when older than an hour. Headers:
  `text/calendar; charset=utf-8`, `Cache-Control: private, max-age=3600`, `ETag` (sha256 of the body)
  with `If-None-Match` → 304. Rate limit `60/hour` per IP through the existing slowapi limiter.
- **Tokens:** `secrets.token_urlsafe(32)`; the plaintext is returned once by `POST` and never again
  (the assistant key card's posture). Settings gains a **Calendar feed** card (`id="calendar"`): feed
  URL with Copy, the token list (label, created, last used, Revoke), "New feed link", the due-day field
  (§12), and one warning sentence — anyone holding the link reads your calendar; revoke it here.

## 12. Ritual reminder

`app_settings['calendar_update_due_day']` (`{"value": 1..28}`, default 1) joins `AppSettingsOut` /
`AppSettingsUpdate`. The ritual generator emits one event per month in the window on that day for the
previous month, suppressed once that month's snapshot exists and re-dated to today while overdue. With
the feed subscribed, the phone gets the reminder and its alarm — §4 idea 14 without email.

## 13. Overrides (user edits on generated events)

`PUT /calendar/overrides/{key}` with `{done: bool, hidden: bool, note: str | null, amount: Decimal |
null}` (full replace, the house law) upserts on the unique key; `DELETE /calendar/overrides/{key}`
clears it (204; 404 unknown). Keys are validated against
`^[a-z]+:[A-Za-z0-9._-]{1,60}:\d{4}-\d{2}-\d{2}$` (≤ 120 chars). `compose` applies the overlay after
folding; `EventDetails` exposes Mark done / Hide / Your figure / Note on generated events. Overrides
join the data export and are importer-immune.

## 14. Overview "Up next"

Fed from the same `GET /calendar` (today → +45 days). `rankUpNext(events, today)`: not hidden, not
done; deadline types due within 14 days first, then by date; **at most one payday** in the five; compact
amounts right-aligned. A second line reads "Next 45 days: +$X in · −$Y out" from
`cashflow.windowSummary`.

## 15. Assistant seam (design only)

A fourth tool, `propose_calendar_event` (`date`, `label`, `detail?`, `amount?`, `direction?`,
`person_id?`, `recurrence?`), validates through `CustomEventIn` and returns `{proposal, preview}`
without writing; the SSE stream emits a `proposal` event; the drawer renders a card with "Add to
calendar" and "Dismiss". Confirming calls the client's own `createCustomEvent` with the user's bearer
token, so the agent loop never gains write authority. Grounding arrives free:
`get_page_data('/calendar')` now returns amounts, keys and items. Lands with T9.

## 16. Backend changes

| Change | Where |
|---|---|
| `GET /calendar` v2 payload (additive fields, folding, overlay, `sources[]` health list) | `api/calendar.py`, `schemas/calendar.py`, `services/calendar/` |
| `GET /calendar/export.ics?start&end` (bearer) | `api/calendar.py`, `services/calendar/ics.py` |
| `GET /calendar/feed.ics?token=` (ETag/304, `FEED_POLL = "60/hour"`) | `api/calendar.py`, `rate_limit.py` |
| `GET/POST /calendar/feed-tokens`, `DELETE /calendar/feed-tokens/{id}` | `api/calendar.py`, `models/calendar.py`, `schemas/calendar.py` |
| `PUT/DELETE /calendar/overrides/{key}` | same files |
| `CustomEventIn/Out` + `amount`, `direction`, `recurrence`, `until` (defaults keep old clients valid) | `schemas/calendar.py`, `models/calendar.py` |
| `calendar_update_due_day` (1–28) | `api/app_settings.py`, `schemas/app_settings.py` |
| `card_credits.reset_cadence` | `models/credit_cards.py`, `api/credit_cards.py`, `schemas/credit_cards.py` |
| `settings.public_url: str | None` | `config.py` |
| Export tuples for the two new tables | `api/export.py` |

**Migrations** (repo style, chained onto the head at implementation time per README §4.3; all four
land in Phase 1 so parallel lanes never fork the chain):

- `20260904_0900_a1c3e5b7d9f2_custom_event_money_recurrence` — `custom_events.amount Numeric(12,2)
  NULL`, `direction String(8) DEFAULT 'neutral'`, `recurrence String(8) DEFAULT 'none'`, `until Date
  NULL`; check constraints on both vocabularies.
- `20260904_0901_b2d4f6a8c0e3_calendar_event_overrides` — `id`, `event_key String(120) UNIQUE`,
  `done_at DateTime(tz) NULL`, `hidden Boolean DEFAULT false`, `note String(300)`, `amount
  Numeric(12,2)`, `updated_at`.
- `20260904_0902_c3e5a7b9d1f4_calendar_feed_tokens` — `id`, `user_id FK users CASCADE`, `token_hash
  String(64) UNIQUE`, `label String(60)`, `created_at`, `last_used_at NULL`.
- `20260904_0903_d4f6b8c0e2a5_card_credit_reset_cadence` — `card_credits.reset_cadence String(12)
  DEFAULT 'calendar'` + check constraint.

**Generation runs on read.** No scheduler job; `product_today()` remains the one clock. The tax
generator is the only heavy input (one withholding computation per year touching the window); the
rest is the SELECT set the router already runs plus `card_credits` and the overlay.

## 17. Testing

**Pytest** (`tests/calendar/`, literals-driven like today). Folding: four grants on one date → one
event, items sorted, amount summed, null when one is unpriced; a two-person payday folds with per-person
items while the single-earner label stays byte-identical. Generators: payday net equals
`breakdown()['net_pay']` for the in-force profile; vest value = shares × quote at 2dp; harbor met →
amount 0 with the verdict, shortfall split across remaining dates, missing prior year handled; card fee
on the anniversary including a Feb 29 `opened_on`, both credit cadences, "falls off 5/24" on year two,
NULL `opened_on` → nothing plus a health entry; ritual on the configured day, overdue re-dated, entered
month suppressed; recurrence clamp 31 → 30/28, weekly, `until` inclusive. Overlay: applied, orphan key
ignored, PUT full-replace, DELETE 404. Key stability across a grant rename. **ICS validity:** BEGIN/END
pairing, CRLF, required properties, UID stable across two renders and a label change, `VALARM` only on
deadline types and never on `done`, `RRULE` for recurring custom, `STATUS` by basis, escaping, and the
**RFC 5545 folding check** — no line over 75 octets, every continuation starts with one space, unfolding
reproduces the source text, a multibyte character straddling the 75th octet is never split. Feed:
bad/revoked token 404, good token 200 `text/calendar`, `ETag` + 304, `last_used_at` throttle, 429.
Tokens: plaintext only on POST, hash stored. Export includes the new tables; importer-immunity pins;
due-day bounds (0 and 29 → 422).

**Vitest:** `calendarView` (chip text and title, priority, `SOURCE_COLORS` pinned to CSS vars);
`cashflow` (cents arithmetic, estimate flag, week and window sums, hidden excluded); `CalendarGrid`
(three-chip cap, "+N more" count, every key, PageDown writes `?month=`, gutter text); `DayDrawer` (open
from +N and the day number, Escape returns focus, Mark done calls PUT, Add-on-day prefills);
`CalendarPage` (`?month=` parse/replace, Today clears it, `?view=list`, `?add=1&date=`, form fields
round-trip, land-on-save); `SourceHealth`; `upNext` (ranking, one-payday rule, 45-day line);
`CalendarFeedCard` (token shown once, copy, revoke, due-day save). Page tests pinned to per-grant labels
move to the folded shape.

**Smoke:** the headless walk opens `/calendar?month=2026-09` and asserts one priced vest chip on Sep 16,
a folded payday, a "+N more" day and its drawer; a pytest fetches `feed.ics` with a fresh token, parses it
with `icalendar`, and re-fetches with `If-None-Match` for the 304.

## 18. Rollout (parallel subagents)

1. **Phase 1 — foundations (one lane, first).** The four migrations and models; v2 schemas and TS
   types with the full type and source vocabularies; the `services/calendar/` package with model, key
   function, fold, overlay and the existing generators moved in (rsu with pricing, payroll with net pay,
   espp, dividends, tax dates, ritual, custom with recurrence); `GET /calendar` on the package; tests.
2. **Phase 2 — three lanes in worktrees off Phase 1.**
   - **Lane B (ICS + feed + tokens):** `ics.py`, export and feed routes, token CRUD, `public_url`, the
     Settings Calendar feed card; delete `src/utils/ics.ts`.
   - **Lane C (calendar page):** `CalendarGrid`, `DayDrawer`, `CashflowStrip`, `SourceHealth`,
     `cashflow.ts`, `?month=` / `?view=` / `?add=`, Grid|List, form fields, Mark done and Hide, Up next.
   - **Lane D (sources):** card generator, `reset_cadence` UI and the `opened_on` nudge on the roster;
     tax amounts and the harbor verdict; ESPP contribution; ex-dividend estimates; due-day setting; the
     health `sources[]` list.
   Lanes touch disjoint files except `api/calendar.py`, where B appends routes and D appends loaders in
   bounded blocks.
3. **Phase 3 — merge and verify.** Full pytest and vitest, `tsc`, lint, the smoke, README sections.

## 19. Out of scope

Mobile (nothing below 1180 px is a target); transaction-level spending (no transactions exist); XIRR;
external calendar OAuth sync (the feed gives read-side sync with no credentials to store); owner scope,
agenda view and filters (v1.1, after T10 makes Comp per-person); holidays on the grid; dividend pay
dates; contribution-cap events (the Paycheck sandbox spec owns the YTD anchor); recurrence exceptions.

## 20. Risks and mitigations

- **Estimates look authoritative.** Tilde, basis badge and the quote's as-of date on every estimated
  figure; `TENTATIVE` in ICS; folded totals null when any part is.
- **Token in a URL.** The ICS norm; mitigated by hash-at-rest, per-link revocation, the Settings warning,
  rate limiting, 404 on unknown tokens, and a window that carries no more than the page shows.
- **Folding hides identity.** Drawer, list, `items[]` and the ICS DESCRIPTION name every grant and
  person; only the chip is summarised.
- **Tax amounts make GET heavier.** One withholding computation per year in the window; measured in
  the smoke; past ~150 ms it moves behind the snapshot cache's `calendar` family, not into storage.
- **Key changes churn subscribed calendars.** Keys derive from ids and dates, never labels; the one
  planned change (per-person vest keys with T10) is named so it happens once.
- **Parallel migrations.** All four ship in Phase 1; lanes add no revisions.
- **Label-pinned tests.** Folding changes vest and payday labels; Phase 1 updates those pins with the
  generator move so lanes inherit green suites.

## Summary for the coordinator

1. Generated events are computed on read, never stored; user edits live in a `calendar_event_overrides` overlay keyed by a stable `source:entity_ref:date` key (approach C).
2. Money rides every event: `amount`, `direction`, `basis`, `items[]`; vests fold per date with the total value, paydays fold across people, both server-side.
3. Chips color by source family, cap at three per day with "+N more" opening a day drawer; the grid is an ARIA grid with a roving tabindex; the duplicate list card becomes a Grid/List toggle.
4. `?month=YYYY-MM` via `useScope({ month: true })`; no ScopeBar ribbon; `?view=`, `?add=1&date=`.
5. One server-side ICS builder serves the authenticated download and `GET /calendar/feed.ics?token=`; stable UIDs, `X-WR-CALNAME`, `VALARM` on deadlines, RFC 5545 folding, ETag/304; tokens in `calendar_feed_tokens`, revoked from a Settings card.
6. New sources: card fee / credit reset / anniversary (needs `opened_on`; `card_credits.reset_cadence`), tax amounts with the safe-harbor verdict, ESPP contribution, ex-dividend estimate, configurable ritual due day, recurring custom events.
7. Cash-flow strip and week gutters are client-side cents arithmetic over fetched events; Overview Up next ranks deadlines first, one payday, plus a 45-day net line.
8. Four migrations (`20260904_0900…0903`), all in Phase 1, one lane, so parallel lanes never fork the alembic chain.
9. Plan split: Phase 1 foundations (sequential) → Lane B ICS/feed/tokens/Settings · Lane C calendar page · Lane D source generators + card/tax/ESPP/ritual UI → Phase 3 merge, suites, smoke.
10. Assistant `propose_calendar_event` is designed (proposal → client-side confirm → existing POST) but implemented with T9; owner scope, agenda and filters wait for T10.
