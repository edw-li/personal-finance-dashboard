# Lane G3 — Guide content: Income + Taxes pages (2026-09-14 guide) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (one
> Opus implementer for this lane in its own worktree, one card per task, the fences as the
> test, then a spec-compliance review — voice, facts, coverage — and a code-quality review,
> then a local merge to main — never pushed). Steps use `- [ ]` checkboxes.

**Spec:** `docs/superpowers/specs/2026-09-14-onboarding-guide-design.md` — this lane writes the
**Pages** chapter's Paycheck, Comp, ESPP and Taxes cards (§5.1) under the writing rules in
**§5.3**. Read §0, §4, §5 before Task 1. Source material:
`docs/superpowers/specs/2026-09-14-onboarding-guide-research.md` §5.3 P6–P9 and Appendix A.

**Goal:** four page cards covering the owner's asks for **managing paychecks, comp and ESPP**,
**adding vests and focal information**, **new ESPP subscription periods** and **calculating
taxes** — each with purpose, views, 3–8 visible tasks, the long tail behind *More*, ≤ 5 traps —
green under every fence.

**Architecture:** content only, in `src/guide/content/pages-income.tsx`. Lane G3 deletes
`/paycheck`, `/comp`, `/espp`, `/taxes` from `PENDING_PAGES`.

**Tech stack:** TypeScript 5.9 (`strict`), vitest 3 for the fences.

---

## Mechanics (read once)

- Worktree: `C:/Users/edyli/personal-finance-dashboard/.worktrees/guide-g3`, branch
  `guide/g3-income`, cut from `main` **after G0 has merged**:
  `git worktree add -b guide/g3-income .worktrees/guide-g3 main`; work ONLY inside it.
- Commands from the worktree root in Git Bash: `npx vitest run src/guide`, `npx tsc -b`,
  `npx eslint src/guide`.
- Files this lane may edit: `src/guide/content/pages-income.tsx`, `src/guide/content/pending.ts`
  (delete `'/paycheck'`, `'/comp'`, `'/espp'`, `'/taxes'` only). Nothing else.
- Commit after every task. Never push.

## Writing rules this plan encodes (spec §5.3)

Identical to lane G2's list; the ones that bite here:

1. Bold labels verbatim and verified against the Source lines
   (`grep -rnF -- "Label" src --include=*.tsx --include=*.ts | grep -v test`). Templated labels →
   angle-bracket placeholders (`**Clone from <year> single tables**` is fine; the fence exempts it).
   Preset chips live in `.ts` files: `Max 401(k)`, `Max HSA`, `Max ESPP`, `Stop ESPP`
   (`paycheckScenario.ts:271-311`), `Max 401(k)`, `Max HSA — <tier>`, `Sell all <TICKER>`,
   `Realize gains to the 15% ceiling` (`taxScenario.ts:238-304` — note **no space** before `%`).
2. `views` exactly: Paycheck `['Summary', 'Try changes', 'Profiles']`; Comp `['Summary', 'Vesting', 'Manage']`;
   ESPP `['Summary', 'Lots', 'Purchase model']`; Taxes `['Summary', 'What-if', 'Inputs', 'Tax tables']`.
3. Steps ≤ 160 characters; 3–8 visible tasks; ≤ 5 card traps; one trap per line.
4. Never "below"/"above" for another view; never restate an `InfoHint`; no personal data; pointer
   tasks link to real destinations.
5. Deep links: `?section=`, `?year=`, `?whatif=`, `?profile=`, `?lot=`, `?grant=`.

## Draft copy — paste, verify against Source, correct, run the fences, commit.

---

## Task 1 — Paycheck (spec §5.1 `page-paycheck`)

