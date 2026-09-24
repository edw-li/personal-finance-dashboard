# Browser probes and smoke drivers

Dev-box tools, never part of the app or the test suites. They drive a real headless browser
(Edge, `EDGE_PATH` overrides) so a chart is judged on real pixels — jsdom never draws, and the
2026-08-25 incident (a real category name collided with a sankey node and blanked a route) was
invisible to every unit test. Their output is an artifact: PNGs and `report.json` land in the
gitignored `scratchpad/`, never next to these tracked scripts.

| Tool | What it draws | Run |
|---|---|---|
| `charts-c4/`, `charts-c5/` | Static `probe.html` pages that feed the app's own `node_modules/echarts` the exact option shapes the builders emit (heat-treemap hierarchy, decals, `markArea`/`markPoint`, the piecewise price wash) | `node tools/probes/charts-c5/shoot.mjs` — no server needed |
| `charts-c7/smoke.mjs` | The whole app: every chart route in both themes at 1600×1000, plus tooltip (axis/item/sankey), the heatmap's three modes, the heat-treemap and the log-axis fan. Fails on any console error, any bare canvas outside a `.chart-card`, and any canvas that did not actually paint | needs the dev stack — see below |
| `calendar-e/smoke.mjs` | The calendar in both themes: the month grid, the cash-flow strip, the source-health footer, the list view, the `?add=` deep link, Overview’s “Up next” and the Settings feed card — then the write paths (override, custom-event add/edit/delete/Undo), the “Add to calendar (.ics)” download and a live feed token (200 → 304 → 404 after revoke). Every row it writes it removes | needs the dev stack — see below |
| `sandbox-v/smoke.mjs` | The three planning sandboxes opened FROM a `whatif=` link in both themes: arrival state, a real slider drag (history must not grow), presets, pins across a reload and a year switch, both Apply doors up to their confirm, the legacy `?whatif=TICKER` and `?whatif-lot=` aliases, and the assistant's tool chip through to the page it lands on. Every mutating request outside a four-entry allowlist is aborted, so the walk cannot write | needs the dev stack — see below |
| `honest-v/smoke.mjs` | The honest-numbers program end to end in both themes: the wizard's per-step saves (a balances-only save must fire NO spending PUT), the deliberate `$0` door and the repair banner it produces, read-only derived parent rows, Overview's coverage footer and its two new attention items, Spending's savings card and kind columns, the Projection window echo, the money-flow pending-take-home node and the Settings kind picker. The only smoke that WRITES — always to the scratch month `2019-01`, swept before each theme and again in a `finally` | needs the dev stack — see below |
| `motion-v/smoke.mjs` | The twelve motion claims of the 2026-09-05 spec §10, in both themes: chart entrances measured as PAINT DELTAS (≥300ms, where the audit found 1–2 frames), `#main` non-empty on every frame of all 14 nav clicks, CLS per page, the nav indicator's ~200ms slide, an InfoHint parked under the STUCK scope row, `--reveal` at the bottom edge, mid-page and at the STUCK scope row's underside (which is the top edge the view() timelines are inset to), plus a scroll back UP that follows one card from the moment it clears the row to full brightness at 45% shown, the two viewport-edge scrims read at three scroll positions (top 0/bottom 1 at rest, 1/1 mid-page, 1/0 at the end) with a hit test 8px inside each band and an A/B proving they cost the flow nothing, a below-fold chart that waits to be seen and then draws once, the Spending drill morphing without a dispose, a theme swap that does not replay the entrance, reduced-motion emulation, and the error grammar on a stubbed 500. READ-ONLY BY CONSTRUCTION — a write fence, not a sweep | needs the dev stack — see below |
| `pace-v/smoke.mjs` | Settings' five sections, the sticky chip rail, the four old anchors still ringing, `#sec-` hashes that do not, and every card-grid row filled to the right edge; the pace strip's ESPP soft tick, window label and note line plus the 415(c) label judged against the profiles the API reports; Net Worth's What moved bars, lede and Groups · Accounts toggle. READ-ONLY BY CONSTRUCTION — a write fence, not a sweep | needs the dev stack — see below |
| `espp-v/smoke.mjs` | The ESPP page after the 2026-09-07 visuals in both themes: the five-tile strip (no lone row, no ghost standing), its figures against `GET /espp/lots`'s own totals block, the two chart cards painted at span-6 filling one grid row, the `Dollars · Per share` toggle swapping the live instance's series, the two-row chain meter where the gauge stood, the totals rows, CLS < 0.1 and a clean console. READ-ONLY BY CONSTRUCTION — a write fence, not a sweep | needs the dev stack — see below |
| `espp-3/` | Static `probe.html` for the 2026-09-07 ESPP visuals: the per-share lot view (two stacks on one column via `barGap: '-100%'`, hollow sold items, scatters over bars on a category axis) and the price chart's stepped references with end labels | `node tools/probes/espp-3/shoot.mjs` — no server needed |
| `budget-seed/smoke.mjs` | The Budget card after the 2026-09-07 seed in both themes: the empty state's `Start from my averages` (enabled exactly when the book has three complete months and something to write) or a budgeted card's `Re-seed from averages` with its confirm line and Cancel, an open editor's suggestion chips and cue, and Projection's `Use my budgets` preset present iff the echo carries `budget_annual_spend`. Reads the book's state over GETs first and expects the matching face. READ-ONLY BY CONSTRUCTION — a write fence; the write path is the plan's API walk (seed → matrix → undo) | needs the dev stack — see below |
| `guide-v/smoke.mjs` | The Guide page (2026-09-14, extended 2026-09-15): 14 sidebar links with Guide before Settings, four chapter tabs, every link the guide can render — driven out of the UI by clicking every selector chip and every rail row with the folds open — walked once (same path, `?section` tab selected, `#hash` target focused or in view, `#main` filled, clean console), the master–detail and selector checks (one card per selector chapter named by its chip, the chip writing the hash, a rail row swapping the detail, "More tasks" opening the fold in place, a deep link selecting a numbered rail row counted 1…n), the palette's Guide group for "add a card", screenshots per chapter in both themes at 1440 and 1920 plus the master–detail, checklist and glossary shots; and (since 2026-09-23) one rail row clicked per task and every card driven, both counted from `src/guide/content/*.tsx` rather than typed in the probe. READ-ONLY BY CONSTRUCTION — a write fence, not a sweep | needs the dev stack — see below |
| `reorder-v/smoke.mjs` | Drag to reorder (2026-09-23) on all six lists — Settings › Spending categories and Accounts (grouped, components nested), Portfolio › Manage › Transactions, Overview › Customize, Credit Cards › Card roster and Categories & weights — one theme per run at 1600×1000 and 1280×800: a real mouse drag (the row follows the pointer, exactly the peers it passes make room, it lands in the gap, the order survives a reload), the toast and its Undo, Space ↓↓ Space with focus kept, reduced motion's drop line (lane R7's overlay, swept 2px at a time: visible above the row in hand in every held sample) and an Escape that sends nothing, auto-scroll in the 420px Settings box, the 440px Categories & weights box (stopping at the range's first slot, clear below the sticky header), inside the ledger's capped box (the page staying put), and the ledger on arrival — a drag held at the window's foot scrolls the box to its end, then the page, and reaches the last slot — the resting table pixel-compared with the collapsed border model (one hairline per row boundary in both; that model's half-pixel row offset allowed; the look stops above a capped box's "more below" fade), a parent carrying its components, the ledger in a person scope and a sell dragged above its buy, credit-line colours through a reorder, across person scopes and in a card's drill-in, Escape inside the Customize popover, a real two-tab 409, and the Activity feed (one entry per logged reorder, a working Undo, the overlap refusal); CLS < 0.1 and a clean console. WRITES — only to its private `finance_reorder_scratch`, rebuilt from `finance_realdata` before each theme, through a write fence | needs a lane stack on 8096/5196 — see below |
| `table-scroll-v/smoke.mjs` | The capped table boxes (2026-09-24) on Dividends, Transactions, Securities, Holdings, Security classifications, Net worth › Accounts and the Rewards matrix, in both themes at 1280×800, 1600×1000 and 1920×1080, launched with CLASSIC scrollbars (headless otherwise lays out 0px overlay ones): the box is a keyboard-reachable region never taller than `clamp(420px, 60vh, 720px)` and filling it when the table is longer, its own scrollbar measured into `--table-scrollbar-w`; mid-scroll the header row sits at the box top and paints over the rows (hit test) on the card's own surface, the totals row at its foot; the foot fades while rows hide below and not at the end; the focused box shows its ring and drops its edge mask, ArrowDown and PageDown scroll it, a wheel at its end carries on down the page; the rings inside a box (2px outside on the padding-free text buttons, −2px inset on row actions); a Tab walk down Transactions and Classifications that never parks a stop under the fade or the header. Holdings: a sort restarts the box at its first row, Tab across the pinned sort headers never moves a scrolled box, and at a sideways overflow the right-edge mask turns opaque over the box's own scrollbar — judged in pixels (the scrollbar strip identical with the mask forced off, the fade zone beside it not) — with the keyboard ring showing at the masked edge (pixels), again with the detail dock open where it docks. Classifications: a chip and a search restart the list. Rewards: Tab across the pinned card buttons never moves the box; Back to matrix hands the focus back to the card's button. Net worth on paper: no cap, mask or fade, every pinned cell static, the totals row after the last row, and a PDF. Dividends: one line per recorded month newest first, the default month open (the newest on or before today's), each total cent-exact against `GET /portfolio/dividends` and equal to its bar in the live chart, the entry counts, Expand all → every entry, Collapse all → none, the fullest month's line pinned under the header mid-month, a month opened below the fold raising "more below" with no scroll, and an edited entry — saved from the keyboard and with the mouse — revealed inside the box without moving the page, below the header and its month's line and above the fade, the focus kept in the form. Transactions: from the arrival state a drag held at the window's foot reaches the last slot, the box running to its end before the page moves, a drag held at the box foot scrolls the BOX while the page — with room below to move — stays put, a keyboard lift keeps its landing slot (the reduced-motion drop line) in view, Escape drops each with nothing sent, and a reload after a (fenced) row Delete re-renders the ledger with the box where it was. A 1440×900 record pass logs each page's height against the spec's before-numbers. CLS < 0.1 (the shifted elements named) and a clean console. Three pre-existing defects print as `KNOWN (pre-existing)` lines instead of failing — see below. READ-ONLY BY CONSTRUCTION — a write fence | needs a stack whose book has long tables — see below |

