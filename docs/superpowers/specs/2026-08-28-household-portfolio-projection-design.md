# Household Portfolio + Dual-Career Projection (P4) — Design Spec

**Date:** 2026-08-28
**Status:** Approved scope (user Q&A this session); spec pending user review. Plans get
written and committed, then the batch PAUSES for the user's go before implementation.
**Lineage:** P4 of the marriage-readiness phasing — audit
`2026-08-26-marriage-readiness-audit.md` §3.5/§3.6/§3.7; builds on the household foundation,
married taxes, and two-income-streams batches (all merged).

## 1. Context & Goals

Ownership now exists everywhere money is earned and taxed, but not where it is invested or
spent on cards, and the projection still models one career. This batch: (a) gives portfolio
positions real, owned accounts and per-owner views; (b) tags credit cards by owner and
quantifies the household-wallet advantage; (c) teaches the projection two retirement dates;
(d) person tags on custom calendar events.

## 2. Decision Log (user Q&A, 2026-08-28)

| Decision | Choice |
|---|---|
| Projection contributions | **Household stream + per-person retirement drops**: one derived contribution stream as today; at each person's retirement date it drops by that person's in-force monthly take-home. No per-person savings attribution (household-totals cashflow stands). |
| Portfolio depth | **Owner filters on holdings / allocation / dividends / transactions / realized only.** The weekly performance chart + contribution benchmark stay whole-household (one row per Monday by design). |
| Execution | Plans → pause for review → autonomous overnight on the user's go. |
| Standing conventions | Backfill everything existing to the primary person; nullable person_id = joint; owner param inclusive-of-joint for a person, `joint` = NULL-only, absent = household; app never ships user data; reality-wins over plan text; no pushes; deletions to the morning list. |

**Out of scope:** per-owner performance/benchmark series; the `account_id` bridge from
portfolio accounts to net-worth accounts (add when a reconciliation feature wants it);
case-folding historically distinct labels (morning-list note; backfill preserves exact
labels); comp/RSU/ESPP person-scoping (still parked until spouse equity exists); marriage
calculator / W-4 math (P5); authorized-user card strategy modeling.

## 3. Data model (three migrations, chained on head at implementation time)

1. **`portfolio_accounts`** — `id`, `label` String(80) UNIQUE NOT NULL, `person_id`
   nullable FK → people (NULL = joint). Backfill: one row per EXACT distinct label found in
   `position_transactions.account` ∪ `dividend_payments.account`, all owned by the primary
   person. Then `position_transactions.portfolio_account_id` + `dividend_payments.
   portfolio_account_id` NOT NULL FKs (backfilled by label join), and the two free-text
   `account` columns are dropped. **Wire compatibility is mandatory:** every response that
   carried `account: str` still carries the same label string (joined), and every request
   that accepted a free-text `account` still does — the router resolves label →
   portfolio_account with get-or-create (new labels default to the primary person). The
   dividend auto-ingest unique index moves to the FK column with identical semantics.
2. **`credit_cards.person_id`** — nullable FK → people (NULL = joint), backfilled to the
   primary person. `primary_holder`/`authorized_users` text columns stay (informational,
   e.g. the exact name embossed on the card) but `primary_holder` stops being the ownership
   vocabulary — `person_id` is.
3. **`custom_events.person_id`** — nullable FK → people (NULL = household), backfill NULL.

## 4. Backend design

### 4.1 Portfolio owner views
- `owner` query param (net-worth grammar: person id | `joint` | absent) on
  `GET /portfolio/holdings`, `/allocation`, `/dividends` (the list — the panel's analytics
  are client-side and inherit), `/realized`, and `/transactions`. Filtering happens once in `load_portfolio`/the dividend loaders by
  `portfolio_account_id` membership; every total in a filtered response is scope-consistent
  (holdings totals, realized totals, dividend analytics). Absent = today's behavior
  byte-identical.
- `GET /portfolio/accounts` (new, small): `[{id, label, person_id}]` +
  `PATCH /portfolio/accounts/{id}` accepting `{person_id}` only (labels immutable this
  batch — they are the positions' identity).
- Prices, securities, refresh, value history, benchmark: untouched (household-wide).

### 4.2 Credit cards
- Cards CRUD carries `person_id` (create/patch/out); the two verbatim full-object rebuilds
  in the archive/undo flows carry it too (the known silent-clear hazard).
- `rewardsMath.toMathCards` gains `ownerId`; `optimize()` gains an optional owner scope.
  New pure `householdAdvantage(cards, categories)`: household lineup net minus the best
  single-owner lineup net (joint cards count for BOTH single-owner wallets — either spouse
  can hold the card). Exposed as a tile: "Household wallet beats the best single wallet by
  $X/yr" (hidden when <2 owners hold cards, or when the delta is zero because one person
  owns everything).
