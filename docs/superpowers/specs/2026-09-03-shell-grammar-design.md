# Shell grammar — design

**Date:** 2026-09-03
**Status:** approved in brainstorming (this document is the written record)
**Source:** `docs/superpowers/specs/2026-09-02-fresh-eyes-dashboard-audit.md` §2 (shell audit) and §13 T4;
post-fix ranking item 8. First of five polish/feature specs; the chart grammar (item 9) follows it,
then Calendar (11), Planning sandboxes (10) and Data lifecycle (14) as parallel lanes.

## 1. Context and goals

The dashboard has thirteen pages that each hand-assemble the same shell: a header (six of them with a
vestigial empty spacer), one of four loading grammars, one of several error/stale postures, one of
five "pick one of N" controls, and — on four pages — its own copy of an owner-scope row and its own
`All / 1Y / YTD` default. The command palette exists but has no visible affordance and matches page
labels only. A 24-hour token ejects the user mid-task with a hard redirect and no way back. The app is
dark-only with chart colors hard-coded as hex literals. This spec replaces those per-page grammars
with shell primitives and migrates every page onto them.

Goals, in the owner's words from the audit: one shell grammar; scope that travels with you and lives
in the URL; a palette people can find and that finds things; a session that respects the user; a
light theme and a density switch; the small polish items that make the shell feel finished.

Non-goals are listed in §17.

## 2. Decisions made in brainstorming

| Decision | Choice |
|---|---|
| Sequencing of the five workstreams | Foundations first: this spec, then chart grammar, then Calendar / Sandboxes / Data lifecycle as parallel lanes |
| Scope of this spec | Items A–H and J from the shell checklist: PageFrame, scope store, palette, session, error boundary + footer, Segmented, polish bundle, theme bridge + light theme + density, month ribbon 2.0. Keyboard chords (I) deferred |
| Page top layout | Layout A (title row with actions on the right, scope row beneath) **with the scope row pinned while scrolling**; page actions stay in the title row |
| Preference storage | Browser-local (localStorage) now; the server-side preferences endpoint arrives with the Data lifecycle spec and migrates these keys then |
| Light theme | Cool neutral palette (pale blue-gray, white cards, current accent); **dark remains the default** |
| Build approach | Primitives built as independent tested units, then page-by-page adoption (Approach 1) |

## 3. Scope

**In:** `PageFrame`, `useScope` + `ScopeBar`, `MonthRibbon` 2.0, `Segmented`, palette registry with
keywords, Settings anchors and entity search, session renewal + return-to-page + splash + sign-out-
everywhere, theme bridge + light palette + density + Appearance card, shell error boundary + sidebar
footer, polish bundle (toast roles, InfoHint popover, targeted cache invalidation, legibility floor,
hero clamp), migration of all thirteen pages, deletion of the retired grammars.

**Backend, kept small:** `POST /auth/renew`; `users.token_version` (migration) + `ver` claim; the
change-password response carries a fresh token; `GET /coverage`; optional `month` on
`GET /net-worth/summary`.

**Out:** see §17.

## 4. Architecture and module map

```
src/components/shell/
  PageFrame.tsx            header · actions · subheader · sticky scope row · states
  ScopeBar.tsx             owner chips · range chips · month ribbon, per page declaration
  useScope.ts              URL ⇄ memory ⇄ defaults; the one scope rule
  Segmented.tsx            toggle | tabs | steps | chips (+ multiple)
  Feed.tsx                 one card's states: ghost, dimmed body, stale banner (+ FeedBanner)
  ThemeProvider.tsx        data-theme / data-density, persistence, OS following, theme version
  session.ts               token expiry decode, single-flight renew, return-to-page
  ShellErrorBoundary.tsx   chunk-load vs real error, Reload, Copy details
  SidebarFooter.tsx        email · environment pill · build hash · theme toggle · Log out
  paletteRegistry.ts       pages + sections + actions + entities, keywords, matching
src/theme/tokens.ts        DARK and LIGHT token maps (single source for CSS, charts and tests)
```

Modified: `Layout.tsx`, `CommandPalette.tsx`, `MonthRibbon.tsx`, `InfoHint.tsx`, `ToastProvider.tsx`,
`RouteBoundary.tsx`, `PageSkeleton.tsx`, `StatTile.tsx`, `ProtectedRoute.tsx`, `LoginPage.tsx`,
`api/client.ts`, `api/snapshotCache.ts`, `charts/theme.ts`, `charts/echarts.ts`, `components/EChart.tsx`,
`index.css`, `panels.css`, `index.html`, `vite.config.ts`, every page in `src/pages/`, and the settings
cards that gain anchors plus a new `AppearanceCard.tsx`.