**Source:** `src/pages/PaycheckPage.tsx` — views `:1018`; scope (no All/Joint) `:1453, 1306-1363`;
profile form `:485-680, 718-882` (**Effective date**, **Annual salary**, **Pay periods per year**,
**Employer 401(k) match**, **Employer HSA contribution**, **Withholding split (optional)**,
**Add profile**); carry-forward `:388-404, 653-677`; **Edit**/**Save profile** `:607-651`;
**Delete** `:682-701`; pin a row `:1280-1290, 1365-1394`; **Show the current profile** `:993-1002`;
breakdown `:61-152`; household tile `:1401-1410, 1461-1486`; apply seed `:1093-1107, 1526-1541`;
`src/components/paycheck/TryItPanel.tsx:119-139, 163-186, 309-403` (**Per check**/**Monthly**/**Annual**,
**Save as profile effective <month>…**, **Reset to actual**); `paycheckScenario.ts:270-313`;
`PacePanel.tsx:13-63, 305-327`; `backend/app/api/paycheck.py:80-133, 168-250`.

- [ ] **Step 1: Write the card**

Replace the empty array in `src/guide/content/pages-income.tsx`:

```tsx
import type { GuideCard } from '../types'

// Chapter: Pages — the Income group and Taxes, sidebar order (2026-09-14 guide spec §5.1).
// Written by lane G3 from research §5.3 P6–P9; every bold label verified against source.
export const INCOME_CARDS: GuideCard[] = [
  {
    id: 'page-paycheck',
    title: 'Paycheck',
    purpose:
      'Each person\u2019s paycheck as the server computes it from a profile — the per-check breakdown, where it goes, contribution pace, and a sandbox to try changes.',
    to: '/paycheck',
    views: ['Summary', 'Try changes', 'Profiles'],
    keywords: ['paycheck', 'salary', 'net pay', 'withholding', 'contributions', 'hsa', '401k'],
    tasks: [
      {
        id: 'paycheck-profile-add',
        title: 'Add a paycheck profile',
        where: 'Paycheck → Profiles → Profile history',
        steps: [
          'Fill **Effective date**, **Annual salary** and **Pay periods per year** — the form needs these three before anything else.',
          'Type the contribution percentages (Traditional, Roth and After-tax 401(k), ESPP), the withholding percent, dental and vision, HSA per check and its coverage.',
          'Open **Employer 401(k) match** and **Employer HSA contribution** for the employer side.',
          'Press **Add profile**.',
        ],
        to: '/paycheck?section=profiles',
        watch: ['Blank percent or money boxes save as a real zero — they were pre-filled from the previous row, so clearing one is a decision.'],
        keywords: ['new profile', 'set up paycheck', 'manage paycheck'],
      },
      {
        id: 'paycheck-profile-carry-forward',
        title: 'Record a raise or an election change',
        where: 'Paycheck → Profiles',
        steps: [
          'The form already holds the current profile with a blank date — change only what moved.',
          'Type the new **Effective date** and press **Add profile**; the old row stays as history.',
        ],
        to: '/paycheck?section=profiles',
        keywords: ['raise', 'new salary', 'election change', 'contribution change'],
      },
      {
        id: 'paycheck-person',
        title: 'Switch person',
        where: 'Paycheck → Whose',
        steps: [
          'Pick a person chip — a paycheck belongs to one person; there is no All or Joint here.',
          'The breakdown, flow, pace and profile history follow; a pinned profile is dropped when you switch.',
        ],
        to: '/paycheck',
        keywords: ['partner paycheck', 'person', 'whose paycheck'],
      },
      {
        id: 'paycheck-pin-profile',
        title: 'Look at a past profile',
        where: 'Paycheck → Profiles → Profile history',
        steps: [
          'Click a row\u2019s date chip — the breakdown, flow and pace switch to that profile.',
          'Press **Show the current profile** to return.',
        ],
        to: '/paycheck?section=profiles',
        keywords: ['history', 'old profile'],
      },
      {
        id: 'paycheck-try-it',
        title: 'Try a change without saving',
        where: 'Paycheck → Try changes',
        steps: [
          'Move a slider or type a salary — the server recomputes the check live; compare **Per check**, **Monthly** or **Annual**.',
          'Presets: **Max 401(k)**, **Max HSA**, **Max ESPP**, **Stop ESPP** — each needs this year\u2019s limit in Settings.',
          'Nothing is saved. **Reset to actual** clears the scenario; the address carries it, so **Copy link** shares it.',
        ],
        to: '/paycheck?section=changes',
        keywords: ['what if', 'sandbox', 'try changes', 'simulate paycheck'],
      },
      {
        id: 'paycheck-apply-scenario',
        title: 'Turn a scenario into a profile',
        where: 'Paycheck → Try changes',
        steps: [
          'Press **Save as profile effective** the coming month — the Profiles form is pre-filled and focused.',
          'Check it, then press the form\u2019s own **Add profile**; that is the only write.',
        ],
        to: '/paycheck?section=changes',
        keywords: ['apply scenario', 'save scenario'],
      },
      {
        id: 'paycheck-withholding-split',
        title: 'Enter the withholding split',
        where: 'Paycheck → Profiles → Withholding split (optional)',
        steps: [
          'From a paystub, type federal and state withholding as percents of taxable wages.',
          'Taxes → Will I owe? then splits its balance into Federal, California and Payroll tiles with separate remedies.',
        ],
        to: '/paycheck?section=profiles',
        watch: ['Blank here means not entered, not zero — the only boxes on this form that work that way.'],
        keywords: ['withholding split', 'federal withholding', 'state withholding'],
      },
      {
        id: 'paycheck-pace',
        title: 'Read the contribution pace meters',
        where: 'Paycheck → Summary → Contribution pace',
        steps: [
          'Each meter has a solid so-far segment and a dimmed projected run; hover or focus a bar for figures.',
          'A row with no limit entered draws no meter and says where to enter it.',
          'The ESPP row grades purchases falling in the calendar year — autumn checks count toward next year.',
        ],
        to: '/paycheck',
        keywords: ['pace', 'limit', 'on track', 'max out'],
      },
    ],
    more: [
      {
        id: 'paycheck-edit-delete',
        title: 'Edit or delete a profile',
        where: 'Paycheck → Profiles → Profile history',
        steps: ['**Edit** a row and **Save profile**; **Delete** asks once — the page falls back to the current profile.'],
        to: '/paycheck?section=profiles',
      },
      {
        id: 'paycheck-read-breakdown',
        title: 'Read the per-check breakdown',
        where: 'Paycheck → Summary',
        steps: [
          'Gross, each deduction and the net as the server computes them — the net is authoritative; lines are rounded for display.',
          'The employer match is printed apart — it never passes through the check.',
        ],
        to: '/paycheck',
      },
      {
        id: 'paycheck-household-tile',
        title: 'Read the household take-home tile',
        where: 'Paycheck → Summary',
        steps: ['Shown when two people both have a profile in force; it ignores the person chip and any pinned row.'],
        to: '/paycheck',
      },
      {
        id: 'paycheck-monthly-net-pointer',
        title: 'Enter actual monthly take-home',
        where: 'Monthly update → Spending',
        steps: ['Actual take-home per month is entered in the monthly update\u2019s spending step — this page\u2019s monthly net is a profile-based estimate.'],
        to: '/update?step=spending',
      },
    ],
    watch: [
      'A paycheck belongs to one person — the person chip has no All or Joint.',
      'The net figure is authoritative; the listed lines are rounded for display and can differ by a cent.',
      'Contribution percentages over 100 % are a warning, never an error — over-committed checks are modelled.',
    ],
  },
]
```

- [ ] **Step 2: Verify** — every bold label against the Source lines; `Contribution pace`,
`Profile history`, `Withholding split (optional)` exist as headings; the four preset labels in
`paycheckScenario.ts`; pay periods 1–366 and blank-equals-zero (`PaycheckPage.tsx:485-680`).

- [ ] **Step 3: Fences** — `npx vitest run src/guide && npx tsc -b && npx eslint src/guide`; delete
`'/paycheck'` from `PENDING_PAGES`.

- [ ] **Step 4: Commit**

```bash
git add src/guide/content/pages-income.tsx src/guide/content/pending.ts
git commit -m "content(guide): Pages — Paycheck (spec §5.1)"
```

---

## Task 2 — Comp (spec §5.1 `page-comp`)

**Source:** `src/pages/CompPage.tsx` — views `:520`; no owner `:643-647`; focal form `:216-345`;
delete event `:296-314`; **Columns** `:186-192, 442`; TC chart `:666-694`;
`src/components/comp/RsuGrantsPanel.tsx:16-64, 137-249, 293-446` (**Kind**, **New hire**/**Refresh**,
**Label**, **Grant focal year**, **Shares**, **Price at grant**, **First vest**, **Vest rounding**,
**Add grant**, **Save grant**, seed chips `:110-135, 309-336`, delete + Undo `:251-291`);
`VestingSchedulePanel.tsx:16-96, 109-151, 207-316`; `backend/app/api/comp.py:101-185, 275-313`.