## Running the C7 / sandbox smokes against the dev servers (dev only)

Start the stack: backend `uvicorn app.main:app --port 8000` on `127.0.0.1:8000`, `npm run dev`
on `http://localhost:5173`. Then mint a token with the **dev seed credentials**
(`admin@example.com` / `changeme123` — dev database only, never a real one) and run the driver:

```bash
OUT=scratchpad/charts-smoke && mkdir -p "$OUT"
curl -s http://127.0.0.1:8000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"changeme123"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).access_token))" > "$OUT/token.txt"
TOKEN_FILE=$OUT/token.txt SMOKE_OUT=$OUT node tools/probes/charts-c7/smoke.mjs
```

Prints `CHARTS SMOKE OK`, or exits 1 listing every problem. Env: `SMOKE_OUT`, `TOKEN_FILE`,
`APP_BASE`, `EDGE_PATH`, `PLAYWRIGHT_CORE`, `ONLY_THEME`, `ONLY_ROUTE`, `SKIP_WALK`,
`SKIP_DETAILS`. Known dev-data non-defects (a person with no paycheck profile 404ing,
`owner=joint` holding no positions) are recorded under `knownBenign` in `report.json` rather
than dropped, so a real regression hiding behind one stays visible.

## Running the calendar smoke (dev only)