Backend: `app/api/auth.py`, `app/security.py`, `app/api/deps.py`, `app/models/user.py`, one alembic
revision, `app/api/net_worth.py`, a new `app/api/coverage.py` (+ schema), `app/main.py` router include.

Each unit answers three questions — what it does, how it is used, what it depends on — in its
module docstring, and can be tested without mounting a page.

## 5. PageFrame

### API

```ts
interface PageFrameProps {
  title: string
  /** Right side of the title row. The page's primary action lives here, not in the scope row. */
  actions?: ReactNode
  /** Under the title row: page-local status lines (Portfolio's refresh result, the wizard's step pills). */
  subheader?: ReactNode
  /** The sticky row's content, composed by the page — a `<ScopeBar …/>` (§6) plus any
   *  page-specific control that belongs beside it. Absent → no scope row. */
  scopeRow?: ReactNode
  /** Built from the state pages already hold. */
  resource: {
    status: 'loading' | 'ready' | 'error'
    error?: string | null
    busy?: boolean        // revalidating while data is on screen
    fromCache?: boolean   // painted from the snapshot cache
    retry?: () => void
  }
  /** Ghost layout while status === 'loading' with no data. */
  skeleton?: { tiles?: number; cards?: { span: number; height: number }[] }
  children: ReactNode
}
```

**As shipped:** the `scope` declaration object and `scopeExtra` collapsed into the one `scopeRow`
slot — pages compose `<ScopeBar owner range month …/>` into it, so the frame never grows a prop per
scope control and a page-specific control is simply another child of the same row. The declaration
itself moved onto ScopeBar's props (§6).

### Rendering

1. `<header class="page-frame-header">` — `<h1>` left, `actions` (in `.page-frame-actions`) right. No
   icons in the h1 (Monthly update drops its calendar glyph). The vestigial `.spacer` pattern is
   retired.
2. `subheader` — optional, directly under the header.
3. Scope row — rendered only when `scopeRow` is given. `position: sticky; top: 0` inside `<main>`,
   surface background, with a hairline bottom border that appears only while stuck (an
   IntersectionObserver sentinel above the row toggles `is-stuck`). z-index sits above cards and below
   the palette, drawer and toasts. The wizard's live net-worth footer stays sticky at the bottom; the
   two never overlap. A row whose content all resolves away — an owner-only `ScopeBar` in a
   one-person household — renders as an empty element, and `.page-frame-scope:empty` hides it, so the
   page carries no empty band and no orphan rule.
4. Body, by state:
   - **loading, no data:** header + scope row + `PageSkeleton` from `skeleton` (defaults: 4 tiles, one
     12-span card of 320 px). The page shape is stable before data arrives.
   - **error, no data:** header + scope row + the house `error-banner` (`role="alert"`) with the message
     and a Retry button when `retry` is given.
   - **ready:** children; when `busy`, children are wrapped in `loading-dim is-loading`.
   - **error, data on screen:** children plus one stale line above them — "Showing earlier data —
     {error} · Retry" — in the muted grammar Overview and Calendar use today.
5. `fromCache` is exposed through `PageFrameContext` so charts keep gating `animateEntrance` exactly as
   they do now.

### Migration rule (one page at a time)

Delete the hand-built header, banner and skeleton; wrap the body in `PageFrame`; move any header-
resident status into `subheader`; move the page's owner row / range chips / ribbon into a `ScopeBar`
in `scopeRow` (they now come from the shell); keep every role and visible string the page tests query.
A page is "migrated" when it renders no `.page-header` of its own and no bespoke loading or error
markup.

**Which grammar carries which failure.** The frame's `resource` is the PAGE's payload, so its stale
line ("Showing earlier data — …") is for a LOAD failure only. A card that loads its own payload — the
pages with several independent feeds (Comp, ESPP, Paycheck, Taxes) — uses `Feed`, which prints the
same three states inside the card: a ghost card before the first payload, a dimmed body while a later
one is in flight, and a banner that only says something is stale when there IS something stale (a
first-load failure has nothing to be behind, so it reads as a plain error with Retry). An ACTION that
failed — a save, a validation, a what-if that would not compute — uses the bare `FeedBanner` alert or
a toast, never the stale line: nothing is stale there, something simply did not happen.

### Success criteria

All thirteen pages render through `PageFrame`; `grep` finds no page-level `page-header`,
`PageSkeleton`, `SkeletonCard`, "Loading…" text, or `error-banner` outside the shell; the scope row is
sticky on Net worth, Spending, Portfolio, Credit cards, Monthly update and Overview.

## 6. Scope store and ScopeBar

### URL grammar (the source of truth)

