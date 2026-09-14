# Onboarding guide page — research and recommendation (2026-09-14)

**Status:** research only, nothing implemented. Awaiting the owner's decisions in §8 before a design
spec and plans are written.
**Method:** read-only pass over the tree at `bc79545` (local main, includes the 2026-09-12
dashboard-experience redesign and the 2026-09-13 polish batch): the shell and routing code, every
page and its tests, the 16 Settings cards, the assistant prompt and tools, the README, the
2026-08-12 design spec, and every prior audit/review in `docs/` and the gitignored
`scratchpad/audit-*` folders. Five parallel code walks produced the task catalogue in §5; the
claims the recommendation leans on were re-verified by hand.

Line numbers reference the tree at `bc79545`.

---

## 0. Summary

**The gap is real, previously observed from five directions, and still unclaimed.** The app has an
unusually strong *micro*-explanation layer — about 150 inline `InfoHint` sentences, 127 always-visible
`.drill-hint` lines, 18 metric receipts with an "Explain this number" hand-off, empty states that name
their fix, a *Needs attention* list, health checks, and an Undo/Activity safety net. It has **no
macro-explanation layer at all**: no surface says what the dashboard is for, what order to set it up in,
what "the monthly ritual" consists of, what the keyboard does, or which conventions (signed liabilities,
effective-dated budgets, sold-pair fields, blank-versus-zero) will bite a newcomer. The README declares
itself a deployment runbook and never defines the monthly routine it tells operators to perform. The
assistant is forbidden by its own grounding rule from answering "how do I…" questions and has no usage
knowledge to draw on. Five audits (2026-09-02, 09-05, 09-08 ×2, 09-13) each hit this wall and each
proposed a *state-gated* fix (a first-run card, an onboarding checklist, a guided empty state); none
was built, and none proposed an evergreen, task-oriented guide. That is the gap a sidebar page fills.

**Adding the page is cheap; the content is the work.** The sidebar is a single registry
(`src/components/navItems.ts`) that also feeds the document title, the command palette, the
landing-page picker and chunk prefetch. A new destination is about ten small edits plus one backend
tuple and three enumerating tests (§2.1). A page with nothing to load already has a precedent
(`NotFoundPage`). The real effort is authoring and *maintaining* roughly 200 catalogued tasks across
13 pages in the house voice, against a UI that changes weekly.

**Recommendation (details in §4):**

1. A **Guide** page at `/guide`, in the sidebar's bottom utility slot directly above **Settings**,
   `BookOpen` icon, palette aliases *help, how to, tutorial, manual, onboarding*.
2. **Four chapters through the existing tab strip** (`LocalSections`): **Start here · Routines ·
   Pages · Reference**. Each chapter is a scrolling stack of cards with stable anchors, so every task
   has a shareable link (`/guide?section=pages#credit-cards-add`). The retired scroll-spy rail is the
   wrong tool: it reintroduces a second navigation grammar and wraps badly past six chips.
3. **Content as a typed data module** (`src/guide/content.ts`), rendered by three small components.
   Plain-string steps make the same content indexable by the command palette (a "Guide" group answering
   *"how do I add a card"*), fence-testable (every link must resolve to a real route, view or anchor),
   and later servable to the assistant — without a markdown pipeline, which the app does not have and
   does not need.
4. **A card grammar of four parts** — *Purpose · Do this · Watch out · Go there* — with the long tail
   of each page folded behind the existing `Disclosure` component so the page reads as a guide, not a
   manual dump.
5. **Two fresh-database entry points** so the guide is found by exactly the people who need it: a
   *Start here* card on an empty Overview (today the Overview's empty states carry no next step, on a
   premise the code comment gets wrong) and a one-line pointer in the monthly wizard when no accounts
   exist (today: an empty table and disabled buttons).
6. **No screenshots.** There is no image pipeline, `public/` assets are cached immutably for a year,
   every figure would need dark and light variants, and the UI changes weekly. Illustrate with the
   app's own live primitives where a picture is needed.
7. **Phase 2/3 candidates**, enabled by the data module but not required for launch: a small
   "How to use this page" link in each page's title row; guide excerpts attached to assistant questions
   so it can finally answer procedural questions with deep links.

**Effort:** one overnight batch of the usual shape — one shell/skeleton lane, three content lanes split
by chapter, one integration lane (palette, entry points, fence tests, the stale "below" copy pass), one
verify lane. The catalogue in §5 exists precisely so the content lanes write from it rather than
re-exploring the code.

---

## 1. The gap, with evidence

### 1.1 What explains itself today

| Mechanism | Count / shape | Where |
| --- | --- | --- |
| `InfoHint` disclosure bubble (hover 150 ms, click pins) | ≈150 call sites, ≈140 distinct sentences, 100 % inline JSX, no registry | `src/components/InfoHint.tsx:34`; 16 Settings cards carry exactly one each |
| `.drill-hint` muted paragraphs | 127 instances across 45 files | `panels.css:409` |
| Metric receipts ("About this number") with definition, window, included/excluded months, source link, **Explain this number** | 18 `definition:` strings | `src/components/details/MetricInspector.tsx:24`, `StatTile.tsx:118` |
| Empty states that name a next step | ≈20 (e.g. "No cards yet — add your first card above.", "No tax years yet — create one to start.") | see §1.3 for the ones that do not |
| *Needs attention* — each condition links to its fix | 13 rule kinds + month-review rows | `src/components/overview/attention.ts:55-262` |
| Data health checks with an inline fix | 6 checks | `src/components/settings/HealthCard.tsx` |
| Toast + Undo (6 s, paused on hover/focus) and the Activity log's durable undo | 56 toast sites, 16 Undo actions | `src/components/ToastProvider.tsx:41`, `ActivityCard.tsx:124` |
| Palette starter prompts for the assistant | 3 presets + 14 route-specific | `src/components/assistant/samples.ts` |
| Review walkthroughs written for the owner | 10 "Suggested walkthrough" cells | `docs/reviews/2026-09-12-dashboard-experience-review.md:11` |

The hint copy is the richest authored prose in the repo and is in a consistent register (sentence
case, second person implied, em-dash consequence clauses, always names the caveat). About a third of
it is definitional ("what this number is") rather than procedural ("how to do X").

### 1.2 What nothing explains

- **What the dashboard is for** and how the sidebar groups relate (Tracking = what you have and
  spend; Income = what you earn; Planning = what is ahead). The 2026-08-12 spec's page "jobs" table
  (`docs/superpowers/specs/2026-08-12-finance-dashboard-design.md:177-190`) never reached the UI and
  predates Credit cards, Calendar, Projection and the assistant.
- **The three rhythms**: set up once; update monthly; refresh yearly (tax tables, contribution
  limits). The README's only mention of the routine is "do the month-end ritual in the /update
  wizard" (`README.md:818-826`) — the ritual is never defined anywhere.
- **Setup order.** The data dependencies are strict (a person before an owned account; an account
  before the wizard's Next button enables; category *kinds* before months, because a kind change
  recomputes all history; import before any UI edit inside sheet-covered years) and nothing states them.
- **Conventions a newcomer will trip on**: liabilities entered negative; blank ≠ zero (and the
  *Confirm remaining categories as $0* consent); budgets effective-dated from the focused month; sold
  date and sold price travel together; the ESPP purchase price derives when left blank; a grant's cliff
  comes with its kind; the tax-table status tab is not the year's filing status; a calendar feed link is
  the credential; a category's kind recomputes all history.
- **Keyboard and entry ergonomics.** Ctrl/⌘+K is the only shortcut with a visible affordance.
  Enter-to-advance, Shift+Enter, arrow moves, Enter-on-last-cell → primary, Ctrl+Enter / Ctrl+S save,
  Escape-restores, `=` arithmetic, accounting negatives, and spreadsheet paste (positional and keyed)
  are documented in a spec (`2026-08-21-data-entry-ergonomics-design.md`) and surfaced in exactly one
  place in the product (the Taxes inputs footer, `InputsForm.tsx:815-838`).
- **The safety net as a system**: what Undo covers, what only a snapshot restore covers (imports,
  restores), what is never undone (feed revocation, matrix multipliers on a card undo).
- **Sandbox semantics**: three pages have one; the URL *is* the scenario; pins are browser-local knobs;
  nothing writes except an explicit Apply that reuses the page's own form. Only the README says so.
