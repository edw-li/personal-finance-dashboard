# Lane V — integration, verification and hand-off (2026-09-11) — plan

> Run by the orchestrator after lanes A–D are merged to local main. Spec §5. Nothing here is pushed.

## Merge order

1. Lane A → main (fast-forward or merge commit). Lane B → main (rebase onto A's main first; resolve
   `src/types/api.ts` / `src/api/taxes.ts` overlaps if any).
2. Cut lanes C and D from that main. Lane C → main, then lane D → main (rebase first).
3. After every merge: `npx tsc -b`, `npx eslint .`, and the affected test files; the full suites once
   after step 2's merges.

## Integration checks (the contracts, end to end)

- [x] Lane B's `previewTaxInputs` body/response matches lane A's `preview_inputs`; lane B's
  `formula` field is what lane A serializes. (Lane A verified the merged types byte-for-byte; smoke: partner Other W2 Income moved $1,000 → $6,000 before Save, echo kept it.)
- [x] Lane D's `TaxBracketsOut.people/per_person` and `TaxBracketsUpdate.person_id` match lane C's
  schemas; `WageTaxOut.per_person` items carry `table: 'own' | 'default'`. (Lane C verified against the merged fixtures; smoke: per_person Me:default / Partner:own rendered as sub-rows.)
- [x] Grep for leftovers (only a historical comment in src/types/api.ts names the retired action): `rewrite_itemized_deduction`, `putTaxInputsForRepair`,
  `check_sec199a_in_itemized`, the old ten-key `SUGGESTION_KEYS`, `_bucket_input_rows` readers of
  money, `DELTA_KEYS` tuples with a total.

## Gates on merged main

- [x] Backend: `ruff check app tests` clean, `ruff format --check` clean (250 files), full pytest
  (`FINANCE_TEST_DB=finance_test_v`): **1971 passed, 1 skipped in 18:02**, exit 0 (log: `scratchpad/tax-smoke-2026-09-11/pytest-main-full.log`).
- [x] Dev DB: `alembic upgrade head` against the dev `finance` DB (5433), then `alembic check` clean.
  New head `d5f2b7c8e390` (c4a7e2b9d13f → b8e1c5f7a204 → d5f2b7c8e390); check: "No new upgrade operations detected."
- [x] Frontend: `npx eslint .` 0 errors (19 pre-existing warnings), `npx tsc -b` clean, `npm test` 2753 passed / 193 files, `npm run build` ok (tooltip chunk 748 kB unchanged).

## Browser smoke (real stack)

- [x] Start `uvicorn app.main:app --port 8000` (scheduler off, the house flag) from `backend/` against
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
- [x] Servers LEFT RUNNING (uvicorn 8000 scheduler-off + vite 5173) for the morning eyeball, house practice. Smoke: `scratchpad/tax-smoke-2026-09-11/{run_smoke.sh,ui_smoke.mjs}` → UI SMOKE OK, 6 screenshots; scratch year 2099 deleted via the API at teardown.

## Documentation and memory

- [x] Spec `**Status:**` line → implemented 2026-09-12 (lane shas inside); lane plans ticked by their lanes with as-built + review-round notes; spec amendments inline (§1.3 goldens, §1.4 feed.rows, §2.2 zero rule, §2.3 bundles/loader, §2.7 capped note).
- [x] Memory: `tax-batch-2026-09-11.md` + `MEMORY.md` carry the outcome, gates, dev-DB head and the morning list.

## Morning list (human-flaggable, deferred — NOT run overnight)

- Remove worktrees `.worktrees/tax-{a,b,c,d}` and branches `tax/*` after the user confirms the merge.
- Drop scratch databases `finance_test_taxa`, `finance_test_taxc`, `finance_test_v`,
  `finance_test_taxa_mig`, `finance_test_taxc_mig`.
- Push + deploy decision (three migrations run at boot); then the user's three prod steps (spec §4).