| Param | Values | Meaning |
|---|---|---|
| `owner` | `all` · `<person id>` · `joint` | Existing `OwnerScope` semantics: a person is their rows plus joint; `joint` is NULL-owned only |
| `range` | `all` · `1y` · `ytd` | Time window for the page's time-series charts (existing `RangePreset`) |
| `month` | `YYYY-MM` (a legacy `YYYY-MM-DD` link is accepted and rewritten) | Page-specific: drilled month (Spending), viewed month (Net worth), edited month (Monthly update) |

### Memory and defaults

`useScope()` resolves each key as **URL → memory → default**. Owner and range are remembered in
localStorage under `finance.scope` (`{ owner, range }`) and written on every change; **month is never
remembered** (its meaning differs per page). Defaults: owner `all`, range `1y`. Arriving on a page
whose URL lacks a remembered key rewrites the URL from memory with a `replace` navigation, so every
view is shareable and the back button never sees the normalization. `Layout`'s existing rule that a
search-param-only navigation neither moves focus nor scrolls already covers this rewrite. The same
pass shortens a legacy `month=YYYY-MM-DD` deep link (Overview's spending drills, the wizard's own
param) to `YYYY-MM`, and deletes a month it cannot parse rather than inventing one.

Writes go through one setter: `setScope({ owner })`, `setScope({ range })`, `setScope({ month })`,
each a `replace` of the current URL (the house convention from Spending's `?month=` and Credit cards'
`?card=`). Two writes in the same tick coalesce: react-router hands a setter the RENDER's params, not
the live URL, so `useScope` parks the uncommitted params in a ref keyed by the URL they were computed
from and the second write starts from the first — otherwise the second would drop the first's key.
A write that would not change the URL is dropped, which is the one behavior change a reader can feel:
**re-clicking the range chip that is already active does nothing at all**, so a chart the reader has
ctrl+wheel-wandered snaps back to the preset when the preset CHANGES, not on a re-click of the chip it
is already on (the retired `RangeChips` reset on every click).

### ScopeBar

Renders only the controls the page declared: owner `Segmented` (when the household has more than one
person — the existing gate), range `Segmented`, and the month ribbon (§7). One component, one CSS
block; the four page-specific owner rows (`.networth-owner-row`, `.portfolio-owner-row`,
`.cards-owner-row`, `.paycheck-person-row`) and their labels are deleted. The eyebrow reads "Whose"
everywhere.

Props as shipped — this is the declaration PageFrame's `scope` object used to carry (§5):

```ts
interface ScopeBarProps {
  /** `{ joint: false }` hides Joint (a paycheck has no joint); `{ all: false }` also hides All and
   *  reads a null scope as the primary person — for pages always about ONE person (Paycheck). */
  owner?: boolean | { joint: boolean; all?: boolean }
  /** Overrides the bar's own "whose view" sentence for a page with something more to say. */
  ownerHint?: string
  range?: boolean
  month?: MonthScopeProps
  /** Any value; a change re-runs the household and coverage fetches (the wizard bumps it after a
   *  save, so the just-saved month's chip fills without leaving the page). */
  revalidate?: unknown
}

type MonthScopeProps =
  | { mode: 'view'; anchor?: string; figures?: Record<string, string>; editHref?: (m: string) => string }
  | { mode: 'edit'; anchor?: string; selected?: string; onSelect?: (m: string) => void }
```

- **Owner.** Paycheck declares `{ joint: false, all: false }`. A scope the page offers no chip for —
  a hidden `All`, `joint` where there is no Joint chip, a person id from a stale link who has since
  been deleted — falls to the first chip rather than leaving the row with nothing selected.
- **The explanation is the shell's.** The bar prints its own answer to "whose view is this": with a
  Joint chip, "A person's view is their own accounts plus the joint ones — that is what a joint
  account is. Joint shows only the shared accounts"; without one, "Each person has their own view;
  nothing here is shared." `ownerHint` overrides it where a page has more to say (Portfolio:
  performance stays household). It renders — as an `InfoHint` right after the chips — only when the
  owner control itself does: a one-person household is asked no whose-view question, so it is offered
  no answer either.
- **Month, by mode.** The union is discriminated rather than one bag of optionals, so a view page
  cannot hand over an edit handler nor the wizard an Edit link. `view` reads and writes `?month=`
  through the scope and offers "Back to latest" while a non-latest month is selected (hidden when the
  selection already IS the latest covered month, where the button would only churn the URL); `edit`
  owns the click — it passes `selected` and `onSelect` because the wizard has a draft to guard — and
  falls back to `/update?month=` when it does not.
- **Anchor vs today.** `anchor` is the ribbon's right edge and the only injectable one; the ring is
  drawn from the real clock, so a page anchored ahead of today (the wizard) never moves it.
- The bar returns nothing when every control it was given resolves away, which is what makes the
  frame's `:empty` rule above enough.

### Page adoption

