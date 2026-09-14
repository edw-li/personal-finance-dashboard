# Guide page (onboarding and how-to) — design

Date: 2026-09-14 · Status: **approved by the user 2026-09-14 ("Let's go with your recommendations")**, to be implemented in parallel worktree lanes; local merges only, no push.

Source research: `docs/superpowers/specs/2026-09-14-onboarding-guide-research.md` (the gap analysis, the engineering brief, the design options and the ~200-task catalogue in its §5). This spec restates only what implementation needs and adds the contracts, copy and tests the lanes build against.

## 0. Scope and non-goals

In scope:

1. A **Guide** page at `/guide`, reachable from the sidebar (bottom utility slot, above Settings), with four chapters through the existing tab strip: **Start here · Routines · Pages · Reference**.
2. The guide's content as a typed data module under `src/guide/`, rendered by three small components into anchored cards with a four-part grammar: *Purpose · Do this · Watch out · More*.
3. **Required content coverage** (the user's list, expanded): adding an account; assigning single or joint ownership (accounts, portfolio accounts, cards, paycheck profiles); updating balances and spending (the monthly update, saving progress, closing a month); adjusting portfolio holdings (transactions, securities, manual prices, classifications, targets); adding and managing credit cards (cards, credits, credit-limit events, categories, multipliers); managing paychecks (profiles, try-it, withholding split), comp (grants, focal history, vesting) and ESPP (offerings/subscription periods, lots, sold lots, purchase model); calculating taxes (tax year, filing status, tables, inputs, will-I-owe, what-if, apply); forecasting projections (assumptions, budgets, retirement month, pins); using the calendar (events, overrides, export, feed) and the assistant (open, ask, presets, key); plus the setup order, the monthly routine, tax season, keyboard and entry conventions, the safety net, sandboxes and a glossary.
4. A **Guide** group in the command palette, one entry per guide task, so "how do I add a card" typed into Ctrl/⌘+K lands on the task.
5. **Fence tests** that fail when a guide link, view, anchor or bold on-screen label no longer exists, plus a completeness fence (every sidebar page has a card) and a required-coverage fence (the task ids in §5.4 exist).
6. Two **fresh-database entry points**: a *Start here* card on an empty Overview and a one-line pointer in the monthly wizard when no accounts exist.
7. The remaining **positional copy check** ("below"/"above" sentences) against the current tab structure, and the manual probe's nav walk.

Out of scope (decided later, enabled by this work): a per-page "Guide" link in the title row (Phase 2); guide excerpts as assistant context so it can answer how-to questions (Phase 3); glossary links from metric receipts; screenshots or any image pipeline; a markdown renderer; server-side or browser state for the guide; mobile layouts; i18n. Nothing here touches the database or any API beyond the `NAV_PATHS` twin.

## 1. Delivery shape

Seven lanes in git worktrees under `.worktrees/`. G0 first; G1–G5 branch from main after G0 merges and run in parallel; V last on main.

| Lane | Branch / worktree | Owns |
| --- | --- | --- |
| G0 shell | `guide/g0-shell` · `.worktrees/guide-g0` | `src/components/navItems.ts`, `routeChunks.ts`, `App.tsx`, `App.test.tsx`, `Layout.test.tsx`, `Layout.tsx` (comment only), `backend/app/services/prefs_registry.py`, new `src/pages/GuidePage.tsx` + `GuidePage.css` + `GuidePage.test.tsx`, new `src/guide/types.ts`, `src/guide/content.tsx` (assembler), `src/guide/content/{start,routines,pages-tracking,pages-income,pages-planning,reference}.tsx` (empty arrays + one exemplar card) and `content/pending.ts`, `src/guide/GuideCard.tsx`, `src/guide/GuideTaskList.tsx`, `src/guide/GuidePageChips.tsx`, `src/guide/renderSteps.tsx`, `src/guide/anchors.ts`, `src/guide/testing/fixtures.ts`, `src/guide/guideContent.test.ts` (the fences), `src/guide/renderSteps.test.tsx`, `src/guide/GuideCard.test.tsx`, `src/guide/palette.ts` (the entry builder — the palette wiring itself is G5) |
| G1 content: Start here + Routines | `guide/g1-start` | `src/guide/content/start.tsx`, `src/guide/content/routines.tsx` |
| G2 content: Tracking pages | `guide/g2-tracking` | `src/guide/content/pages-tracking.tsx` (Overview, Net worth, Portfolio, Spending, Credit cards) |
| G3 content: Income + Taxes pages | `guide/g3-income` | `src/guide/content/pages-income.tsx` (Paycheck, Comp, ESPP, Taxes) |
| G4 content: Planning pages + Reference | `guide/g4-planning` | `src/guide/content/pages-planning.tsx` (Projection, Calendar, Settings ×2), `src/guide/content/reference.tsx`, new `src/guide/content/settingsMap.tsx` (the shared *Where to configure X* table) |
| G5 integration | `guide/g5-integration` | `src/components/paletteRegistry.ts` (+test), `CommandPalette.tsx` (only if a kind switch needs the new kind), `src/pages/OverviewPage.tsx` (+test, +css if needed), `src/components/overview/attention.ts` (comment), `src/pages/MonthlyUpdatePage.tsx` (+test), the positional-copy sentences listed in §11, `tools/probes/motion-v/smoke.mjs`, new `tools/probes/guide-v/smoke.mjs` |
| V verify | on `main` | gates, the guide probe run, screenshots, the `PENDING_PAGES` retirement (§8.3), hand-off notes |

Rules: a lane edits only the files it owns; a content lane that needs a renderer change reports it in its hand-off list rather than editing `src/guide/*.tsx`. Implementers run `model: opus` (house mandate); reviewers run the default model. Each lane: implement → self-check gates (`npx tsc -b`, `npx eslint src` (G0 also `ruff`/`pytest backend/tests/test_prefs_registry.py`), `npx vitest run` scoped then full, `npm run build` at the end) → spec-compliance review → code-quality review → fixes → local merge into main by the lead. No pushes. Worktree/branch deletion and any other prompt-prone command are deferred to the end.

House constraints every lane must respect:

- `motion.test.ts`: no literal finite duration in any stylesheet — `var(--t-*)` only. No new tokens.
- `tokens.test.ts`: no new palette tokens; text colours are `var(--text)` / `var(--muted)` / `var(--accent)` only.
- Per-page stylesheets never depend on another page's sheet; `GuidePage.css` carries page-only rules and duplicates `.hint`-class rules rather than importing them.
- Existing tests are updated, never deleted. Three enumerating tests move on purpose (§2.3).
- `mounts.audit.test.ts` walks every `.tsx` under `src/`: no `<EChart` outside `ChartCard`, no retired header classes, no `empty-note` beside a `<ChartCard`. The guide draws no charts.
- Content lanes write **no personal data**: no names, tickers, amounts or dates from the owner's book. Placeholders are `<Month>`, `<year>`, `<person>`, `<TICKER>`, `$X`.

## 2. Navigation and route (G0)

### 2.1 Sidebar entry

`src/components/navItems.ts` — import `BookOpen` (alphabetical among the lucide imports) and add to the trailing `heading: null` section, **before** Settings:

```ts
{
  to: '/guide',
  label: 'Guide',
  icon: BookOpen,
  keywords: ['help', 'how to', 'how do i', 'tutorial', 'manual', 'onboarding', 'docs', 'getting started', 'shortcuts', 'keyboard'],
},
```

The section comment at `navItems.ts:27` ("null = ungrouped (the top pair, and Settings alone at the bottom)") becomes "…and the utility tail: Guide, then Settings". Label is sentence case; the icon is `BookOpen` (not `Info`, which already carries two meanings, and not `CircleHelp`, reserved by the 2026-09-13 audit for the metric-inspector trigger).

### 2.2 Route and chunk

- `src/components/routeChunks.ts`: `'/guide': () => import('../pages/GuidePage'),` (keep the object in sidebar order — after `/settings`).
- `src/App.tsx`: `const GuidePage = lazy(ROUTE_CHUNKS['/guide'])` and `<Route path="/guide" element={<GuidePage />} />` before the `*` route, inside the `DetailPanelProvider`/`Layout` route.
- `backend/app/services/prefs_registry.py` `NAV_PATHS`: append `"/guide"` after `"/settings"`; `backend/tests/test_prefs_registry.py:35-41` then passes (it regex-reads `navItems.ts`).

### 2.3 Enumerating tests that move

- `src/components/Layout.test.tsx:210-224`: the ordered label array gains `'Guide'` before `'Settings'` (the comment "Settings last" becomes "Guide then Settings last").
- `src/App.test.tsx:21`: the mocked route list gains `'/guide'`.
- `src/components/routeChunks.test.ts`: passes unchanged (two-way lockstep).
- `Layout.test.tsx:485-577` indicator maths stub `translateY(160px)` for Spending is unaffected (the new link is after Spending).
- `src/components/Layout.tsx:175` comment: "the 12-link sidebar" → "the 14-link sidebar".

### 2.4 What comes free

Document title "Guide · Personal finance" (`usePageTitle.ts`), the palette **Pages** entry with the aliases above, a *Landing page* option in Settings → Appearance, hover/idle prefetch, route hold, page-body entrance, card stagger and scroll reveal for every `.card`.

## 3. Page structure (G0)

### 3.1 Frame and chapters

```tsx
// src/pages/GuidePage.tsx
const PAGE_SECTIONS = [
  { id: 'start', label: 'Start here' },
  { id: 'routines', label: 'Routines' },
  { id: 'pages', label: 'Pages' },
  { id: 'reference', label: 'Reference' },
] as const
type Chapter = (typeof PAGE_SECTIONS)[number]['id']

const views = useLocalSections(PAGE_SECTIONS, 'start', {
  resolveLegacy: ({ hash }) => {
    const target = hash.slice(1)
    if (!target) return null
    const chapter = chapterOf(target)          // src/guide/anchors.ts — card id or task id → chapter id
    return chapter ? { section: chapter, targetId: target } : null
  },
})

<div className="page guide-page">
  <PageFrame title="Guide" resource={{ status: 'ready' }}
             sections={<LocalSectionNav state={views} label="Guide chapters" />}>
    {GUIDE.map((chapter) => (
      <LocalSectionPanel key={chapter.id} state={views} section={chapter.id} className="span-12 card-grid">
        {chapter.id === 'pages' && <GuidePageChips chapter={chapter} />}
        {chapter.cards.map((card) => <GuideCard key={card.id} card={card} chapter={chapter.id} />)}
      </LocalSectionPanel>
    ))}
  </PageFrame>
</div>
```

- `resource={{ status: 'ready' }}`, no skeleton, no scope row (the `NotFoundPage` precedent).
- The **URL grammar** is `/guide?section=<chapter>#<cardId|taskId>`. A bare `/guide#<id>` resolves through `resolveLegacy` to the owning chapter and focuses the target (the `LocalSections` `targetId` path: `scrollIntoView`, `tabindex=-1` if needed, focus, MutationObserver retry). `chapterOf` is built once from `GUIDE` (`src/guide/anchors.ts`) and is the same map the fences and the palette use.
- The **Pages chapter chip row** (`GuidePageChips`) is a `<nav className="guide-chips span-12" aria-label="Pages in this guide">` of `<Link className="chip" to={{ search: '?section=pages', hash: `#${card.id}` }}>` in sidebar order; a Link navigation pushes a new location key, so the hook's effect scrolls and focuses the card. It is the panel's first grid child (hence `span-12`), is not a `.card`, and wraps on narrow widths. `.chip` already exists in `panels.css:506-523` with hover, `:focus-visible` and `.active` rules; `GuidePage.css` adds only `a.chip { text-decoration: none }` if the anchor needs it.
- Anchors inside panels already receive `scroll-margin-top: 7rem` (`localSections.css`); `GuidePage.css` sets `.guide-page [id] { scroll-margin-top: calc(var(--sticky-inset, 0px) + 0.75rem) }` — the measured form, as Settings uses.

### 3.2 Card component

`GuideCard` renders one `GuideCard` record:

```tsx
<section className="card span-12 guide-card" id={card.id} aria-labelledby={`${card.id}-title`}>
  <div className="guide-card-head">
    <h2 className="eyebrow" id={`${card.id}-title`}>{card.title}</h2>
    {card.to && <Link className="guide-open" to={card.to}>Open {card.title} →</Link>}   {/* only for page cards */}
  </div>
  <p className="guide-purpose">{card.purpose}</p>
  {card.views && <p className="drill-hint">Views: {card.views.join(' · ')}</p>}
  {card.body}                                                     {/* Start here / Reference prose */}
  {card.tasks.length > 0 && <><h3 className="guide-h3">Do this</h3><GuideTaskList tasks={card.tasks} /></>}
  {card.watch?.length ? <><h3 className="guide-h3">Watch out</h3><ul className="guide-watch">{…}</ul></> : null}
  {card.more?.length ? (
    <Disclosure summary={`More tasks (${card.more.length})`} className="guide-more">
      <GuideTaskList tasks={card.more} />
    </Disclosure>
  ) : null}
</section>
```

`GuideTaskList` renders `<ol className="guide-tasks">`; each `<li id={task.id}>`: `<h4 className="guide-task-title">{task.title}</h4>`, `<p className="guide-where"><span className="guide-where-label">Where:</span> {task.where}</p>`, `<ol className="guide-steps">{task.steps.map(renderSteps)}</ol>`, optional `<ul className="guide-task-watch">` for `task.watch`, and `{task.to && <Link to={task.to} className="guide-go">Go →</Link>}`. Task ids are anchors too (`chapterOf` knows them).

`renderSteps(text)` splits on `**…**` and emits `<b className="guide-label">` for each bold span; no other markup is recognised (a test pins that `*x*`, `` `x` `` and `[x](y)` render literally).

Heading outline on the page: `h1` (frame) → `h2.eyebrow` per card → `h3.guide-h3` for *Do this* / *Watch out* → `h4` per task. The chapter chip row is a `nav`, not a heading.

### 3.3 Stylesheet (`src/pages/GuidePage.css`)

Page-only rules; no literal durations; colours via tokens.

- `.guide-card` inherits `.card`; `.guide-card-head { display:flex; justify-content:space-between; gap:1rem; align-items:baseline }`.
- Prose measure: `.guide-purpose, .guide-body, .guide-steps, .guide-watch { max-width: 72ch }` (the `details.css:57` reading-mode precedent).
- `.guide-h3 { font-size: 0.72rem; letter-spacing: 0.09em; text-transform: uppercase; color: var(--muted); margin: 1rem 0 0.4rem }` (the eyebrow scale, one level down — `h3` so the outline is honest).
- `.guide-tasks { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.9rem }`; `.guide-task-title { font-size: 0.95rem; font-weight: 600; margin: 0 }`; `.guide-where { color: var(--muted); font-size: 0.85rem; margin: 0.1rem 0 0.3rem }`; `.guide-where-label { font-weight: 600 }`.
- `.guide-steps { margin: 0 0 0.3rem 1.2rem; padding: 0 }` with `li { margin: 0.15rem 0 }`; `.guide-label { font-weight: 600; color: var(--text) }`.
- `.guide-watch, .guide-task-watch { color: var(--muted); font-size: 0.85rem; margin: 0 0 0 1.1rem }`.
- `.guide-go, .guide-open { font-size: 0.85rem }`; `panels.css` has no generic `a:focus-visible` rule, so `GuidePage.css` states the house ring for the guide's links: `.guide-page a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px }`.
- `.guide-chips { display:flex; flex-wrap:wrap; gap:0.4rem; margin: 0 0 0.25rem }` over the existing `.chip` look (`panels.css:506`).
- Target highlight on arrival: none beyond the focus ring `LocalSections` gives the focused target (it adds `tabindex="-1"` and focuses). No `is-highlighted` port.

### 3.4 Motion and accessibility

Every card is a `.card`, so entrance, stagger (capped at six), scroll reveal and edge scrims apply with no opt-in. The only WAAPI path is the panel fade `LocalSections` already gates on `prefersReducedMotion()`. The `Disclosure` primitive keeps its own focus ring and pop-in. Tabs get the strip's roving tabindex and ←/→/Home/End.

## 4. Content model (G0 defines; G1–G4 fill)

```ts
// src/guide/types.ts
export type GuideChapterId = 'start' | 'routines' | 'pages' | 'reference'

export interface GuideTask {
  /** Stable anchor; kebab-case; unique across the whole guide. */
  id: string
  /** Verb first: 'Add a card', 'Close the month'. */
  title: string
  /** UI path in on-screen labels: 'Manage → Card roster' or 'Settings → Household → Accounts'. */
  where: string
  /** 1–6 plain sentences, ≤ 15 words each; on-screen labels wrapped in **double asterisks**. */
  steps: string[]
  /** Deep link to the exact page/view/anchor. Optional only for tasks that are pure reading. */
  to?: string
  /** Traps specific to this task, one rule per line. */
  watch?: string[]
  /** Palette aliases beyond the words in `title`. */
  keywords?: string[]
}

export interface GuideCard {
  id: string
  title: string
  /** One sentence. */
  purpose: string
  /** The page route for page cards ('/credit-cards'); drives "Open … →" and the completeness fence. */
  to?: string
  /** The page's views in strip order, on-screen labels. */
  views?: string[]
  /** Core tasks, visible. 3–8 for page cards. */
  tasks: GuideTask[]
  /** Long tail behind the Disclosure. */
  more?: GuideTask[]
  /** Card-level traps. ≤ 5. */
  watch?: string[]
  /** Prose for Start here / Reference cards; may contain <Link>s. */
  body?: ReactNode
  /** Extra palette aliases for every task in this card ('credit card', 'rewards'). */
  keywords?: string[]
}

export interface GuideChapter { id: GuideChapterId; label: string; cards: GuideCard[] }
```

`src/guide/content.ts` assembles `export const GUIDE: GuideChapter[] = [start, routines, pages, reference]` where `pages.cards = [...tracking, ...income, ...planning]` in sidebar order. Each content file exports a `GuideCard[]`. G0 seeds every file with `[]` except `start.ts`, which receives the finished **S1 — What this dashboard does** card as the exemplar of voice and shape (G1 keeps or edits it).

`src/guide/anchors.ts`: `chapterOf(id)` and `allIds()` built from `GUIDE`; `src/guide/palette.ts`: `guideEntries(): PaletteEntry-shaped objects` (typed locally as `{ id, label, sub, keywords, to }` so `src/guide` does not import from the palette and no cycle forms).

## 5. Content requirements (G1–G4)

### 5.1 Chapters and cards

Card ids are fixed here so anchors, the palette and the fences agree.

**Start here** (`start`): `start-what` *What this dashboard does* · `start-organized` *How it is organized* · `start-setup` *Set up once* (the first-time checklist as an ordered `body` list with a `<Link>` per step, in the dependency order of research §6/§5.1 S3) · `start-next` *What happens next*.

**Routines** (`routines`):

- `routine-monthly` *The monthly update* — `to: '/update'` (this card is the `/update` route's home for the completeness fence). Canonical tasks: `update-pick-month`, `update-balances`, `update-spending`, `update-review-save`, `update-close`, `update-after`; more: `update-historical-close`, `update-delete-month`, `update-clear-take-home`, `update-paste`, `update-phantom`, `update-drafts`, `update-conflict`.
- `routine-tax-season` *Tax season, once a year* — a `body` ordered list (the yearly sequence) whose steps `<Link>` to the canonical Taxes and Settings tasks: `#taxes-year-create`, `#taxes-filing-status`, `#taxes-tables`, `#taxes-tables-clone`, `#taxes-per-person-table`, `#taxes-inputs`, `#limits-enter`, `#taxes-will-i-owe`, `#taxes-apply-vest`; no tasks of its own; `watch` carries the three season-level traps (status tab ≠ filing status; no tables → "—"; MFS caveat).
- `routine-health` *Keeping it healthy* — canonical tasks `health-attention` (Overview → Needs attention), `health-about-number` (About this number → Explain this number); `body` links to `#health-checks`, `#snapshot-now`, `#activity-undo`, `#portfolio-deactivate`, `#portfolio-refresh`.

**Every task id has exactly one canonical home.** A second card that needs the same task uses a **pointer task**: its own id ending in `-pointer`, exactly one step naming the place and the guide card that holds the full task ("Accounts are added, owned and retired in Settings → Household → **Accounts** — see the Settings card in this guide."), and `to` set to the **real destination** (`/settings?section=household#accounts`), never to another chapter's guide anchor. Content lanes run in parallel and merge one at a time, so a cross-lane `/guide#…` link would fail the link fence on whichever lane merges first; the real destination is also the better "Go →" for a reader. Pointer tasks count toward a card's visible tasks and are excluded from the palette. Cross-chapter guide anchors are added only by lane V (§9, one short list). This is how Net worth points at account management, Spending at the wizard, Settings at the calendar feed, and Reference → Asking the assistant at the key.

**Pages** (`pages`), sidebar order, `to` = route, `views` = strip labels. The third column lists the **required task ids** for the card (canonical unless suffixed `-pointer`); the lane decides which sit under *Do this* (3–8 visible) and which under *More*:

| Card id | Title | Required tasks (ids) |
| --- | --- | --- |
| `page-overview` | Overview | `overview-whose`, `overview-customize`, `overview-attention`, `overview-refresh` |
| `page-net-worth` | Net worth | `networth-accounts-pointer` (→ `#accounts-add`), `networth-grain`, `networth-past-month`, `networth-stack-by`, `networth-what-moved`, `networth-drilldown`, `networth-export` |
| `page-portfolio` | Portfolio | `portfolio-refresh`, `portfolio-transaction` (buy/sell/split), `portfolio-security`, `portfolio-manual-price`, `portfolio-dividend`, `portfolio-holding-detail`, `portfolio-classify`, `portfolio-targets`, `portfolio-deactivate` |
| `page-spending` | Spending | `spending-enter-pointer` (→ `#update-spending`), `spending-drill-month`, `spending-flow-window`, `spending-trends`, `spending-heatmap`, `spending-budget-seed`, `spending-budget-set`, `spending-budget-end` |
| `page-credit-cards` | Credit cards | `cards-add`, `cards-opened-date`, `cards-owner`, `cards-categories-seed`, `cards-category-add`, `cards-multipliers`, `cards-detail`, `cards-credit-add`, `cards-limit-add`, `cards-archive-delete` |
| `page-paycheck` | Paycheck | `paycheck-profile-add`, `paycheck-profile-carry-forward`, `paycheck-person`, `paycheck-pin-profile`, `paycheck-try-it`, `paycheck-apply-scenario`, `paycheck-withholding-split`, `paycheck-pace` |
| `page-comp` | Comp | `comp-grant-add`, `comp-grant-seed`, `comp-focal-add`, `comp-vesting-read`, `comp-grant-edit-delete` |
| `page-espp` | ESPP | `espp-offering-add` (new subscription period), `espp-close-chip`, `espp-lot-add`, `espp-lot-sold`, `espp-model-sale`, `espp-purchase-model`, `espp-plan-settings` |
| `page-taxes` | Taxes | `taxes-year-create`, `taxes-filing-status`, `taxes-tables`, `taxes-tables-clone`, `taxes-per-person-table`, `taxes-inputs`, `taxes-derived-rows`, `taxes-will-i-owe`, `taxes-apply-vest`, `taxes-whatif-sale`, `taxes-whatif-override`, `taxes-whatif-apply`, `taxes-pin` |
| `page-projection` | Projection | `projection-assumptions`, `projection-use-budgets`, `projection-retire-month`, `projection-dollars`, `projection-pin`, `projection-reset` |
| `page-calendar` | Calendar | `calendar-navigate`, `calendar-add-event`, `calendar-edit-event`, `calendar-override` (done/hide/your figure), `calendar-export-ics`, `calendar-subscribe` (Settings → Integrations → Calendar feed → **New feed link**; canonical here because the reader's goal is "get this on my phone"), `calendar-reminder-day` (canonical here; set in Settings) |
| `page-settings` | Settings — Household & Planning | `household-add-member`, `household-marriage-date`, `accounts-add`, `accounts-owner` (single vs joint on accounts, and the portfolio-account owner table), `accounts-parent-component`, `accounts-retire-delete`, `categories-add`, `categories-kind`, `limits-enter`, `plan-assumptions` |
| `page-settings-data` | Settings — Account, Integrations & Data | `appearance`, `password`, `price-refresh-schedule`, `assistant-key`, `calendar-feed-pointer` (→ `#calendar-subscribe`), `calendar-reminder-pointer` (→ `#calendar-reminder-day`), `import-workbook`, `snapshot-now`, `restore-snapshot`, `health-checks`, `activity-undo`, `settings-map` (the *Where to configure X* table as `body`) |

The assistant lives in the Reference chapter (`ref-assistant`) because it is a shell affordance, not a page: `assistant-open`, `assistant-ask`, `assistant-presets`, `assistant-key-pointer` (→ `#assistant-key`). Ownership appears wherever an owner is chosen: `accounts-owner` (canonical, the rule "blank owner = joint" and the portfolio-account table), `cards-owner` (a card's owner and the "their cards plus joint ones" scope rule), `paycheck-person` (a profile belongs to one person; no joint), and `calendar-add-event` (the Person field).

**Reference** (`reference`): `ref-typing` *Typing numbers and moving between cells* · `ref-keyboard` *Keyboard shortcuts* · `ref-undo` *Undo, snapshots, and what cannot be undone* · `ref-sandboxes` *Trying things without saving* · `ref-links` *Every view has a link* · `ref-assistant` *Asking the assistant* · `ref-glossary` *Words this dashboard uses* (a `<dl>` in `body`) · `ref-settings-map` *Where to configure X* (the same table as `settings-map`, rendered from one shared constant).

### 5.2 Source material

Each card's tasks, prerequisites and traps are catalogued in research §5 (S1–S4, R1–R3, P1–P12, F1–F7) with `file:line` pointers in its Appendix A. Content lanes write from the catalogue and **verify every on-screen label against source** before bolding it; the label fence (§8.2) then holds it.

### 5.3 Writing rules

1. Verb first, one task per item; steps ≤ 15 words, one action each; 1–6 steps.
2. Name the place before the action; on-screen labels **bold and verbatim** (sentence case as rendered: **Save and close month**, **Add card**, **Start from my averages**).
3. One trap per *Watch out* line, as rule plus consequence, in the house em-dash clause: "Liabilities are entered as negative numbers — a positive card balance inflates net worth."
4. Say what is *not* saved, *not* undoable, *not* per-person, *not* pre-filled.
5. No marketing adjectives, no "simply", no exclamation marks. Numbers only when the number is the rule (three confirmations, six seconds, 1–28, exactly 100 %).
6. Never restate an `InfoHint` sentence; the guide explains *how*, the hint explains *what*. If a step needs the definition, link the glossary entry.
7. Describe the **current tabs** (research §2.5 table): "Portfolio → Manage → Transactions", never "below".
8. No personal data (§1). Placeholders in angle brackets are exempt from the label fence.
9. Purpose sentences answer "what is this page for" in ≤ 25 words. Card `watch` ≤ 5 lines; the rest goes to `more`.
10. Every task that changes data ends with what the change affects elsewhere when that is not obvious ("…feeds the calendar's fee and anniversary events").

### 5.4 Required-coverage fence

`guideContent.test.ts` asserts these task ids exist somewhere in `GUIDE` (the user's list): `accounts-add`, `accounts-owner`, `cards-owner`, `paycheck-person`, `update-balances`, `update-spending`, `update-close`, `portfolio-transaction`, `portfolio-security`, `portfolio-classify`, `cards-add`, `cards-multipliers`, `cards-credit-add`, `paycheck-profile-add`, `paycheck-try-it`, `comp-grant-add`, `comp-focal-add`, `espp-offering-add`, `espp-lot-add`, `espp-lot-sold`, `taxes-year-create`, `taxes-tables`, `taxes-inputs`, `taxes-will-i-owe`, `taxes-whatif-sale`, `projection-assumptions`, `projection-retire-month`, `calendar-add-event`, `calendar-subscribe`, `assistant-ask`, `assistant-key`. G0 writes the assertion with this list; **the whole assertion is skipped while `PENDING_PAGES` is non-empty** (§8.3) and becomes live when V retires the escape hatch.

## 6. Command palette Guide group (G5)

- `PaletteKind` gains `'guide'`; `PaletteGroup['title']` gains `'Guide'`; `GROUP_ORDER` appends `'Guide'` **last** so pages, Settings cards and entities win an ambiguous query; `titleOf` maps `kind === 'guide'` → `'Guide'`.
- `buildEntries` appends `guideEntries()` from `src/guide/palette.ts` after sections: one entry per task (`tasks` and `more`) —

```ts
{ kind: 'guide', id: `guide:${task.id}`, label: task.title, sub: `Guide · ${card.title}`,
  keywords: [...(task.keywords ?? []), ...(card.keywords ?? []), 'how to', 'guide'],
  to: `/guide?section=${chapter.id}#${task.id}` }
```

- `CommandPalette.tsx` renders it like a section entry (label + `sub`); if it switches on kind for an icon, `guide` uses `BookOpen`.
- `GROUP_CAP` (6) applies; fuzzy scoring is the existing `fuzzyScore` over label + keywords.
- Tests (`paletteRegistry.test.ts`): the five-action pin is unchanged; a Guide group exists; the query `add a card` surfaces `guide:cards-add` in the Guide group; the query `settings` still ranks Settings sections above guide tasks; every guide entry's `to` starts with `/guide?section=`.

## 7. Fresh-database entry points (G5)

### 7.1 Overview *Start here* card

Condition: `owner === null && data.ts && data.ts.months.length === 0` (no net-worth snapshot exists in the household). Placement: first card in `<aside className="overview-agenda-column">`, above *Up next*. Markup:

```tsx
<section className="card overview-start" aria-labelledby="overview-start-title">
  <h2 className="eyebrow" id="overview-start-title">Start here</h2>
  <p>This dashboard is empty. Three steps get it going:</p>
  <ol className="overview-start-steps">
    <li><Link to="/settings?section=household#accounts">Add your household and accounts</Link> — every balance needs an account to live in.</li>
    <li><Link to="/settings?section=data#import">Import your workbook</Link> or <Link to="/update">enter your first month</Link>.</li>
    <li><Link to="/guide">Read the guide</Link> — setup order, the monthly routine, every page.</li>
  </ol>
  <p className="drill-hint">After that: one <Link to="/guide?section=routines#routine-monthly">monthly update</Link> in the first days of each month.</p>
</section>
```

Tests: renders on an empty household (`months: []`), absent once one month exists, absent under a person/joint scope (the empty-scope note owns that case). Update the comment at `attention.ts:50-51` to state the true premise: "the Overview's *Start here* card owns the empty-book case; the nudge starts once a first month exists." The gating itself is unchanged.

### 7.2 Monthly wizard, zero accounts

On the Balances step, when `!loading && accounts.length === 0` and the load succeeded, render instead of the table:

```tsx
<p className="empty-note">
  No accounts yet — <Link to="/settings?section=household#accounts">add them in Settings → Household → Accounts</Link>, or <Link to="/guide?section=start#start-setup">start with the guide</Link>.
</p>
```

Next/Save stay disabled as today. Test: the note appears with an empty roster and both links carry the right `href`; it is absent with one account.

## 8. Fence tests (G0 writes; all lanes keep green)

`src/guide/guideContent.test.ts` walks `GUIDE`:

### 8.1 Link fence

For every `to` on cards and tasks:
- `pathname` ∈ `NAV_ITEMS.map(i => i.to)` ∪ `{'/guide'}`.
- If `?section=<id>` is present: `<id>` ∈ the target page's `PAGE_SECTIONS` ids, read from `src/pages/<Page>.tsx` source text with `/PAGE_SECTIONS = (\[.*?\]) as const/s` and `/"id":"([a-z-]+)"/g` (the file-as-text technique `paletteRegistry.test.ts:66-78` uses). For `/guide`, ids ∈ the four chapters.
- If `#<id>` is present: for `/guide`, `<id>` ∈ `allIds()`; for `/settings`, `<id>` ∈ `SETTINGS_SECTIONS` ids or `sec-*`; for any other page, `id="<id>"` occurs in that page's source or its `src/components/<area>/` folder.
- Other query keys must be in the allow-list `{month, owner, range, step, view, add, date, tab, ticker, drill, trend, card, year, comp, lot, grant, profile, whatif}`.

### 8.2 Label fence

For every `**Label**` in `steps` (and `where` segments split on ` → `), unless it contains `<` or `>` or begins with a digit or `$`: the exact string occurs in some file under `src/` excluding `src/guide/` (searching `.tsx` text, case-sensitive). A label may also be satisfied by an `aria-label`/`title` attribute value (they are text in the source too). Where-segments naming pages/tabs (`Settings`, `Household`, `Manage`) are satisfied by `navItems.ts` labels or `PAGE_SECTIONS` labels.

### 8.3 Completeness and uniqueness

- Every route in `NAV_ITEMS` except `/guide` has at least one card **in any chapter** whose `to` equals it (`/update` is satisfied by `routine-monthly`, `/settings` by either Settings card) — **or** is listed in `PENDING_PAGES` (`src/guide/content/pending.ts`, seeded by G0 with all thirteen routes). Each content lane deletes its routes from the array as it lands its cards (G1 deletes `/update`). **V asserts the array is empty and deletes the escape hatch and the `pending.ts` file.** The required-coverage assertion (§5.4) is skipped while the array is non-empty.
- All card ids and task ids are unique across the guide (a pointer task has its own id); every task has non-empty `title`, `where`, ≥ 1 step; every card with `to` other than `/guide` has `views` when its page has a tab strip (research §2.5 table; Overview, Monthly update and Calendar have none), 3–8 visible tasks, ≤ 5 `watch` lines; every `step` ≤ 160 characters (a soft proxy for the fifteen-word rule; the reviewer judges the rest); every pointer task's `to` starts with `/guide` and resolves to an existing id.
- `chapterOf(id)` resolves every id to its chapter.

### 8.4 Page and component tests

- `GuidePage.test.tsx`: h1 "Guide"; four tabs with the labels; default panel *Start here*; `MemoryRouter` at `/guide?section=pages#page-taxes` shows the Pages panel and the Taxes card is in the document; `/guide#update-close` (bare hash) resolves to Routines; the chip row has one link per Pages card in sidebar order.
- `GuideCard.test.tsx`: a fixture card renders eyebrow, purpose, views line, *Do this* with tasks (title, where, steps, Go link href), *Watch out*, and a Disclosure whose summary reads `More tasks (N)` and whose content mounts on open.
- `renderSteps.test.tsx`: bold spans, literal rendering of other markdown, escaping of `<`.

## 9. Gates and the verify lane

Per lane: `npx tsc -b`, `npx eslint src`, `npx vitest run` (scoped, then the full suite), `npm run build`; G0 also `ruff check backend && ruff format --check backend` and `python -m pytest backend/tests/test_prefs_registry.py -q` (the backend venv recipe is in the README/CI).

V on main after all merges:

1. Full gates.
2. Retire `PENDING_PAGES` (§8.3), run the fences again.
3. Bring up the dev stack (Docker Postgres 5433, uvicorn 8000, vite 5173) and run `tools/probes/guide-v/smoke.mjs` (G5 writes it): for every link rendered inside the guide, navigate and assert the URL landed, the `?section` tab is selected where present, and a `#id` target received focus or is in view; screenshot each chapter in dark and light at 1440×900 and 1920×1080. **Docker Desktop was not running when this spec was approved**; V tries to start it unattended and, if it cannot, records a reasoned skip — the fences, `GuidePage.test.tsx`, the palette tests and the Overview/wizard tests are the acceptance, and the walk moves to the morning list. The Overview *Start here* card and the wizard note are verified by their unit tests (an empty scratch database is not created overnight).
4. Hand-off notes: any label the fence exempted, any `to` that needed the allow-list, Phase 2/3 pointers.

## 10. Probe nav walk

`tools/probes/motion-v/smoke.mjs:51`: the `NAV` array gains `'Guide'` before `'Settings'` and the comment says 14 links.

## 11. Positional copy check (G5)

The 2026-09-13 P3 lane already rewrote the Taxes "below" sentences. Of the positional sentences that remain, two point at another tab and are rewritten; the rest are same-view or geometric and stay:

- **Rewrite** `src/pages/SpendingPage.tsx:537` — the *Savings rate — cash* tile hint (Overview view) says "the chart below draws both readings", but the *Savings rate* chart is in the **Trends** panel (`SpendingPage.tsx:688-798`). New ending: "— the **Savings rate** chart on Trends draws both readings."
- **Rewrite** `src/components/paycheck/TryItPanel.tsx:257` — "against the profile shown above" while the panel renders in the **Try changes** view and the breakdown lives on Summary. New: "against the profile named in this card's title — nothing is saved." (the eyebrow already reads "Try changes — effective <date>").
- Keep: `NetWorthPage.tsx:810` (drill-down chips are in the same card), `NetWorthPage.tsx:868` (the ribbon is in the sticky row), `CardDetail.tsx:404` (same card), `SpendingPage.tsx:568` (totals tiles are in the same Overview panel), `SpendingPage.tsx:696` ("Above the zero line you saved" — chart geometry), `CompositionPanel.tsx:161` (the totals receipt precedes it in the Summary panel).

Each rewrite updates any test that quotes the old sentence (grep both files' tests first) and adds no new pin.

## 12. Hand-offs recorded for later phases

- **Phase 2:** `PageFrame` optional `guide?: string` prop → a muted `BookOpen` 14 px + "Guide" link at the title row's right, to `/guide?section=pages#page-<id>`; thirteen call sites.
- **Phase 3:** the drawer attaches the top-three `fuzzyScore` matches from `GUIDE` as client context; one system-prompt sentence permits procedural answers from those excerpts and links their `to` through `navLink.ts`.
- **Glossary links** from `MetricInspector` definitions to `/guide?section=reference#ref-glossary`.
- The **landing-page** picker now offers Guide; no action.

## 13. Acceptance (what "done" means for the batch)

- Sidebar shows **Guide** above **Settings** on every page; the palette lists it under Pages and lists guide tasks under a **Guide** group.
- `/guide` renders four chapters; every card in §5.1 exists with its required tasks; the content covers the user's list (§0.3) and the fences in §8 are green with `PENDING_PAGES` retired.
- Every deep link in the guide lands on a real route/view/anchor (probe + fence); every bold label exists in the UI (fence).
- An empty Overview shows *Start here*; a zero-account wizard shows the pointer; both disappear once data exists.
- All gates green on local main; nothing pushed; no database or API behaviour changed beyond the `NAV_PATHS` twin.