- **Where to configure X.** Sixteen Settings cards across five tabs, discoverable only by the palette,
  whose group cap of six hides ten of them on an empty query (`paletteRegistry.ts:39`).

### 1.3 Fresh-database dead ends

A brand-new user sees, in order:

1. **Overview**: `—` tiles, "No snapshots yet." / "No performance history yet." / "No spending months
   yet." (`OverviewPage.tsx:667, 578, 601`) — all three stripped of the next-step clause their siblings
   carry on the owning pages — and *no* update nudge, because `attention.ts:50-52` gates it on
   `months.length > 0` with the comment *"a fresh database's empty states already say 'enter your first
   month'"*. The Overview's own empty states do not. `OverviewPage.test.tsx:1068` pins the behaviour.
2. **Monthly update with zero accounts**: the balances table renders empty and Next/Save are disabled
   via `accounts.length === 0` (`MonthlyUpdatePage.tsx:1647, 1929, 1935`) with no sentence and no link
   to Settings → Accounts. This is the single most likely first-run dead end.
3. **Portfolio**: two cold-start stories ("No holdings yet — add transactions in Manage." vs "No
   performance history yet — import your workbook in Settings to load it."), neither linked to the
   other (`HoldingsTable.tsx:80`, `PortfolioPage.tsx:674`).
4. **Comp**: "No grants yet." (`RsuGrantsPanel.tsx:448`) with the seed chips below the fold.

### 1.4 The assistant cannot help

The system prompt (`backend/app/services/assistant_chat.py:125-163`) says *"Answer ONLY from the
CONTEXT JSON below and any tool results — never from general knowledge"* and *"If the data does not
contain the answer, say so and name the page or tool that would."* Its five tools (`get_metrics`,
`get_month_review`, `get_page_data`, `get_month_detail`, `run_tax_whatif`) are all data tools; the
context builder serialises the current page's *data*, not its affordances. Asked "how do I add a credit
card?", the honest outcome is a refusal that names a page; the dishonest one is an invented procedure.
A guide whose content is machine-readable fixes this in Phase 3 (§4.6).

### 1.5 Prior audit findings on guidance

| Source | Finding |
| --- | --- |
| `scratchpad/audit-2026-09-08/01-shell-overview.md:144` B12 (High) | "A fresh install has no path forward." No import / first-month call to action on the home page. |
| same `:146` B13 | No route to the monthly ritual from the home page before the 7th (`UPDATE_NUDGE_DAY = 7`). |
| same `:202-204` B36 | "One shortcut in the whole app." No `?` sheet; palette hides 10 of 16 Settings sections. |
| same `:248` C8 | Proposal: first-run "Get started" card with three numbered steps (import → first month → holdings) plus a line explaining the ritual. |
| `scratchpad/audit-2026-09-08/08-settings-assistant.md:223` | Proposal: first-run onboarding checklist on Overview and Settings, each row deep-linking to its card. |
| `scratchpad/audit-2026-09-05/area-reports/01-…md:24,27` | "First run: no guided path." Ranked idea #1: guided empty state. |
| `scratchpad/audit-2026-09-05/area-reports/03-…md:21-22` | Portfolio cold-start dead end, two stories, neither linked; hints name a settings key with no link. |
| `docs/superpowers/specs/2026-09-02-fresh-eyes-dashboard-audit.md:135,217` | Palette undiscoverable, matches page labels only. |
| same `:757,788` | Grants first-run below the fold; proposal: top-of-page onboarding card. |
| `scratchpad/audit-2026-09-08/05-taxes.md:148` | "The missing-tables CTA is prose, not an affordance." |
| `scratchpad/audit-2026-09-08/07-calendar-cards.md:182` | "The good export is undiscoverable" (the subscription feed lives in Settings). |
| `scratchpad/ux-audit-2026-09-13/reports/00-SUMMARY.md` idea #14 | Copy pass: **14 hint sentences say "below" about content that now lives on other tabs** — currently wrong. |
| same, L2/B8 | Two ⓘ affordances share one glyph; proposal to use `CircleHelp` for the inspector trigger — so `CircleHelp` should stay free for that. |
| `docs/plans/2026-09-12-dashboard-experience-design.md:128` | Wizard: "add a persistent compact month/status summary and a discoverable shortcut hint." |

No finding anywhere proposes a dedicated guide page. The two closest (C8, the onboarding checklist)
are state-gated first-run aids — complements to a guide, not substitutes.

---

## 2. What it takes to add a sidebar page (engineering brief)

### 2.1 Minimum change set

| # | File | Edit |
| --- | --- | --- |
| 1 | `src/components/navItems.ts:1-15` | import `BookOpen` from lucide-react (alphabetical) |
| 2 | `src/components/navItems.ts:128-133` | add `{ to: '/guide', label: 'Guide', icon: BookOpen, keywords: [...] }` to the trailing `heading: null` section, before Settings |
| 3 | `src/components/routeChunks.ts:10-24` | `'/guide': () => import('../pages/GuidePage')` |
| 4 | `src/App.tsx:19-31` | `const GuidePage = lazy(ROUTE_CHUNKS['/guide'])` |
| 5 | `src/App.tsx:46-66` | `<Route path="/guide" element={<GuidePage />} />` before the `*` route |
| 6 | `src/pages/GuidePage.tsx` (new) | `<div className="page guide-page"><PageFrame title="Guide" resource={{ status: 'ready' }} sections={…}>` |
| 7 | `src/pages/GuidePage.css` (new, optional) | page-only rules; durations as `var(--t-*)` only |
| 8 | `backend/app/services/prefs_registry.py:19-33` | add `"/guide"` to `NAV_PATHS` — `backend/tests/test_prefs_registry.py:35-41` regex-reads `navItems.ts` and asserts set equality; **pytest fails without it** |
| 9 | `src/components/Layout.test.tsx:210-224` | add the label to the exact 13-string nav-order assertion |
| 10 | `src/App.test.tsx:21` | add `/guide` to the 13-route mock array |
| 11 | `src/components/routeChunks.test.ts:11-25` | passes automatically once 2 and 3 agree (two-way lockstep) |
| 12 | `tools/probes/motion-v/smoke.mjs:51` (optional) | add the label to the 13-item `NAV` walk |
| 13 | `src/components/Layout.tsx:175` (optional) | the "12-link sidebar" skip-link comment is already stale |

### 2.2 What a nav entry gets for free

Sidebar row with the measured accent indicator (`Layout.tsx:96-143`, measured not assumed), document
title `"Guide · Personal finance"` (`usePageTitle.ts:16-27`), a palette **Pages** entry with the
`keywords` aliases (`paletteRegistry.ts:114-120`), a *Landing page* option in Settings → Appearance
(`AppearanceCard.tsx:83-98`), hover/focus/idle chunk prefetch (`routeChunks.ts:29-53`), route hold
under one `Suspense` (`Layout.tsx:234`), the page-body entrance, card entrance and stagger
(`PageFrame.tsx:105` calls `useStagger`), scroll-linked reveal and edge scrims for any `.card`.

### 2.3 A page with nothing to load

`src/pages/NotFoundPage.tsx:6-12`: *"Through PageFrame like every other page (2026-09-03 shell spec
§5), permanently ready: there is nothing to load, and the shared title row is the point."* —
`resource={{ status: 'ready' }}`, no skeleton, no scope row. The guide follows this exactly.

### 2.4 In-page navigation: two candidates

**`LocalSections`** (`src/components/shell/LocalSections.tsx`) is a URL-backed **tab strip**
(`?section=<id>`, ARIA tablist, roving tabindex, one measured underline, lazy first mount, panels kept
mounted, per-section scroll memory, `#hash` targeting through a `resolveLegacy` hook with a
`MutationObserver` retry). Ten pages use it with 2–5 tabs, always through `PageFrame`'s `sections`
prop. It swaps content; it does not scroll to it.

**`SettingsRail`** (`src/components/settings/SettingsRail.tsx`) is a scroll-spy chip rail
(IntersectionObserver, `rootMargin: 0px 0px -67% 0px`, explicit at-bottom branch). It is **orphaned** —
retired when the tab strip landed in the 2026-09-13 polish — and only its own test imports it.