| Page | owner | range | month |
|---|---|---|---|
| Overview | ✓ (new) | – | – |
| Net worth | ✓ | ✓ | view |
| Portfolio | ✓ | ✓ | – |
| Spending | – | ✓ | view (drill) |
| Credit cards | ✓ | – | – |
| Paycheck | ✓ (person chips become the owner control; `joint` is hidden here since a paycheck has no joint) | – | – |
| Monthly update | – | – | edit |
| Others | – | – | – |

Overview honors owner for the net-worth tile and trend (`/net-worth/summary?owner=`,
`/net-worth/timeseries?owner=`) and the portfolio tile and performance chart (`/portfolio/holdings?owner=`,
history stays household until the history endpoint grows an owner param — the card says
"household" in its hint). The spending tile and money flow stay household and their hints say so:
spending has no person dimension.

### Data invariants

Changing `owner` or `range` never triggers a refetch on pages whose data is household-wide and
filtered client-side (Credit cards); pages that fetch per owner (Net worth, Portfolio) keep their
snapshot keys per owner exactly as today.

## 7. Month ribbon 2.0

The ribbon is the `month` control of the scope row on Net worth, Spending and Monthly update.

- **Window and paging:** twelve chips at a time; ‹ › page in twelve-month steps back to the earliest
  covered month and forward to the current month. The window containing the selected month is shown
  first. The window ends at an `anchor` — the current month by default, `max(next entry month,
  current month)` for the wizard.
- **Year dividers:** a small year label above the first chip of each calendar year in the window.
- **Today marker:** a ring around the current calendar month — computed from the clock, never from
  the anchor, which may sit ahead of it.
- **Two-tone chips:** the left half fills when balances exist for the month, the right half when
  spending exists. A month with neither is hollow. Colors follow the existing filled/hollow tokens.
- **Hover:** month name; on Net worth also that month's net worth from the timeseries already on the
  page; on Spending that month's total from the matrix. A tooltip "Edit ↗" link on read pages jumps
  to `/update?month=YYYY-MM&step=balances`.
- **Click:** `month: 'view'` pages set `?month=` (Spending's existing drill; Net worth's new viewed
  month); `month: 'edit'` (the wizard) keeps click-to-edit.
- **Net worth viewed month:** the KPI tiles and the accounts table show the chosen month with its own
  month-over-month delta; the charts are unchanged (they already span all months). A "Back to latest"
  chip appears while a non-latest month is viewed.

### Backend

- `GET /coverage` → `{ "balances": ["YYYY-MM-01", …], "spending": [...], "net_pay": [...] }`, ascending,
  one query per table. Cheap, cacheable, and the seed for later coverage-honesty work.
- `GET /net-worth/summary?month=YYYY-MM-01` (optional; default unchanged = latest). Returns that
  month's groups, owner totals and the delta against the immediately preceding snapshot. 404 with
  the house sentence when the month has no snapshot.

## 8. Segmented control

```ts
interface SegmentedProps<V extends string> {
  variant: 'toggle' | 'tabs' | 'steps' | 'chips'
  options: { value: V; label: ReactNode; disabled?: boolean; badge?: ReactNode; title?: string }[]
  value: V | V[]              // array only with `multiple`
  onChange: (next: V | V[]) => void
  multiple?: boolean          // chips only (the account drill-down, max enforced by the caller)
  ariaLabel: string
  /** tabs only: id of the panel each tab controls, by value */
  panelIds?: Record<V, string>
  size?: 'sm' | 'md'
}
```

Semantics per variant: **toggle/chips** — `role="group"` with `aria-pressed` per button;
**tabs** — `role="tablist"`, buttons `role="tab"` with `aria-selected` and `aria-controls` when
`panelIds` is given, arrow-key movement; **steps** — `aria-current="step"` on the active item. All
variants share one focus-visible ring and the 120 ms hover transition.

Adopters: owner and range in `ScopeBar`; Taxes year chips and filing status; Portfolio records tabs;
wizard step pills; Net worth By group / By owner and Monthly / Quarterly; Spending Month / Year;
Credit cards Multiplier / Effective %; ESPP modeler years; Projection trend spans; Net worth account
drill chips (`multiple`). The hand-rolled `.segmented`, `.tab-row`, `.chip-row` and wizard pill CSS is
deleted once the last adopter migrates.

Focus: one `:focus-visible` rule in `panels.css` covers `.segmented button`, `.nav-link`,
`.logout-button`, `.button` and `.chip`. The sidebar nav gains a ring for the first time.

## 9. Palette

### Registry

```ts
type PaletteEntry =
  | { kind: 'page';    id; label; keywords: string[]; to: string }
  | { kind: 'section'; id; label; keywords: string[]; to: string }       // e.g. /settings#limits
  | { kind: 'action';  id; label; keywords: string[]; run: (ctx) => void }
  | { kind: 'entity';  id; label; sub?: string; keywords: string[]; to: string }
```