- [ ] **Step 1: Append the card**

```tsx
  {
    id: 'page-comp',
    title: 'Comp',
    purpose:
      'RSU grants and their vesting schedule, focal-year history and the total-comp trajectory — one set for the household, not per person.',
    to: '/comp',
    views: ['Summary', 'Vesting', 'Manage'],
    keywords: ['comp', 'rsu', 'grant', 'vest', 'vesting', 'equity', 'focal', 'total comp'],
    tasks: [
      {
        id: 'comp-grant-add',
        title: 'Add an RSU grant',
        where: 'Comp → Manage → RSU grants',
        steps: [
          'Pick the **Kind** — **New hire** or **Refresh** — the cliff comes with it.',
          'Fill **Label**, **Grant focal year**, **Shares**, **Price at grant**, **First vest** and **Vest rounding**.',
          'Press **Add grant** — the schedule, the tiles and the calendar\u2019s vest events recompute from these parameters.',
        ],
        to: '/comp?section=manage',
        watch: ['There is no cliff box — a new-hire grant holds 25 % for a year then 6.25 % a quarter; a refresh starts at 6.25 % on its first date.'],
        keywords: ['add grant', 'add vest', 'new grant', 'rsu grant'],
      },
      {
        id: 'comp-grant-seed',
        title: 'Seed a grant from a focal year',
        where: 'Comp → Manage → RSU grants',
        steps: [
          'A focal-history row with refresh RSUs and no grant yet shows an **Add** chip naming the shares and price.',
          'Press it — the form fills; nothing is saved until **Add grant**.',
        ],
        to: '/comp?section=manage',
        keywords: ['seed grant', 'refresh grant'],
      },
      {
        id: 'comp-focal-add',
        title: 'Record a focal year',
        where: 'Comp → Manage → Focal history',
        steps: [
          'Fill **Focal year** and **Current base**, then **New base**, **Unvested RSUs** and their price, **Refresh RSUs** and the grant price.',
          'Press **Add**; per row, **Edit** or **Delete**.',
          'One row per focal year; a half-filled RSU and price pair warns but saves.',
        ],
        to: '/comp?section=manage',
        keywords: ['focal', 'annual review', 'base salary', 'comp event', 'focal information'],
      },
      {
        id: 'comp-vesting-read',
        title: 'Read the vesting schedule',
        where: 'Comp → Vesting → Vesting schedule',
        steps: [
          'One row per vest date — click a date to expand its per-grant tranches.',
          'Past dates use their own close; future dates use the latest quote and are marked est.',
          'The tiles above read next vest, unvested, and vested this year.',
        ],
        to: '/comp?section=vesting',
        keywords: ['vesting', 'schedule', 'next vest', 'unvested'],
      },
      {
        id: 'comp-grant-edit-delete',
        title: 'Edit or delete a grant',
        where: 'Comp → Manage → RSU grants',
        steps: [
          '**Edit** and **Save grant** — flipping the kind re-derives the cliff.',
          '**Delete** offers **Undo** in the toast; the schedule recomputes from the stored columns.',
        ],
        to: '/comp?section=manage',
      },
    ],
    more: [
      {
        id: 'comp-columns',
        title: 'Show entered or computed columns',
        where: 'Comp → Manage → Focal history',
        steps: ['Pick **Entered**, **Computed** or **All** under **Columns** — a view choice, not saved.'],
        to: '/comp?section=manage',
      },
      {
        id: 'comp-tc-read',
        title: 'Read the total-comp chart',
        where: 'Comp → Summary',
        steps: ['Base salary stacked under unvested equity value — the app\u2019s total-comp proxy; the line is the server\u2019s total.'],
        to: '/comp',
      },
    ],
    watch: [
      'Comp is not per person — there is no owner chip; grants and focal history are one set.',
      'Vests land on the third Wednesday; without an employer ticker in Settings → Plan assumptions the future half is unvalued.',
      'Workbook imports never touch grants — they are typed here.',
    ],
  },
```

- [ ] **Step 2: Verify** — the grant form labels (`RsuGrantsPanel.tsx:293-446`), `Focal history`
and `RSU grants` headings, `Columns`/`Entered`/`Computed`/`All` (`CompPage.tsx:442`), the
25 %/6.25 % cliff rule (`RsuGrantsPanel.tsx:16-64`), third Wednesday (`VestingSchedulePanel.tsx:16-96`).

- [ ] **Step 3: Fences**; delete `'/comp'` from `PENDING_PAGES`.

- [ ] **Step 4: Commit**

```bash
git add src/guide/content/pages-income.tsx src/guide/content/pending.ts
git commit -m "content(guide): Pages — Comp (spec §5.1)"
```

---

## Task 3 — ESPP (spec §5.1 `page-espp`)