Same stack and the same dev seed credentials. A merge lane runs its own pair of servers beside
the shared ones so the walk is judged on the lane's build, not on whatever owns port 8000:

```bash
# Anywhere outside the repo; the C7 recipe above writes to the gitignored scratchpad/ instead.
OUT=/tmp/calendar-smoke && mkdir -p "$OUT"
# in the worktree: uvicorn on 8010, vite on 5174 — VITE_API_PROXY makes that vite talk to THAT uvicorn
(cd backend && SCHEDULER_ENABLED=0 .venv/Scripts/python.exe -m uvicorn app.main:app --port 8010 &)
VITE_API_PROXY=http://127.0.0.1:8010 npm run dev -- --port 5174 &
curl -s http://127.0.0.1:8010/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"changeme123"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).access_token))" > "$OUT/token.txt"
TOKEN_FILE=$OUT/token.txt SMOKE_OUT=$OUT APP_BASE=http://localhost:5174 \
  API_BASE=http://127.0.0.1:8010 node tools/probes/calendar-e/smoke.mjs
```

Prints `CALENDAR SMOKE OK`, or exits 1 listing every problem. Env: `SMOKE_OUT`, `TOKEN_FILE`,
`APP_BASE`, `API_BASE`, `EDGE_PATH`, `PLAYWRIGHT_CORE`, `ONLY_THEME`, `SKIP_ACTIONS`.
**`PLAYWRIGHT_CORE` is required off this box**: playwright-core is not a repo dependency, so
the driver falls back to one author's npx cache (`…/npm-cache/_npx/<hash>/node_modules/playwright-core`)
— a path that exists nowhere else. Point it at any local install (`npx --no-save playwright-core`
leaves one in the npx cache; `npm i --no-save playwright-core` leaves one in `node_modules`).
`EDGE_PATH` is the same kind of default.