Verdict: a 12–15-section single scroll is the wrong shape for both (tabs hide content and wrap into the
sticky block; a revived rail reintroduces the fragmented grammar the shell spec removed). **Four to five
chapters as tabs, each a scrolling stack of anchored cards**, fits the existing grammar exactly and gives
deep links, keyboard navigation, indicator and scroll memory for free. Anchors inside panels already get
`scroll-margin-top: 7rem` (`localSections.css:17`); use `calc(var(--sticky-inset, 0px) + 0.75rem)` as
Settings does (`settings.css:317`) for the measured form.

### 2.5 Deep links the guide can point at

| Target | Grammar | Source |
| --- | --- | --- |
| Page views | `?section=<id>` on 10 pages — see table below | `LocalSections.tsx:31` |
| Settings cards | `/settings?section=<tab>#<cardId>` (legacy `/settings#<cardId>` still resolves) — 16 card ids: `household, categories, accounts, limits, plan-assumptions, appearance, password, price-refresh, assistant, calendar, import, backups, restore, health, system, activity` | `SettingsPage.tsx:34-37, 140-177` |
| Shell scope | `?month=YYYY-MM`, `?owner=all\|joint\|<personId>`, `?range=all\|1y\|ytd` | `useScope.ts` |
| Wizard | `/update?month=YYYY-MM-01&step=balances\|spending\|review` | `MonthlyUpdatePage.tsx:277-281` |
| Calendar | `?view=list`, `?add=1&date=YYYY-MM-DD` | `CalendarPage.tsx:95, 390-404` |
| Portfolio | `?tab=transactions\|securities\|realized\|dividends`, `?ticker=` | `PortfolioPage.tsx:127` |
| Net worth / Spending / Cards | `?drill=<slug>`, `?trend=<slug>`, `?card=<slug>` | palette registry |
| Taxes / Paycheck / Projection | `?whatif=<kind>:<fields>` (repeatable), `?year=`, `?profile=` | `src/sandbox/scenarioUrl.ts` |

Local views after the 2026-09-12 redesign (`docs/reviews/2026-09-12-chart-and-task-view-review.md:19-28`):

| Route | Views |
| --- | --- |
| `/net-worth` | overview · accounts |
| `/portfolio` | overview · holdings · allocation · income · manage |
| `/spending` | overview · trends · budgets · history |
| `/credit-cards` | rewards · lines · manage |
| `/paycheck` | summary · changes · profiles |
| `/comp` | summary · vesting · manage |
| `/espp` | summary · lots · purchase |
| `/taxes` | summary · whatif · inputs · tables |
| `/projection` | planning · historical trend |
| `/settings` | household · planning · account · integrations · data |
| `/calendar` | `?view=grid\|list` (not a tab strip) |
| `/`, `/update` | no views |

There is no global `#hash` scroll handler; the house recipe is `SettingsPage.tsx:140-177` (gated on
loaded, `scrollIntoView?.({ block: 'start' })`, `is-highlighted` ring, ResizeObserver re-assert, 1200 ms
cleanup) or `LocalSections`' `resolveLegacy` → `targetId` path.

### 2.6 Content rendering: JSX, not markdown; no images

- **No markdown library, sanitizer, syntax highlighter or animation library** is installed
  (`package.json`: five runtime deps — echarts, lucide-react, react, react-dom, react-router-dom).