- **Pages** come from `NAV_ITEMS` plus keyword aliases declared next to each nav item (Comp: rsu, vest,
  vesting, salary, tc, equity, grant; Net worth: 401k, accounts, balance, liabilities; Spending:
  budget, categories, savings; Portfolio: stocks, holdings, dividends, prices, refresh; Taxes: what-if,
  brackets, withholding, refund; Calendar: payday, deadline, events; Settings: preferences).
- **Sections** are the Settings cards, each given a stable `id` (`import`, `system`, `app-settings`,
  `password`, `household`, `categories`, `accounts`, `limits`, `assistant`, `appearance`) and reached
  by `/settings#<id>`. Arrival scrolls the card into view and applies a 1.2 s highlight.
- **Actions** are the five existing ones, finished: "Add dividend" navigates to `/portfolio?tab=dividends`,
  which now scrolls the records strip into view and focuses the first form field; "Add custom event"
  navigates to `/calendar?add=1`, which opens the form; "Refresh prices" fires the POST, toasts
  "Refreshing prices…", then toasts the run's result, and navigates to Portfolio; "Enter <month>
  update" and "Ask assistant" are unchanged.
- **Entities** load lazily on the palette's first open and are held for the session (refetched if
  older than ten minutes): tickers from `/portfolio/securities` → `/portfolio?ticker=<T>` (opens the
  holding drill; the page gains this arrival param alongside `?tab=`), accounts from
  `/net-worth/accounts` → `/net-worth?drill=<slug>` (selects the drill chip), spending categories from
  `/spending/categories` → `/spending?trend=<slug>` (picks the trend), cards from `/credit-cards` →
  `/credit-cards?card=<slug>` (existing). Warm snapshot-cache payloads are used before any fetch.

### Matching and presentation

The existing subsequence fuzzy scorer runs over `label + keywords` (+ `sub` for entities). Results are
grouped under kind headers in the order Actions · Pages · Settings · Holdings · Accounts · Categories ·
Cards, at most six per group, recents first when the query is empty. Keyboard behavior, ARIA combobox
semantics and mousedown execution are unchanged.

Two refinements the build needed. The scorer tries an alignment starting at every WORD HEAD and keeps
the strongest, because one leftmost-greedy pass is not always the best one: in "Ask assistant" the
query "assistant" had its a-s stolen by "As", scattering the real word and scoring below the Settings
card of the same name. A label hit outranks an alias hit of equal strength, and equal scores fall back
to registry order (actions before pages before sections). And the list keeps its house group order on
screen while **Enter runs the best-SCORING match wherever it sits** — the highlighted row IS that
match, so what Enter does is always what the reader sees highlighted, empty query included.

### Affordance

A sidebar row above the nav — a magnifier icon, "Search or jump…", and a `Ctrl K` / `⌘ K` kbd hint
chosen by platform — opens the palette. It is the only new sidebar control.

### Deferred

Seeding the entity lists from warm snapshot-cache payloads before any fetch was not built. As shipped,
the first open in a ten-minute window fires the four entity fetches unconditionally
(`Promise.allSettled`, so one unreachable endpoint costs only its own group) and the palette opens
without waiting on them — the seeding would buy a fraction of a second on a page that already holds
the data. Worth doing later against the cache's own keys; it was not worth holding the lane.

## 10. Session

### Backend

- `POST /auth/renew` (authenticated, default rate limit): issues a new token with a fresh 24 h expiry
  and the caller's current `token_version`. No refresh tokens, no cookies — one bearer token, renewed.
- `users.token_version INTEGER NOT NULL DEFAULT 0` (alembic revision). Tokens carry `ver`; tokens
  issued before this deploy have no `ver` and are read as 0, so nothing is logged out by the deploy.
  `get_current_user` rejects a token whose `ver` differs from the row's.
- `POST /auth/change-password` increments `token_version` and returns `{ access_token }` for the
  current session, which the client stores — you stay signed in here, every other session ends. The
  Settings card's caveat sentence ("Existing sessions stay signed in…") is replaced by "Other devices
  are signed out."

### Client (`session.ts`)

- `expiryOf(token)` decodes the JWT payload (base64url, no verification) for `exp`.
- After any successful authenticated response, if `exp − now < 6 h`, call `/auth/renew` once
  (single-flight promise; failures are logged and retried on the next successful response). The new
  token replaces `finance_token` in localStorage; in-flight requests keep working because the old
  token is still valid until its own expiry.
- On 401: store `location.pathname + location.search` in sessionStorage `finance.returnTo`, clear the
  token and caches as today, and navigate to `/login?reason=expired`.