The driver writes to the **dev** database on purpose — that is the point of the write walk —
and undoes everything it writes, twice over. The walk deletes its own events, reopens the
override and revokes the feed link through the UI, because doing so is part of what it proves;
then a sweep in a `finally` settles the same three things straight against the API, so a
Playwright timeout halfway through still leaves the database as it was found. The sweep only
touches rows it can name (its own event labels, a feed link labelled `smoke` created inside
this run) and it puts an override row the walk found back exactly as it was rather than
deleting it. Anything it cannot settle is reported and fails the run. `PATCH /prefs` is
stubbed, so a run never rewrites the account's settings.
The sandbox smoke takes the same token the same way (`SMOKE_OUT=scratchpad/sandbox-smoke`,
then `node tools/probes/sandbox-v/smoke.mjs`) and prints `SANDBOX SMOKE OK`. Its own env:
`ONLY_STEP` (paycheck|taxes|projection|assistant), `SKIP_ASSISTANT`, `TICKER`, `ESPP_LOT`,
`RETIRE_PERSON`, `ASSISTANT_MODEL`. Two cautions learned the hard way on 2026-09-04: the
backend is started WITHOUT `--reload`, so a server left running from before the branch
under test merged will answer with the old code (the assistant's tool-chip link went
missing for exactly that reason, and nothing about the page said so) — restart it before a
smoke; and `npm run dev` in a worktree serves THAT checkout, so point `APP_BASE` at the
port serving the code you mean to judge.

## Running the honest-numbers smoke (dev only)

Same stack and the same dev seed credentials (`admin@example.com` / `changeme123` — dev
database only, never a real one). Restart uvicorn first: it runs WITHOUT `--reload`, so a
server started before lanes A/B merged answers with the old code and every new wire field
reads as missing.

```bash
OUT=scratchpad/honest-smoke && mkdir -p "$OUT"
curl -s http://127.0.0.1:8000/api/v1/auth/login -H 'content-type: application/json'   -d '{"email":"admin@example.com","password":"changeme123"}'   | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).access_token))" > "$OUT/token.txt"
TOKEN_FILE=$OUT/token.txt SMOKE_OUT=$OUT node tools/probes/honest-v/smoke.mjs
```

Prints `HONEST SMOKE OK`, or exits 1 listing every problem. Env: `SMOKE_OUT`, `TOKEN_FILE`,
`APP_BASE`, `API_BASE`, `EDGE_PATH`, `PLAYWRIGHT_CORE`, `ONLY_THEME`, `ONLY_STEP`
(wizard|overview|spending|projection|moneyflow|settings), `SCRATCH_MONTH`. It writes to the
dev database on purpose — the wizard's save is the subject — into `SCRATCH_MONTH` only
(default `2019-01-01`, a month the dev book has never used); it sweeps that month from the
spending and balances tables before EACH theme and again in a `finally`, then re-reads the
month to prove it is gone. `PATCH /prefs` is stubbed, so a run never rewrites the account's
settings.