- The assistant's hand-rolled renderer (`src/components/assistant/markdown.tsx`) deliberately
  downgrades links to plain text and renders headings as `<strong>` ("the page owns the heading
  outline"), so it cannot carry a guide with in-app links and a real outline.
- **No image assets exist inside `src/`** and no `<img>` anywhere; `public/` holds one favicon.
  `nginx.conf:68-71` serves images with `Cache-Control: immutable, max-age=31536000` and Vite only
  fingerprints assets imported from `src/`. Screenshots would need dark and light variants and rot weekly.
- **UI copy is inline JSX everywhere; there is no i18n and no strings file.** The only centralised
  label maps are feature-local (`NAV_SECTIONS`, `SETTINGS_SECTIONS`, `REVIEW_LABELS`,
  `COMPLETENESS_LABELS`).

Conclusion: author the guide as a typed TypeScript data module rendered into JSX cards (§4.3), with
`<Link>` for every "Go there".

### 2.7 Style rules the page must obey

- Root `<div className="page">` → `PageFrame` → `<div className="card-grid">` → `<section className="card span-12">`
  (`panels.css:7-68`). No page-level max width exists; prose blocks cap themselves —
  `details.css:57` uses `max-width: 72ch` for reading mode, the pattern to copy.
- Heading outline: `h1` is the frame's; card title `<h2 className="eyebrow">`; in-card `<h3>`;
  hidden band grouping `<h2 className="… visually-hidden" id="sec-…">` (`SettingsPage.tsx:302-378`).
- Colours only through tokens (`src/theme/tokens.ts`; `tokens.test.ts` holds every tone to 4.5:1 on both
  backgrounds and diffs `index.css` against it). No literal durations in any stylesheet
  (`motion.test.ts` walks every `.css` under `src/`).
- Muted explanatory text: `.drill-hint` (0.75rem), `.settings-note` (0.85rem), `.empty-note`.
  Eyebrows ≥ 0.72rem. Page sheets never import another page's sheet; duplicate `.hint` if needed.
- Copy voice (samples in §4.4): sentence case, initialisms in caps, second person sparingly, em-dash
  consequence clauses, bold claim then mechanism, explicit negatives, arrows on forward links, ellipsis
  on "opens something".

### 2.8 If any state is needed

Two sanctioned patterns: browser-local `localStorage` under `finance.*` (precedents `finance.chartDecals`,
`finance.detailPanel.mode`, `finance.sandbox.<page>`) or a registered pref that follows the account
(`prefsStore.ts:19-44` + `prefs_registry.py:100-114`, ~5 files including two pinned tests). The
recommended v1 needs **neither** — the guide is stateless; the fresh-database entry points derive from
coverage data already on the page.

### 2.9 Gates

CI: `npm run lint`, `npm test` (vitest — including the enumerating tests in §2.1), `npm run build`
(`tsc -b && vite build`), `ruff`, `pytest` (including `test_prefs_registry.py`), alembic round-trip. No
headless browser in CI; `tools/probes/*` are manual dev-box walks (add the label to `motion-v`'s nav
walk). No accessibility linter or axe; role queries in tests are the convention.

---

## 3. Design options

| | A. Chaptered guide page (tabs) | B. One long scroll + scroll-spy rail | C. Contextual help in the side panel | D. Guide content as palette/assistant knowledge | E. State-gated first-run checklist |
| --- | --- | --- | --- | --- | --- |
| What it is | `/guide` with 4–5 `LocalSections` chapters, anchored cards | `/guide` as one document, revived `SettingsRail` | A help affordance on each page opening that page's guide card in the shared detail panel | Index guide tasks in Ctrl+K; attach matching excerpts to assistant questions | Overview/Settings card listing setup steps, ticking off from coverage/health reads |
| Fits existing grammar | Yes — same strip as 10 pages | No — reintroduces a retired second grammar | Yes — the 09-12 detail panel exists | Yes — palette kinds exist | Partly — the audits' own proposal |
| Ctrl-F / scanning | Within a chapter | Whole document | n/a | n/a | n/a |
| "Simple to a new user" | High if chapters are few and cards use progressive disclosure | Low at 200 tasks (wall of text) | Highest in the moment; needs A for the full picture | Depends on A | High for the first hour; useless afterwards |
| Cost | Low shell, high content | Same content, plus rail revival | Medium: `PageFrame` prop + 13 one-line edits + panel wiring | Low once content is data | Low–medium; touches tested Overview logic |
| Maintenance | Content colocated, link fence | Same | Same content, one more entry point | Same content | Rules drift with features |
| Verdict | **Core** | Reject | **Phase 2** | **Palette in v1; assistant in Phase 3** | **Minimal version in v1** (two entry points, §4.5) |

**Why A over B:** the 2026-09-03 shell spec spent a batch removing fragmented navigation grammars; the
2026-09-13 polish retired the rail in favour of the strip. Chapters-as-tabs are what a user of this app
already knows how to operate, and the panel model gives per-chapter scroll memory and lazy mounting.
The Ctrl-F loss is covered by palette indexing of tasks (D), which is the better search anyway.

**Why not only E:** the audits' first-run card solves the first hour and then disappears. The owner's
ask is a one-stop reference for *any* task, forever. E's minimal form (two pointers) is kept because
without it the guide is only found by people who already know to look in the sidebar.

---

## 4. Recommended design

### 4.1 Placement, label, icon

- **Where:** the trailing `heading: null` section of `NAV_SECTIONS`, above **Settings** — the slot the
  file itself documents as the ungrouped utility tail (`navItems.ts:27`). Help beside Settings is the
  convention users bring from other tools; top placement would crowd Overview/Monthly update for every
  return visit.
- **Label:** **Guide** (sentence case per `navItems.ts:35-37`). Alternatives considered: "Help" reads as
  support; "How to" is awkward as a noun; "Manual" is heavy. Keywords: `help, how to, how do i, tutorial,
  manual, onboarding, docs, getting started, shortcuts, keyboard`.
- **Icon:** `BookOpen`. Not `Info` (already means two things — L2/B8) and not `CircleHelp` (the audit
  reserves it for the metric-inspector trigger).
- **Route:** `/guide`. Document title "Guide · Personal finance" for free.

### 4.2 Information architecture

Four chapters (`?section=`), sidebar-order cards inside each, every card and task with a stable `id`:

1. **Start here** (`start`) — *What this dashboard does · How it is organized · Set up once (the
   first-time checklist) · What happens next (the three rhythms)*.
2. **Routines** (`routines`) — *The monthly update · Tax season, once a year · Keeping it healthy
   (ongoing)*. The monthly update card is the longest card in the guide and the reason the page exists.
3. **Pages** (`pages`) — one card per sidebar page in sidebar order: Overview, Net worth, Portfolio,
   Spending, Credit cards, Paycheck, Comp, ESPP, Taxes, Projection, Calendar, Settings. A chip row at
   the top of the chapter jumps to each card.
4. **Reference** (`reference`) — *Typing numbers and moving between cells · Keyboard shortcuts · Undo,
   snapshots and what cannot be undone · Trying things without saving (sandboxes) · Every view has a
   link · Words this dashboard uses · Where to configure X (the Settings map)*.

**Card grammar** (one component, four parts, in this order):

- **Purpose** — one sentence, then the page's views as a chip list ("Views: Rewards · Credit lines ·
  Manage") and an **Open <page> →** link.
- **Do this** — the core tasks (5–8). Each task: bold title; *Where:* the UI path in on-screen labels
  ("Manage → Card roster"); 1–4 numbered steps of ≤ 15 words; **Go →** deep link to the exact view or
  anchor.
- **Watch out** — the traps a newcomer actually hits (≤ 5 visible).
- **More** — a `Disclosure` (`src/components/Disclosure.tsx`, summary reads as an eyebrow row) holding
  the long tail of tasks and the remaining traps. Closed by default; opens once and stays.

The chapter *Start here* uses the same card component with `body` prose instead of tasks.

### 4.3 Content model

```ts
// src/guide/content.ts — the whole guide as data; no JSX except optional `body`
export interface GuideTask {
  id: string            // 'credit-cards-add' → the anchor
  title: string         // 'Add a card'
  where: string         // 'Manage → Card roster'
  steps: string[]       // plain sentences; on-screen labels in **bold**
  to?: string           // '/credit-cards?section=manage'
  watch?: string[]      // traps specific to this task
  keywords?: string[]   // palette aliases: ['new card', 'annual fee', 'opened']
}
export interface GuideCard {
  id: string; title: string; purpose: string
  to?: string; views?: string[]
  tasks: GuideTask[]; more?: GuideTask[]; watch?: string[]
  body?: ReactNode      // Start here / Reference prose with <Link>s
}
export interface GuideChapter { id: 'start' | 'routines' | 'pages' | 'reference'; label: string; cards: GuideCard[] }
export const GUIDE: GuideChapter[]
```

Why data rather than free JSX:

- **One source, three consumers.** The page renders it; `paletteRegistry.buildEntries` maps
  `GUIDE.flatMap(tasks)` to a **Guide** group (`kind: 'section'`, `sub: 'Guide · Credit cards'`,
  `to: '/guide?section=pages#credit-cards-add'`) — this turns *"how do I add a card"* typed into Ctrl+K
  into a hit, which directly answers the audit's "palette matches page labels only"; and Phase 3 attaches
  the same plain strings to assistant questions.
- **Fence-testable.** A vitest walks every `to` and asserts the path is a `NAV_ITEMS` route, every
  `?section=` is in that page's `PAGE_SECTIONS`, and every `#id` appears as `id="…"` in the target
  page's source text — the same file-as-text technique `paletteRegistry.test.ts:66-78` already uses for
  Settings ids. A guide link can no longer rot silently.
- **Completeness fence.** Every `NAV_ITEMS` route (except `/guide`) has a card in *Pages*.
- **Optional label fence.** Every `**Label**` inside `steps` must appear as text somewhere under `src/`;
  a renamed button then fails a test instead of stranding the guide.

The bold-label mini-syntax (`**Save and close month**`) is the only markup in steps; a ten-line
`renderSteps` splits on it. No other markdown.

### 4.4 Writing rules for guide copy

The house voice (samples: *"Retire keeps a category out of the wizard without losing its history;
delete only works while a category has no monthly rows."*, *"No holdings yet — add transactions in
Manage."*, *"Showing earlier data — {error}"*) is precise, mechanism-first and dense. A guide for
newcomers keeps its honesty and casing but shifts to **task-first**:

- Lead with the verb: "To add an account: …". One task per numbered item.
- Steps ≤ 15 words, one action each. On-screen labels **bold and verbatim** (the label fence checks).
- Name the place before the action: "Settings → Household → Accounts", then the button.
- One trap per *Watch out* line, stated as the rule plus its consequence — the house em-dash clause is
  right here: "Liabilities are entered as negative numbers — a positive card balance inflates net worth."
- Say what is *not* saved, *not* undoable, *not* per-person. Honesty about limits is a house value
  (`2026-09-04-honest-numbers-design.md`).
- No marketing adjectives; no "simply"; no numbers in prose unless the number is the rule (three
  confirmations, six seconds, 1–28).
- Never restate an `InfoHint` verbatim (the 09-13 audit already flags four duplicate-hint sites); link to
  the place instead. The guide explains *how*; the hint explains *what*.
- Write against the **current tabs**. Fourteen existing hint sentences say "below" about content now on
  other tabs (§1.5); fix those in the same batch so the guide and the hints agree.

### 4.5 Entry points beyond the sidebar (v1)

1. **Overview, empty database.** When coverage has no months and there are no accounts, render one
   card at the top of the agenda column: *"Start here — this dashboard is empty. 1 Add your household
   and accounts → 2 Import your workbook or enter your first month → 3 Read the guide →"*. Correct the
   premise comment at `attention.ts:50-51` and the pin at `OverviewPage.test.tsx:1068`. Gate strictly on
   emptiness so it never appears for the owner.
2. **Monthly update, zero accounts.** Replace the empty balances table with one `.empty-note`:
   *"No accounts yet — add them in Settings → Household → Accounts, or start with the guide."* with both
   links (`MonthlyUpdatePage.tsx` around `:1437`).
3. **Command palette.** The **Guide** group from §4.3; `GROUP_ORDER` gets `'Guide'` last so pages and
   entities still win an ambiguous query; `titleOf` is generalised from its Settings-only branch
   (`paletteRegistry.ts:254-259`).

### 4.6 Later phases (enabled, not required)

- **Phase 2 — "How to use this page".** An optional `guide?: string` prop on `PageFrame` renders a small
  muted link (BookOpen 14 px + "Guide") at the right of the title row, to `/guide?section=pages#<id>`.
  Thirteen one-line edits. Worth doing once the page has proven its copy; it is the "seamless" path for a
  user already standing on the page they do not understand.
- **Phase 3 — the assistant answers "how do I".** The drawer fuzzy-matches the question against
  `GUIDE` tasks client-side (the `fuzzy.ts` scorer the palette uses) and attaches the top three as
  client-captured context; the system prompt gains one sentence permitting procedural answers from those
  excerpts and linking their `to` paths through the existing validated-link builder (`navLink.ts`). No
  content is duplicated into Python.
- **Phase 3 — inspector cross-links.** Metric receipts could link the glossary card for their term.

### 4.7 Tests

- The enumerating updates in §2.1 (nav order, route mock, `NAV_PATHS`).
- `GuidePage.test.tsx`: h1 "Guide"; four tabs; default chapter *Start here*; `?section=pages#taxes`
  mounts the Pages panel and focuses the Taxes card; every card renders an eyebrow h2 with its id.
- `guideContent.test.ts`: link fence, completeness fence, label fence (optional), no duplicate ids, every
  task has ≥ 1 step and a `where`.
- `paletteRegistry.test.ts`: the Guide group exists; a query "add a card" surfaces the guide task; the
  five-action pin is unchanged.
- Overview and wizard entry-point tests: appear only on an empty book; absent with one month or one account.

### 4.8 Accessibility and motion

Cards as `<section className="card">` with `<h2 className="eyebrow" id="…">`; task titles as `<h3>`;
steps as `<ol>`; the chapter chip row as `Segmented variant="chips"`; anchors get the measured
`scroll-margin-top`. Entrance, stagger and reveal come free with `.card`; the only WAAPI path is the
panel fade, already gated on `prefersReducedMotion()`. `Disclosure` keeps the house focus ring.

### 4.9 Maintenance

The guide will rot unless three things are true: content lives in **one module** every lane can find;
the **fence tests** fail when a route, view, anchor or label disappears; and plan templates gain a
one-line rule — *"if a lane renames a control or moves a task to another view, update
`src/guide/content.ts` in the same lane."*

---

## 5. Content outline (source material for the copy lanes)

Condensed from the code walks; UI paths use on-screen labels as found in source at `bc79545`. The copy
lane verifies every label against source when writing (the label fence then holds it). Items marked
*(more)* belong behind the card's Disclosure.

### 5.1 Chapter: Start here

**S1 — What this dashboard does.** A self-hosted, single-household finance dashboard. You enter account
balances, spending and take-home once a month; prices refresh on a schedule; everything else (net worth,
savings rates, taxes, projections, calendar) is computed from those entries and never stored twice.
Nothing leaves your server except price lookups and, if you enable it, the questions you ask the
assistant. Two people can be tracked; most pages have a *Whose* chip.

**S2 — How it is organized.**
- Sidebar: **Overview** and **Monthly update** on top; **Tracking** (Net worth, Portfolio, Spending,
  Credit cards) = what you have and spend; **Income** (Paycheck, Comp, ESPP) = what you earn; **Planning**
  (Taxes, Projection, Calendar) = what is ahead; **Settings** and **Guide** at the bottom.
- Most pages have tabs under the title (their *views*). The URL keeps the view, so Back works and links
  can be shared.
- The sticky row under the title: **Whose** (All · you · partner · Joint), the time window (**All · 1Y ·
  YTD**), and on some pages the month ribbon — twelve chips whose left half fills when balances exist and
  right half when spending exists; a ring marks the current month.
- **Ctrl/⌘+K** opens the command palette: pages, Settings cards, actions, holdings, accounts, categories,
  cards — and, with this page, tasks from the guide.
- **ⓘ** next to a title opens a one-paragraph explanation; **About this number** on a tile opens the
  receipt (definition, window, included months, source) with **Explain this number** for the assistant.
- **✦** bottom-right opens the assistant (needs an API key — Settings → Integrations → Assistant).
- Saving shows a toast for six seconds; many carry **Undo**. Settings → Data → Activity keeps every
  money-bearing change with a durable Undo.
- Sidebar footer: who is signed in, which deployment, theme toggle, **Log out**.

**S3 — Set up once (first-time checklist).** Dependency order; each step links.

1. **Settings → Account → Appearance** — theme, density, landing page. Works even before data exists.
2. **Settings → Account → Password** — change the seeded password (signs out other devices).
3. **Settings → Household → Household** — **Add member** for each person; set the marriage date if
   married (drives joint filing; nothing is backfilled).
4. **Settings → Household → Accounts** — every account: name, **Group** (Cash, Pre-tax, Post-tax,
   Taxable, Equity, Other, Liabilities), **Owner** (blank = joint), sort order, optional parent/component
   pair. *Without at least one account the monthly wizard cannot proceed.* Liabilities are entered
   negative in the wizard.
5. **Settings → Household → Spending categories** — add categories and set each one's **kind**
   (Living · Tax · Transfer) *before* entering months; changing a kind later recomputes all history.
6. *(If you have the workbook)* **Settings → Data → Import workbook** → **Dry run** → **Apply import**.
   Do this before any UI editing of sheet-covered tax years — the sheet wins there.
7. **Monthly update** — your first month: Balances → Spending & take-home → Review → **Save progress**
   → tick the three confirmations → **Save and close month**. (Full card in Routines.)
8. **Settings → Integrations → Price refresh** — set the cron with day names, keep Mondays covered (the
   Monday run records the weekly performance point), then **Refresh now**.
9. **Portfolio → Manage** — securities and dated transactions the import did not cover; manual prices for
   private assets. **Allocation** — classify securities, set targets.
10. **Settings → Planning** — this year's **Contribution limits** (the app ships none; blank = "not
    entered") and **Plan assumptions** (withdrawal rate, ESPP ticker and discount).
11. **Taxes** — **New tax year…**, filing status, tax tables, inputs. (Card in Routines.)
12. **Paycheck → Profiles** — one profile per person: salary, pay periods, contribution %, HSA, employer
    match, optional withholding split.
13. **Comp → Manage** and **ESPP → Lots** — grants and focal history; offerings and lots.
14. **Credit cards → Manage** — cards with **Opened** dates, categories and multipliers.
15. **Settings → Integrations → Calendar feed** — the monthly reminder day and a subscription link for
    your phone.
16. **Settings → Data → Backups** — **Snapshot now** once; confirm the nightly 23:30 PT job writes.
17. **Spending → Budgets → Start from my averages** — only after three complete months exist.

**S4 — What happens next.** Monthly: the update, then read Overview → *Needs attention*. Yearly: tax
tables, limits, a new tax year. Whenever: what-ifs in the sandboxes, calendar overrides, card changes.
→ Routines chapter.

### 5.2 Chapter: Routines

**R1 — The monthly update** (`/update`). *Purpose:* the one place balances, spending and take-home are
entered; the wizard replaces the spreadsheet ritual. *When:* the first days of the month, for the month
just ended; the reminder day (Settings → Integrations → Calendar feed, 1–28) puts it on the calendar with
a three-day alarm. *What you need:* each account's month-end balance, the month's spend per category, the
household's take-home for the month.

Do this:
1. **Pick the month** — the ribbon chip, or **Start <Month>** when it is the next uncovered month. A
   month with no balances yet always opens on Balances.
2. **Balances** — one cell per account, grouped by owner and group; **Last month · This month · Δ**.
   Cells are pre-filled from last month. Component accounts roll up into a read-only *derived* parent.
   Liabilities negative — a positive one shows an amber cue and **Flip sign**. **Recorded on** and
   **Notes** are per month. Paste a column straight from a spreadsheet; the status line says what landed.
3. **Spending & take-home** — **Household take-home** first, then one cell per category (they start at
   0.00, with the three-month *Typical* beside them). Blank means "not entered"; to record a genuinely
   empty month tick **Confirm remaining categories as $0**.
4. **Review & save** — four tiles, a *Changes since the last save* table, *Items to review*. **Save
   progress** at any time (one atomic save, six-second **Undo**). To close: tick **I checked every account
   balance**, **I checked spending, tax, and transfers…**, **I checked household take-home…**, then **Save
   and close month**. A current month needs a fourth tick. The receipt says how many rows changed and links
   to Net worth and Spending.
5. **Afterwards** — Overview → *Needs attention*; Spending → *What changed*; Net worth → *What moved*.

Watch out:
- Saving progress and closing are different: only a closed month counts as complete for averages,
  comparisons and projection defaults.
- Changing a figure after closing clears that tick — the month becomes *Needs review*.
- Unsaved entries live in this browser tab (a *Restored unsaved entries* banner offers **Discard**).
- A month saved with balances only is a "phantom" — spending averages read it as spent nothing; the
  banner offers **Delete the empty month**.
- Spending is never pre-filled from last month; balances are.

More: *Review historical months* (batch close of older months with all three feeds); **Month actions ⋯
→ Delete this month** (type `YYYY-MM`; six-second Undo; removes the snapshot, its balances, spending and
take-home); clearing a saved take-home (blank the box, save); keyed paste (name → value block);
component/parent hand-over rules; the revision-conflict banner (**Reload latest and compare draft**).

**R2 — Tax season, once a year** (`/taxes`, `/settings?section=planning`).
1. **Taxes → New tax year…** → year → **Create year** (clones the newest year's tables).
2. Scope row → **Filing status** (every year starts Single).
3. **Tax tables** view → for that status, enter or refresh Federal, State, Medicare, Social Security,
   Disability, Capital gains (rates as percents, thresholds ascending from 0, first threshold 0, ≤ 12
   rows). Married year: **Clone from <year> single tables**, then edit the tables badged *review
   thresholds*. **Add a table for <person>** under Social Security or Disability for an earner on a
   different plan.
4. **Inputs** view → the year's line items; grey *derived* rows compute themselves; **Apply** chips carry
   last year's deductions forward. **Save inputs** (or **Ctrl+Enter**).
5. **Settings → Planning → Contribution limits** → the year → amounts (or **Clone from <year−1>**); the
   Paycheck pace meters and the sandbox presets need them.
6. Through the year: **Summary → Will I owe?** — the vest **Apply** chip writes RSU income into the W-2
   inputs; the remedy line gives the W-4 4(c) / DE 4 figure.

Watch out: the *Editing tables for* tab picks which tables you are editing, not the year's filing
status (that is the scope row); no tables for the year's status → every figure reads "—", not 0; MFS
has a permanent community-property caveat.

**R3 — Keeping it healthy (ongoing).**
- **Overview → Needs attention** — each line links to its fix; absent when nothing is wrong.
- **Settings → Data → Data health** — zero-filled months, orphaned feeds, stale quotes, backup markers.
- **Portfolio** — a red failure chip → **Deactivate** a delisted ticker; **Refresh prices** if the as-of
  line is amber.
- **Settings → Data → Backups** — nightly at 23:30 PT, newest fourteen kept; **Snapshot now** before an
  import or a big edit. **Restore** writes a pre-restore point first.
- **Settings → Data → Activity** — every money-bearing change, newest first, with **Undo** while nothing
  later touched the same rows.
- A number looks wrong → **About this number** → its window and included months → **Explain this number**.

### 5.3 Chapter: Pages

Each card: Purpose · Views · Do this · Watch out · More · Open →. Long-tail items are listed under
*(more)*.

**P1 — Overview** (`/`). Read-only briefing; nothing here writes.
- Do: switch **Whose**; **Refresh**; **Customize** tiles and cards (order, hide; browser-first, synced
  at sign-in); act on **Needs attention**; click a spending bar → **Open spending**; click a trend point →
  **Open net worth records**; **Retry** one failed group.
- Watch out: spending and performance have no owner dimension and stay household-wide; the portfolio
  delta is dated from the newest quote; a month with take-home but no spending shows "—".
- *(more)*: Money flow year chips; Up next window; Data status clauses (shared with Settings → System).

**P2 — Net worth** (`/net-worth`; views overview · accounts). Read and analyse; **Enter month** goes to
the wizard; accounts themselves are managed in Settings.
- Do: **Monthly / Quarterly**; ribbon → a past month's table; **Stack by** Group / Owner / Share %;
  *What moved* → **Break down by**; Accounts → drill-down chips (up to 8); **Export** PNG / Copy / CSV /
  **Table**.
- Watch out: liabilities are stored negative and net worth sums signed balances; quarterly snaps a ribbon
  pick to the last quarter end; a scope owning nothing shows a sentence and a link to Settings → Accounts.
- *(more)*: `?drill=<slug>` links; the weekly performance point is Monday-only (product timezone) and
  backfilled by later refreshes; a workbook re-import overwrites Monday rows up to the sheet's last date.

**P3 — Portfolio** (`/portfolio`; overview · holdings · allocation · income · manage).
- Do: **Refresh prices** (also records Monday's point); **Deactivate** a failing ticker from the red chip;
  Manage → **Securities** (add/edit; delete refused while referenced — deactivate instead); Manage →
  **Transactions** (buy/sell/split; typing a new **Account** label creates a portfolio account owned by
  the primary person — re-tag in Settings → Accounts); Income → **Dividends** (manual rows; refreshes write
  ex-date rows automatically); Holdings → click a row for the detail panel; Allocation → **Security
  classifications**, **Your allocation targets** (**Activate targets** only at exactly 100 %); **Allocation
  dimension**.
- Watch out: *Prices as of* is the **oldest** quote; the live ping and the person scope: performance is
  household-wide; the two benchmark legs mean different things (baseline invests the starting balance;
  *VOO (your contributions)* invests every inferred contribution); XIRR needs dated transactions.
- *(more)*: manual price for private/NAV assets; `?tab=` and `?ticker=` links; industry treemap keyed by
  classification; import-first order law (README Part 7).

**P4 — Spending** (`/spending`; overview · trends · budgets · history). Category CRUD is in Settings.
- Do: **Enter month**; click a bar or ribbon chip → the whole page follows that month; **Month / Year**
  flow; Trends → up to 3 categories or **All categories**; History → heatmap **Row / vs average /
  Absolute**, **Show N dormant**; Budgets → **Start from my averages** (needs three complete months;
  disabled caption says why), **Re-seed from averages** (confirm first), per row **Set budget / Edit budget**
  → **Monthly budget** + **Effective from** → **Save**; blank amount ends a budget.
- Watch out: budgets are effective-dated — the date defaults to the focused month and dating one in the
  past rewrites that era; spending up is red (▲ says direction, colour says good/bad); *Living spending*
  excludes Tax and Transfer categories; the previous-12-months comparison only counts eligible months.
- *(more)*: suggestion chips fill the box only; the budget history list appears only for categories
  saved this session; yearly rollups only count months with both spending and take-home.

**P5 — Credit cards** (`/credit-cards`; rewards · lines · manage).
- Do: **+ Add card** → Manage → Card roster (name, annual fee, rewards currency, point value ¢, owner,
  authorized users, **Opened**, linked liability account) → **Add card**; **Start with the spreadsheet's
  categories**; **Add category** (annual override, mapped spending category, pin); Rewards → **Edit
  multipliers** → click a cell → multiplier, condition note, monthly cap → **Save multipliers**; click a
  card's column header → detail: **Add credit** (label, $/yr), **Resets Jan 1 ⇄ Resets on anniversary**,
  **Counts ✓ ⇄ Ignored**, **Credit line → Add** (date, new limit); **Archive**; **Delete** (Undo restores
  the card, credits and limit events; multipliers are not restored).
- Watch out: **no Opened date → no fee, anniversary or anniversary-cadence events on the calendar**;
  blank multiplier = card unusable for that category; the tiles read "—" until at least one category has
  a weight; a person's view is their cards plus joint ones; **Multiplier / Effective %** changes the number
  you read, never the winner.
- *(more)*: reorder categories by grip or ↑/↓; **Hide / Show**; utilization needs a linked liability
  account with a snapshot balance and a current limit; `?card=<slug>`.

**P6 — Paycheck** (`/paycheck`; summary · changes · profiles). One person at a time; no All/Joint.
- Do: Profiles → the form is already last profile with a blank date → change what moved → **Add
  profile** (effective date, salary, pay periods, Traditional/Roth/After-tax 401(k) %, ESPP %,
  withholding %, dental & vision, HSA per check + coverage, **Employer 401(k) match**, **Employer HSA
  contribution**, **Withholding split (optional)** federal/state %); click a row's date chip to pin the
  breakdown to it; **Show the current profile**; Try changes → sliders and boxes → compare **Per check /
  Monthly / Annual** → presets **Max 401(k) · Max HSA · Max ESPP · Stop ESPP** → **Save as profile
  effective <next month>…** pre-fills the form (the form's **Add profile** is the only write).
- Watch out: blank percent or money box = a real zero (they were pre-filled), except the withholding
  split where blank = not entered; the net is authoritative — lines are display-rounded; a pace meter
  draws only when that year's limit is entered in Settings; the ESPP meter grades purchases falling in the
  calendar year; monthly take-home is entered in the monthly update, not here.
- *(more)*: **Household take-home** tile always shows both people; `?profile=` links; the withholding
  split unlocks federal/California tiles on Taxes → Will I owe?.

**P7 — Comp** (`/comp`; summary · vesting · manage). Not per-person.
- Do: Manage → **RSU grants** → Kind (**New hire / Refresh**), label, focal year, shares, price at
  grant, first vest, vest rounding → **Add grant** (or a seed chip **Add <label> — N sh @ $X** from a focal
  year); Manage → **Focal history** → focal year, current base, new base, unvested RSUs/price, refresh
  RSUs/price → **Add**; **Columns** Entered / Computed / All; Vesting → click a date to expand its tranches.
- Watch out: there is no cliff box — the cliff comes with the kind (new hire 25 % after a year then
  6.25 %/quarter; refresh 6.25 % from its first date), and flipping the kind re-derives it; vests are on the
  third Wednesday; workbook imports never touch grants; future values use the latest quote and are marked
  *est.*.
- *(more)*: Delete a grant with Undo; a half-filled RSU/price pair warns but saves; TC trajectory is the
  app's proxy (the sheet has no TC column).

**P8 — ESPP** (`/espp`; summary · lots · purchase).
- Do: Lots → **Subscription offerings** → start date (a **close on <date>: <price> — Use** chip appears
  with an employer ticker), subscription price → **Add offering**; Lots → purchase date (pre-fills
  subscription and qualifying date from the covering offering), shares, FMV, purchase price (blank =
  derived) → **Add lot**; mark sold: **Edit** → **Sold date** + **Sold price** together → **Save lot**;
  **Model sale →** (unsold lots) opens Taxes what-if; Purchase model → year chips → knobs (blank =
  resolve) and per-period **Base · Additional · Contrib %** → **Save & recalculate**; **Reset** a stored
  period.
- Watch out: sold date and price travel together — half a pair is refused; every period resolves to the
  latest offering starting on or before it, so a reset re-prices everything after it; the $25k meter's
  "remaining" is the server's figure — a capped purchase refunds the excess and carries nothing forward;
  no employer ticker (Settings → Plan assumptions) → no market values.
- *(more)*: lot anatomy (paid · bargain element · market move; sold lots hollow); price chart rules
  (subscription price, your average paid; diamonds purchases, triangles sales).

**P9 — Taxes** (`/taxes`; summary · whatif · inputs · tables). See R2 for the yearly routine.
- Do: **New tax year…** / **Delete <year>…**; year chips; **Filing status**; Inputs → type → live
  preview after 300 ms → **Save inputs** / **Ctrl+Enter**; **Apply** chips; Tax tables → **Add bracket**
  → **Save** per table; **Clone from <year> single tables**; **Add a table for <person>**; What-if → **Add
  sale** (ticker, shares, price, long/short), **Add ESPP sale**, **Add override** (blank clears), presets
  **Max 401(k) · Max HSA · Sell all <TICKER> · Realize gains to the 15 % ceiling**, **Pin this scenario**
  (3), **Copy link**, **Apply N overrides to <year>** (before → after confirm; overrides only, never sale
  legs); Summary → totals table, marginal ladder, **Will I owe?** → **Apply** vest income.
- Watch out: derived rows cannot be typed over (the server refuses and names the components); saving an
  empty table deletes it; sale basis is average cost and long/short is your call; ESPP ordinary income in
  the sandbox raises payroll wage bases (inherited sheet structure); a null balance in *Will I owe?* means
  the engine refused, not "even".
- *(more)*: per-person columns appear only with married-joint plus a second person; `?comp=` drills the
  composition trend independently of `?year=`; two retry banners for two failure kinds.

**P10 — Projection** (`/projection`; planning · historical trend). Nothing here is saved.
- Do: adjust **Annual return · Monthly contribution · Annual spend · Withdrawal rate · Horizon ·
  Volatility · Inflation · Contribution growth** (blank = derived from records; enter 5 for 5 %); **Use my
  budgets · $X/yr**; **Retires — <Name>** month; **Today's dollars / Future dollars**; **Next milestone /
  Full horizon**; **Linear / Log**; click a month; **Pin this scenario** (3, browser-local); **Reset to
  baseline**; Historical trend → span chips.
- Watch out: the probability tile is "reach FI within the horizon" across 500 paths, not spending
  sustainability; volatility 0 turns the fan off legitimately; display dollars never move dates or
  probabilities; RSU vests are not in the derived contribution — raise it to model them; the stored
  withdrawal rate lives in Settings → Plan assumptions.
- *(more)*: derived-figure captions ("From records: … (N months)"); a fresh database says "enter a
  monthly update to start one".

**P11 — Calendar** (`/calendar`; grid · list).
- Do: **‹ Today ›**, **Jump to month**, keyboard arrows/PageUp/PageDown; grid ⇄ list; click a day or
  **+N more**; click a chip → **Mark done / Reopen**, **Hide / Unhide**, **Your figure → Save figure / Use
  the estimate**, **Open <page> →**; **Add event** (date, label, note, person, amount, direction, repeats,
  until) → **Save**; **Edit** / **Delete** (Undo); **Add to calendar (.ics)** for the visible window;
  subscribe a phone via Settings → Integrations → Calendar feed → **New feed link** → **Copy** (shown
  once) → **Revoke** later.
- Watch out: the feed link is the credential (amounts included) and is never shown again; a series is
  edited from its start; no amount → direction is forced neutral; done/hide/figure apply only to generated
  events; hidden events reappear only in List view; the reminder day is set in Settings.
- *(more)*: source-health footer says what each generator could not see (e.g. cards without an opened
  date); the feed window is 30 days back, 365 forward.

**P12 — Settings** (`/settings`; household · planning · account · integrations · data). The card doubles
as the *Where to configure X* map:

| To… | Go to |
| --- | --- |
| Add a person, rename, set the marriage date | Household → **Household** |
| Add/edit/retire/delete a net-worth account; parent/component pairs; re-tag a portfolio account's owner | Household → **Accounts** |
| Add categories; set Living / Tax / Transfer kind | Household → **Spending categories** |
| Enter or clone this year's limits | Planning → **Contribution limits** |
| Withdrawal rate, ESPP ticker and discount | Planning → **Plan assumptions** |
| Theme, density, chart patterns, landing page | Account → **Appearance** |
| Change the password (signs out other devices) | Account → **Password** |
| Refresh schedule (cron, LA time, day names) and **Refresh now** | Integrations → **Price refresh** |
| API key, model, **Test key** | Integrations → **Assistant** |
| Feed links and the monthly reminder day | Integrations → **Calendar feed** |
| Import the workbook (**Dry run → Apply import**) | Data → **Import workbook** |
| **Snapshot now**, download the ZIP, nightly schedule | Data → **Backups & snapshots** |
| Restore (dry run → type the date → **Restore**) | Data → **Restore a snapshot** |
| Health checks with inline fixes | Data → **Data health** |
| Data-through clauses, backups, schema, environment | Data → **System status** |
| Change log with durable **Undo**, import/restore reports | Data → **Activity** |

- Watch out: delete is refused for accounts with balances and categories with rows — retire instead; a
  kind change recomputes all history; the cron uses day names (`mon-fri`); an apply that fails may have
  partially written — restore the snapshot you took first; re-pick the file if you re-saved the workbook.

### 5.4 Chapter: Reference

**F1 — Typing numbers and moving between cells.** Accepted: `$`, commas, `(1,234.56)` negatives,
leading `+`/`-`; rejected: `1e5`, two points. `=1200+34.56` evaluates on Enter or blur (money boxes only).
Focus selects all; Enter commits and moves down; Shift+Enter up; ↑/↓ likewise; Enter on the last cell
focuses the step's primary button; **Ctrl+Enter** or **Ctrl+S** presses it from anywhere; Escape
restores the value at focus. Blank is "not entered", never zero. Paste: a column fills downward from the
cell (positional); a name → value block fills by name (keyed); empty cells are skipped; the status line
narrates. Bracket tables paste one column at a time.

**F2 — Keyboard shortcuts.** Ctrl/⌘+K palette (↑/↓, Enter, Escape); Ctrl+Enter / Ctrl+S save in any
entry form; Escape closes bubbles, popovers, the assistant; tab strips ←/→ Home/End; calendar grid
arrows, PageUp/PageDown, Enter opens a day; Tab from the very top → **Skip to content**.

**F3 — Undo, snapshots, and what cannot be undone.** Toast **Undo** (six seconds, pauses while hovered);
Settings → Activity **Undo** while nothing later touched the same rows; imports and restores are undone by
restoring a snapshot; a restore writes a pre-restore point; typed confirmations for month delete
(`YYYY-MM`) and restore (`YYYY-MM-DD`); never undone: a revoked feed link, matrix multipliers after a
card Undo, a password change's sign-outs.

**F4 — Trying things without saving.** Three sandboxes: Paycheck → **Try changes**, Taxes → **What-if**,
Projection's assumptions. The URL is the scenario (`?whatif=…`), so **Copy link** shares it; pins (up to
three per page) are browser-local knobs re-run on live data; **Reset to actual / baseline** clears; nothing
writes except **Apply** (Paycheck pre-fills the profile form; Taxes writes overrides after a before → after
confirm; Projection has no Apply).

**F5 — Every view has a link.** `?section=` for views, `?month=`, `?owner=`, `?range=`, `#card` on
Settings, `?whatif=`. Back and Forward restore view, period, owner and selection.

**F6 — Words this dashboard uses.** Living spending · Tax paid from take-home · Transfers · Cash
outflow · Cash saved · savings rate (cash vs total) · Typical (three-month median) · eligible months /
previous 12 months · closed / in progress / ready to review / needs review / unreviewed history ·
snapshot (a month of balances) · derived parent / component account · retired vs deleted · signed
liabilities · effective-dated budget · basis (confirmed / scheduled / estimated) · your figure ·
qualifying date · bargain element · cliff · focal year · marginal vs effective rate · safe harbor ·
FI target / FI ratio / SWR · today's vs future dollars · weekly performance point.

**F7 — Where to configure X.** The Settings map table from P12, repeated here for search.

---

## 6. First-time setup order (derived from data dependencies)

People before owned things (accounts, portfolio accounts, paycheck profiles, cards with a person owner)
→ accounts before the wizard (Next is disabled at zero accounts) → category kinds before months (a kind
change recomputes all history) → import before UI edits of sheet-covered tax years (sheet wins) → months
before budgets (three complete months) and before projection defaults (twelve entered-and-paid months) →
limits before pace meters and sandbox presets → an employer ticker before ESPP and Comp values → an opened
date before card calendar events → a paycheck profile before *Will I owe?* remedies → a key before the
assistant. §5.1 S3 is this order written for a reader.

---

## 7. Phasing and effort

| Lane | Scope | Size |
| --- | --- | --- |
| G0 shell | §2.1 change set; `GuidePage` with four `LocalSections` chapters; `GuideCard` / `GuideTask` / chapter chip row components; `GuidePage.css`; content-model types; page test; fence tests scaffolded against an empty `GUIDE` | S |
| G1 content: Start here + Routines | S1–S4, R1–R3 | M |
| G2 content: Tracking pages | P1–P5 | M |
| G3 content: Income + Planning pages + Reference | P6–P12, F1–F7 | L |
| G4 integration | Palette Guide group + `titleOf`; Overview empty-book card + `attention.ts` comment + test pin; wizard zero-accounts note; the fourteen "below" hint sentences copy pass; probe nav walk | S–M |
| V verify | gates; both themes at 1366/1600/1920; keyboard walk of tabs and anchors; every `Go →` clicked once; heading outline; fence tests green | S |

G1–G3 depend on G0's types only and run in parallel; G4 depends on G0. One overnight batch.

---

## 8. Decisions for the owner

1. **Placement and label** — "Guide" above Settings in the bottom utility slot (recommended), or at the
   top under Monthly update, or labelled "Help".
2. **Shape** — four tabbed chapters with anchored cards (recommended), or one long scroll with a revived
   scroll-spy rail.
3. **Register** — task-first plain steps with bold on-screen labels (recommended), or the denser
   InfoHint voice throughout.
4. **Scope of v1 content** — every catalogued task with long tails behind *More* (recommended, it is
   what "one stop shop" means), or core tasks only.
5. **Entry points in v1** — empty-book Overview card + wizard zero-accounts note + palette Guide group
   (recommended all three), or the sidebar alone.
6. **Same batch or later** — the fourteen stale "below" hint sentences (recommended same batch: the
   guide will describe tabs the hints contradict).
7. **Phase 2/3** — per-page "Guide" link in the title row; assistant how-to context. Decide after v1 is
   read.

## 9. Risks

- **Rot.** Mitigated by one content module, the link/label fences, and the plan-template rule (§4.9).
  Without the fences this page becomes wrong within two batches.
- **Duplication with hints.** The guide explains *how*; hints explain *what*. Reviewers should reject
  any step that restates a hint sentence.
- **Length.** Twelve page cards with five to eight visible tasks each is ≈ 80 visible tasks; the
  Disclosure tail holds the rest. If the Pages chapter still reads as a manual, split Tracking / Income /
  Planning into three chapters (the strip handles six).
- **Prod lag.** Production runs `c4a7e2b9d13f` (2026-09-11), before the local-view tabs, month close
  and metric inspector. The guide describes local main; deploy it with or after those batches, not before.
- **Owner-specific copy.** The guide must not name people, tickers or amounts from the owner's data; the
  fence tests cannot catch that — a review rule.

---

## Appendix A — Source pointers for the copy lanes

| Area | Files |
| --- | --- |
| Shell, nav, palette | `src/components/Layout.tsx`, `navItems.ts`, `routeChunks.ts`, `paletteRegistry.ts`, `CommandPalette.tsx`, `shell/PageFrame.tsx`, `shell/LocalSections.tsx`, `shell/ScopeBar.tsx`, `shell/MonthRibbon.tsx`, `shell/SidebarFooter.tsx` |
| Monthly update | `src/pages/MonthlyUpdatePage.tsx`, `components/monthly/HistoricalReview.tsx`, `ReviewChanges.tsx`, `backend/app/api/month_review.py`, `services/month_review.py`, `services/month_writes.py`, `utils/paste.ts`, `components/AmountInput.tsx` |
| Overview | `src/pages/OverviewPage.tsx`, `components/overview/attention.ts`, `DataStatusCard.tsx`, `OverviewCustomize.tsx`, `upNext.ts` |
| Net worth | `src/pages/NetWorthPage.tsx`, `backend/app/services/value_history.py`, `importer/apply.py` |
| Portfolio | `src/pages/PortfolioPage.tsx`, `components/portfolio/*.tsx`, `usePriceRefresh.ts` |
| Spending | `src/pages/SpendingPage.tsx`, `components/spending/BudgetPanel.tsx`, `backend/app/services/budgets.py` |
| Credit cards | `src/pages/CreditCardsPage.tsx`, `components/creditcards/*.tsx`, `backend/app/api/credit_cards.py`, `services/calendar/generators/cards.py` |
| Paycheck | `src/pages/PaycheckPage.tsx`, `components/paycheck/PacePanel.tsx`, `TryItPanel.tsx`, `paycheckScenario.ts`, `backend/app/api/paycheck.py` |
| Comp | `src/pages/CompPage.tsx`, `components/comp/RsuGrantsPanel.tsx`, `VestingSchedulePanel.tsx`, `backend/app/api/comp.py` |
| ESPP | `src/pages/EsppPage.tsx`, `components/espp/*.tsx`, `backend/app/api/espp.py`, `services/espp_calc.py` |
| Taxes | `src/pages/TaxesPage.tsx`, `components/taxes/InputsForm.tsx`, `BracketsEditor.tsx`, `SummaryPanel.tsx`, `WithholdingPanel.tsx`, `WhatIfPanel.tsx`, `MarginalPanel.tsx`, `TaxYearMenu.tsx`, `taxScenario.ts`, `backend/app/api/taxes.py`, `tax_keys.py` |
| Projection | `src/pages/ProjectionPage.tsx`, `components/projection/ScenarioPanel.tsx`, `projectionChartOptions.ts` |
| Calendar | `src/pages/CalendarPage.tsx`, `components/calendar/AddEventForm.tsx`, `EventDetails.tsx`, `settings/CalendarFeedCard.tsx`, `backend/app/api/calendar.py` |
| Settings | `src/pages/SettingsPage.tsx`, `components/settings/*Card.tsx` |
| Sandboxes | `src/sandbox/SandboxPanel.tsx`, `useSandbox.ts`, `scenarioUrl.ts`, `README.md:843-866` |
| Assistant | `src/components/assistant/AssistantDrawer.tsx`, `samples.ts`, `navLink.ts`, `backend/app/services/assistant_chat.py`, `assistant_tools.py` |
| Design records | `docs/superpowers/specs/2026-09-03-shell-grammar-design.md`, `2026-09-13-surface-grammar-and-view-fit-polish-design.md`, `2026-09-05-motion-polish-design.md`, `2026-08-21-data-entry-ergonomics-design.md`, `docs/plans/2026-09-12-dashboard-experience-design.md`, `docs/reviews/2026-09-12-*.md` |