**Source:** `src/pages/EsppPage.tsx` — views `:1277`; offerings form `:695-845` (**Offering start**,
**Subscription price**, **Offering notes**, **Add offering**, close chip **Use** `:772-784`,
**Edit**/**Delete** `:818-836`); lot form `:301-450` (**Purchase date**, **Qualifying date**,
**Shares**, **FMV**, **Purchase price**, **Sold date**, **Sold price**, **Add lot**, **Save lot**
`:405-423, 494-498`); **Model sale** `:539-543`; purchase model `:1069-1146, 1198-1265`
(**Save & recalculate**, **Reset**, **Base**, **Additional**, **Contrib %**); tiles
`src/components/espp/PositionStrip.tsx:49-127`; `LimitChainMeter.tsx:1-16`; `LotAnatomyCard.tsx:65-69`;
`EsppPriceCard.tsx:75-79`; `src/components/settings/PlanAssumptionsCard.tsx:120-214`;
`backend/app/api/espp.py:111-276`, `services/espp_calc.py:33, 383-440`.

- [ ] **Step 1: Append the card**

```tsx
  {
    id: 'page-espp',
    title: 'ESPP',
    purpose:
      'Offerings, purchase lots, sales and the $25,000 limit chain for the employee stock purchase plan — priced from the employer ticker set in Settings.',
    to: '/espp',
    views: ['Summary', 'Lots', 'Purchase model'],
    keywords: ['espp', 'offering', 'lots', 'purchase', 'discount', '25k limit'],
    tasks: [
      {
        id: 'espp-offering-add',
        title: 'Add an offering — a new subscription period',
        where: 'ESPP → Lots → Subscription offerings',
        steps: [
          'Type **Offering start** — the enrollment date — and the **Subscription price**; add **Offering notes** if useful.',
          'Press **Add offering**.',
          'Every purchase resolves to the latest offering starting on or before it, so a reset re-prices everything after it.',
        ],
        to: '/espp?section=lots',
        keywords: ['offering', 'subscription period', 'enrollment', 'new espp period', 'reset'],
      },
      {
        id: 'espp-close-chip',
        title: 'Use the close price for the start date',
        where: 'ESPP → Lots → Subscription offerings',
        steps: [
          'After typing the start date, a chip shows that day\u2019s close — press **Use** to fill the subscription price.',
          'The chip needs an employer ticker with stored prices up to that date.',
        ],
        to: '/espp?section=lots',
      },
      {
        id: 'espp-lot-add',
        title: 'Add a purchase lot',
        where: 'ESPP → Lots → Lots',
        steps: [
          'Type the **Purchase date** — the covering offering pre-fills the subscription price and **Qualifying date**.',
          'Type **Shares** and **FMV**; leave **Purchase price** blank to derive it from the plan discount.',
          'Press **Add lot**.',
        ],
        to: '/espp?section=lots',
        keywords: ['lot', 'purchase', 'espp buy', 'shares bought'],
      },
      {
        id: 'espp-lot-sold',
        title: 'Mark a lot sold',
        where: 'ESPP → Lots → Lots',
        steps: [
          'Press **Edit** on the lot; type **Sold date** and **Sold price** together; press **Save lot**.',
          'Clear both to un-sell it.',
          'A sold row is measured at its sale price; every other row at the live quote.',
        ],
        to: '/espp?section=lots',
        watch: ['Sold date and sold price travel together — half a pair is refused.'],
        keywords: ['sell espp', 'sold lot', 'disposition', 'sale'],
      },
      {
        id: 'espp-model-sale',
        title: 'Model selling a lot',
        where: 'ESPP → Lots → an unsold lot',
        steps: [
          'Press **Model sale** — Taxes opens in What-if with the lot as a sale leg.',
          'Sold lots have no link; a what-if sells the whole lot.',
        ],
        to: '/espp?section=lots',
        keywords: ['tax on espp sale', 'model sale'],
      },
      {
        id: 'espp-purchase-model',
        title: 'Model the year\u2019s purchases and the $25k limit',
        where: 'ESPP → Purchase model',
        steps: [
          'Pick the year chip.',
          'Leave the knobs blank to resolve from offerings and quotes, or type a **Subscription price**, FMV or carry-forward to override the year.',
          'Edit **Base**, **Additional** and **Contrib %** per period; press **Save & recalculate**.',
          'The limit meter draws one bar per period against $25,000; remaining is the server\u2019s figure.',
        ],
        to: '/espp?section=purchase',
        keywords: ['25k', 'limit', 'purchase model', 'contribution percent'],
      },
      {
        id: 'espp-plan-settings',
        title: 'Set the plan discount and ticker',
        where: 'Settings → Planning → Plan assumptions',
        steps: ['Type the **ESPP ticker** and **ESPP discount (%)** — the page needs both to price lots and derive purchase prices.'],
        to: '/settings?section=planning#plan-assumptions',
        keywords: ['espp discount', 'employer ticker'],
      },
    ],
    more: [
      {
        id: 'espp-offering-edit',
        title: 'Edit or delete an offering',
        where: 'ESPP → Lots → Subscription offerings',
        steps: ['**Edit** or **Delete** a row — the purchase model re-runs.'],
        to: '/espp?section=lots',
      },
      {
        id: 'espp-reset-period',
        title: 'Reset a stored period',
        where: 'ESPP → Purchase model',
        steps: ['Press **Reset** on a stored row to return it to derived values.'],
        to: '/espp?section=purchase',
      },
      {
        id: 'espp-read-charts',
        title: 'Read the lot anatomy and the price chart',
        where: 'ESPP → Summary',
        steps: [
          'Lot anatomy splits each purchase into what you paid, the bargain element at purchase and the market\u2019s move since; sold lots draw hollow.',
          'The price chart draws daily closes with the subscription price and your average paid; diamonds are purchases, triangles sales.',
        ],
        to: '/espp',
      },
    ],
    watch: [
      'Sold date and sold price must be set together — the server refuses half a pair.',
      'A capped purchase refunds the excess and carries nothing forward — the Refunded tile is that cash.',
      'No employer ticker in Settings → Plan assumptions means no market values on this page.',
    ],
  },
```

- [ ] **Step 2: Verify** — the offering and lot form labels (`EsppPage.tsx:301-450, 695-845`),
`Subscription offerings` and `Lots` headings, `Save & recalculate`, `Reset`, `Base`, `Additional`,
`Contrib %`, `Model sale`, `Use`; the offering-resolution rule (`EsppPage.tsx:695-845`); the
capped-purchase refund (`espp_calc.py:383-440`).

- [ ] **Step 3: Fences**; delete `'/espp'` from `PENDING_PAGES`.

- [ ] **Step 4: Commit**

```bash
git add src/guide/content/pages-income.tsx src/guide/content/pending.ts
git commit -m "content(guide): Pages — ESPP (spec §5.1)"
```

---

## Task 4 — Taxes (spec §5.1 `page-taxes`)

**Source:** `src/pages/TaxesPage.tsx` — views `:137`; scope row `:745-788`; **New tax year…** →
**Create year** `:590-651`; delete `:653-714`; **Filing status** `:443-469, 768-786`; apply overrides
`:517-565`; `src/components/taxes/TaxYearMenu.tsx:110-189`; `InputsForm.tsx:450-508, 650-841`
(**Save inputs**, Ctrl+Enter, **Apply** chips, derived rows `:719-780`); `BracketsEditor.tsx:184-209`
(rules), `:271-370` (status tab, **Clone from <year> single tables**), `:406-433, 555-642`
(**Add a table for <person>**, **Discard draft**, **Remove — use the default**), `:447-468` (empty
save deletes), **Add bracket**/**Save**; `SummaryPanel.tsx:59-124, 264-307` (**Open Tax tables**);
`MarginalPanel.tsx:25-110`; `WithholdingPanel.tsx:99-160, 262-295, 309-380, 383-611` (**How this is
estimated**, vest **Apply**); `WhatIfPanel.tsx:140-263, 306-349, 364-602, 625-836` (**Add sale**,
**Add ESPP sale**, **Add override**); `taxScenario.ts:232-305` (presets);
`src/sandbox/SandboxPanel.tsx:106-155` (**Pin this scenario**, **Copy link**);
`backend/app/api/taxes.py:955-983, 1221-1309, 2162-2260`.

- [ ] **Step 1: Append the card**

```tsx
  {
    id: 'page-taxes',
    title: 'Taxes',
    purpose:
      'The year\u2019s tax as the engine computes it from your inputs and bracket tables — totals, marginal rates, will-I-owe, and a what-if sandbox for sales and overrides.',
    to: '/taxes',
    views: ['Summary', 'What-if', 'Inputs', 'Tax tables'],
    keywords: ['taxes', 'tax', 'brackets', 'irs', 'refund', 'owe', 'filing', 'calculate taxes'],
    tasks: [
      {
        id: 'taxes-year-create',
        title: 'Create a tax year',
        where: 'Taxes → New tax year…',
        steps: [
          'Press **New tax year…** in the title row, type the year, press **Create year**.',
          'The newest year that has bracket tables is cloned into it.',
        ],
        to: '/taxes',
        keywords: ['new tax year', 'create year', 'next year'],
      },
      {
        id: 'taxes-filing-status',
        title: 'Set the filing status',
        where: 'Taxes → Filing status',
        steps: [
          'Pick Single, Married filing jointly or Married filing separately in the sticky row.',
          'The tables, the inputs columns and the summary reload for that status; every year starts Single.',
        ],
        to: '/taxes',
        watch: ['Married filing separately shows a permanent caveat — California is community property and income is not split.'],
        keywords: ['married', 'joint', 'single', 'filing status'],
      },
      {
        id: 'taxes-tables',
        title: 'Enter bracket tables',
        where: 'Taxes → Tax tables',
        steps: [
          'Pick the status tab, then a jurisdiction — Federal, State, Medicare, Social Security, Disability or Capital gains.',
          'Press **Add bracket** per row; type the rate as a percent and the threshold — the first threshold is 0, thresholds ascend, at most twelve rows.',
          'Press **Save** — each table saves on its own; saving an empty table deletes it after a confirm.',
        ],
        to: '/taxes?section=tables',
        keywords: ['brackets', 'bracket tables', 'rates', 'thresholds', 'ftb'],
      },
      {
        id: 'taxes-inputs',
        title: 'Enter the year\u2019s inputs',
        where: 'Taxes → Inputs → Tax inputs',
        steps: [
          'Type the line items under Ordinary income, Deductions and Capital gains; grey derived rows compute themselves.',
          'Press **Apply** on a chip to take last year\u2019s figure or a suggestion — nothing is saved until you save.',
          'Press **Save inputs** or Ctrl+Enter — only changed cells are written; a cleared box unsets its input.',
        ],
        to: '/taxes?section=inputs',
        keywords: ['inputs', 'w-2', 'deductions', 'line items', 'tax inputs'],
      },
      {
        id: 'taxes-will-i-owe',
        title: 'See whether you will owe',
        where: 'Taxes → Summary → Will I owe?',
        steps: [
          'Read projected tax, projected withholding and the balance for the current year.',
          'With a withholding split on the paycheck profile, Federal, California and Payroll tiles appear with W-4 4(c) and DE 4 remedies.',
          'Open **How this is estimated** for the safe-harbor sentences and the assumptions.',
        ],
        to: '/taxes',
        watch: ['A blank balance means the engine refused — missing tables — not that you are even.'],
        keywords: ['owe', 'refund', 'withholding', 'safe harbor', 'w-4', 'balance due'],
      },
      {
        id: 'taxes-whatif-sale',
        title: 'Model a stock sale',
        where: 'Taxes → What-if',
        steps: [
          'Press **Add sale**; pick the ticker, type shares and a price (blank means the latest quote), pick long or short.',
          'Or press **Add ESPP sale** and pick an unsold lot.',
          'Read the change in total tax and take-home, the per-jurisdiction bars and the compare table — nothing is stored.',
        ],
        to: '/taxes?section=whatif',
        watch: ['Basis is average cost and long or short is your call — imported transactions carry no dates.'],
        keywords: ['sell shares', 'capital gains', 'what if', 'sale', 'tax on sale'],
      },
      {
        id: 'taxes-whatif-override',
        title: 'Try a different input',
        where: 'Taxes → What-if',
        steps: [
          'Press **Add override**; pick an input and type a value — blank clears the input in the scenario.',
          'Preset chips: **Max 401(k)**, **Max HSA**, **Sell all** a holding, **Realize gains to the 15% ceiling** — a disabled chip says what to enter first.',
        ],
        to: '/taxes?section=whatif',
        keywords: ['override', 'max 401k', 'scenario', 'what if input'],
      },
      {
        id: 'taxes-whatif-apply',
        title: 'Apply overrides to the stored year',
        where: 'Taxes → What-if',
        steps: [
          'Press **Apply** for the overrides — a confirm lists each input before and after.',
          'Only overrides are written; sale legs stay hypothetical.',
        ],
        to: '/taxes?section=whatif',
        keywords: ['apply overrides', 'write scenario'],
      },
    ],
    more: [
      {
        id: 'taxes-tables-clone',
        title: 'Clone tables into a married status',
        where: 'Taxes → Tax tables → status tab',
        steps: [
          'On an empty non-Single tab press **Clone from** the single tables.',
          'Edit the tables badged review thresholds; Social Security and Disability copy verbatim.',
        ],
        to: '/taxes?section=tables',
        keywords: ['clone tables', 'married tables'],
      },
      {
        id: 'taxes-per-person-table',
        title: 'Add a per-person payroll table',
        where: 'Taxes → Tax tables → Social Security · Disability',
        steps: [
          'Press **Add a table for** the person; the draft seeds from the default rows.',
          'Edit and **Save**; **Discard draft** throws it away; **Remove — use the default** deletes a saved one.',
        ],
        to: '/taxes?section=tables',
        keywords: ['per person', 'social security table', 'disability table'],
      },
      {
        id: 'taxes-derived-rows',
        title: 'Understand derived rows',
        where: 'Taxes → Inputs',
        steps: ['A row badged derived is computed from its components and cannot be typed over — edit the components instead.'],
        to: '/taxes?section=inputs',
      },
      {
        id: 'taxes-apply-vest',
        title: 'Bring vest income into the inputs',
        where: 'Taxes → Summary → Will I owe?',
        steps: ['Press the **Apply** chip on the vest sentence — this year\u2019s vest income is written to the stock and RSU W-2 input.'],
        to: '/taxes',
      },
      {
        id: 'taxes-pin',
        title: 'Pin and share a scenario',
        where: 'Taxes → What-if',
        steps: [
          'Type a label and press **Pin this scenario** — up to three, kept in this browser, knobs only.',
          '**Copy link** shares the live scenario; pins are never part of a link.',
        ],
        to: '/taxes?section=whatif',
      },
      {
        id: 'taxes-delete-year',
        title: 'Delete a tax year',
        where: 'Taxes → New tax year…',
        steps: ['Open the year menu, press the delete entry, then confirm inside the popover — inputs and tables go together.'],
        to: '/taxes',
      },
      {
        id: 'taxes-marginal',
        title: 'Read the marginal ladder',
        where: 'Taxes → Summary → Marginal rates',
        steps: ['What the next $1,000 of ordinary income costs, federal plus state — computed in the browser, nothing saved.'],
        to: '/taxes',
      },
    ],
    watch: [
      'The tab under Tax tables picks which tables you edit — the year\u2019s filing status is the scope row\u2019s toggle.',
      'No tables for the year\u2019s status and every figure reads "—", not 0, with a door to Tax tables.',
      'Derived rows are read-only — the server refuses a write and names the components.',
      'ESPP ordinary income in the sandbox raises payroll wage bases — inherited from the sheet\u2019s structure.',
    ],
  },
]
```

- [ ] **Step 2: Verify** — every bold label against the Source lines, especially `New tax year…`
(the ellipsis character), `Create year`, `Add bracket`, `Clone from`, `Add a table for`,
`Discard draft`, `Remove — use the default`, `Add sale`, `Add ESPP sale`, `Add override`,
`Realize gains to the 15% ceiling` (no space before `%`), `How this is estimated`, `Pin this scenario`,
`Copy link`; headings `Tax inputs`, `Will I owe?`, `Marginal rates`; the twelve-row cap and
first-threshold-0 rule; the empty-table delete confirm.

- [ ] **Step 3: Fences**; delete `'/taxes'` from `PENDING_PAGES`.

- [ ] **Step 4: Commit**

```bash
git add src/guide/content/pages-income.tsx src/guide/content/pending.ts
git commit -m "content(guide): Pages — Taxes (spec §5.1)"
```

---

## Task 5 — gates and hand-off

- [ ] **Step 1: Full gates** — `npx tsc -b && npx eslint . && npx vitest run && npm run build`.
- [ ] **Step 2: Results** — append `## Results (implementer, <date>)`: commits, gate counts, every
label changed from the draft and why, deviations, hand-offs.

## Self-review (done while writing)

- Spec §5.1 required ids: Paycheck 8 ✓ (all visible); Comp 5 ✓; ESPP 7 ✓; Taxes 13 (8 visible +
  5 folded: `taxes-tables-clone`, `taxes-per-person-table`, `taxes-derived-rows`, `taxes-apply-vest`,
  `taxes-pin`) ✓.
- Required-coverage ids owned here: `paycheck-person`, `paycheck-profile-add`, `paycheck-try-it`,
  `comp-grant-add`, `comp-focal-add`, `espp-offering-add`, `espp-lot-add`, `espp-lot-sold`,
  `taxes-year-create`, `taxes-tables`, `taxes-inputs`, `taxes-will-i-owe`, `taxes-whatif-sale` ✓.
- Fences: `views` match; visible tasks 8/5/7/8; `watch` ≤ 5 (Taxes has 4); no cross-lane guide anchors.

---

## Results (implementer, 2026-09-14)

**Status: DONE.** Four page cards written into `src/guide/content/pages-income.tsx`;
`'/paycheck'`, `'/comp'`, `'/espp'`, `'/taxes'` deleted from `PENDING_PAGES`. No other file
touched. Nothing pushed.

### Commits (branch `guide/g3-income`, from `e0d289c`)

| Commit | Task |
| --- | --- |
| `0eed7e9` | content(guide): Pages — Paycheck (spec §5.1) |
| `3e62ffe` | content(guide): Pages — Comp (spec §5.1) |
| `b13cbbc` | content(guide): Pages — ESPP (spec §5.1) |
| `1dc21da` | content(guide): Pages — Taxes (spec §5.1) |

### Gates

Per card: `npx vitest run src/guide` → 5 files, 23 passed / 1 skipped (the §5.4 coverage
guard, still skipped: `PENDING_PAGES` holds nine routes for G1/G2/G4); `npx tsc -b` clean;
`npx eslint src/guide` clean.

Final full gates on `1dc21da`:

- `npx tsc -b` — clean.
- `npx eslint .` — 0 errors, 25 warnings (all pre-existing `react-refresh/only-export-components`,
  none under `src/guide`).
- `npx vitest run` — **231 files, 3093 passed, 1 skipped**.
- `npm run build` — built in 18.14s.

Shape: visible tasks 8 / 5 / 7 / 8; `watch` 4 / 4 / 3 / 4; `views` equal to each page's
`PAGE_SECTIONS` labels; every spec §5.1 required id present (Taxes 13 = 8 visible + 5 folded,
plus `taxes-delete-year` and `taxes-marginal`); no cross-lane `/guide#…` anchors.

### Labels and facts changed from the draft (source checked; draft wrong, or forbidden by §5.3)

**Wrong in the draft — corrected against source**

1. `comp-focal-add`: the focal form's buttons are **Add event** / **Save event**, not "Add"
   (`CompPage.tsx:420-422`). Row actions **Edit** / **Delete** kept.
2. `comp-focal-add`: "a half-filled RSU and price pair warns but saves" is **not true** —
   `_validated_event` (`backend/app/api/comp.py:117-155`) has no pair rule and nothing warns.
   Replaced with the real constraint: one row per focal year, a second is refused
   (`_require_free_focal_year`, `comp.py:175-185`). Also named **Unvested price** and
   **Grant price**, the form's own labels.
3. `espp-lot-add`: the lot form's field is **Subscription**, not "Subscription price" — the
   latter is the *offering* form's label (`EsppPage.tsx:371` vs `:733`).
4. `espp-close-chip`: the chip offers the last stored close **on or before** the typed date,
   not "that day's close" (`EsppPage.tsx:631-639`).
5. `espp-purchase-model`: the three year knobs are **Subscription price**, **Purchase FMV**
   and **Carry-forward** (`EsppPage.tsx:1104-1122`); the draft named only one.
6. `taxes-whatif-apply`: the button reads **Apply (n) overrides to (year)** — written with
   angle-bracket placeholders (`WhatIfPanel.tsx:595`), not a bare "Apply".
7. `taxes-apply-vest`: the chip writes **W2: Stock/RSUs Sold** for the **primary** person
   (`WithholdingPanel.tsx:628-636`) — the draft said "the stock and RSU W-2 input".
8. `comp-grant-edit-delete`: a grant **Delete** has no confirm at all — it is instant with an
   **Undo** toast (`RsuGrantsPanel.tsx:251-291`).
9. `paycheck-profile-add`: named the form's verbatim labels **Withholding %**,
   **Dental & vision**, **HSA**, **HSA coverage** (`PaycheckPage.tsx:229-235, 762-776`) in
   place of the draft's prose list ("HSA per check" is not a label).
10. `paycheck-withholding-split`: the tiles are **Federal balance**, **California balance**
    and **Payroll taxes** (`WithholdingPanel.tsx:437-462`).

**Where segments that would have failed the fence**

11. `espp-model-sale`: `'ESPP → Lots → an unsold lot'` → `'ESPP → Lots'` ("an unsold lot" is
    not UI text and is not exempt). `espp-lot-add` / `espp-lot-sold` likewise use
    `'ESPP → Lots'` rather than `'… → Lots → Lots'`.
12. `taxes-tables-clone`: `'Taxes → Tax tables → status tab'` → `'Taxes → Tax tables'`
    ("status tab" is not UI text).

**Rewritten because the draft restated on-screen copy (spec §5.3 rule 6)**

13. `paycheck-pace`: dropped "hover or focus a bar" and the ESPP calendar-year sentence —
    both verbatim `PacePanel` copy (`:314-319`). Replaced with "the ESPP row appears only
    once the profile contributes to ESPP" (`paycheckScenario.ts:296`).
14. `paycheck-read-breakdown` and the card watch: dropped the "net is authoritative, lines are
    display-rounded" line — the breakdown card prints it twice already
    (`PaycheckPage.tsx:92-101`). Kept the employer-match note, which is its own sentence.
15. `paycheck-household-tile`: rewritten — "it ignores the person chip and any pinned row" is
    the tile's own hint (`PaycheckPage.tsx:1486`).
16. `comp-grant-add` watch: the 25 %/6.25 % cliff sentence is printed verbatim on the panel
    (`RsuGrantsPanel.tsx:302-312`); replaced with its consequence (a wrong **Kind** re-times
    every vest).
17. `comp-vesting-read` and `comp-tc-read`: rewritten — the draft was the two ChartCard hints
    (`VestingSchedulePanel.tsx:229, 315-318`; `CompPage.tsx:668`).
18. `espp-offering-add` step 3 and `espp-read-charts`: rewritten — the draft was the offerings
    drill-hint (`EsppPage.tsx:709-713`) and the two Summary ChartCard hints
    (`LotAnatomyCard.tsx:67`, `EsppPriceCard.tsx:76`).
19. `taxes-year-create` step 2: the draft was the menu's `createHint` (`TaxesPage.tsx:809`).
20. `taxes-filing-status`: the draft was the scope row's InfoHint (`TaxesPage.tsx:783`); the
    MFS watch line now states the consequence rather than quoting the standing caveat
    (`TaxesPage.tsx:821-827`).
21. `taxes-whatif-sale` watch and `taxes-inputs`: reworded off the panels' drill-hints
    (`WhatIfPanel.tsx:604-609`, `InputsForm.tsx:632`).

**Traps added (verified, and nowhere on screen until you hit them)**

22. Card watch, Taxes: applying overrides is **refused** on a two-column year — a per-person
    input must be edited in Tax inputs (`TaxesPage.tsx:536-547`). This replaced the draft's
    "ESPP ordinary income raises payroll wage bases", which the What-if card already prints.
23. `espp-lot-add` watch: a purchase date no offering covers pre-fills **neither** box
    (`EsppPage.tsx:160-178`).
24. `espp-purchase-model` watch: edited cells do not reach the chain until saved
    (`EsppPage.tsx:1136-1143`).
25. Card watch, ESPP: a capped purchase refunds the leftover and carries **nothing** forward
    (`espp_calc.py:395-421`: `carry_next` is zero when `over_limit`).
26. Card watch, Comp: the drift note when a grant no longer matches its focal row
    (`comp.py:643-654`).
27. Undo/confirm honesty (spec §5.3 rule 4) on every destructive action: paycheck profile
    (confirm, no undo), focal row (confirm, no undo), grant (no confirm, undo), offering and
    lot (confirm, no undo), tax year (armed confirm, no undo).

### Deviations from the plan

- None structural: ids, `views`, counts and commit messages are the plan's. The copy differs
  wherever §5.3 or the source required it — every difference is itemised above.
- The plan's rule 5 lists `?year=`, `?whatif=`, `?profile=`, `?lot=`, `?grant=` deep links;
  none were used. Every task points at a view, never at one of the owner's rows, which also
  keeps personal data out (spec §1). `?section=`, `/update?step=spending` and
  `/settings?section=planning#plan-assumptions` are the only parameters used.

### Hand-offs

- **For G1/G2/G4 and lane V — `watch` lines are rendered as plain text.** `GuideCard.tsx:38`
  and `GuideTaskList.tsx:24` render `watch` entries directly, not through `renderSteps`, so a
  `**Label**` in a watch line would print literal asterisks (the label fence only reads
  `steps`, so it would not catch it). No watch line in `pages-income.tsx` uses `**`.
- **For G0's findings, confirmed here:** a page card's `to` must be the bare route, and
  `views` must equal `PAGE_SECTIONS` labels exactly — both held for all four pages.
- **For lane V:** `PENDING_PAGES` now holds `'/'`, `'/update'`, `'/net-worth'`, `'/portfolio'`,
  `'/spending'`, `'/credit-cards'`, `'/projection'`, `'/calendar'`, `'/settings'`. The §5.4
  coverage assertion stays skipped until those land.
- **For lane V's cross-chapter anchor pass:** the Taxes tasks G1's `routine-tax-season` card
  links to all exist with the spec's ids (`taxes-year-create`, `taxes-filing-status`,
  `taxes-tables`, `taxes-tables-clone`, `taxes-per-person-table`, `taxes-inputs`,
  `taxes-will-i-owe`, `taxes-apply-vest`), and `paycheck-person` is the canonical
  one-person-per-profile task for the ownership thread.