Three of its checks read the dev book rather than a literal, because the dev database is not
production's: the coverage wording is derived from a live `GET /coverage` (the rule under test
is "the newest gap is named", not which month it is), the YTD windows are asserted only for a
fact that has a figure, and the money-flow pending node is driven to whichever year the wire
reports as partly entered. Two labels live only on a CANVAS and so are pinned by unit tests
instead: the savings chart's legend words (`spendingChartOptions.test.ts`) and the sankey node
name — for the latter the driver opens the card's **Table** twin, which exports one row per
node, and reads the string there.

## Running the motion smoke (dev only)

Same stack and the same dev seed credentials. This one is **read-only by construction**: the
fence in `makeContext` continues GET/HEAD/OPTIONS and answers every other `/api/v1/**` call
from memory (`PATCH /prefs` included, so a theme swap never rewrites the account's settings),
recording each one under `writesBlocked`. There is no sweep because there is nothing to undo —
a Playwright timeout halfway through leaves the dev book exactly as it was. Restart uvicorn
first all the same, for the same reason the other smokes give.

```bash
OUT=scratchpad/motion-smoke && mkdir -p "$OUT"
curl -s http://127.0.0.1:8000/api/v1/auth/login -H 'content-type: application/json'   -d '{"email":"admin@example.com","password":"changeme123"}'   | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).access_token))" > "$OUT/token.txt"
TOKEN_FILE=$OUT/token.txt SMOKE_OUT=$OUT node tools/probes/motion-v/smoke.mjs
```

Prints `MOTION SMOKE OK`, or exits 1 listing every failed check with its observed numbers. Env:
`SMOKE_OUT`, `TOKEN_FILE`, `APP_BASE`, `EDGE_PATH`, `PLAYWRIGHT_CORE`, `ONLY_THEME`,
`ONLY_STEP` (entrance|nav|cls|indicator|hint|reveal|scrims|belowfold|drill|themeswap|reduced|errors).
Roughly four minutes per theme at 1440×900; ~21 PNGs and `report.json` per theme — the `scrims`
step's four go in a `scrims/` subfolder, because a scrim photographs as a gradient at the edge of
the frame and is only legible with the whole viewport beside it.


Its instruments are the 2026-09-05 UX-pass probes' own, so every number is comparable with the
audit's: a per-frame rAF tracer that hashes each chart canvas, a buffered `layout-shift`
observer, and an ECharts prototype wrapper that logs every `setOption`/`dispose` with its
animation fields. Two things the driver does that a reader should expect: the entrance step
SCROLLS to the first mounted-but-unpainted chart inside its paint window (M1's one-shot holds
the first paint of any chart less than 20% on screen, which at 1440×900 is every chart on
Taxes and Portfolio), and the reveal step parks the page by correcting its own scroll twice —
the reveal's `translateY(±4px)` is inside `getBoundingClientRect`, so one computed scroll lands
7px off and leaves no card straddling the edge at all. A bare "Failed to load resource" console
line is recorded as a NOTE with its URL (the dev book's `/paycheck/breakdown?person_id=2` 404
is the same known non-defect the C7 smoke lists); anything else in the console still fails.

## Running the ESPP smoke (dev only)

Same stack pattern as the calendar recipe (a lane pair on 8010/5174 beside the shared servers),
same dev seed token. Start the lane's uvicorn from the MERGED main — it runs without `--reload`,
so a server started before the backend lane merged answers without the `totals` block and the
per-lot anatomy fields, and the strip reads as four em dashes.

```bash
OUT=scratchpad/espp-smoke && mkdir -p "$OUT"
curl -s http://127.0.0.1:8010/api/v1/auth/login -H 'content-type: application/json'   -d '{"email":"admin@example.com","password":"changeme123"}'   | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).access_token))" > "$OUT/token.txt"
TOKEN_FILE=$OUT/token.txt SMOKE_OUT=$OUT APP_BASE=http://localhost:5174 API_BASE=http://127.0.0.1:8010 node tools/probes/espp-v/smoke.mjs
```

Prints `ESPP SMOKE OK`, or exits 1 listing every problem. Env: `SMOKE_OUT`, `TOKEN_FILE`,
`APP_BASE`, `API_BASE`, `EDGE_PATH`, `PLAYWRIGHT_CORE`, `ONLY_THEME`.

Two things the driver has to do that the others do not. **`vite.config.ts` pins its dev proxy to
`127.0.0.1:8000`**, the shared backend — so the fence re-aims every same-origin `/api` read at
`API_BASE` and fulfills it from the handler; without that the page reads whatever build has been
running on 8000 all day. And **CLS is attributed**: the shell's route-hold cross-fade
(`.xfade`/`.xfade-veil`/`.loading-dim`/`.loading-fallback`) intermittently collapses its held block
at ~0.5 s and books ~0.13 on this page and on ones this batch never touched, so the check counts
only shifts with a source outside that overlay (`__clsPage`) and reports the total beside it.

## Running the pace smoke (dev only)

Same stack and the same dev seed credentials, and **read-only by construction** in exactly the
motion smoke's way: the fence in `makeContext` continues GET/HEAD/OPTIONS and answers every other
`/api/v1/**` call from memory (`PATCH /prefs` included), recording each under `writesBlocked`.
This walk provokes no write at all, so anything landing in `writesBlocked` is itself a finding.
Restart uvicorn first — it runs without `--reload`, so a server started before the backend lane
merged answers with the old code and every new wire field (`soft_limit`, `halves`,
`employer_match`) reads as missing.

```bash
OUT=scratchpad/pace-smoke && mkdir -p "$OUT"
curl -s http://127.0.0.1:8000/api/v1/auth/login -H 'content-type: application/json'   -d '{"email":"admin@example.com","password":"changeme123"}'   | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).access_token))" > "$OUT/token.txt"
TOKEN_FILE=$OUT/token.txt SMOKE_OUT=$OUT node tools/probes/pace-v/smoke.mjs
```

Prints `PACE SMOKE OK`, or exits 1 listing every failed check with its observed numbers. Env:
`SMOKE_OUT`, `TOKEN_FILE`, `APP_BASE`, `API_BASE`, `EDGE_PATH`, `PLAYWRIGHT_CORE`, `ONLY_THEME`,
`ONLY_STEP` (settings|rows|rail|anchors|pace|movers). Roughly three minutes per theme at
1440×900; nine PNGs and `report.json` per theme. `API_BASE` is used directly (not through the
page) for the one `GET /paycheck/profiles` that decides whether this book's in-force profiles
carry a match policy — the 415(c) label is judged against that answer rather than against memory.
The `rows` step resizes the viewport to 721 and 1400 px and flips `data-density` to `compact`,
restoring both before it hands over.

## Running the reorder smoke (a lane stack with a database of its own)

The one smoke that needs its own database. It WRITES — reorders, Undos, two scratch trades and
one scratch category, every one put back — so it refuses any stack but a lane pair on **uvicorn
8096 / vite 5196** whose uvicorn serves **`finance_reorder_scratch`**: a `pg_dump | psql` copy of
the shared, read-only `finance_realdata` (never `CREATE DATABASE … TEMPLATE`, which fails while
other sessions hold the source), rebuilt before EACH theme. A gate refuses a copy an earlier pass
already wrote to, so one run is one theme.

```bash
PY=/c/Users/edyli/personal-finance-dashboard/backend/.venv/Scripts/python.exe
# 1. (re)build the private copy — uvicorn on 8096 must be stopped first
docker exec finance-dashboard-db-1 dropdb -U finance --if-exists finance_reorder_scratch
docker exec finance-dashboard-db-1 createdb -U finance finance_reorder_scratch
docker exec finance-dashboard-db-1 sh -c 'pg_dump -U finance --no-owner --no-privileges finance_realdata | psql -q -v ON_ERROR_STOP=1 -U finance -d finance_reorder_scratch'
(cd backend && DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_reorder_scratch $PY -m alembic upgrade head)
# 2. the lane pair, each in its own terminal (or run_in_background)
(cd backend && DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_reorder_scratch SCHEDULER_ENABLED=0 $PY -m uvicorn app.main:app --host 127.0.0.1 --port 8096)
VITE_API_PROXY=http://127.0.0.1:8096 npx vite --port 5196 --strictPort
# 3. one theme per fresh copy (about 30 minutes each)
ONLY_THEME=dark node tools/probes/reorder-v/smoke.mjs
#    stop uvicorn, repeat step 1, start uvicorn again, then
ONLY_THEME=light node tools/probes/reorder-v/smoke.mjs
```

Prints `REORDER SMOKE OK — <theme>: N checks`, exits 1 listing every problem, or exits 2 when it
refuses to start (wrong ports, the migration missing, a copy that is not fresh). Env:
`ONLY_THEME` (required), `ONLY_WIDTH` (1600|1280), `ONLY_SURFACE` (a comma list of settings,
portfolio, overview, cards, activity), `APP_BASE`, `API_BASE`, `SMOKE_OUT` (default
`scratchpad/reorder-v/<theme>`), `EXPECT_HEAD`, `EDGE_PATH`, `PLAYWRIGHT_CORE`. It mints its own
token with the dev seed credentials, which `finance_realdata` carries (on a 401, reset the private
copy's password — the plan's Task 1 Step 6).

Lines starting `JUDGE` are observations a person rules on, not failures: the row in hand drawn over
a capped box's sticky header during an upward auto-scroll (a `-scrolling` shot mid-scroll and a
`-held` shot at the stop, per box), and any pixel that differs INSIDE a pinned (sticky) cell when
the resting table is compared with the collapsed border model it replaced. The rule for both is in
`docs/superpowers/plans/2026-09-23-reorder-v-verify.md`, Task 7. The drags follow the shared
component's final rules: the leading-edge slot rule (a row passes a peer once its leading edge
reaches the peer's midpoint) and the range-end auto-scroll stop, counted below a box's sticky header (lane R7) — which is why the Settings box's
auto-scroll drag uses a group whose first row the box can hide, never the roster's last group. Not
probed, on purpose: the importer's identity rule (backend tests own it) and the forced 500/409
failure paths (the lanes' own checks and unit tests own them).

## Running the table-scroll smoke (a stack with long tables)

Read-only, so any stack will do — but the checks that matter (pins, fades, the drags' auto-scroll,
the month lines, the Tab walks) are only exercised where the tables outgrow their boxes. The
2026-09-24 run used `finance_scroll`, a private copy of production restored into the dev Postgres,
on its own pair of servers started FROM THE WORKTREE, vite with a private dependency cache (a
worktree's `node_modules` is a junction, so the default cache is shared by every dev server on the
box):

```bash
# a vite wrapper config with its own cacheDir, next to the scratch data (never in the repo)
cat > "$SCRATCH/vite.private.config.mts" <<'EOF'
import base from '<worktree>/vite.config.ts'
export default { ...base, cacheDir: '<scratch>/vite-cache' }
EOF
# the pair, each in its own terminal (or run_in_background)
(cd backend && DATABASE_URL=postgresql+asyncpg://finance:finance@127.0.0.1:5433/<db> SCHEDULER_ENABLED=0 SNAPSHOT_ENABLED=0 $PY -m uvicorn app.main:app --host 127.0.0.1 --port 8061)
VITE_API_PROXY=http://127.0.0.1:8061 npx vite --config "$SCRATCH/vite.private.config.mts" --port 5261 --strictPort
curl -s http://127.0.0.1:8061/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"<login>","password":"<password>"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).access_token))" > "$SCRATCH/token.txt"
TOKEN_FILE=$SCRATCH/token.txt SMOKE_OUT=scratchpad/table-scroll-v node tools/probes/table-scroll-v/smoke.mjs
```

Prints each page's height per run (and, from the 1440×900 record pass, against the spec's
before-number) and any `KNOWN (pre-existing)` lines, then
`TABLE SCROLL SMOKE OK — N checks, M notes, K known (pre-existing), W writes fenced (P prefs)` —
followed, when there were any, by `R GET(s) asked twice` and `L page load(s) retried`, each
listed above the line with its cause — or exits 1 listing every problem (a request the fence could
not answer is one; so is a run in which no check passed). `ONLY_THEME` (dark|light), `ONLY_SIZE`
(1280|1600|1920, or 1440 for the record pass alone), `ONLY_TARGET` (dividends, transactions,
securities, holdings, classifications, networth, rewards) and `RECORD=0` narrow a run; an `ONLY_*`
value that names nothing is refused up front with the valid names (exit 2), so a typo cannot pass
on zero checks. The full run takes about 16 minutes. `TOKEN_FILE` defaults to
`<SMOKE_OUT>/token.txt`.