- Page: owner chips (All / names / Joint) filtering `activeCards` — the roster, matrix,
  KPIs, value bars, and credit-line history all inherit; owner badge on matrix card
  headers.

### 4.3 Dual-career projection
- `GET /projection` gains optional `retire_month_<personId>`-style inputs — concretely:
  `retirements` as repeated query params `retire=<person_id>:<YYYY-MM>` (order-free,
  validated: known person, first-of-month, within the horizon). Response echoes
  `retirements: [{person_id, name, month, monthly_drop}]`.
- `monthly_drop` = that person's in-force paycheck profile `monthly_net` at request time
  (today's honest approximation, named in the hint). A person with no in-force profile
  contributes no drop (422 if a retirement is supplied for them — nothing to drop).
- Engine: `project()` and `simulate()` accept a sorted list of (month_index, drop_amount);
  the contribution stream decrements at each index (floor 0; contribution growth applies to
  the REMAINING stream). Deterministic + Monte Carlo use the same schedule so the fan
  matches the line. FI target math unchanged (spend-based). Back-compat: no `retire`
  params → byte-identical outputs (pinned against existing fixtures).
- UI: one retirement-month knob per person with an in-force profile (labeled by name;
  blank = works forever). Chart gains a dashed markLine per retirement (name label).
  Renders for single-person households too (one knob) — new capability, same grammar.

### 4.4 Calendar
- Custom-event form gains an optional person select (Household / names); chips and list
  rows carry `— <name>` when set (the payday-label grammar); ICS summary likewise.

## 5. Frontend design

- **PortfolioPage**: owner chips under the page header (RangeChips, gated >1 person),
  wired to every owner-filterable fetch; the performance card gains a one-line hint
  "always the whole household" when chips are active. Empty owned scope renders the
  existing empty states (no silent zeros — the tables/donut have real empty notes).
- **Settings → Accounts card**: gains a compact "Portfolio accounts" table (label
  read-only, owner select) driving the PATCH — the one place portfolio ownership is edited.
- **CreditCardsPage**: chips + delta tile + badges per §4.2.
- **ProjectionPage**: retirement knobs + markLines per §4.3.
- **CalendarPage**: person select on the event form; labeled chips.
- Types/clients extended accordingly (`src/api/portfolio.ts`, `creditCards.ts`,
  `projection.ts`, `calendar.ts`, `types/api.ts`).

## 6. Error handling & honesty

Owner-filtered portfolio responses keep their existing empty-state notes; the projection
422s a retirement for a profile-less person with the server's sentence rendered verbatim;
the household-advantage tile is absent rather than zero when it has nothing honest to say;
new transaction labels silently default to primary ownership and are re-taggable in
Settings (hint on the portfolio-accounts table says so).

## 7. Testing

Byte-identity pins: no-owner portfolio responses, no-retirement projection outputs
(deterministic + MC against existing fixtures), single-person pages (no chips), cards page
without owner data. New: migration backfill (labels → rows → FKs, dropped columns,
auto-ingest index semantics preserved — the (security, account, ex_date) uniqueness ports);
owner-filtered scope-consistency (totals match filtered rows); get-or-create on new labels;
portfolio-accounts PATCH; householdAdvantage math (joint-counts-for-both pinned; delta-zero
hidden); retirement drop math (drop at index, growth on remainder, floor 0, fan matches
line at p50 seed); calendar person labels; full suites + tsc/lint/build; real-data browser
smoke checklist at batch end (portfolio chips + settings table + cards delta + projection
markLines + calendar label).

## 8. Migration & compatibility

All additive except the two dropped free-text columns (data moved into the FK join —
downgrades restore them from the join). Importer: position/dividend apply resolves labels
through get-or-create (primary-owned) — pinned by an importer test; sheet re-imports keep
working with zero workbook changes. Alembic chain verified single-head; applied to the dev
DB at merge time with `alembic check`.

## 9. Plan breakdown (for writing-plans)

1. **Portfolio accounts backend** — migration 1 + wire-compat resolution + owner params +
   scope-consistent totals + portfolio-accounts CRUD + importer resolve + tests.
2. **Portfolio + Settings UI** — owner chips across the five panels, performance hint,
   Settings portfolio-accounts table. (Depends on 1.)
3. **Dual-career projection** — engine schedule, API params/echo, MC parity, knobs +
   markLines UI. (Independent.)
4. **Cards owners + household advantage + calendar tags + batch verification** —
   migrations 2-3, cards CRUD/UI/delta tile, calendar select/labels, full gates + browser
   smoke checklist. (Cards/calendar independent; verification last.)

Waves: {1 ∥ 3} → {2 ∥ 4} → verification.