- **Product note, not fixed here:** the Paycheck pace row's "enter this year's limit" link
  goes to bare `/settings`, not to `/settings?section=planning#limits`, so it lands on the
  Household view. The guide step says "links to Settings" rather than naming a view.

### Review round (2026-09-14) — `2899eeb`

One commit, `src/guide/content/pages-income.tsx` only, every id unchanged. Gates after it:
`npx vitest run src/guide` → 5 files, 23 passed / 1 skipped; `npx tsc -b` clean;
`npx eslint src/guide` clean.

**Important 1 — `comp-grant-add` watch was factually wrong.** The kind does not move the first
vest date: `rsu_vesting.vest_dates` takes `first_vest_date` verbatim, and
`vest_count(cliff) = 1 + (1 − cliff) / 6.25 %` (`backend/app/services/rsu_vesting.py:26-42`), so a
new-hire grant filed as a refresh vests **6.25 % instead of 25 % on the date you typed** and runs
**three quarters longer** (16 tranches against 13). The watch line now says that; the draft's
"drops the first-year cliff and vests a year early" is gone.

**Important 2 — Paycheck card watch, the over-100 % rule.** A *single* box over 100 is refused
(`PaycheckPage.tsx:524, 543`); only the SUM of the four contribution percents warns and saves
(`backend/app/api/paycheck.py:114, 548-551` — withholding is excluded from that sum). Line now
reads "Percents that together exceed 100 % warn but save — one box over 100 is refused."