- **The fence.** The page's GETs are fetched by the fence from `API_BASE` directly — the uvicorn
  behind the vite, never through the vite proxy, which stalled about one proxied request in a dozen
  page loads on this box past the app's 15 s timeout; a GET whose socket died unanswered (uvicorn
  closing a keep-alive connection as it was reused — "socket hang up") is asked once more and logged
  in `fenceRetries`. Every other method is answered `200 {}` from memory and logged in
  `writesBlocked` (`PATCH /prefs` in `prefsWrites`). The smoke writes three times
  on purpose per theme and size — two dividend PATCHes (the reveal, saved from the keyboard and
  with the mouse) and a transaction DELETE (the reload) — and the fence plays the server's part for
  them in the GETs that follow; otherwise the refetch returns the
  unchanged book, PortfolioPage keeps the ledger it has, and neither claim is exercised. A page
  whose box does not render within 15 s is loaded again (three tries), every retry logged in
  `loadRetries` with what the page showed instead.
- **The product's day.** The dividend ledger's default month follows the server's day
  (`X-Product-Today`, the 2026-09-23 time contract), which the smoke reads off the API; a stack
  without the header falls back to this box's date.
- **Placement.** The page-still drag and the wheel set the box's foot 8px inside the window, so
  whatever the page holds below the box is room to move into: a page that ENDS in its box, placed
  any other way, sits at its maximum scroll, where "the page stays put" cannot fail and the wheel's
  chaining cannot be seen. With under 20px of room either is a note.