- `LoginPage` shows "Your session expired — sign in to continue" when `reason=expired`, pre-fills the
  last successful email (localStorage `finance.lastEmail`), and after login navigates to `returnTo`
  (falling back to `/`), clearing the key. A show-password toggle and a Caps-Lock hint join the form.
- `ProtectedRoute` renders a branded splash — wordmark, then a spinner after 300 ms — instead of
  `null` while `/auth/me` resolves; after the 15 s timeout or a network error it shows "Can't reach
  the server" with Retry.

## 11. Theme bridge, light palette, density

### Tokens as the single source

`src/theme/tokens.ts` exports `DARK` and `LIGHT`: the same variable names with both palettes' values —
the eight chart palette slots, `--grid-line`, `--axis-line`, `--other-series`, `--on-accent`, the
12-step sequential ramp and the positive/negative/warn tones. `index.css` keeps a static `:root` block
(dark) and a static `[data-theme="light"]` block so the first paint is correct without JavaScript; a
vitest parses `index.css` and asserts both blocks carry every declaration `cssDeclarations()` emits
(the sequential ramp stays in TS — only charts read it), so the two cannot drift.

Light values as shipped (cool neutral): background `#f2f5f9`, surface `#ffffff`, surface-2 `#f7f9fc`,
border `#e1e7ef`, text `#141a24`, muted `#5f6b7a`, accent `#296dcc`, on-accent `#ffffff`, positive
`#1b7e44`, negative `#c73a3a`, warn `#996500`, grid-line `#e6ebf2`, axis-line `#d5dce6`, other-series
`#7f8a9c`; chart slots 1–8 `#2f6fdc`, `#c94f1e`, `#15895f`, `#996500`, `#c2436f`, `#1f7a1f`, `#6f63d6`,
`#c94848`. The three small-text tones sit one notch below the mockup's `#3b7dd8` / `#1f8f4e` /
`#a86400`, which cleared 4.5:1 on the white card alone: the floor is read against BOTH text-bearing
backgrounds and `--bg` is the weaker of the two. `--on-accent` is the one token that inverts between
palettes — near-black on dark's bright accent, white on light's deep one. The dark palette is
unchanged except `--other-series`, raised from `#4a5060` (2.16:1) to `#6b7382` to clear its floor.

**Acceptance** (`tokens.test.ts`, both palettes): WCAG contrast against BOTH text-bearing backgrounds
— the card (`--surface`) and the bare page (`--bg`), since deltas, links and advisories sit on bare
page as often as on a card — ≥ 4.5:1 for `--text`, `--muted`, `--positive`, `--negative`, `--warn` and
`--accent`; ≥ 3:1 for the eight chart slots and `--other-series`; ≥ 4.5:1 for `--on-accent` on
`--accent`. The same test asserts `--warn === --chart-4` in both palettes — one amber per theme, the
advisory register and chart slot 4 being the same ink.

### Bridge

`charts/theme.ts` exposes `buildTheme(tokens)` → an ECharts theme object; `registerTheme(version)`
registers it as `finance-<version>`. `ThemeProvider` owns `{ theme: 'system'|'dark'|'light',
resolved: 'dark'|'light', density, version }`, persists `theme` and `density` to localStorage
(`finance.theme`, `finance.density`), sets `data-theme` and `data-density` on `<html>`, follows
`prefers-color-scheme` live when `theme === 'system'`, and bumps `version` on every resolved change.
`EChart` reads the version from context and re-initializes its instance with the new theme name; page
state already holds zoom windows and legend selections, so they are re-applied by the existing option
rebuild. A two-line inline script in `index.html` applies the stored `data-theme` before the bundle
loads, so a light-theme user never sees a dark flash.

### Density

`data-density="compact"` scales the root font size by 0.9, the spacing scale (`--space-*`) by 0.75
and table row padding by 0.7. Comfortable is the current geometry. Charts are unaffected except for
their card padding.

### Controls

Settings gains an **Appearance** card (`id="appearance"`): Theme — System / Dark / Light (default
**Dark**); Density — Comfortable / Compact. The sidebar footer carries a one-click theme toggle that
cycles Dark ↔ Light and sets the stored theme explicitly. The favicon stays dark.

## 12. Shell error boundary and sidebar footer

