# Lane L2 — Guide content restructuring for the master–detail layout (2026-09-15 guide polish) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (one
> Opus implementer for this lane in its own worktree, the fences as the test, then a
> spec-compliance review — facts, labels, structure — and a code-quality review, then a local
> merge to main — never pushed). Steps use `- [ ]` checkboxes.

**Spec:** `docs/superpowers/specs/2026-09-15-guide-polish-master-detail-design.md` **§5** (content
restructuring), with §2.2 (numbered rails) and §3 (one card at a time) for context; writing rules
are the predecessor spec's §5.3 (`2026-09-14-onboarding-guide-design.md`).

**Goal:** the setup checklist and the tax-season sequence become numbered task rails (rail left,
fuller explanation right — the user's pick), the prose cards use two-column fact grids so their
right half is used, and the glossary becomes a term | definition grid — all inside the fences,
with every verified fact from last night's content carried over unchanged.

**Architecture:** content only, in three files. Lane L1 (in parallel) ships the renderer that
reads `numbered: true` (already in `src/guide/types.ts`) and the CSS classes `.guide-facts`,
`.guide-fact`, `.guide-glossary-grid`; this lane writes against those names. Nothing else changes.

**Tech stack:** TypeScript 5.9 (`strict`), React 19 JSX in `.tsx`, vitest 3 (the fences in
`src/guide/guideContent.test.ts`).

---

## Mechanics (read once)

- Worktree: `C:/Users/edyli/personal-finance-dashboard/.worktrees/guide-l2`, branch
  `guide/l2-content`, cut from `main` at or after `954aac3`; created by the lead with
  `node_modules`; work ONLY inside it, Git Bash, absolute paths.
- Commands: `npx vitest run src/guide` (fences + guide suites), `npx tsc -b`, `npx eslint src/guide`.
- Files this lane may edit: `src/guide/content/start.tsx`, `src/guide/content/routines.tsx`,
  `src/guide/content/reference.tsx`. Nothing else. The fact-grid and glossary-grid classes are
  L1's — use the names, do not add CSS.
- The current content (last night's, reviewed and fact-checked) is the source of truth for
  facts: **carry every sentence over**; restructure, do not rewrite. Where you must split a
  sentence to fit a step, keep its facts and labels.
- Commit after every task. Never push.

## Fence rules that bite here

- Every `**Label**` in `steps` and `watch` exists verbatim in non-test `src/**/*.ts(x)`; every
  `where` segment (split on ` → ` and ` · `) is a nav label, a tab label or UI text; steps ≤ 160
  characters; ids unique kebab-case; a card with `to` on a sidebar route shows 3–8 visible tasks
  (the setup and tax-season cards have no `to`, so their 18 and 8 tasks are fine); pointer tasks
  have one step and a real destination.
- `body` prose is not fenced — verify its bold labels by hand.
- The checklist tasks are excluded from the palette by L1 (`numbered` cards), so their titles may
  echo page tasks without producing duplicate palette hits.

---

## Task 1 — `start-setup` becomes an 18-step numbered rail (spec §5.1)

**Files:** Modify `src/guide/content/start.tsx`.

- [ ] **Step 1: Read the current card** — the `start-setup` card's `body` is an `<ol>` of 18
`<li>`s, each with a `<Link>`, bold labels and an explanation. Copy each item's facts into a task.

- [ ] **Step 2: Replace `body` with `tasks`**

Set `numbered: true`, delete `body`, and write `tasks` in this shape (draft titles/where/to below;
the `steps` carry the current `<li>` text, split into ≤ 160-character sentences; the `watch` line
carries the dependency where the order matters):

```tsx
    numbered: true,
    keywords: ['setup', 'checklist', 'first time', 'getting started'],
    tasks: [
      {
        id: 'setup-appearance',
        title: 'Pick a theme and a landing page',
        where: 'Settings → Account → Appearance',
        steps: ['Choose **Theme**, **Density** and **Landing page**.', 'Works before any data exists.'],
        to: '/settings?section=account#appearance',
      },
      {
        id: 'setup-password',
        title: 'Change the password',
        where: 'Settings → Account → Password',
        steps: ['Replace the seeded password before this server is reachable from anywhere else.'],
        to: '/settings?section=account#password',
      },
      {
        id: 'setup-household',
        title: 'Add the household',
        where: 'Settings → Household → Household',
        steps: [
          'Press **Add member** for each person.',
          'Type the **Marriage date** if you are married — it marks the net-worth trend and nothing else; filing status is chosen per year on Taxes.',
          'Adding a person backfills nothing: their accounts and balances start where you enter them.',
        ],
        to: '/settings?section=household#household',
      },
      {
        id: 'setup-accounts',
        title: 'Add the accounts',
        where: 'Settings → Household → Accounts',
        steps: [
          'Add every account with its **Group** and **Owner**; leave **Owner** empty for a joint one.',
          'Liabilities are entered as negative numbers.',
          'Until one account exists the monthly wizard cannot leave Balances.',
        ],
        to: '/settings?section=household#accounts',
        watch: ['Depends on 3 · Add the household — a person before the things they own.'],
      },
      {
        id: 'setup-categories',
        title: 'Add spending categories and their kinds',
        where: 'Settings → Household → Spending categories',
        steps: [
          'Add each category and set its kind — **Living**, **Tax** or **Transfer** — before you enter months.',
          'Changing a kind later recomputes every month, chart and projection.',
        ],
        to: '/settings?section=household#categories',
      },
      {
        id: 'setup-import',
        title: 'Import the workbook',
        where: 'Settings → Data → Import workbook',
        steps: ['If you have the workbook: **Dry run**, read the diff, then **Apply import**.', 'Do it before typing tax years the workbook covers.'],
        to: '/settings?section=data#import',
        watch: ['Depends on 4 and 5 — the importer keys on account and category slugs.'],
      },
      {
        id: 'setup-first-month',
        title: 'Enter the first month',
        where: 'Monthly update',
        steps: [
          'Balances → Spending → Review → **Save progress**.',
          'Tick the confirmations and press **Save and close month**.',
          'The full routine is the Routines chapter\u2019s first card.',
        ],
        to: '/update',
        watch: ['Depends on 4 · Add the accounts — the wizard needs at least one.'],
      },
      {
        id: 'setup-prices',
        title: 'Set the price refresh',
        where: 'Settings → Integrations → Price refresh',
        steps: ['Type a five-field cron in day names and press **Save schedule**.', 'Press **Refresh now** for the first prices.'],
        to: '/settings?section=integrations#price-refresh',
        watch: ['Keep Mondays covered — the Monday run records the weekly performance point.'],
      },
      {
        id: 'setup-portfolio',
        title: 'Fill the portfolio',
        where: 'Portfolio → Manage',
        steps: [
          'Add the securities the import did not carry — tick manual pricing for a private asset — and their dated transactions.',
          'Then open **Allocation** for classifications and targets.',
        ],
        to: '/portfolio?section=manage',
      },
      {
        id: 'setup-limits',
        title: 'Enter limits and plan assumptions',
        where: 'Settings → Planning',
        steps: [
          '**Contribution limits** for this year, then **Save limits**.',
          '**Plan assumptions** — withdrawal rate, ESPP ticker and discount.',
        ],
        to: '/settings?section=planning#limits',
      },
      {
        id: 'setup-taxes',
        title: 'Create the tax year',
        where: 'Taxes',
        steps: ['**New tax year…**, **Filing status**, the tables, the inputs.', 'The yearly version is Tax season, once a year in Routines.'],
        to: '/taxes',
        watch: ['Depends on 6 · Import the workbook if you have one — the sheet wins inside the years it covers.'],
      },
      {
        id: 'setup-paycheck',
        title: 'Add paycheck profiles',
        where: 'Paycheck → Profiles',
        steps: ['One profile per person: salary, pay periods, contribution percentages, HSA, employer match, and the optional **Withholding split (optional)**.'],
        to: '/paycheck?section=profiles',
      },
      {
        id: 'setup-comp-espp',
        title: 'Add grants and ESPP offerings',
        where: 'Comp → Manage · ESPP → Lots',
        steps: ['Comp → **Manage** for grants and focal history.', 'ESPP → **Lots** for offerings and lots.'],
        to: '/comp?section=manage',
      },
      {
        id: 'setup-cards',
        title: 'Add the credit cards',
        where: 'Credit cards → Manage',
        steps: ['Add the cards with their **Opened** dates, then their categories and multipliers.'],
        to: '/credit-cards?section=manage',
      },
      {
        id: 'setup-calendar',
        title: 'Set the calendar feed',
        where: 'Settings → Integrations → Calendar feed',
        steps: ['Set the **Monthly update reminder day**.', 'Press **New feed link** to subscribe a phone.'],
        to: '/settings?section=integrations#calendar',
      },
      {
        id: 'setup-snapshot',
        title: 'Take a snapshot',
        where: 'Settings → Data → Backups & snapshots',
        steps: ['Press **Snapshot now** once, then check the list gains a nightly entry.'],
        to: '/settings?section=data#backups',
      },
      {
        id: 'setup-budgets',
        title: 'Seed budgets',
        where: 'Spending → Budgets',
        steps: ['After three complete months, press **Start from my averages**.'],
        to: '/spending?section=budgets',
        watch: ['Depends on 7 · Enter the first month — three complete months, closed.'],
      },
      {
        id: 'setup-assistant',
        title: 'Turn on the assistant',
        where: 'Settings → Integrations → Assistant',
        steps: ['Optional, and last because everything above feeds it: paste an **NVIDIA API key** and press **Save assistant settings**.'],
        to: '/settings?section=integrations#assistant',
      },
    ],
```

Reconcile every step with the current `<li>` text (the draft above paraphrases it — the current
sentences win). Where a where-segment is not UI text (e.g. `Comp → Manage · ESPP → Lots` splits
into `Comp`, `Manage`, `ESPP`, `Lots` — all nav or tab labels), keep it; otherwise use a path
that is. Drop the `Link` import from `start.tsx` if nothing else in the file uses it.

- [ ] **Step 3: Fences** — `npx vitest run src/guide && npx tsc -b && npx eslint src/guide` → PASS.
A failing label names the task and label: fix the label to the verbatim UI text.

- [ ] **Step 4: Commit** — `git add src/guide/content/start.tsx && git commit -m "content(guide): the setup checklist is an 18-step numbered rail (polish spec §5.1)"`

---

## Task 2 — fact grids in Start here (spec §5.3)

**Files:** Modify `src/guide/content/start.tsx`.

- [ ] **Step 1: `start-organized`** — replace its `body` (five-bullet list + six paragraphs) with a
fact grid carrying the same sentences and bold labels:

```tsx
    body: (
      <div className="guide-facts">
        <div className="guide-fact">
          <h4>The sidebar</h4>
          <p>… (the current five bullets, condensed into two or three sentences with the same bold labels) …</p>
        </div>
        <div className="guide-fact"><h4>Views</h4><p>… (the "Most pages have tabs" paragraph) …</p></div>
        <div className="guide-fact"><h4>The scope row</h4><p>… (Whose · All · 1Y · YTD · the ribbon) …</p></div>
        <div className="guide-fact"><h4>The command palette</h4><p>… (Ctrl K) …</p></div>
        <div className="guide-fact"><h4>ⓘ and About this number</h4><p>…</p></div>
        <div className="guide-fact"><h4>The assistant</h4><p>…</p></div>
        <div className="guide-fact"><h4>Toasts and Undo</h4><p>…</p></div>
        <div className="guide-fact"><h4>The footer</h4><p>…</p></div>
      </div>
    ),
```

Each `<p>` is the current paragraph verbatim (with its `<b className="guide-label">` and `<Link>`s).

- [ ] **Step 2: `start-next`** — replace its `body` list with four `.guide-fact` tiles (Every month ·
Every year · Whenever · When a number looks wrong), each `<p>` the current bullet verbatim.

- [ ] **Step 3: Fences** — `npx vitest run src/guide && npx tsc -b && npx eslint src/guide` → PASS.

- [ ] **Step 4: Commit** — `git add src/guide/content/start.tsx && git commit -m "content(guide): Start here prose in two-column fact grids (polish spec §5.3)"`

---

## Task 3 — `routine-tax-season` becomes an 8-step numbered rail (spec §5.2)

**Files:** Modify `src/guide/content/routines.tsx`.

- [ ] **Step 1: Replace the `body` list with tasks** (`numbered: true`; the three card `watch`
lines stay). Draft — reconcile with the current list's sentences:

```tsx
    numbered: true,
    tasks: [
      { id: 'season-new-year', title: 'Create the year', where: 'Taxes → New tax year…', steps: ['Press **New tax year…**, type the year, press **Create year**.', 'The newest year that has tables is cloned.'], to: '/taxes' },
      { id: 'season-status', title: 'Set the filing status', where: 'Taxes → Filing status', steps: ['Pick the status in the scope row — every year starts Single.'], to: '/taxes' },
      { id: 'season-tables', title: 'Enter the tables', where: 'Taxes → Tax tables', steps: ['For that status, enter or refresh Federal, State, Medicare, Social Security, Disability and Capital gains.', 'Rates as percents; thresholds ascending from 0; at most twelve rows.'], to: '/taxes?section=tables' },
      { id: 'season-clone', title: 'Clone for a married year', where: 'Taxes → Tax tables', steps: ['On the status tab press **Clone from** the single tables, then edit the tables badged review thresholds.', 'Social Security and Disability copy verbatim — they are per worker.'], to: '/taxes?section=tables' },
      { id: 'season-per-person', title: 'Add a per-worker table', where: 'Taxes → Tax tables', steps: ['For an earner on a different plan, press **Add a table for** that person under Social Security or Disability.'], to: '/taxes?section=tables' },
      { id: 'season-inputs', title: 'Enter the inputs', where: 'Taxes → Inputs', steps: ['Type the year\u2019s line items; grey derived rows compute themselves.', 'An **Apply** chip fills a box with its suggestion — last year\u2019s figure, or a formula\u2019s.', 'Press **Save inputs**.'], to: '/taxes?section=inputs' },
      { id: 'season-limits', title: 'Enter this year\u2019s limits', where: 'Settings → Planning → Contribution limits', steps: ['Pick the year and type the published amounts, or **Clone from** last year.', 'The Paycheck pace meters and the sandbox presets need them.'], to: '/settings?section=planning#limits' },
      { id: 'season-owe', title: 'Watch Will I owe? through the year', where: 'Taxes → Summary → Will I owe?', steps: ['The **Apply** chip writes this year\u2019s vest income into the W-2 inputs.', 'The remedy line gives the W-4 line 4(c) and DE 4 figure.'], to: '/taxes' },
    ],
```

Keep the card's `purpose`, `keywords` and `watch`; drop `body`. If `Link` becomes unused in
`routines.tsx`, drop the import.

- [ ] **Step 2: Fences** → PASS.
- [ ] **Step 3: Commit** — `git add src/guide/content/routines.tsx && git commit -m "content(guide): tax season is an 8-step numbered rail (polish spec §5.2)"`

---

## Task 4 — Reference: fact grids and the glossary grid (spec §5.3–5.4)

**Files:** Modify `src/guide/content/reference.tsx`.

- [ ] **Step 1:** `ref-undo`, `ref-sandboxes`, `ref-links` — replace each `body` `<ul className="guide-body">`
with `<div className="guide-facts">` of `.guide-fact` tiles; the bullet's bold lead becomes the
`<h4>` (e.g. "The toast", "The Activity log", "Snapshots", "Typed confirmations", "Never undone")
and the rest of the bullet the `<p>`, verbatim.
- [ ] **Step 2:** `ref-glossary` — add the class: `<dl className="guide-body guide-glossary guide-glossary-grid">`.
- [ ] **Step 3: Fences** → PASS.
- [ ] **Step 4: Commit** — `git add src/guide/content/reference.tsx && git commit -m "content(guide): Reference prose in fact grids; glossary as a term | definition grid (polish spec §5.3–5.4)"`

---

## Task 5 — gates and hand-off

- [ ] **Step 1: Full gates** — `npx tsc -b && npx eslint . && npx vitest run && npm run build`.
  The GuideCard/GuidePage suites on this branch are last night's (L1 replaces them); they must
  still pass against the restructured content.
- [ ] **Step 2: Results** — append `## Results (implementer, <date>)`: commits, gate counts, every
  sentence you changed beyond restructuring (should be none) and why, hand-offs to V (e.g. the
  `.guide-facts` tiles needing a tweak once seen in the browser).

## Self-review (done while writing)

- Spec §5.1 → Task 1; §5.3 (start) → Task 2; §5.2 → Task 3; §5.3 (reference) + §5.4 → Task 4.
- Ids new and unique (`setup-*`, `season-*`); no cross-lane guide anchors introduced; every `to`
  is a real route/view/Settings card the fences accept.

---

## Results (implementer, 2026-09-15)

**Status: complete.** Four content commits on `guide/l2-content`, all four tasks done, full gates
green. Nothing outside the three content files and this Results section was touched; never pushed.

### Commits

| Commit | What |
| --- | --- |
| `5b16b99` | `content(guide): the setup checklist is an 18-step numbered rail (polish spec §5.1)` |
| `2bb3b96` | `content(guide): Start here prose in two-column fact grids (polish spec §5.3)` |
| `335e24d` | `content(guide): tax season is an 8-step numbered rail (polish spec §5.2)` |
| `328a852` | `content(guide): Reference prose in fact grids; glossary as a term \| definition grid (polish spec §5.3–5.4)` |

### Gates

- Per task: `npx vitest run src/guide` → 5 files / 23 tests passed; `npx tsc -b` clean; `npx eslint src/guide` clean.
- Final: `npx tsc -b` clean · `npx eslint .` 0 errors, 25 warnings (all pre-existing
  `react-refresh/only-export-components`; none in `src/guide`) · `npx vitest run` **232 files /
  3108 tests passed** · `npm run build` ✓ built in 8.9 s.
- Also run on purpose: `npx vitest run src/components/paletteRegistry.test.ts` (11 passed) — it
  pins "add a card" against the **real** guide, and this lane adds 26 task entries to the palette
  (L1 excludes `numbered` cards later). "Add the credit cards" does not outrank `guide:cards-add`.

### Structure delivered

- `start-setup`: `numbered: true`, `body` dropped, 18 tasks `setup-appearance` → `setup-assistant`,
  card `keywords` added. Four dependency `watch` lines (spec §5.1): on `setup-accounts` (people
  before accounts), two on `setup-first-month` (accounts, and kinds before months), on `setup-taxes`
  (import before UI tax edits), on `setup-budgets` (three complete months); plus the Monday trap on
  `setup-prices`.
- `routine-tax-season`: `numbered: true`, `body` dropped, 8 tasks `season-new-year` → `season-owe`;
  `purpose`, `keywords` and the three card `watch` lines untouched.
- Fact grids: `start-organized` (8 tiles), `start-next` (4), `ref-undo` (5), `ref-sandboxes` (5),
  `ref-links` (4). Glossary `<dl>` gained `guide-glossary-grid`. `start-what`, `ref-settings-map`
  and the Settings-map table untouched, as specified.

### Deviations from the plan's drafts (the current sentences won, per the brief)

1. **`setup-import` has no `watch`.** The plan drafted "Depends on 4 and 5 — the importer keys on
   account and category slugs." Read `backend/app/importer/apply.py`: it matches existing accounts
   by slug and **creates** the ones it does not find, so the import does not depend on tasks 4–5.
   The ordering fact last night's content really states ("Do it before typing tax years the
   workbook covers.") is kept as the task's second step.
2. **`setup-taxes` watch** = "Depends on 6 · Import the workbook — do it before typing tax years the
   workbook covers." (the current sentence), not the plan's "the sheet wins inside the years it
   covers" — that claim is nowhere in the reviewed content.
3. **`setup-first-month` carries two watch lines** (accounts, and "set the kinds before you enter
   months") so the spec's "kinds before months" dependency is stated somewhere; the plan drafted
   only the accounts one.
4. **`setup-budgets` watch** ends "only a closed month counts toward the averages" — the wording
   `routine-monthly`'s card watch already uses — rather than the plan's "three complete months,
   closed".
5. **`season-status`** keeps "the status this year is filed as" and drops the plan's "every year
   starts Single": that is not in last night's content and I could not verify it.
6. **`season-limits`** drops the plan's "The Paycheck pace meters and the sandbox presets need
   them." — same reason.
7. **`setup-paycheck`** uses **Withholding split** (the label the current content and the UI carry),
   not the plan's "Withholding split (optional)".
8. **`setup-portfolio`**, **`setup-cards`**, **`setup-snapshot`**, **`setup-categories`** keep the
   current fragment openings ("The securities the import did not carry…", "The cards with their
   **Opened** dates…") instead of the plan's re-verbed drafts, so the sentences stay as reviewed.

### Sentences split or reworded (facts and labels intact)

- Split into one sentence per step: `setup-accounts` (liabilities · "cannot leave **Balances**"),
  `setup-prices`, `setup-limits`, `setup-calendar`, `setup-paycheck`, `setup-assistant`,
  `season-new-year`, `season-clone`, `season-inputs`, `season-owe`.
- A step cannot carry a `<Link>`, so four in-prose links became prose or a bold label:
  `#routine-monthly` → "The full routine is the Routines chapter's first card.";
  `/portfolio?section=allocation` → **Allocation** (task `to` stays `…?section=manage`);
  `#plan-assumptions` → **Plan assumptions** (task `to` is `#limits`);
  `/espp?section=lots` → **Lots** (task `to` is `/comp?section=manage`);
  `#routine-tax-season` → "…in the Routines chapter". `season-owe`'s Summary link became its `to`.
- `start-next` tiles: the bold lead became the `<h4>`, so each sentence now starts at what used to
  be mid-sentence — "tax season" → "Tax season", "the monthly update" → "The … monthly update".
  No other word changed.
- `start-organized`'s first tile keeps **all five** sidebar bullets verbatim as five sentences in
  one paragraph; the plan suggested condensing them to two or three, which would have rewritten
  reviewed copy.
- `ref-sandboxes` and `ref-links` bullets had no bold lead, so their tiles needed new headings:
  "The three sandboxes", "The scenario rides in the address", "Pinning", "Resetting", "The doors
  out"; "The view and the month", "Whose figures and the window", "Settings cards and scenarios",
  "Back and Forward". The bullet text under each is unchanged.

### Hand-offs for lane V

- **Nothing here looks right until L1 merges.** `.guide-facts`, `.guide-fact` and
  `.guide-glossary-grid` are L1's CSS and `numbered` is L1's renderer; on this branch alone the
  tiles render as plain `div`/`h4`/`p` and the two rails render as ordinary task lists (last
  night's `GuideTaskList`). Eyeball only after the merge.
- **Eyeball first at 1440 px:** `start-organized`'s "The sidebar" tile is by far the tallest (five
  sentences) — check it does not leave a hole beside it; the glossary's longest term ("Not started ·
  In progress · Ready to review · Reviewed · Changed since review · Not yet reviewed") sets the
  width of the term column; `ref-links` tiles are short, so four of them may look sparse.
- **26 new ids** for the probe/palette: `setup-appearance`, `setup-password`, `setup-household`,
  `setup-accounts`, `setup-categories`, `setup-import`, `setup-first-month`, `setup-prices`,
  `setup-portfolio`, `setup-limits`, `setup-taxes`, `setup-paycheck`, `setup-comp-espp`,
  `setup-cards`, `setup-calendar`, `setup-snapshot`, `setup-budgets`, `setup-assistant`;
  `season-new-year`, `season-status`, `season-tables`, `season-clone`, `season-per-person`,
  `season-inputs`, `season-limits`, `season-owe`. Both cards have no `to`, so the 3–8-task fence
  does not apply to their 18 and 8.
- **Palette:** until L1 excludes `numbered` cards, those 26 are Guide entries. `paletteRegistry`'s
  "add a card" pin is green with them in; if L1's exclusion lands, that suite stays green either way.
- **Probe link walk:** Start here now renders fewer in-card links (the four listed above became
  task `to`s or prose), and 26 new `Go →` destinations appear instead — all fenced, all sidebar
  routes. `/portfolio?section=allocation` and `/espp?section=lots` are no longer linked from the
  checklist; both are still reachable from the Pages chapter.
- Plan checkboxes above were left unticked on purpose: the brief scoped this lane's edits to the
  three content files and this Results section.