- **Classic scrollbars.** The launch drops headless Chromium's `--hide-scrollbars`, so boxes carry
  the ~15px scrollbars of the user's headed Edge; every box that scrolls must measure one (a check —
  a run that lost the flag fails rather than passing on overlay scrollbars).
- **Reduced motion** (the context's): the fade reads final at once, and a drag marks its landing
  slot with the drop line (`data-reorder-drop`) instead of moving the peers — the slot the drag
  checks read mid-drag.
- **Known defects** — three claims the product fails today for reasons outside the capped boxes,
  found by this smoke on 2026-09-24 and left as follow-ups: Net worth's scope row wrapping at
  1280px when the month chips land (CLS ≈0.166 — the CLS check is `known` there alone, and only
  while the scope row's own shifts explain it: less them, the load must be under 0.1); the
  dividend edit's **Save changes**, which disables itself mid-save so the focus falls to
  `<body>` (the Enter-in-Notes save keeps it and is an ordinary check); and **Back to matrix**,
  whose focus hand-back fires in a `setTimeout(0)` before the matrix re-mounts. `known()` records
  each as `{ ok: null, known: true, ref }` in `report.json` and prints one `KNOWN (pre-existing): …`
  line per defect with its cause and evidence; they do not fail the run, and the day one is fixed
  its check simply passes. Only a failure with that defect's signature counts as known (a shift
  that is not the scope row's, focus landing anywhere but `<body>`): any other failure of the same
  claim fails the run.
- **Preconditions.** A claim that could not fail where it is measured is a note instead of a pass: a
  chip or search reset where the box was not scrolled first or the new list fits it, the dividend
  observer on a box that does not scroll, the arrival hand-off where the box's foot is inside the
  window (1920×1080: the page never needs to take over), the mask drop on a box with no mask.
  Print media and every drag are undone in a `finally`, so a failure never leaks into the checks
  after it.
- **Notes** (`ok: null` in `report.json`) are observations, not votes: a table that fits its box at
  that size (the sideways checks, for Holdings at the wider sizes; the matrix's sideways state per
  size), a box with no edge mask at rest (nothing for the keyboard focus to drop — the check runs
  where one is masked), a page that ends at its box (no room to see the wheel chain), whether the
  Holdings detail opens docked or as an overlay, where the card button lands after Back to
  matrix, the matrix's remount (the card detail REPLACES the matrix, so Back to matrix returns to
  the box's top and the page's scroll is not restored — pre-existing, by the page's design), and
  the page heights.
- **Artifacts** in `SMOKE_OUT`: each box mid-scroll, the pinned month line, the revealed entries,
  the held arrival drag, the Holdings scrollbar strip with and without the mask and the ring at the
  masked edge, the matrix after Back to matrix, the Net worth PDF with a full-page shot under print media beside
  it, and `report.json`.