**Minor 3 — pointer wording.** `paycheck-monthly-net-pointer`'s one step now names the guide
card as spec §5.1 requires ("— see the Monthly update card in this guide") and bolds the
**Spending** step. The estimate caveat it used to carry moved to the task's own `watch`, which
keeps the pointer at exactly one step.

**Minor 4 — one verbatim label.** `**Save as profile effective <date>…**` in one piece
(`TryItPanel.tsx:315`), instead of splitting the label with prose.

**Voice (§5.3).** "simply" removed twice (`comp-tc-read`, `espp-offering-add`). Three
restatements of on-screen text rewritten to say HOW: `taxes-marginal` (the ladder needs this
year's Federal and State tables), the What-if long/short step (press the toggle to switch the
rate), and the ESPP sold-pair pair — its step now reads "To un-sell it, empty both boxes and
save again", and its watch carries a rule the form does not print (a sold lot loses its Model
sale link and cannot be a what-if leg). Six long steps tightened and the two three-action steps
split (`paycheck-try-it`, `taxes-per-person-table`, plus `espp-model-sale`, `taxes-tables-clone`,
`taxes-apply-vest`, `taxes-delete-year`): no step is now over 19 words. The Paycheck purpose is
23 words. Both Settings paths spell `Settings → Planning → Plan assumptions`.

No step is over 160 characters, no `watch` line uses `**` (they render as plain text), and the
task counts and `views` are untouched.