- `ShellErrorBoundary` mounts in `Layout`, wrapping the sidebar, palette, assistant drawer and the
  routed outlet, so a throw in an overlay can no longer unmount the whole app. It classifies the
  error: messages matching `/ChunkLoadError|Loading chunk|Failed to fetch dynamically imported
  module|error loading dynamically imported module|Importing a module script failed|Unable to preload
  CSS/i` — every engine words the post-deploy chunk failure differently (Firefox's "error loading",
  Safari's "Importing a module script failed") and Vite's CSS preloader has a sentence of its own —
  render "The app was updated — reload to get the new version" with a Reload button; anything else
  renders "Something went wrong" with Reload and **Copy details**, which copies message, stack,
  React's component stack, current route, build hash and the last cached `/system/status` (alembic
  head, environment) as text. The button reports its outcome (`Copied` / `Copy failed`), and a
  read-only textarea holding the same payload appears whenever the clipboard is absent (plain HTTP) or
  refused, so the reader can still select it by hand. Focus moves to Reload when the fallback appears.
  A `resetKey` prop (Layout passes `location.key`) clears a shown error on navigation — a prop and not
  a `key`, because keying would remount the palette and the drawer and throw away the drawer's
  transcript on every page change. `RouteBoundary` keeps its per-route role.
  **Known gap:** `ToastProvider` sits above `BrowserRouter` in `App.tsx`, so toasts — and the login
  route and the `ProtectedRoute` splash — are still OUTSIDE this boundary. Moving the provider inside
  it is a later change, not a shell one.
- **Build hash:** `vite.config.ts` defines `__BUILD_HASH__` from the `BUILD_HASH` environment variable
  when it is set, else `git rev-parse --short HEAD` at build time, else `"dev"`; declared in
  `vite-env.d.ts`. The env override is what makes the hash real in Docker: `.dockerignore` excludes
  `.git`, so the probe inside the image always falls through to `"dev"` — the one place the hash
  matters most. The `Dockerfile` takes it as a build arg (README §3.3).
- **SidebarFooter:** signed-in email (from `useAuth`), an environment pill (`dev` amber, `prod` muted;
  hidden until `/system/status` has answered once), the build hash in monospace, the theme toggle,
  and Log out. Replaces the bare Log out row.

## 13. Polish bundle

- **Toasts:** error toasts render in a second, `aria-live="assertive"` `role="alert"` region; success
  and info stay polite. Undo semantics unchanged.
- **InfoHint:** the trigger is a real `<button aria-expanded>`; opens on hover after 150 ms or on
  click (pinned until Escape or outside click); the bubble measures itself and flips to the left when
  it would overflow the viewport's right edge; `aria-describedby` links trigger and bubble.
