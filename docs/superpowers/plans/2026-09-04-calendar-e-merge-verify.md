# Calendar E — Merge the lanes, swap the download, verify, smoke — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (this is a sequential integration checklist, not parallelizable work). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land Lanes B, C and D on local main in the order that keeps every merge a fast-forward or a trivially disjoint three-way, wire the one cross-lane seam that no lane could own (the Calendar page's "Add to calendar (.ics)" → Lane B's server download), run every suite and check, walk the page in a real browser against the dev database, and record the state for the morning.

**Architecture:** Plan A is already on main. B merges first (its only `api/calendar.py` change is an append at the file's end); D second (its `api/calendar.py` hunks are in region 1 and the `Sources(...)` call; if git reports a conflict it is because both lanes touched the import block — keep BOTH sets of imports); C last (frontend only, disjoint from B's Settings/palette files and D's credit-card files). Then one integration commit swaps the download call and its test. Phase 3 per spec §18.

**Tech Stack:** git, pytest, vitest, tsc, eslint, ruff, alembic, the headless-Edge smoke driver (puppeteer-core, `--no-save`).

**Prerequisites:** Plans A (merged), B, C, D each green on their own branch (`calendar-b`, `calendar-c`, `calendar-d`). Postgres up; the dev stack (uvicorn 8000 with `SCHEDULER_ENABLED=0`, vite 5173) for the smoke.

---

### Task 1: Merge B, D, C

- [x] **Step 1:** From the ROOT checkout on `main`: `git merge --no-ff calendar-b -m "Merge branch 'calendar-b' — ICS builder, token feed, Settings calendar card"`.
- [x] **Step 2:** `git merge --no-ff calendar-d -m "Merge branch 'calendar-d' — card, tax-amount, ESPP-contribution and dividend generators; source health; reset cadence UI"`. Conflict rule for `backend/app/api/calendar.py`: keep B's region 5 at the end AND D's region-1 edits; keep the union of both import blocks; re-run `ruff check` and `ruff format` on the file.
- [x] **Step 3:** `git merge --no-ff calendar-c -m "Merge branch 'calendar-c' — calendar page grammar: grid, drawer, strip, URL month, overrides, Up next"`. `src/types/api.ts` may report a conflict where B appended `FeedTokenOut` and D appended `CardCreditResetCadence`: keep both blocks.
- [x] **Step 4:** `git log --oneline -6` shows the three merges on top of Plan A's; `git status` clean.

---

### Task 2: Wire "Add to calendar (.ics)" onto the server renderer

**Files:**
- Modify: `src/pages/CalendarPage.tsx`, `src/pages/CalendarPage.test.tsx`

- [x] **Step 1: Failing test** — in `src/pages/CalendarPage.test.tsx` replace the `vi.mock('../utils/ics', …)` block and its `downloadIcs` import with:

```ts
vi.mock('../api/calendarFeed', () => ({ downloadCalendarIcs: vi.fn().mockResolvedValue(undefined) }))
import { downloadCalendarIcs } from '../api/calendarFeed'
```

and replace the export test with:

```ts
  it('exports the fetched window through the server renderer', async () => {
    renderPage()
    await screen.findAllByText(/RSU vest/)
    fireEvent.click(screen.getByRole('button', { name: 'Add to calendar (.ics)' }))
    const [start, end] = windowFor(MONTH)
    expect(downloadCalendarIcs).toHaveBeenCalledWith(start, end)
  })
```

Run `npx vitest run src/pages/CalendarPage.test.tsx` → that test FAILS (the page still calls `downloadIcs`).

- [x] **Step 2: Swap the action** — in `src/pages/CalendarPage.tsx` replace `import { downloadIcs } from '../utils/ics'` with `import { downloadCalendarIcs } from '../api/calendarFeed'`, and change the action's `onClick` to:

```tsx
            onClick={() => {
              const { start, end } = windowFor(month)
              downloadCalendarIcs(start, end).catch((err: unknown) =>
                toast.error(err instanceof ApiError ? err.message : 'Could not build the calendar file.'),
              )
            }}
```

(`disabled` stays `shown === null`; the server renders overrides and folded items the client file never had.) `src/utils/ics.ts` is now unimported — leave it (retire list).

- [x] **Step 3:** `npx vitest run src/pages/CalendarPage.test.tsx` → all passed. Commit:

```bash
git add src/pages/CalendarPage.tsx src/pages/CalendarPage.test.tsx
git commit -m "feat(calendar): Add to calendar (.ics) downloads the server-rendered window"
```

---

### Task 3: Whole-suite gates

- [x] **Backend** (from `backend/`): `FINANCE_TEST_DB=finance_test_cal_e .venv/Scripts/python.exe -m pytest -q && .venv/Scripts/python.exe -m ruff check app tests && .venv/Scripts/python.exe -m ruff format --check app tests && .venv/Scripts/python.exe -m alembic heads` — all green; exactly one head, `d4f6b8c0e2a5`.
- [x] **Frontend**: `npx tsc -b && npx eslint . && npx vitest run && npm run build` — clean; the build's chunk warning limit unchanged (no echarts added).
- [x] **Dev database**: `.venv/Scripts/python.exe -m alembic upgrade head` against the dev DB (adds the four revisions), then `.venv/Scripts/python.exe -m alembic check` → `No new upgrade operations detected.`
- [x] **Feed smoke (pytest, optional parser)**: `.venv/Scripts/python.exe -m pip install "icalendar>=6,<7"` (tests only; add `icalendar>=6,<7  # feed smoke parser` to `backend/requirements-dev.txt`), then append to `backend/tests/calendar/test_feed_api.py`:

```python
async def test_feed_parses_with_icalendar_and_revalidates(client, auth_client, monkeypatch):
    icalendar = __import__("pytest").importorskip("icalendar")
    freeze_today(monkeypatch)
    await auth_client.post(f"{CALENDAR}/events", json={"date": "2026-09-12", "label": "Car insurance", "amount": "180", "direction": "out"})
    _, plaintext = await make_token(auth_client)
    del client.headers["Authorization"]
    first = await client.get(f"{CALENDAR}/feed.ics?token={plaintext}")
    parsed = icalendar.Calendar.from_ical(first.content)
    summaries = [str(component.get("SUMMARY")) for component in parsed.walk("VEVENT")]
    assert "Car insurance · -$180.00" in summaries
    assert (await client.get(f"{CALENDAR}/feed.ics?token={plaintext}", headers={"If-None-Match": first.headers["etag"]})).status_code == 304
```

Run it: `FINANCE_TEST_DB=finance_test_cal_e .venv/Scripts/python.exe -m pytest tests/calendar/test_feed_api.py -q` → passed (not skipped — if it skips, the pip install did not land in the root venv). Commit: `git add backend/requirements-dev.txt backend/tests/calendar/test_feed_api.py && git commit -m "test(calendar): feed smoke — parse with icalendar, 304 on revalidation"`.

---

### Task 4: Browser smoke against the dev database

- [x] **Step 1:** Dev stack up. The lane runs its **own** pair beside the shared one —
  uvicorn on **8010**, vite on **5174** — so the walk is judged on this branch's build and
  not on whatever owns 5173. Token minted through `POST /auth/login` with the dev seed
  credentials rather than `create_access_token`, so `token_version` can never drift.
  Run recipe: `tools/probes/README.md`, "Running the calendar smoke".
- [x] **Step 2:** Written as **`tools/probes/calendar-e/smoke.mjs`** (tracked, beside the C7
  driver, per the convention that landed on main mid-lane) rather than as an untracked
  scratchpad file; playwright-core out of the npx cache, not puppeteer-core, and the token
  seeded into `localStorage` before first paint with `addInitScript`. It walks, in both
  themes, and adds a write pass the plan only implied (override, custom-event
  add/edit/delete/Undo, the .ics download, a live feed token) that undoes everything it
  writes:
  - `/calendar?month=2026-09` — assert `[role="grid"]` present, exactly one `[role="gridcell"][tabindex="0"]`, a `.cal-chip` on `[data-day="2026-09-16"]` whose text starts with `RSU vest` and contains `$` (one PRICED folded vest chip — prod carries four grants), a `.cal-chip` whose text starts with `Payday` (folded), at least one `.cal-more` button, click it → `[role="dialog"].cal-drawer` visible; `Escape` → focus back on the active gridcell; four `.stat-tile`s in `.cal-strip`; `.cal-health` lists eight sources; no console errors.
  - `/calendar?view=list` — the list card renders, the grid does not.
  - `/calendar?add=1&date=2026-09-20` — the form is open with the date prefilled; URL stripped to `/calendar`.
  - `/` — the Up next block shows amounts right-aligned and the "Next 45 days:" line.
  - `/settings#calendar` — the Calendar feed card is highlighted; create a link labelled `smoke`, copy its URL, fetch it with plain `fetch` (no bearer) → 200 `text/calendar`; revoke it → the same fetch 404s.
  - Timing: log `performance.now()` around the `/api/v1/calendar` request on `/calendar?month=2026-09` and print it — the spec's ~150 ms note (past it, the follow-up is the snapshot-cache family, not storage).
  - Screenshots under the session scratchpad `calendar-smoke/<route>.png`.
- [x] **Step 3:** Nothing in the app: the walk came back with **zero problems** in both
  themes, one recorded `knownBenign` (the deliberate 404 the revoked feed link answers).
  The three fixes it did ask for were the driver's own (fixed sleeps → polls on the app's
  signals, edit/delete driven through the list rather than the folding grid, and the
  all-default override row "Reopen" leaves behind now dropped through the API's DELETE).
  Timing: `GET /calendar` settles at **41–81 ms** on the calendar routes, well inside the
  spec's ~150 ms watch; the outliers are 2.2 s on the first request of a cold uvicorn and
  ~2.5 s on Overview, where the Up-next window queues behind that page's other card
  fetches on a single-worker dev server — contention, not the endpoint.
  (Original: fix anything the smoke names (real-data chip collisions, a NaN in the strip, a layout break at 1180 px) as a `fix(calendar): …` commit on main; re-run the affected vitest file.)

---

### Task 5: Docs and the morning note

- [x] **README** — in the features section add one paragraph "Calendar": generated events computed on read with amounts (`GET /calendar` v2, folded vests/paydays, `sources[]` health), overrides (`PUT /calendar/overrides/{key}`), the ICS download and the token feed (`/calendar/feed.ics?token=`, `PUBLIC_URL`), the Settings Calendar feed card and `calendar_update_due_day`; add `PUBLIC_URL` to the `.env` table in §3.2. Commit `docs(readme): calendar v2 — money on events, overrides, ICS feed`.
- [ ] **Memory note** — in the batch memory file record: merge commits, suite counts (pytest/vitest), smoke results and timing, anything deferred, and the end-of-night retire list: `backend/app/services/calendar_events.py` + `backend/tests/test_calendar_events.py`, `src/utils/ics.ts` + `src/utils/ics.test.ts` (both unimported now — verify with `grep -rn "utils/ics'" src` and `grep -rn "calendar_events" backend/app` → no hits), the scratch databases `finance_test_cal_a/b/c/d/e` and `finance_mig_cal`, the four worktrees and branches.

---

## Retire at the end of the night

Nothing below is deleted by this lane — deletions are their own pass, after every branch that
could still import one of these has landed. Each line carries the grep that proved it orphaned,
run on `calendar-e` (base `df20a1b`, all four lanes merged).

**Orphaned by the calendar lanes — delete:**

| Path | Proof | Note |
|---|---|---|
| `src/utils/ics.ts` | `grep -rn "utils/ics'" src` → no hits after Plan E Task 2 | The client-side ICS builder. `escapeIcsText`, `eventUid` and `buildIcs` all moved into `backend/app/services/calendar/ics.py`, which is what both routes render through now |
| `src/utils/ics.test.ts` | the only file left importing `./ics` | Its RFC-5545 coverage is now `backend/tests/calendar/test_ics.py` plus the `icalendar` parse in `test_feed_api.py` |
| `backend/app/services/calendar_events.py` | `grep -rn "calendar_events" backend/app --include=*.py` → one **docstring** mention only (`generators/payroll.py:14`) | Superseded by the `backend/app/services/calendar/` package (Plan A) |
| `backend/tests/test_calendar_events.py` | the only importer of `app.services.calendar_events` | Its rules moved to `backend/tests/calendar/` (compose, fold, generators, model, overrides) |

Take `generators/payroll.py:14` with them: its docstring points at `calendar_events.person_suffix`
as the source of the person-tag grammar, which becomes a dangling reference the moment the module
goes. `backend/tests/test_calendar_api.py` is **not** on this list — it tests the live router's
loaders and is current.

**Unused but not orphaned — a judgement call for the deletion pass:**

- `deleteCalendarOverride` in `src/api/calendar.ts` — zero callers (`grep -rn deleteCalendarOverride src`
  finds only its own definition). `EventDetails`' "Use the estimate" clears a figure with a PUT, so
  nothing in the UI ever DELETEs an override. The endpoint it wraps is real and tested
  (`tests/calendar/test_overrides_api.py`); keep it only if API parity is worth an unused export.

**Orphaned by earlier batches, found while verifying this one (not the calendar lanes' doing):**

- `src/components/MonthRibbon.tsx` + `src/components/MonthRibbon.test.tsx` — superseded by
  `src/components/shell/MonthRibbon.tsx` (ribbon 2.0); the only `MonthRibbon` importer is `shell/ScopeBar.tsx`.
- `src/components/RangeChips.tsx` — no importer; two prose mentions only (`charts/timeZoom.test.ts`,
  `pages/TaxesPage.tsx` comments).
- `src/pages/PlaceholderPage.tsx` — no importer at all.

**Scratch state (not files):** the test databases `finance_test_ce`, `finance_test_ce2` and `finance_test_ce3` this lane
created, plus each lane's own; the four `calendar-a`…`calendar-d` worktrees and branches, and
`calendar-e` once merged.

---

## Self-review

**Spec coverage:** §18 phase 3 (merge, full pytest + vitest, tsc, lint, smoke, README) → Tasks 1, 3–5; §17 smoke (`/calendar?month=2026-09` with a priced vest chip, a folded payday, a "+N more" day and its drawer; `feed.ics` fetched with a fresh token, parsed with `icalendar`, 304 on `If-None-Match`) → Tasks 3–4; §11 "the action fetches it and saves the blob through `download.ts`" → Task 2; §20 tax-GET timing measured in the smoke → Task 4. **Placeholders:** none. **Type consistency:** `downloadCalendarIcs(start, end)` (Plan B) and `windowFor(month)` (Plan C's page) are the names swapped in Task 2; `make_token` / `freeze_today` are Plan B's test helpers.
