# Lane V — integration, verification and hand-off (2026-09-11) — plan

> Run by the orchestrator after lanes A–D are merged to local main. Spec §5. Nothing here is pushed.

## Merge order

1. Lane A → main (fast-forward or merge commit). Lane B → main (rebase onto A's main first; resolve
   `src/types/api.ts` / `src/api/taxes.ts` overlaps if any).
2. Cut lanes C and D from that main. Lane C → main, then lane D → main (rebase first).
3. After every merge: `npx tsc -b`, `npx eslint .`, and the affected test files; the full suites once
   after step 2's merges.

## Integration checks (the contracts, end to end)

- [ ] Lane B's `previewTaxInputs` body/response matches lane A's `preview_inputs`; lane B's
  `formula` field is what lane A serializes.
- [ ] Lane D's `TaxBracketsOut.people/per_person` and `TaxBracketsUpdate.person_id` match lane C's
  schemas; `WageTaxOut.per_person` items carry `table: 'own' | 'default'`.
- [ ] Grep for leftovers: `rewrite_itemized_deduction`, `putTaxInputsForRepair`,
  `check_sec199a_in_itemized`, the old ten-key `SUGGESTION_KEYS`, `_bucket_input_rows` readers of
  money, `DELTA_KEYS` tuples with a total.

## Gates on merged main

- [ ] Backend: `ruff check app tests`, `ruff format --check app tests`, full pytest
  (`FINANCE_TEST_DB=finance_test_v`), counts recorded.
- [ ] Dev DB: `alembic upgrade head` against the dev `finance` DB (5433), then `alembic check` clean.
  Record the new head.
- [ ] Frontend: `npx eslint .`, `npx tsc -b`, `npm test`, `npm run build` (chunk size within the
  existing budget noted in the last batch).

## Browser smoke (real stack)

- [ ] Start `uvicorn app.main:app --port 8000` (scheduler off, the house flag) from `backend/` against
  the migrated dev DB and `npm run dev` (5173). Puppeteer/Playwright script under `scratchpad/`:
  1. Create scratch year 2099 as married_joint with the two dev people; clone brackets as MFJ.
  2. Inputs: type a partner `w2_bonuses` and watch `Other W2 Income` change before saving; Save;
     the echo keeps the figure.
  3. Brackets → Disability: `Add a table for <partner>`, set `1.3% from 0`, Save; the summary's
     Disability row grows two sub-rows with `own table` / `default`.
  4. Positional paste of a 3-value column into the partner's column keeps alignment (note text).
  5. Screenshots to `scratchpad/tax-smoke-2026-09-11/`; zero console/page errors.
  6. Delete the scratch year through the API (it is scratch data, not user data) — or leave it for
     the morning list if the delete route is considered human-flaggable.
- [ ] Stop the servers you started unless the user's morning list wants them up.

## Documentation and memory

- [ ] Spec `**Status:**` line → "implemented 2026-09-12 — lanes A–D merged to local main @<sha>";
  tick every plan checkbox that shipped; note deviations inline in the spec section they touch.
- [ ] Memory: update `payroll-taxes-per-person-2026-09-11.md` + `MEMORY.md` with the batch outcome,
  gates, dev-DB head, and the morning list.

## Morning list (human-flaggable, deferred — NOT run overnight)

- Remove worktrees `.worktrees/tax-{a,b,c,d}` and branches `tax/*` after the user confirms the merge.
- Drop scratch databases `finance_test_taxa`, `finance_test_taxc`, `finance_test_v`,
  `finance_test_taxa_mig`, `finance_test_taxc_mig`.
- Push + deploy decision (three migrations run at boot); then the user's three prod steps (spec §4).