- **Targeted cache invalidation:** `api()` maps a mutation's path to snapshot-key families and
  invalidates only those; unknown paths clear everything (today's behavior). Snapshot keys are
  normalized to a `<family>:…` prefix where they are not already, and every family named below is
  one a page actually writes — a family that matches no live key reads as coverage that isn't there.

  | Mutation path prefix | Families invalidated |
  |---|---|
  | `/spending` | spending, overview, projection, shell, credit-cards |
  | `/net-worth` | net-worth, overview, projection, shell, spending, credit-cards |
  | `/portfolio`, `/prices` | portfolio, overview, calendar, espp, comp |
  | `/calendar` | calendar, overview |
  | `/credit-cards` | credit-cards |
  | `/taxes` | taxes, overview |
  | `/paycheck`, `/comp`, `/espp`, `/limits` | paycheck, comp, espp, taxes, projection, calendar, overview |
  | `/household`, `/settings`, `/import`, `/auth` | all |

  The cross-page rows: `shell` rides the two month-writing paths because the scope ribbon caches
  household + coverage under it; the spending matrix's `four_pct_rule` is computed from the
  net-worth investable bases; the credit-cards page keeps ONE snapshot that embeds the spending
  categories, the spending matrix and `/net-worth/accounts`; and the ESPP lots and comp vesting
  schedule are both valued at the portfolio's latest quote, so a price refresh restates them. The last
  row is not an entry in the map: any path the map does not match — those four prefixes and anything
  added later — falls through to the old total wipe, so a new endpoint is stale-by-default rather than
  silently wrong, and joins the table only once someone has reasoned about its blast radius.

- **POST-for-read:** a POST whose body is only the question — `/assistant/context-preview`,
  `/taxes/what-if`, and `/auth/renew`, which mints a token and touches no page data — rides
  `apiReadOnly`, which skips invalidation entirely. All three re-run on interaction (a drawer open, a
  what-if keystroke, any response inside the renewal window) and none of them writes.

- **Legibility floor:** eyebrows, table heads and nav headings ≥ 0.72 rem; delta text ≥ 0.8 rem;
  `.stat-value` gets `font-variant-numeric: tabular-nums`; `OTHER_SERIES_COLOR` is raised to ≥ 3:1;
  `--negative` gains a small-text variant that meets 4.5:1 on surface in both palettes.
- **Hero clamp:** `.stat-value { min-width: 0; overflow-wrap: anywhere; font-size: clamp(1.1rem,
  1.4vw + 0.6rem, 1.45rem) }` and the hero tile's larger size clamps the same way; the KPI row uses
  `repeat(auto-fit, minmax(220px, 1fr))` so a fifth tile wraps into a balanced second row instead of
  orphaning.

## 14. Backend changes (complete list)

| Change | Where |
|---|---|
| `POST /auth/renew` | `app/api/auth.py` |
| `users.token_version` column + `ver` claim + check | alembic revision, `app/models/user.py`, `app/security.py`, `app/api/deps.py` |
| Change-password bumps version and returns a token | `app/api/auth.py`, `app/schemas/auth.py` |
| `GET /coverage` | new `app/api/coverage.py`, `app/schemas/coverage.py`, `app/main.py` |
| `GET /net-worth/summary?month=` | `app/api/net_worth.py`, `app/services/net_worth_calc.py` |

No other endpoint changes. Nothing here alters stored data.

## 15. Testing

**Vitest, one file per primitive:** PageFrame (five states, sticky sentinel class, subheader slot,
context `fromCache`); useScope (URL over memory over default; URL rewrite on arrival uses replace;
month never persisted; setter writes both); ScopeBar (renders only declared controls; owner hidden for
one-person households); MonthRibbon (paging bounds, year dividers, today ring, two-tone from coverage,
hover figures, click semantics per mode); Segmented (ARIA per variant, arrow keys on tabs, `multiple`);
ThemeProvider (attributes, persistence, `matchMedia` following, version bump; tokens drift test;
contrast test); session (expiry decode, renew threshold, single flight, 401 → returnTo → login →
return; splash timing with fake timers); paletteRegistry (keyword hits, section anchors, entity
results and grouping, finished actions); ShellErrorBoundary (chunk classification, copy payload);
InfoHint (delay, pin, flip); snapshot invalidation map.

**Pytest:** renew issues a fresh expiry and preserves `ver`; a stale `ver` is rejected with 401;
change-password bumps `ver` and returns a token that still works while the old one stops; `/coverage`
shape and ordering; `/net-worth/summary?month=` for an existing month, the latest month and a missing
month (404 sentence).

**Page migrations:** each page's existing tests stay green, with only the queries that named the old
control markup updated to the Segmented roles and labels.

**Visual smoke:** the headless walk from the audit, run against the dev stack in both themes at 1600
px and 1180 px, screenshots every page and the palette, splash and expired-login states; console
errors fail the run.

## 16. Rollout (each phase mergeable on its own)

1. **Primitives.** All `shell/` units, `tokens.ts`, the ECharts bridge, backend endpoints and
   migration, the Appearance card, the sidebar row and footer, the error boundary — built, tested,
   and mounted where they are page-independent (footer, boundary, session, palette, theme). No page
   migrated yet.
2. **Prove it on two pages.** Overview and Net worth migrate: between them they exercise PageFrame's
   states, owner + range + month scope, the ribbon's view mode, Segmented toggles, both palettes on
   real charts, and the summary month parameter.
3. **Migrate the rest in pairs.** Portfolio + Spending; Credit cards + Monthly update; Paycheck +
   Comp; ESPP + Taxes; Projection + Calendar; Settings + Login/404 polish. Each pair deletes its own
   bespoke header, owner row, skeleton and control CSS.
4. **Retire and verify.** Remove `PlaceholderPage`, the old palette list, unused `PageSkeleton`
   variants and control CSS; run the full suites and the two-theme visual smoke; update the README's
   frontend section with the shell primitives.

## 17. Out of scope

- Keyboard chords and the `?` shortcut sheet (unticked; a later small spec).
- Server-side preferences and cross-device sync (Data lifecycle spec migrates `finance.theme`,
  `finance.density`, `finance.scope`).
- The data-health status line, coverage-aware attention items and two-tone coverage beyond the
  ribbon (the honesty theme; `/coverage` built here is its seed).
- Chart tooltip/motion/legend/export grammar (Spec 2).
- Any mobile or responsive work; anything below 1180 px wide is not a target.

## 18. Risks and mitigations

- **Sticky row vs existing sticky elements** (wizard footer, chart headers): z-index tokens defined in
  one place; the wizard footer stays bottom-anchored; verified in the smoke.
- **ECharts re-init on theme change** drops instance state: pages already mirror zoom windows and
  legend selections into React state, and the rebuild re-applies them; the palette-open animation
  gate (`fromCache`) prevents a replayed entrance.
- **URL rewrite on arrival** could loop with a page that also normalizes params: the rewrite runs once
  per mount from `useScope`, and pages stop touching `owner`/`range` themselves.
- **Migration churn in tests:** Segmented preserves button roles and labels; only tab-role queries
  change, and those pages are migrated with their tests in the same commit.
- **Multiple tabs** with different remembered scopes: last writer wins in localStorage; each tab's URL
  keeps its own truth, so nothing on screen changes underneath the user.
