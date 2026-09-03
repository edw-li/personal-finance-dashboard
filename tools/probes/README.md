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
# in the worktree: uvicorn on 8010, vite on 5174
(cd backend && SCHEDULER_ENABLED=0 .venv/Scripts/python.exe -m uvicorn app.main:app --port 8010 &)
npm run dev -- --port 5174 &
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
