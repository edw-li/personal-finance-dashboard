# Lane V verify — 2026-09-13 polish batch — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the merged 2026-09-13 polish batch on local `main` against spec §15 (items 1–10) with a read-only browser driver, the four frontend gates, a before/after screenshot index, and a filled-in Results section the lead can read in the morning.

**Architecture:** One new read-only Playwright/Edge driver `scratchpad/ux-audit-2026-09-13/accept.mjs` (same node-version spoof, launch line and write fence as `audit.mjs`) asserts §15 items 1–8 as `check()` calls grouped by area — `motion`, `strip`, `orphans`, `layout`, `tables`, `loading`, `light`, `allocation` — and writes `after/accept-report.json` plus `after/accept-*.png`; every failed assertion is a `problems[]` entry carrying the observed numbers and the process exits 1 on any problem. The existing `audit.mjs` is re-run with `TAG=after` into `after/shots/` and a small `index.cjs` pairs every `shots/prod-dark-1440-*.png` with its new twin in `after/INDEX.md`. Gates (`tsc -b`, `eslint .`, `vitest run`, `npm run build`, conditional backend `pytest`) run on `main` and their numbers land in this file's Results section.

**Tech Stack:** Node 18 on this box (spoofed to 20 for playwright-core from the npx cache), Microsoft Edge headless, Playwright route fence (`**/api/v1/**`), Git Bash (MSYS) shell, Vite 5174 + uvicorn 8010 serving the production clone `finance_uxreview`, Vite 5173 + uvicorn 8000 serving the sparse dev book.

---

## Ground rules for this lane

- Runs on `main` **after** F1, F2, P1, P2, P3, P4 are merged. Pre-batch SHA is `ab92b91` (the spec commit; `.worktrees/polish-f1` and `polish-f2` were cut from it). Every diff in this plan is `ab92b91..HEAD`.
- This lane edits **no source file**. The only tracked file it touches is this plan (its Results section). Everything else lands under `scratchpad/` (gitignored, line 37 of `.gitignore`), so the per-task commit steps commit this plan file only.
- The browser driver is read-only by construction: GET/HEAD/OPTIONS continue, every other `/api/v1/**` call is answered from memory and recorded under `writesBlocked`. `PATCH /prefs` is stubbed so the theme flip never rewrites the account. Nothing here writes to either database.
- Servers: uvicorn 8000 + vite 5173 (dev book), uvicorn 8010 + vite 5174 (prod clone). Both vites were started from the main checkout and serve **whatever `main` holds** via HMR. Uvicorn runs **without `--reload`**; this batch touches no `backend/` file (Task 1 proves it with a diff), so no backend restart is needed. Acceptance is measured on **5174** (spec §15: "measured against the prod clone").
- Tokens expire after 24 h (`backend/app/config.py` `access_token_expire_hours = 24`); the stored `token-dev.txt` / `token-prod.txt` were minted 2026-09-13 02:02 and will be dead by the time this lane runs. Task 0 re-mints both with the dev seed credentials (`admin@example.com` / `changeme123`, seeded in both books).
- MSYS caveat: Git Bash rewrites env values that look like POSIX paths. `ONLY_ROUTE=/spending` becomes `C:/Program Files/Git/spending`; **`ONLY_ROUTE` takes a route NAME** (`spending`, `networth`, `cards`, `paycheck`, …) — the names in `audit.mjs`'s `ROUTES` table. `APP_BASE=http://…` and relative `OUT=scratchpad/…` are safe. If a value must start with `/`, prefix the command with `MSYS_NO_PATHCONV=1`.
- Every `page.evaluate` snippet below uses the selectors the spec fixes; where a lane had naming latitude the table in "Selector contract" names the spec section and the fallback the driver tries second. A fallback hit is itself reported (the check records which selector answered) so the lead sees the naming drift.
- No hard caps on this plan or the Results section (user rule 2026-09-06): record every number observed, never compress.

## File structure

| Path | Role |
| --- | --- |
| `scratchpad/ux-audit-2026-09-13/accept.mjs` | **New.** Read-only acceptance driver: fence + launch scaffold (Task 2) and eight runner groups (Tasks 3–10). Writes `after/accept-report.json` and `after/accept-*.png`. Exit 1 on any problem. |
| `scratchpad/ux-audit-2026-09-13/index.cjs` | **New.** Pairs `shots/prod-{dark,light}-1440-*.png` with `after/shots/after-{dark,light}-1440-*.png`, appends the acceptance captures and the problem list, writes `after/INDEX.md` (Task 13). |
| `scratchpad/ux-audit-2026-09-13/after/` | **New folder.** `gates/*.log` (Task 1), `accept-report.json` + `accept-*.png` (Tasks 3–11), `shots/after-*.png` + `report-after-*.json` + `summary-after-*.txt` + `run-after-*.log` (Task 12), `INDEX.md` (Task 13). |
| `scratchpad/ux-audit-2026-09-13/audit.mjs`, `summarize.cjs` | **Unchanged.** Re-run only (Task 12). |
| `scratchpad/ux-audit-2026-09-13/token-dev.txt`, `token-prod.txt` | Re-minted in Task 0 (overwritten). |
| `docs/superpowers/plans/2026-09-13-polish-v-verify.md` | This plan; its **Results** section is filled by Tasks 1–14 and is the only tracked change of the lane. |

## Selector contract (what each check reads, where the spec fixes it, what the driver tries second)

| Surface | Primary selector (spec section) | Fallback tried second | Why a fallback |
| --- | --- | --- | --- |
| Detail panel | `.detail-panel` (§2.2, existing) and `.detail-layout-content` margin transition (§2.2) | none — both classes pre-date the batch | — |
| Panel width persistence | `localStorage['finance.detailPanel.width']` (§4); default `clamp(400px, 26vw, 560px)` → **400 at 1440** | any key matching `/detailPanel|dock/i` is listed in the observation | F1 could spell the key differently |
| Chart Expand dialog | `dialog.chart-expanded-dialog[open]` (§2.3, existing) opened by `button[aria-label^="Expand "]` | none | — |
| Customize popover | `button[aria-haspopup="dialog"]` whose text matches `/customize/i` → `.popover-surface` (§11) | `details.overview-customize > summary` → `.overview-customize-menu` (pre-batch) | P1 conversion may lag; a fallback hit means item 11 is not done |
| Tab strip indicator | `.local-section-indicator` with `data-placed` (§2.4) | none | — |
| Sticky strip slot | `nav.local-section-nav` inside `.page-frame-scope`, wrapper `.page-frame-sections` (§3) | none; the retired `.local-section-toolbar` is asserted absent | — |
| Overview columns | `.overview-wealth-column` / `.overview-agenda-column` (existing, §12) | none | — |
| Settings cards | `#household`, `#accounts`, `#categories .settings-scroll` (existing ids) | none | — |
| Ghosts | `.skeleton` (existing house class; §9 GhostCard is built from it) | `.skeleton-card`, `.ghost-card` | P4 may wrap GhostCard in a named section |
| Projection band | `.projection-outcomes` (existing, §12) | none | — |
| KPI rows | `.kpi-row` (existing; §12 adds the `:last-child` rule) | none | — |
| Row actions | scroller classes `.paycheck-scroll`, `.comp-scroll`, `.espp-scroll`, `.settings-scroll` (existing; §7 adds `td.row-actions`) | table picked by a header regex when a section holds two scrollers | Comp Manage and ESPP Lots each hold two tables |
| Light tokens | `--fill`, `--border` read from `:root`; `.segmented button.active`, `.data-table td` (§6) | none | — |
| Allocation | `button` text `/^Classify these \d+ holdings$/` (§13), card eyebrow `Security classifications` (§13), `Set targets` / `Edit targets` (existing), `.allocation-add-target select` (existing) | `h2` inside `section.card` if the eyebrow is not a `.eyebrow` | P2 may render the eyebrow as `h2.eyebrow` or `h2` |

---

### Task 0: Preconditions — main state, servers, fresh tokens, proxy proof

**Files:**
- Modify: `scratchpad/ux-audit-2026-09-13/token-dev.txt`, `scratchpad/ux-audit-2026-09-13/token-prod.txt` (re-minted)
- Create: `scratchpad/ux-audit-2026-09-13/after/gates/` (folder)

- [ ] **Step 1: Confirm `main` holds the merged batch and is clean**

Run (Git Bash, repo root `C:/Users/edyli/personal-finance-dashboard`):

```bash
cd /c/Users/edyli/personal-finance-dashboard
git branch --show-current
git status --porcelain | wc -l
git log --oneline ab92b91..HEAD | wc -l
git log --oneline ab92b91..HEAD | grep -ciE "merge|polish|lane|f1|f2|p1|p2|p3|p4"
git diff --stat ab92b91 HEAD -- backend | tail -1
```

Expected: `main`; `0` (clean tree); a non-zero commit count (six lane merges plus their commits); the grep count ≥ 6; the backend diff line **empty** (no output — the batch touches no backend file). If the backend diff is non-empty, Task 1 Step 5 runs pytest; note it here.

- [ ] **Step 2: Confirm the four servers are listening**

```bash
netstat -ano | grep LISTENING | grep -E ':(8000|8010|5173|5174) '
```

Expected: four lines, one each for `127.0.0.1:8000`, `127.0.0.1:8010`, `[::1]:5173`, `[::1]:5174`. If 5174 is missing, restart it from the main checkout (it serves `main`):

```bash
VITE_API_PROXY=http://127.0.0.1:8010 npm run dev -- --port 5174 --strictPort > scratchpad/ux-audit-2026-09-13/after/vite-5174.log 2>&1 &
```

If 8010 is missing (unexpected — no backend change), restart it against the clone; the URL below is inferred from `backend/app/config.py`'s default (`postgresql+asyncpg://finance:finance@localhost:5433/finance`) with the clone's name, because the running process's environment is not visible:

```bash
(cd backend && DATABASE_URL=postgresql+asyncpg://finance:finance@localhost:5433/finance_uxreview SCHEDULER_ENABLED=0 .venv/Scripts/python.exe -m uvicorn app.main:app --port 8010 > ../scratchpad/ux-audit-2026-09-13/after/uvicorn-8010.log 2>&1 &)
```

- [ ] **Step 3: Re-mint both tokens (the stored ones expire 24 h after 02:02)**

```bash
A=scratchpad/ux-audit-2026-09-13
mkdir -p $A/after/gates
for pair in "8000 dev" "8010 prod"; do set -- $pair
  curl -s http://127.0.0.1:$1/api/v1/auth/login -H 'content-type: application/json' \
    -d '{"email":"admin@example.com","password":"changeme123"}' \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).access_token))" > $A/token-$2.txt
done
wc -c $A/token-dev.txt $A/token-prod.txt
curl -s -o /dev/null -w 'prod token on 8010: %{http_code}\n' -H "Authorization: Bearer $(cat $A/token-prod.txt)" http://127.0.0.1:8010/api/v1/prefs
curl -s -o /dev/null -w 'dev token on 8000: %{http_code}\n'  -H "Authorization: Bearer $(cat $A/token-dev.txt)"  http://127.0.0.1:8000/api/v1/prefs
```

Expected: two files of ~129 bytes (a JWT; **never 0 bytes** — 0 means the login failed and `JSON.parse` threw), then `prod token on 8010: 200` and `dev token on 8000: 200`.

- [ ] **Step 4: Prove vite 5174 proxies to the clone, not to 8000**

The JWT is signed with the same secret in both books, so a 200 alone proves nothing; the account count does (the clone has 28 accounts, the dev book far fewer):

```bash
A=scratchpad/ux-audit-2026-09-13
count() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).length))"; }
echo "via 5174: $(curl -s -H "Authorization: Bearer $(cat $A/token-prod.txt)" http://localhost:5174/api/v1/net-worth/accounts | count)"
echo "8010 direct: $(curl -s -H "Authorization: Bearer $(cat $A/token-prod.txt)" http://127.0.0.1:8010/api/v1/net-worth/accounts | count)"
echo "8000 direct: $(curl -s -H "Authorization: Bearer $(cat $A/token-dev.txt)" http://127.0.0.1:8000/api/v1/net-worth/accounts | count)"
```

Expected: `via 5174` equals `8010 direct` (28) and differs from `8000 direct`. If `via 5174` equals the 8000 figure, the 5174 vite was started without `VITE_API_PROXY`; restart it with Step 2's command before going on.

- [ ] **Step 5: Record**

In the Results section below, fill the "Preconditions" row: HEAD short SHA, commit count since `ab92b91`, backend diff (empty/non-empty), token bytes, account counts.

- [ ] **Step 6: Commit the plan's Results row**

```bash
git add docs/superpowers/plans/2026-09-13-polish-v-verify.md
git commit -m "docs(plan): lane V — preconditions recorded (main state, servers, tokens, proxy proof)"
```

---

### Task 1: Gates on `main`

**Files:**
- Create: `scratchpad/ux-audit-2026-09-13/after/gates/tsc.log`, `eslint.log`, `vitest.log`, `build.log` (and `pytest.log` only if the backend diff is non-empty)
- Modify: this plan's Results → "Gates" table

- [ ] **Step 1: Type-check**

```bash
cd /c/Users/edyli/personal-finance-dashboard
npx tsc -b 2>&1 | tee scratchpad/ux-audit-2026-09-13/after/gates/tsc.log; echo "tsc exit ${PIPESTATUS[0]}"
```

Expected: no diagnostics, `tsc exit 0`.

- [ ] **Step 2: Lint and count warnings against the baseline**

```bash
npx eslint . 2>&1 | tee scratchpad/ux-audit-2026-09-13/after/gates/eslint.log | tail -3
grep -c "react-refresh/only-export-components" scratchpad/ux-audit-2026-09-13/after/gates/eslint.log
grep -E "warning|error" scratchpad/ux-audit-2026-09-13/after/gates/eslint.log | grep -vc "react-refresh/only-export-components"
```

Expected: last line `✖ N problems (0 errors, N warnings)`. Baseline on pre-batch `main` (`ab92b91`, measured 2026-09-13): **`✖ 24 problems (0 errors, 24 warnings)`**, all 24 `react-refresh/only-export-components`. Acceptance (§15.9): 0 errors and N ≤ 24 + additions a lane documented in its plan. The third command prints the count of non-react-refresh warnings — expected `0`; any other rule firing is a finding for the owning lane (record the file:line).

- [ ] **Step 3: Full vitest**

```bash
npx vitest run 2>&1 | tee scratchpad/ux-audit-2026-09-13/after/gates/vitest.log | tail -8
```

Expected: `Test Files  N passed (N)` and `Tests  M passed (M)` with no `failed`; baseline before the batch (tax batch lane V, 2026-09-12): 193 files / 2753 tests — expect both larger. Record exact N/M and the `Duration`. A failing file is a lane defect: record `file › test` and the assertion text; do not fix source here.

- [ ] **Step 4: Production build and chunk sizes**

```bash
npm run build 2>&1 | tee scratchpad/ux-audit-2026-09-13/after/gates/build.log | tail -4
grep -E '\.js\s+[0-9.,]+ kB' scratchpad/ux-audit-2026-09-13/after/gates/build.log | sed 's/,//g' | awk '{print $2, $1}' | sort -n -r | head -8
```

Expected: `✓ built in …s` with exit 0; the second command lists the eight largest chunks as `<kB> dist/assets/<name>.js`. Reference from the last batch: the tooltip chunk ≈ 748 kB. Record the top three sizes and whether any chunk crossed a new 100 kB boundary (Vite prints a `(!) Some chunks are larger than 500 kB` advisory for the tooltip chunk already — that line is pre-existing).

- [ ] **Step 5: Backend pytest — ONLY if `git diff --name-only ab92b91 HEAD -- backend` is non-empty**

```bash
git diff --name-only ab92b91 HEAD -- backend
```

Expected: **no output** (the batch touches no backend file) → write "backend untouched; pytest not run" in Results and skip the rest of this step. If any path prints, run from `backend/` with its own test DB name so a concurrent suite cannot deadlock it (`FINANCE_TEST_DB` must match `<name>_test[_suffix]`):

```bash
(cd backend && FINANCE_TEST_DB=finance_test_v .venv/Scripts/python.exe -m pytest -q 2>&1 | tee ../scratchpad/ux-audit-2026-09-13/after/gates/pytest.log | tail -3)
```

Expected: `N passed, 1 skipped in …` (baseline 2026-09-12: 1971 passed, 1 skipped), exit 0.

- [ ] **Step 6: Record**

Fill the "Gates" table in Results: tsc exit; eslint N (+ delta vs 24 and any non-react-refresh rule); vitest files/tests/duration; build status + top three chunk sizes; pytest run or skipped with the diff evidence.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/plans/2026-09-13-polish-v-verify.md
git commit -m "docs(plan): lane V — gates on merged main recorded (tsc, eslint, vitest, build)"
```

---

### Task 2: `accept.mjs` scaffold — fence, launch, helpers, report, exit code

**Files:**
- Create: `scratchpad/ux-audit-2026-09-13/accept.mjs`

- [ ] **Step 1: Write the scaffold**

Create `scratchpad/ux-audit-2026-09-13/accept.mjs` with exactly this content. The fence and launch lines are `audit.mjs`'s; `window.__acc` is a page-side helper installed by an init script so every runner shares one `durations()` / `rect()` / `vis()` / `desc()`; `RUNNERS` is filled by Tasks 3–10 in the marked region.

```js
// accept.mjs — READ-ONLY acceptance driver for the 2026-09-13 polish batch (spec §15 items 1–8).
// Same fence as audit.mjs: every non-GET /api/v1/** call is answered from memory (PATCH /prefs
// included) and recorded under writesBlocked. Each failed assertion is a problems[] entry with
// the observed numbers; exit code 1 on any problem.
// Env: APP_BASE (default http://localhost:5174 — the prod clone), TOKEN_FILE (default token-prod.txt),
//      OUT (default scratchpad/ux-audit-2026-09-13/after), WIDTH (default 1440), EDGE_PATH,
//      PLAYWRIGHT_CORE, ONLY (comma list of groups: motion,strip,orphans,layout,tables,loading,light,allocation).
Object.defineProperty(process, 'version', { value: 'v20.19.0' })
Object.defineProperty(process.versions, 'node', { value: '20.19.0' })
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? 'C:/Users/edyli/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core')
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const OUT = process.env.OUT ?? path.join(HERE, 'after')
mkdirSync(OUT, { recursive: true })
const BASE = process.env.APP_BASE ?? 'http://localhost:5174'
const TOKEN = readFileSync(process.env.TOKEN_FILE ?? path.join(HERE, 'token-prod.txt'), 'utf8').trim()
const EDGE = process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const WIDTH = Number(process.env.WIDTH ?? 1440)
const HEIGHT = WIDTH >= 1900 ? 1080 : 900
const ALL_GROUPS = ['motion', 'strip', 'orphans', 'layout', 'tables', 'loading', 'light', 'allocation']
const GROUPS = ALL_GROUPS.filter((g) => !process.env.ONLY || process.env.ONLY.split(',').includes(g))
const NOISE = /favicon|DevTools|\[vite\]|@vite\/client|React DevTools|React Router Future Flag|Failed to load resource/i
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const report = { generatedAt: new Date().toISOString(), base: BASE, width: WIDTH, groups: GROUPS, checks: [], problems: [], writesBlocked: [], files: [] }

function check(group, name, ok, observed) {
  report.checks.push({ group, name, ok: !!ok, observed: observed ?? null })
  if (!ok) report.problems.push({ group, name, observed: observed ?? null })
  console.log(`${ok ? 'ok  ' : 'FAIL'} [${group}] ${name} ${JSON.stringify(observed ?? null).slice(0, 220)}`)
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=1'] })

async function makeContext(theme, reducedMotion) {
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1, reducedMotion })
  await ctx.addInitScript(([t, th]) => { localStorage.setItem('finance_token', t); localStorage.setItem('finance.theme', th) }, [TOKEN, theme])
  await ctx.addInitScript(() => {
    const secs = (s) => String(s || '').split(',').map((v) => { v = v.trim(); return v.endsWith('ms') ? (parseFloat(v) || 0) / 1000 : parseFloat(v) || 0 })
    window.__acc = {
      // Longest animation OR transition duration on an element, in seconds ("0.24s, 0.12s" → 0.24).
      durations(sel) {
        const el = typeof sel === 'string' ? document.querySelector(sel) : sel
        if (!el) return null
        const cs = getComputedStyle(el)
        return { animation: cs.animationName + ' ' + cs.animationDuration, transition: cs.transitionProperty + ' ' + cs.transitionDuration, max: Math.max(...secs(cs.animationDuration), ...secs(cs.transitionDuration)) }
      },
      rect(el) { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) } },
      vis(el) { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden]') },
      desc(el) { if (!el) return null; return el.tagName.toLowerCase() + (el.id ? '#' + el.id.slice(0, 30) : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '') },
    }
  })
  const themeEntry = { value: theme, updated_at: new Date().toISOString() }
  await ctx.route('**/api/v1/**', async (route) => {
    const req = route.request(); const m = req.method()
    if (/\/api\/v1\/prefs/.test(req.url())) {
      if (m === 'GET') { let body = { prefs: {} }; try { body = await (await route.fetch()).json() } catch { /* empty prefs */ } body.prefs = { ...body.prefs, theme: themeEntry }; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }) }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ prefs: { theme: themeEntry } }) })
    }
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return route.continue()
    report.writesBlocked.push({ theme, method: m, url: req.url() })
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  return ctx
}

async function settle(page, ms = 15000) {
  try {
    await page.waitForFunction(() => {
      const body = document.querySelector('.page-frame-body') || document.querySelector('main')
      if (!body) return false
      if (document.querySelector('.route-fallback')) return false
      if ([...document.querySelectorAll('.skeleton')].some((s) => s.getBoundingClientRect().height > 0 && !s.closest('[hidden]'))) return false
      if (document.querySelector('.loading-dim.is-loading')) return false
      return true
    }, null, { timeout: ms })
  } catch { check('driver', `settle within ${ms}ms`, false, { url: page.url() }) }
  await sleep(600)
}

// Scroll through so every below-fold chart gets its one-shot first paint, then park at top.
async function warm(page) {
  const h = await page.evaluate(() => document.documentElement.scrollHeight)
  for (let y = 0; y < h; y += 650) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await sleep(220) }
  await page.evaluate(() => window.scrollTo(0, 0))
  await sleep(500)
}

async function open(page, route) { await page.goto(BASE + route, { waitUntil: 'commit' }); await settle(page) }

function attachConsole(page, sink) {
  page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) sink.push(m.text().slice(0, 300)) })
  page.on('pageerror', (e) => sink.push('pageerror: ' + e.message.slice(0, 300)))
}

async function shot(page, name, full = false) {
  const file = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: file, fullPage: full })
  report.files.push(path.basename(file))
  return path.basename(file)
}

// Collapse a frame trace to the frames where the watched keys changed (first 12).
const dedupe = (frames, keys) => frames.filter((f, i, a) => i === 0 || keys.some((k) => f[k] !== a[i - 1][k])).slice(0, 12)

const slug = (route) => route.replace(/^\//, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'root'

const RUNNERS = {}
// ── runners: Tasks 3–10 append their `RUNNERS.<group> = async () => { … }` blocks below this line ──

// ── main ──
try {
  for (const g of GROUPS) {
    if (!RUNNERS[g]) { console.log(`skip [${g}] (no runner yet)`); continue }
    console.log(`\n== ${g} ==`)
    try { await RUNNERS[g]() } catch (e) { check(g, 'driver error', false, { message: String(e && e.message ? e.message : e).slice(0, 300) }) }
  }
} finally {
  await browser.close()
  const file = path.join(OUT, 'accept-report.json')
  writeFileSync(file, JSON.stringify(report, null, 1))
  const n = report.problems.length
  console.log(`\nchecks ${report.checks.length}, problems ${n}, writesBlocked ${report.writesBlocked.length}; report ${file}`)
  for (const w of report.writesBlocked) console.log('WRITE BLOCKED', w.method, w.url.replace(/^.*\/api\/v1/, ''))
  for (const p of report.problems) console.log('PROBLEM', `[${p.group}] ${p.name}`, JSON.stringify(p.observed).slice(0, 300))
  console.log(n === 0 ? 'ACCEPT OK' : `ACCEPT FAILED: ${n} problems`)
  process.exitCode = n === 0 ? 0 : 1
}
```

- [ ] **Step 2: Run the empty scaffold against the clone**

```bash
cd /c/Users/edyli/personal-finance-dashboard
node scratchpad/ux-audit-2026-09-13/accept.mjs; echo "exit $?"
```

Expected (eight skip lines, then):

```
skip [motion] (no runner yet)
…
skip [allocation] (no runner yet)

checks 0, problems 0, writesBlocked 0; report C:\Users\edyli\personal-finance-dashboard\scratchpad\ux-audit-2026-09-13\after\accept-report.json
ACCEPT OK
exit 0
```

If `require` fails with `Cannot find module …playwright-core`, the npx cache moved: `ls "C:/Users/edyli/AppData/Local/npm-cache/_npx/"` and pass the folder that holds `node_modules/playwright-core` as `PLAYWRIGHT_CORE=…`.

- [ ] **Step 3: Prove the fence with a one-off GET/PATCH probe (no runner needed)**

```bash
node -e "
Object.defineProperty(process,'version',{value:'v20.19.0'});Object.defineProperty(process.versions,'node',{value:'20.19.0'});
const {chromium}=require('C:/Users/edyli/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
(async()=>{const b=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-sandbox','--disable-gpu']});
const c=await b.newContext();const blocked=[];await c.route('**/api/v1/**',r=>{const m=r.request().method();if(m==='GET')return r.continue();blocked.push(m+' '+r.request().url());return r.fulfill({status:200,contentType:'application/json',body:'{}'})});
const p=await c.newPage();await p.goto('http://localhost:5174/login',{waitUntil:'commit'});
const s=await p.evaluate(async()=>{const r=await fetch('/api/v1/prefs',{method:'PATCH',headers:{'content-type':'application/json'},body:'{}'});return r.status});
console.log('PATCH status',s,'blocked',blocked);await b.close()})()"
```

Expected: `PATCH status 200 blocked [ 'PATCH http://localhost:5174/api/v1/prefs' ]` — the PATCH never reached uvicorn (answered from memory), which is the property every runner inherits.

- [ ] **Step 4: Commit (plan only — `scratchpad/` is gitignored)**

Add a line under Results → "Driver" noting the scaffold ran clean (`checks 0, problems 0`), then:

```bash
git add docs/superpowers/plans/2026-09-13-polish-v-verify.md
git commit -m "docs(plan): lane V — accept.mjs scaffold verified (fence, launch, report, exit code)"
```

---

### Task 3: Motion checks (§15.1) — dock trace, durations, reduce, frame budget

**Files:**
- Modify: `scratchpad/ux-audit-2026-09-13/accept.mjs` (append in the runners region)

- [ ] **Step 1: Append the `motion` runner**

Paste below the `// ── runners:` marker line (above `// ── main ──`):

```js
RUNNERS.motion = async () => {
  // ── A. Dock open on Overview under no-preference: frame trace, final width, computed durations ──
  const ctx = await makeContext('dark', 'no-preference')
  const page = await ctx.newPage()
  const errors = []
  attachConsole(page, errors)
  await open(page, '/')
  const stored = await page.evaluate(() => ({
    width: localStorage.getItem('finance.detailPanel.width'),
    mode: localStorage.getItem('finance.detailPanel.mode'),
    keys: Object.keys(localStorage).filter((k) => /detailPanel|dock/i.test(k)),
  }))
  // Spec §4: default width clamp(400px, 26vw, 560px) when nothing is stored; a stored drag wins.
  const expectedWidth = stored.width ? Number(stored.width) : Math.min(560, Math.max(400, 0.26 * WIDTH))
  const hasInfo = !!(await page.$('.metric-info-button'))
  check('motion', 'Overview has a metric (i) button to open the dock', hasInfo, { stored })
  if (hasInfo) {
    const tracer = page.evaluate((ms) => new Promise((res) => {
      const out = []; const t0 = performance.now()
      const step = () => {
        const p = document.querySelector('.detail-panel'); const c = document.querySelector('.detail-layout-content')
        out.push({ t: Math.round(performance.now() - t0), pw: p ? Math.round(p.getBoundingClientRect().width) : 0, px: p ? Math.round(p.getBoundingClientRect().left) : null, m: c ? getComputedStyle(c).marginInlineEnd : null, op: p ? getComputedStyle(p).opacity : null })
        if (performance.now() - t0 < ms) requestAnimationFrame(step); else res(out)
      }
      requestAnimationFrame(step)
    }), 900)
    await page.click('.metric-info-button')
    await sleep(950)
    const frames = await tracer
    const early = frames.filter((f) => f.t <= 320)
    const distinct = new Set(early.map((f) => `${f.pw}|${f.m}`)).size
    const tail = frames.slice(-5)
    const settled = tail.length === 5 && tail.every((f) => f.pw === tail[0].pw && f.m === tail[0].m)
    check('motion', 'dock open: ≥3 distinct width/margin values within 300ms', distinct >= 3, { distinct, early: dedupe(early, ['pw', 'm', 'px']) })
    check('motion', 'dock open: final width equals the stored/default width and is settled', settled && Math.abs(tail[0].pw - expectedWidth) <= 2, { finalWidth: tail[0]?.pw, finalMargin: tail[0]?.m, expectedWidth, stored, settled })
    const d = await page.evaluate(() => ({ panel: window.__acc.durations('.detail-panel'), content: window.__acc.durations('.detail-layout-content'), dockVar: getComputedStyle(document.documentElement).getPropertyValue('--dock-width').trim() }))
    check('motion', '.detail-panel reports a non-zero animation/transition duration', !!(d.panel && d.panel.max > 0), d)
    check('motion', '.detail-layout-content transitions its margin (non-zero duration)', !!(d.content && d.content.max > 0), d.content)
    await shot(page, 'accept-dock-open')
    await page.keyboard.press('Escape'); await sleep(400)
    check('motion', 'Escape closes the single-level dock', !(await page.$('.detail-panel')), {})
  }
  // ── B. Chart Expand dialog (Net worth) ──
  await open(page, '/net-worth')
  const expandBtn = await page.$('button[aria-label^="Expand "]')
  check('motion', 'Net worth has a chart Expand button', !!expandBtn, {})
  if (expandBtn) {
    await expandBtn.click(); await sleep(120)
    const d = await page.evaluate(() => window.__acc.durations('dialog.chart-expanded-dialog[open]'))
    check('motion', 'dialog.chart-expanded-dialog[open] reports a non-zero animation duration', !!(d && d.max > 0), d)
    await sleep(500); await shot(page, 'accept-chart-expand')
    await page.keyboard.press('Escape'); await sleep(400)
  }
  // ── C. Customize popover (spec §11: button[aria-haspopup=dialog] → .popover-surface[role=dialog]) ──
  await open(page, '/')
  const opened = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-haspopup="dialog"]')].find((x) => /customize/i.test((x.textContent || '') + ' ' + (x.getAttribute('aria-label') || '')))
    if (b) { b.click(); return 'button[aria-haspopup=dialog]' }
    const s = document.querySelector('details.overview-customize > summary')
    if (s) { s.click(); return 'details.overview-customize (pre-batch fallback)' }
    return null
  })
  await sleep(120)
  const pop = await page.evaluate(() => {
    const el = document.querySelector('.popover-surface') || document.querySelector('.overview-customize-menu')
    const surface = document.querySelector('.popover-surface') ? '.popover-surface' : el ? '.overview-customize-menu (fallback)' : null
    return { surface, ...(el ? window.__acc.durations(el) : {}), role: el ? el.getAttribute('role') : null, label: el ? el.getAttribute('aria-label') : null, z: el ? getComputedStyle(el).zIndex : null }
  })
  check('motion', 'Customize opens .popover-surface[role=dialog] with a non-zero animation duration', opened === 'button[aria-haspopup=dialog]' && pop.surface === '.popover-surface' && pop.role === 'dialog' && pop.max > 0, { opened, pop })
  await shot(page, 'accept-customize-popover')
  await page.keyboard.press('Escape'); await sleep(200)
  check('motion', 'Escape closes the Customize popover', !(await page.$('.popover-surface')), {})
  // ── D. Tab-strip indicator (Portfolio) ──
  await open(page, '/portfolio')
  const ind = await page.evaluate(() => {
    const el = document.querySelector('.local-section-indicator'); if (!el) return null
    const tab = document.querySelector('.local-section-nav [role=tab][aria-selected="true"]')
    return { ...window.__acc.durations(el), placed: el.hasAttribute('data-placed'), w: Math.round(el.getBoundingClientRect().width), tabBorder: tab ? getComputedStyle(tab).borderBottomColor : null }
  })
  check('motion', '.local-section-indicator exists, is placed and reports a non-zero transition duration', !!(ind && ind.placed && ind.w > 0 && ind.max > 0), ind)
  check('motion', 'no console errors during the no-preference motion walk', errors.length === 0, errors)
  await ctx.close()

  // ── E. The same four surfaces under reducedMotion: 'reduce' read 0s ──
  const rctx = await makeContext('dark', 'reduce')
  const rpage = await rctx.newPage()
  await open(rpage, '/')
  const tokens = await rpage.evaluate(() => Object.fromEntries(['--t-fast', '--t-page', '--t-xfade', '--t-nav'].map((t) => [t, getComputedStyle(document.documentElement).getPropertyValue(t).trim()])))
  check('motion', 'reduce: every motion token reads 0ms', Object.values(tokens).every((v) => /^0m?s$/.test(v)), tokens)
  if (await rpage.$('.metric-info-button')) {
    await rpage.click('.metric-info-button'); await sleep(300)
    const d = await rpage.evaluate(() => ({ panel: window.__acc.durations('.detail-panel'), content: window.__acc.durations('.detail-layout-content') }))
    check('motion', 'reduce: .detail-panel and .detail-layout-content durations are 0s', !!(d.panel && d.panel.max === 0 && d.content && d.content.max === 0), d)
    await rpage.keyboard.press('Escape'); await sleep(300)
    check('motion', 'reduce: Escape still unmounts the panel (fallback timer, spec §2.2)', !(await rpage.$('.detail-panel')), {})
  }
  await rpage.evaluate(() => { const b = [...document.querySelectorAll('button[aria-haspopup="dialog"]')].find((x) => /customize/i.test((x.textContent || '') + ' ' + (x.getAttribute('aria-label') || ''))); if (b) b.click() })
  await sleep(120)
  const rpop = await rpage.evaluate(() => window.__acc.durations('.popover-surface'))
  check('motion', 'reduce: .popover-surface durations are 0s', !!(rpop && rpop.max === 0), rpop)
  await rpage.keyboard.press('Escape'); await sleep(150)
  await open(rpage, '/net-worth')
  const rexp = await rpage.$('button[aria-label^="Expand "]')
  if (rexp) {
    await rexp.click(); await sleep(150)
    const d = await rpage.evaluate(() => window.__acc.durations('dialog.chart-expanded-dialog[open]'))
    check('motion', 'reduce: dialog.chart-expanded-dialog[open] durations are 0s', !!(d && d.max === 0), d)
    await rpage.keyboard.press('Escape'); await sleep(300)
  }
  await open(rpage, '/portfolio')
  const rind = await rpage.evaluate(() => window.__acc.durations('.local-section-indicator'))
  check('motion', 'reduce: .local-section-indicator durations are 0s', !!(rind && rind.max === 0), rind)
  await rctx.close()

  // ── F. Frame budget: dock open on Spending (three canvases + a sankey), spec §2.2 ──
  const fctx = await makeContext('dark', 'no-preference')
  const fpage = await fctx.newPage()
  await open(fpage, '/spending'); await warm(fpage)
  const canvases = await fpage.evaluate(() => document.querySelectorAll('.page-frame-body canvas').length)
  if (await fpage.$('.metric-info-button')) {
    const tracer = fpage.evaluate((ms) => new Promise((res) => {
      const deltas = []; let last = performance.now(); const t0 = last
      const step = () => { const now = performance.now(); deltas.push(Math.round(now - last)); last = now; if (now - t0 < ms) requestAnimationFrame(step); else res(deltas) }
      requestAnimationFrame(step)
    }), 800)
    await fpage.click('.metric-info-button'); await sleep(850)
    const deltas = await tracer
    const long = deltas.filter((d) => d > 32)
    check('motion', 'Spending dock open: at most two frames over 32ms (otherwise F1 owes its documented data-panel-motion fallback)', long.length <= 2, { canvases, frames: deltas.length, long, worst: Math.max(...deltas) })
    await shot(fpage, 'accept-spending-dock')
  } else check('motion', 'Spending has a metric (i) button for the frame-budget trace', false, { canvases })
  await fctx.close()
}
```

- [ ] **Step 2: Run the group alone**

```bash
cd /c/Users/edyli/personal-finance-dashboard
ONLY=motion node scratchpad/ux-audit-2026-09-13/accept.mjs; echo "exit $?"
```

Expected (numbers indicative; every line must start `ok  `):

```
== motion ==
ok   [motion] Overview has a metric (i) button to open the dock {"stored":{"width":null,"mode":null,"keys":[]}}
ok   [motion] dock open: ≥3 distinct width/margin values within 300ms {"distinct":9,…}
ok   [motion] dock open: final width equals the stored/default width and is settled {"finalWidth":400,"finalMargin":"400px","expectedWidth":400,…}
ok   [motion] .detail-panel reports a non-zero animation/transition duration {"panel":{"animation":"detail-panel-in 0.24s",…}
ok   [motion] .detail-layout-content transitions its margin (non-zero duration) {"transition":"margin-inline-end 0.24s",…}
ok   [motion] Escape closes the single-level dock {}
ok   [motion] Net worth has a chart Expand button {}
ok   [motion] dialog.chart-expanded-dialog[open] reports a non-zero animation duration {"animation":"surface-in 0.24s",…}
ok   [motion] Customize opens .popover-surface[role=dialog] with a non-zero animation duration {"opened":"button[aria-haspopup=dialog]","pop":{"surface":".popover-surface",…"max":0.12,"role":"dialog","label":"Customize overview","z":"20"}}
ok   [motion] Escape closes the Customize popover {}
ok   [motion] .local-section-indicator exists, is placed and reports a non-zero transition duration {…"max":0.2,"placed":true,…}
ok   [motion] no console errors during the no-preference motion walk []
ok   [motion] reduce: every motion token reads 0ms {"--t-fast":"0ms","--t-page":"0ms","--t-xfade":"0ms","--t-nav":"0ms"}
ok   [motion] reduce: .detail-panel and .detail-layout-content durations are 0s …
ok   [motion] reduce: Escape still unmounts the panel (fallback timer, spec §2.2) {}
ok   [motion] reduce: .popover-surface durations are 0s …
ok   [motion] reduce: dialog.chart-expanded-dialog[open] durations are 0s …
ok   [motion] reduce: .local-section-indicator durations are 0s …
ok   [motion] Spending dock open: at most two frames over 32ms … {"canvases":4,"frames":4x,"long":[],"worst":2x}

checks 19, problems 0, writesBlocked 0; report …\after\accept-report.json
ACCEPT OK
exit 0
```

Reading a FAIL: `distinct` < 3 means the margin transition or the panel entrance did not run (F1 §2.2); `finalWidth` 440 with `expectedWidth` 400 means F1 kept the old default (spec §4 says `clamp(400px, 26vw, 560px)`); a `pop.surface` of `.overview-customize-menu (fallback)` means P1's Customize conversion (§11) is not on `main`; `long.length` > 2 is the trigger for F1's documented `data-panel-motion` fallback (spec §2.2) — record it as a follow-up, not a blocker. Pre-batch reference (`report-prod-dark-1440-both.json`, `inspector-open`): two frames only (`pw` 0 → 440 at t=83ms), `transition: "0s"` on both elements.

- [ ] **Step 3: Record**

Fill the Results → "Acceptance groups" row `motion` with checks/problems and the observed `distinct`, `finalWidth`/`expectedWidth`, the four durations, the reduce readings and the frame-budget numbers (`frames`, `long`, `worst`).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-09-13-polish-v-verify.md
git commit -m "docs(plan): lane V — motion acceptance (dock trace, durations, reduce, frame budget) recorded"
```

---

### Task 4: Tab-strip and sticky checks (§15.2, §16 risk)

**Files:**
- Modify: `scratchpad/ux-audit-2026-09-13/accept.mjs` (append in the runners region)

- [ ] **Step 1: Append the `strip` runner**

```js
RUNNERS.strip = async () => {
  const TABBED = ['/net-worth', '/portfolio', '/spending', '/credit-cards', '/paycheck', '/comp', '/espp', '/taxes', '/projection', '/settings']
  const ctx = await makeContext('dark', 'reduce')
  const page = await ctx.newPage()
  const errors = []
  attachConsole(page, errors)
  for (const route of TABBED) {
    await open(page, route)
    const rest = await page.evaluate(() => {
      const nav = document.querySelector('nav.local-section-nav'); if (!nav) return null
      const body = document.querySelector('.page-frame-body') || document.querySelector('.page')
      const scope = nav.closest('.page-frame-scope')
      return { inScope: !!scope, inSectionsRow: !!nav.closest('.page-frame-sections'), navW: Math.round(nav.getBoundingClientRect().width), contentW: Math.round(body.getBoundingClientRect().width), navTop: Math.round(nav.getBoundingClientRect().top), scopePosition: scope ? getComputedStyle(scope).position : null, toolbar: !!document.querySelector('.local-section-toolbar'), tabs: nav.querySelectorAll('[role=tab]').length, trailing: !!nav.querySelector('.segmented') }
    })
    check('strip', `${route}: nav.local-section-nav sits inside .page-frame-scope`, !!(rest && rest.inScope), rest)
    check('strip', `${route}: strip spans ≥ 90% of the content width`, !!(rest && rest.navW >= 0.9 * rest.contentW), rest && { navW: rest.navW, contentW: rest.contentW })
    check('strip', `${route}: the retired .local-section-toolbar is gone`, !!(rest && !rest.toolbar), rest && { toolbar: rest.toolbar })
    await page.evaluate(() => window.scrollTo(0, 700)); await sleep(300)
    const scrolled = await page.evaluate(() => {
      const nav = document.querySelector('nav.local-section-nav'); const scope = document.querySelector('.page-frame-scope')
      const n = nav ? nav.getBoundingClientRect() : null; const s = scope ? scope.getBoundingClientRect() : null
      return { scrollY: Math.round(window.scrollY), scrollable: document.documentElement.scrollHeight > window.innerHeight + 50, navTop: n ? Math.round(n.top) : null, navBottom: n ? Math.round(n.bottom) : null, scopeTop: s ? Math.round(s.top) : null, stuck: !!(scope && scope.classList.contains('is-stuck')) }
    })
    check('strip', `${route}: strip still in view after a 700px scroll`, scrolled.navTop !== null && scrolled.navTop >= 0 && scrolled.navBottom <= HEIGHT, scrolled)
    check('strip', `${route}: .page-frame-scope still sticks (top ≥ 0, is-stuck when scrollable)`, scrolled.scopeTop !== null && scrolled.scopeTop >= 0 && (!scrolled.scrollable || scrolled.stuck), scrolled)
    await shot(page, `accept-strip-${slug(route)}-scrolled`)
  }
  // §16 risk: container-type: inline-size on .page must not unstick the wizard's .entry-footer.
  await open(page, '/update'); await warm(page)
  await page.evaluate(() => window.scrollTo(0, 400)); await sleep(300)
  const ef = await page.evaluate(() => {
    const f = document.querySelector('.entry-footer'); if (!f) return null
    const r = f.getBoundingClientRect(); const pageEl = document.querySelector('.page')
    return { position: getComputedStyle(f).position, top: Math.round(r.top), bottom: Math.round(r.bottom), inView: r.top >= 0 && r.bottom <= window.innerHeight, scrollY: Math.round(window.scrollY), scrollable: document.documentElement.scrollHeight > window.innerHeight + 50, pageContainerType: pageEl ? getComputedStyle(pageEl).containerType : null }
  })
  check('strip', '/update: the wizard .entry-footer is still in view mid-scroll (sticky survives container-type)', !!(ef && ef.inView), ef)
  check('strip', 'no console errors during the strip walk', errors.length === 0, errors)
  await ctx.close()
}
```

- [ ] **Step 2: Run the group alone**

```bash
ONLY=strip node scratchpad/ux-audit-2026-09-13/accept.mjs; echo "exit $?"
```

Expected: 10 routes × 5 checks + 2 = **52 `ok` lines**, then `checks 52, problems 0 … ACCEPT OK`, `exit 0`. Pre-batch reference (`summary-prod-dark-1440.txt`): `contentW` 1151 on every page; nav widths were 1151 except Net worth 1001 (shared toolbar) and Settings **423** — both must now read ≥ 1036. Observed `inSectionsRow: true` confirms the §3 wrapper; `trailing: true` on `/net-worth` confirms the Monthly/Quarterly `Segmented` moved into the strip.

Reading a FAIL: `inScope: false` with `navTop` > 200 on a page = that page was not rewired to `sections=` (F2 §3 lists all ten); `navW` < 0.9 × `contentW` on `/settings` = the strip still sits in the old `scopeRow` slot; `stuck: false` while `scrollable: true` = the sentinel/IntersectionObserver broke under the new wrapper; `ef.inView: false` = the §16 container-type risk materialised.

- [ ] **Step 3: Record**

Fill Results → `strip` row: per-route `navW/contentW` (ten pairs), any route failing, and the `/update` footer reading.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-09-13-polish-v-verify.md
git commit -m "docs(plan): lane V — tab-strip placement and sticky checks recorded"
```

---

### Task 5: Orphan-text checks (§15.3)

**Files:**
- Modify: `scratchpad/ux-audit-2026-09-13/accept.mjs` (append in the runners region)

- [ ] **Step 1: Append the `orphans` runner**

The instrument is `audit.mjs`'s own orphan block (same `CONTAINERS` list, same tag list, same 60 cap) so the after-numbers are comparable with `summary-prod-*.txt`. One refinement, documented in the code: nodes at most 1×1 px or inside `.visually-hidden` are skipped — P4 turns Settings' five `h2.settings-section` bands `visually-hidden` (spec §10) and the house rule (`panels.css:649`) keeps a 1×1 clipped box that the audit's `vis()` would count as visible text. A screen-reader-only heading is not text outside a boundary.

```js
RUNNERS.orphans = async () => {
  const ORPHAN_FN = `(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden]') && !el.closest('.visually-hidden') }
    const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) } }
    const desc = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id.slice(0, 30) : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.') : '')
    const chain = (el, n = 3) => { const out = []; let cur = el; for (let i = 0; i < n && cur && cur !== document.body; i++) { out.push(desc(cur)); cur = cur.parentElement } return out.join(' < ') }
    const body = document.querySelector('.page-frame-body') || document.querySelector('main') || document.body
    const CONTAINERS = '.card,.panel,.chart-card,.stat-tile,.attention-item,.sandbox-card,dialog,.detail-panel,.assistant-drawer,table,.page-frame-header,.page-frame-scope,.page-frame-subheader,.local-section-nav,.wizard-steps,.wizard-footer,.entry-footer,.error-banner,.draft-note,.sidebar,aside,nav,header,footer,.toast-region,.command-palette,.scope-bar,.segmented,button,a,select,label,.review-confirmations,.month-review-status,.projection-outcomes,.kpi-row,.up-next,.field,fieldset,.assistant-launcher'
    const orphans = []
    for (const el of body.querySelectorAll('p,small,span,h2,h3,h4,li,dt,dd,div,strong,em')) {
      if (!vis(el)) continue
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim()
      if (!own) continue
      if (el.closest(CONTAINERS)) continue
      orphans.push({ el: chain(el), text: own.slice(0, 140), rect: rect(el) })
      if (orphans.length > 60) break
    }
    return orphans
  })()`
  const ROUTES = [
    { path: '/', sections: [] },
    { path: '/spending', sections: ['overview', 'trends', 'budgets', 'history'] },
    { path: '/net-worth', sections: ['overview', 'accounts'] },
    { path: '/paycheck', sections: ['summary', 'changes', 'profiles'] },
    { path: '/projection', sections: ['planning', 'trend'] },
    { path: '/settings', sections: ['household', 'planning', 'account', 'integrations', 'data'] },
    { path: '/calendar', sections: [], clickText: ['List'] },
    // Not in §15.3's list; walked with its one subheader line allowlisted (spec §10, row "Portfolio").
    { path: '/portfolio', sections: ['overview', 'holdings', 'allocation', 'income', 'manage'], allow: (o) => /page-frame-subheader/.test(o.el) || /^Prices as of /.test(o.text) },
  ]
  const ctx = await makeContext('dark', 'reduce')
  const page = await ctx.newPage()
  const errors = []
  attachConsole(page, errors)
  for (const route of ROUTES) {
    await open(page, route.path); await warm(page)
    const record = async (sectionName) => {
      const all = await page.evaluate(ORPHAN_FN)
      const kept = route.allow ? all.filter((o) => !route.allow(o)) : all
      check('orphans', `${route.path} [${sectionName}]: no text outside a section boundary`, kept.length === 0, { orphans: kept.map((o) => `${o.el} :: "${o.text}" @y=${o.rect.y}`), allowlisted: all.length - kept.length })
    }
    await record(route.sections[0] ?? 'default')
    for (const section of route.sections.slice(1)) {
      const clicked = await page.evaluate((s) => { const t = document.querySelector(`[role=tab][id$="-tab-${s}"]`); if (!t) return false; t.click(); return true }, section)
      if (!clicked) { check('orphans', `${route.path}: tab "${section}" exists`, false, {}); continue }
      await settle(page); await warm(page)
      await record(section)
    }
    for (const text of route.clickText ?? []) {
      const ok = await page.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === t); if (!b) return false; b.click(); return true }, text)
      if (ok) { await settle(page); await warm(page); await record(text.toLowerCase()) }
      else check('orphans', `${route.path}: "${text}" toggle exists`, false, {})
    }
  }
  check('orphans', 'no console errors during the orphan walk', errors.length === 0, errors)
  await ctx.close()
}
```

- [ ] **Step 2: Run the group alone**

```bash
ONLY=orphans node scratchpad/ux-audit-2026-09-13/accept.mjs; echo "exit $?"
```

Expected: 1 + 4 + 2 + 3 + 2 + 5 + 2 + 5 = 24 view checks + 1 console check = **25 `ok` lines**, `ACCEPT OK`, `exit 0`. Pre-batch reference (`summary-prod-dark-1440.txt`) — each of these must now be gone: Overview `p.drill-hint` "Living spending: Unreviewed history…" and the eight `span.freshness` clocks (→ the Data status card, §10); Net worth `dl.networth-owner-strip` dt/dd on both sections (→ the ChartCard `lede`); Spending `p.drill-hint.spending-metric-context` (→ tile `delta`/`badge`); Paycheck `p.drill-hint` "Edward + Grace — …" (→ household tile `delta`); Projection `p.projection-method-note` + `div.projection-warnings p` (→ chart card footer/lede) and `p.projection-view-intro` (→ trend card `lede`); Settings `h2#sec-*.settings-section` ×5 (→ `visually-hidden`). A FAIL prints each surviving node as `chain :: "text" @y=` — that is the exact line for the owning lane.

- [ ] **Step 3: Record**

Fill Results → `orphans` row: 25 checks, the surviving orphan lines per route (or "none"), and the Portfolio `allowlisted` count (expected 1 — the subheader line).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-09-13-polish-v-verify.md
git commit -m "docs(plan): lane V — orphan-text acceptance recorded"
```

---

### Task 6: Layout checks (§15.4) — Overview columns, Settings slack, Allocation single card, Projection band, KPI rows under a dock

**Files:**
- Modify: `scratchpad/ux-audit-2026-09-13/accept.mjs` (append in the runners region)

- [ ] **Step 1: Append the `layout` runner**

```js
RUNNERS.layout = async () => {
  const ctx = await makeContext('dark', 'reduce')
  const page = await ctx.newPage()
  const errors = []
  attachConsole(page, errors)
  // 4a. Overview: the two primary columns end within 24px of each other (spec §10: the Data-status card fills the agenda column).
  await open(page, '/'); await warm(page)
  const ov = await page.evaluate(() => {
    const a = document.querySelector('.overview-wealth-column'); const b = document.querySelector('.overview-agenda-column'); if (!a || !b) return null
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
    return { wealthBottom: Math.round(ra.bottom + scrollY), agendaBottom: Math.round(rb.bottom + scrollY), gap: Math.round(Math.abs(ra.bottom - rb.bottom)), agendaCards: [...b.querySelectorAll('.card > .eyebrow')].map((e) => e.textContent.trim()) }
  })
  check('layout', '.overview-primary: column bottoms within 24px', !!(ov && ov.gap <= 24), ov)
  check('layout', 'Overview agenda column carries the Data status card (spec §10)', !!(ov && ov.agendaCards.some((t) => /^Data status$/i.test(t))), ov && ov.agendaCards)
  await shot(page, 'accept-layout-overview', true)
  // 4b. Settings Household card slack ≤ 24px (spec §12: .settings-page .card-grid { align-items: start }; §7: Categories span-8, Household span-4).
  await open(page, '/settings?section=household'); await warm(page)
  const hh = await page.evaluate(() => {
    const card = document.querySelector('#household'); if (!card) return null
    const kids = [...card.children].filter(window.__acc.vis); const cr = card.getBoundingClientRect(); const cs = getComputedStyle(card)
    const bottom = Math.max(...kids.map((k) => k.getBoundingClientRect().bottom))
    return { slack: Math.round(cr.bottom - parseFloat(cs.paddingBottom) - bottom), h: Math.round(cr.height), gridAlign: getComputedStyle(card.parentElement).alignItems, spans: [...card.parentElement.children].filter(window.__acc.vis).map((c) => (c.id || c.tagName.toLowerCase()) + ':' + ([...c.classList].find((x) => /^span-/.test(x)) || '')) }
  })
  check('layout', 'Settings #household card slack ≤ 24px', !!(hh && hh.slack <= 24), hh)
  await shot(page, 'accept-layout-settings-household', true)
  // 4c. Allocation: one card, no stretched twin (spec §13: .allocation-overview-grid / .allocation-ranked are gone; §12: .panel → .card; §12: donut ChartCard carries an aside).
  await open(page, '/portfolio?section=allocation'); await warm(page)
  const al = await page.evaluate(() => {
    const ws = document.querySelector('.allocation-workspace') || document.querySelector('.local-section-panel:not([hidden])')
    const cards = ws ? [...ws.querySelectorAll('.card')].filter((c) => window.__acc.vis(c) && !c.parentElement.closest('.card')) : []
    const hollow = cards.map((card) => { const kids = [...card.children].filter(window.__acc.vis); const cr = card.getBoundingClientRect(); const cs = getComputedStyle(card); const bottom = kids.length ? Math.max(...kids.map((k) => k.getBoundingClientRect().bottom)) : cr.top; const head = card.querySelector('.eyebrow, h2'); return { card: head ? head.textContent.trim().slice(0, 40) : card.className.split(' ').slice(0, 2).join('.'), slack: Math.round(cr.bottom - parseFloat(cs.paddingBottom) - bottom), h: Math.round(cr.height) } })
    return { legacyGrid: !!document.querySelector('.allocation-overview-grid'), legacyRanked: !!document.querySelector('.allocation-ranked'), panelClass: document.querySelectorAll('.local-section-panel:not([hidden]) .panel').length, withAside: !!document.querySelector('.chart-card-with-aside'), hollow }
  })
  check('layout', 'Allocation: legacy two-column grid and .panel vocabulary are gone; the donut card carries an aside', !!(al && !al.legacyGrid && !al.legacyRanked && al.panelClass === 0 && al.withAside), al && { legacyGrid: al.legacyGrid, legacyRanked: al.legacyRanked, panelClass: al.panelClass, withAside: al.withAside })
  check('layout', 'Allocation: no top-level card carries ≥ 48px of slack (no stretched twin)', !!(al && al.hollow.length > 0 && al.hollow.every((h) => h.slack < 48)), al && al.hollow)
  await shot(page, 'accept-layout-allocation', true)
  // 4d. Projection band: one row at 1440 without a dock (spec §12: .kpi-row-5 inside @container (min-width: 1000px)).
  await open(page, '/projection'); await warm(page)
  const po = await page.evaluate(() => {
    const el = document.querySelector('.projection-outcomes'); if (!el) return null
    const tiles = [...el.children].filter(window.__acc.vis); const tops = new Set(tiles.map((t) => Math.round(t.getBoundingClientRect().top)))
    return { h: Math.round(el.getBoundingClientRect().height), tiles: tiles.length, rows: tops.size, position: getComputedStyle(el).position, classes: el.className }
  })
  check('layout', '.projection-outcomes renders one row (height ≤ 130px) at 1440', !!(po && po.h <= 130 && po.rows === 1), po)
  // 4e. KPI rows with the dock open: no lone last tile narrower than its row (spec §12: .kpi-row > :last-child { grid-column-end: -1 }).
  const KPI_ROUTES = ['/', '/net-worth', '/portfolio', '/spending', '/credit-cards', '/paycheck', '/comp', '/espp', '/projection', '/calendar']
  for (const route of KPI_ROUTES) {
    await open(page, route)
    const info = await page.$('.metric-info-button')
    if (info) { await info.click(); await sleep(500) }
    const rows = await page.evaluate(() => [...document.querySelectorAll('.kpi-row')].filter(window.__acc.vis).map((row) => {
      const tiles = [...row.children].filter(window.__acc.vis); const rr = row.getBoundingClientRect()
      const byTop = new Map(); for (const t of tiles) { const k = Math.round(t.getBoundingClientRect().top); byTop.set(k, [...(byTop.get(k) ?? []), t]) }
      const lines = [...byTop.values()]; const last = lines[lines.length - 1] ?? []
      const loneLastW = last.length === 1 ? Math.round(last[0].getBoundingClientRect().width) : null
      return { row: row.className, tiles: tiles.length, lines: lines.length, rowW: Math.round(rr.width), loneLastW, lone: lines.length > 1 && last.length === 1 && loneLastW < Math.round(rr.width) - 2 }
    }))
    const contentW = await page.evaluate(() => Math.round(document.querySelector('.page-frame-body').getBoundingClientRect().width))
    check('layout', `${route}: no .kpi-row leaves a lone narrower last tile (dock ${info ? 'open' : 'unavailable on this page'})`, rows.every((r) => !r.lone), { dock: !!info, contentW, rows })
    if (info) await shot(page, `accept-kpi-${slug(route)}-dock`)
  }
  check('layout', 'no console errors during the layout walk', errors.length === 0, errors)
  await ctx.close()
}
```

- [ ] **Step 2: Run the group alone**

```bash
ONLY=layout node scratchpad/ux-audit-2026-09-13/accept.mjs; echo "exit $?"
```

Expected: 2 + 1 + 2 + 1 + 10 + 1 = **17 `ok` lines**, `ACCEPT OK`, `exit 0`. Indicative observations: `ov.gap` ≤ 24 with `agendaCards` containing `"Data status"`; `hh.slack` single digits with `gridAlign: "start"` and `spans` showing `categories:span-8`, `household:span-4`, `accounts:span-12`; `al.withAside: true`, `panelClass: 0`; `po` `{h: ~118, tiles: 5, rows: 1, position: "sticky"}`; every `rows[i].lone` false — with the dock open the content column is ≈ 1151 − 400 = 751 px wide, so a five-tile strip wraps 3 + 2 (two lines, last line has two tiles → not lone) or 4 + 1 where the lone tile spans the full row (`loneLastW` = `rowW`). The dock is unavailable on `/credit-cards`, `/comp` and `/espp` (no metric (i) button, pre-batch report) — those rows are measured at full width and say so.

Reading a FAIL: `ov.gap` > 24 = P1's Data-status card did not land or the agenda column still ends at Up next; `hh.slack` ≥ 48 = the `align-items: start` rule (F2 §12) or the span change (P4 §7) is missing; `legacyGrid: true` = P2's §13 single-card rewrite is not on `main`; `po.rows: 2` = the `.kpi-row-5` container rule (F2 §12) is missing or Projection did not adopt the class; a `lone: true` row names the page and the row class.

- [ ] **Step 3: Record**

Fill Results → `layout` row with `gap`, `slack`, the allocation flags, `po.h`/`rows`, and the per-route lone-tile verdicts.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-09-13-polish-v-verify.md
git commit -m "docs(plan): lane V — layout acceptance (columns, slack, allocation card, band, KPI rows) recorded"
```

---

### Task 7: Table checks (§15.5) — row actions in view on the five wide tables

**Files:**
- Modify: `scratchpad/ux-audit-2026-09-13/accept.mjs` (append in the runners region)

- [ ] **Step 1: Append the `tables` runner**

`headerMatch` picks the right table where a section holds two scrollers: Comp Manage has the focal history (`CompPage.tsx:383`, header "Current base") and the RSU grants table (`RsuGrantsPanel.tsx:450`); ESPP Lots has the lots table (header "Cost basis") and the offerings table ("Subscription price"). The purchase modeler's action cell (`EsppPage.tsx` ~1214, `td.row-actions`) is conditional per row, so the driver takes the first row that has a button and records which row that was.

```js
RUNNERS.tables = async () => {
  const TABLES = [
    { url: '/paycheck?section=profiles', scroller: '.paycheck-scroll', headerMatch: 'Salary', label: 'Paycheck Profiles history' },
    { url: '/comp?section=manage', scroller: '.comp-scroll', headerMatch: 'Current base', label: 'Comp Focal history (default column set)' },
    { url: '/espp?section=lots', scroller: '.espp-scroll', headerMatch: 'Cost basis', label: 'ESPP Lots' },
    { url: '/espp?section=purchase', scroller: '.espp-scroll', headerMatch: 'Carry out', label: 'ESPP Purchase modeler' },
    { url: '/settings?section=household', scroller: '#categories .settings-scroll', headerMatch: 'Kind', label: 'Settings Categories' },
  ]
  const ctx = await makeContext('dark', 'reduce')
  const page = await ctx.newPage()
  const errors = []
  attachConsole(page, errors)
  for (const t of TABLES) {
    await open(page, t.url); await warm(page)
    const r = await page.evaluate(([sel, head]) => {
      const scrollers = [...document.querySelectorAll(sel)].filter((s) => window.__acc.vis(s) && s.querySelector('tbody tr') && (s.querySelector('thead') || s).textContent.includes(head))
      const scroller = scrollers[0]
      if (!scroller) return { found: false, candidates: document.querySelectorAll(sel).length, head }
      const rows = [...scroller.querySelectorAll('tbody tr')]
      const row = rows.find((tr) => tr.querySelector('button')) ?? rows[0]
      const buttons = row ? [...row.querySelectorAll('button')] : []
      const btn = buttons[buttons.length - 1]
      const cell = btn ? btn.closest('td') : null
      const sr = scroller.getBoundingClientRect()
      const chip = (scroller.closest('.card, .local-section-panel') || document).querySelector('.segmented button.active')
      return { found: true, rows: rows.length, rowIndex: row ? rows.indexOf(row) : -1, buttons: buttons.length, label: btn ? (btn.getAttribute('aria-label') || btn.textContent.trim()).slice(0, 60) : null, right: btn ? Math.round(btn.getBoundingClientRect().right) : null, innerWidth, scrollerRight: Math.round(sr.right), overflow: scroller.scrollWidth > scroller.clientWidth + 1, scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth, scrollLeft: scroller.scrollLeft, cellPosition: cell ? getComputedStyle(cell).position : null, cellClass: cell ? cell.className : null, scrollMore: scroller.getAttribute('data-scroll-more'), columnSet: chip ? chip.textContent.trim() : null }
    }, [t.scroller, t.headerMatch])
    check('tables', `${t.label}: first data row's last action button is inside the viewport at 1440 without scrolling`, r.found && r.buttons > 0 && r.right !== null && r.right <= WIDTH && r.right <= r.scrollerRight + 1 && r.scrollLeft === 0, r)
    check('tables', `${t.label}: the action cell is sticky (td.row-actions) whenever the table overflows`, r.found && (!r.overflow || (r.cellPosition === 'sticky' && /row-actions/.test(r.cellClass || ''))), r.found ? { overflow: r.overflow, scrollWidth: r.scrollWidth, clientWidth: r.clientWidth, cellPosition: r.cellPosition, cellClass: r.cellClass, scrollMore: r.scrollMore } : r)
    await shot(page, `accept-table-${slug(t.url)}`)
  }
  check('tables', 'no console errors during the table walk', errors.length === 0, errors)
  await ctx.close()
}
```

- [ ] **Step 2: Run the group alone**

```bash
ONLY=tables node scratchpad/ux-audit-2026-09-13/accept.mjs; echo "exit $?"
```

Expected: 5 × 2 + 1 = **11 `ok` lines**, `ACCEPT OK`, `exit 0`. Indicative observations: Paycheck `{rows: ≥1, buttons: ≥1, right: ~1380, scrollerRight: ~1393, overflow: true, cellPosition: "sticky", cellClass: "row-actions", scrollMore: "right"}`; Comp `{overflow: false, columnSet: "Entered"}` (spec §7: the default column set fits 1440, so nothing needs to be sticky there); ESPP lots/modeler and Settings Categories with `overflow` either way and `right ≤ 1440`.

Reading a FAIL: `found: false` = the table did not render (no data rows on the clone for that section — record it; the clone has profiles, grants, lots and categories) or the section's scroller class changed; `right > scrollerRight` with `cellPosition: "static"` = the page lane did not add `td.row-actions` + `useScrollEdges` (spec §7); `columnSet: null` on Comp = the "Entered | Computed | All" `Segmented` is missing.

- [ ] **Step 3: Record**

Fill Results → `tables` row with the five `right/scrollerRight/overflow/cellPosition` tuples and the Comp `columnSet`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-09-13-polish-v-verify.md
git commit -m "docs(plan): lane V — wide-table row-action acceptance recorded"
```

---

### Task 8: Loading-state checks (§15.6) — `/update` skeleton, Settings ghosts, Accounts card height

**Files:**
- Modify: `scratchpad/ux-audit-2026-09-13/accept.mjs` (append in the runners region)

- [ ] **Step 1: Append the `loading` runner**

The `/update` probe is `probe-update-timing.mjs`'s rAF poll from navigation commit, with "first real card" defined as a `.card` that is not inside the page skeleton (`PageSkeleton` renders its ghost cards as `section.card` too). The Settings tab probe clicks the tab from inside the page (`tab.click()`), so no pointer hover fires the §9 prefetch, and it watches the **target** panel (`aria-controls`) rather than "whatever panel is visible" so the previous section's settled cards cannot answer for the new one.

```js
RUNNERS.loading = async () => {
  // 6a. /update: a .skeleton inside .page-frame-body before the first real card (spec §9), cold and warm.
  for (let i = 0; i < 2; i++) {
    const ctx = await makeContext('dark', 'reduce')
    const page = await ctx.newPage()
    await page.goto(BASE + '/update', { waitUntil: 'commit' })
    const t = await page.evaluate(() => new Promise((res) => {
      const t0 = performance.now(); let bodyAt = null, skeletonAt = null, cardAt = null
      const tick = () => {
        const now = Math.round(performance.now() - t0)
        const body = document.querySelector('.page-frame-body')
        if (body && bodyAt === null) bodyAt = now
        if (skeletonAt === null && document.querySelector('.page-frame-body .skeleton')) skeletonAt = now
        if (cardAt === null && [...document.querySelectorAll('.page-frame-body .card')].some((c) => !c.closest('.page-skeleton, .loading-fallback') && !c.querySelector('.skeleton'))) cardAt = now
        if ((skeletonAt !== null && cardAt !== null) || now > 20000) return res({ bodyAt, skeletonAt, cardAt })
        requestAnimationFrame(tick)
      }
      tick()
    }))
    check('loading', `/update run ${i + 1} (${i === 0 ? 'cold' : 'warm'}): a .skeleton shows inside .page-frame-body before the first real card`, t.skeletonAt !== null && (t.cardAt === null || t.skeletonAt <= t.cardAt), t)
    if (i === 1) { await settle(page); await shot(page, 'accept-loading-update', true) }
    await ctx.close()
  }
  // 6b. Settings: the Accounts card's height changes at most once after mount (spec §9: AccountsCard renders once after Promise.all).
  const ctx = await makeContext('dark', 'reduce')
  const page = await ctx.newPage()
  await page.goto(BASE + '/settings?section=household', { waitUntil: 'commit' })
  const acc = await page.evaluate(() => new Promise((res) => {
    const t0 = performance.now(); const heights = []; let last = null
    const tick = () => {
      const now = Math.round(performance.now() - t0); const el = document.querySelector('#accounts')
      if (el) {
        const h = Math.round(el.getBoundingClientRect().height)
        if (h !== last) { const note = el.querySelector('.empty-note'); heights.push({ t: now, h, ghost: !!el.querySelector('.skeleton'), loadingNote: !!(note && /^Loading/.test(note.textContent)) }); last = h }
      }
      const deadline = heights.length ? heights[0].t + 3000 : 15000
      if (now > deadline) return res(heights)
      requestAnimationFrame(tick)
    }
    tick()
  }))
  check('loading', 'Settings Accounts card: height changes at most once after mount (3s watch)', acc.length > 0 && acc.length - 1 <= 1, acc)
  check('loading', 'Settings Accounts card: never shows a "Loading…" empty-note (ghost instead)', acc.length > 0 && acc.every((h) => !h.loadingNote), acc)
  await settle(page)
  // 6c. Settings tabs: a ghost (or already-settled content) in the TARGET panel within 100ms of a click.
  for (const section of ['planning', 'account', 'integrations', 'data']) {
    const r = await page.evaluate((s) => new Promise((res) => {
      const tab = document.querySelector(`[role=tab][id$="-tab-${s}"]`); if (!tab) return res({ tab: false })
      const panel = document.getElementById(tab.getAttribute('aria-controls'))
      const t0 = performance.now(); tab.click()
      let visibleAt = null, ghostAt = null, contentAt = null, first = null, loadingNote = false
      const tick = () => {
        const now = Math.round(performance.now() - t0)
        const visible = !!(panel && !panel.hidden)
        const ghost = visible && !!panel.querySelector('.skeleton, .skeleton-card, .ghost-card')
        const notes = visible ? [...panel.querySelectorAll('.empty-note')].filter((n) => /^Loading/.test(n.textContent)) : []
        const settledCard = visible && [...panel.querySelectorAll('.card')].some((c) => !c.querySelector('.skeleton') && ![...c.querySelectorAll('.empty-note')].some((n) => /^Loading/.test(n.textContent)))
        if (visible && visibleAt === null) visibleAt = now
        if (visible && first === null) first = { t: now, ghost, settled: settledCard }
        if (ghostAt === null && ghost) ghostAt = now
        if (contentAt === null && settledCard) contentAt = now
        if (notes.length) loadingNote = true
        if (now > 3000 || (visible && !ghost && settledCard && contentAt !== null && now - contentAt > 200)) return res({ tab: true, panel: panel ? panel.id.slice(-18) : null, visibleAt, first, ghostAt, contentAt, loadingNote })
        requestAnimationFrame(tick)
      }
      tick()
    }), section)
    check('loading', `Settings tab "${section}": a ghost (or settled card) shows within 100ms of the click`, r.tab && ((r.ghostAt !== null && r.ghostAt <= 100) || (r.first !== null && r.first.settled && r.first.t <= 100)), r)
    check('loading', `Settings tab "${section}": no "Loading…" empty-note appears`, r.tab && !r.loadingNote, r.tab ? { loadingNote: r.loadingNote } : r)
    await settle(page)
  }
  await shot(page, 'accept-loading-settings-data', true)
  await ctx.close()
}
```

- [ ] **Step 2: Run the group alone**

```bash
ONLY=loading node scratchpad/ux-audit-2026-09-13/accept.mjs; echo "exit $?"
```

Expected: 2 + 2 + 4 × 2 = **12 `ok` lines**, `ACCEPT OK`, `exit 0`. Indicative observations: `/update` `{bodyAt: ~40, skeletonAt: ~40, cardAt: ~900–2500}` on both runs (pre-batch, `probe-update-timing.mjs` recorded `skeleton@never` and a blank body window ≈ 2s); Accounts `[{t, h: ~1045, ghost: true}, {t, h: ~1045±, ghost: false}]` — two entries, i.e. one change (the ghost's reserved height ≈ the loaded height is the §9 intent, so a single entry is also a pass); each tab `{visibleAt: 0–16, first: {ghost: true, …}, ghostAt: ≤ 32, contentAt: …, loadingNote: false}` or `first.settled: true` when the section prefetched.

Reading a FAIL: `skeletonAt: null` = P1's `resource.status` still reads `ready` before the first data (spec §9); Accounts with three entries = the two fetches still render separately (no `Promise.all`); `ghostAt: null` with `first.settled: false` and `loadingNote: true` = P4's GhostCards did not replace the `Loading…` notes for that section.

- [ ] **Step 3: Record**

Fill Results → `loading` row with both `/update` timings, the Accounts height list, and the four tab `ghostAt`/`first` readings.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-09-13-polish-v-verify.md
git commit -m "docs(plan): lane V — loading-state acceptance recorded"
```

---

### Task 9: Light-theme checks (§15.7) — segmented fill contrast and hairline colour

**Files:**
- Modify: `scratchpad/ux-audit-2026-09-13/accept.mjs` (append in the runners region)

- [ ] **Step 1: Append the `light` runner**

WCAG relative luminance (sRGB linearisation, 0.2126/0.7152/0.0722) and contrast `(L1 + 0.05) / (L2 + 0.05)` are implemented in the page. Computed colours come back as `rgb()`/`rgba()`; a `color-mix()` result serialises as `color(srgb r g b / a)` in Chromium, so both forms are parsed and a translucent fill is composited over the card's own background before the ratio is taken. Identical (control, fill, card) triples collapse to one check so a per-row `Segmented` (Settings Categories) does not produce twenty lines. `--border` is read as a computed colour by painting a probe span with `color: var(--border)` — comparing strings against the authored hex would fail on format alone.

```js
RUNNERS.light = async () => {
  // Routes with a Segmented inside a .card and/or a .data-table: Appearance (3 controls), Categories (per-row kind), Overview MoneyFlow, ESPP anatomy toggle, Paycheck profiles table.
  const LIGHT_ROUTES = ['/settings?section=account', '/settings?section=household', '/', '/espp', '/paycheck?section=profiles']
  const ctx = await makeContext('light', 'reduce')
  const page = await ctx.newPage()
  const errors = []
  attachConsole(page, errors)
  const measured = []
  for (const route of LIGHT_ROUTES) {
    await open(page, route); await warm(page)
    const r = await page.evaluate(() => {
      const parse = (c) => {
        const s = String(c); let m = s.match(/rgba?\(([^)]+)\)/)
        if (m) { const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } }
        m = s.match(/color\(srgb ([^)]+)\)/)
        if (m) { const p = m[1].split(/[\s\/]+/).filter(Boolean).map(Number); return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p.length > 3 ? p[3] : 1 } }
        return null
      }
      const bgOf = (el) => { let cur = el; while (cur) { const c = parse(getComputedStyle(cur).backgroundColor); if (c && c.a > 0) return c; cur = cur.parentElement } return { r: 255, g: 255, b: 255, a: 1 } }
      const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 })
      const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
      const contrast = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) }
      const pairs = []; const seen = new Set()
      for (const btn of document.querySelectorAll('.segmented button.active')) {
        if (!window.__acc.vis(btn)) continue
        const card = btn.closest('.card'); if (!card) continue
        const cardBg = bgOf(card); const raw = parse(getComputedStyle(btn).backgroundColor); const btnBg = raw && raw.a > 0 ? blend(raw, cardBg) : cardBg
        const p = { control: (btn.closest('.segmented').getAttribute('aria-label') || '').slice(0, 40), card: card.id || card.className.split(' ').slice(0, 2).join('.'), btnBg: getComputedStyle(btn).backgroundColor, cardBg: getComputedStyle(card).backgroundColor, ratio: Math.round(contrast(btnBg, cardBg) * 1000) / 1000 }
        const key = `${p.control}|${p.btnBg}|${p.cardBg}`
        if (!seen.has(key)) { seen.add(key); pairs.push(p) }
      }
      const probe = document.createElement('span'); probe.style.color = 'var(--border)'; document.body.appendChild(probe); const borderRgb = getComputedStyle(probe).color; probe.remove()
      const tds = [...document.querySelectorAll('.data-table td')].filter(window.__acc.vis).slice(0, 4).map((td) => getComputedStyle(td).borderBottomColor)
      const root = getComputedStyle(document.documentElement)
      return { theme: document.documentElement.dataset.theme, pageLum: Math.round(lum(bgOf(document.body)) * 1000) / 1000, pairs, borderRgb, tds, tokens: { fill: root.getPropertyValue('--fill').trim(), scrim: root.getPropertyValue('--scrim').trim(), shadow: root.getPropertyValue('--shadow').trim(), border: root.getPropertyValue('--border').trim() } }
    })
    measured.push({ route, ...r })
    check('light', `${route}: light theme is active (data-theme=light, page luminance > 0.5)`, r.theme === 'light' && r.pageLum > 0.5, { theme: r.theme, pageLum: r.pageLum })
    for (const p of r.pairs) check('light', `${route}: .segmented button.active vs its card ≥ 1.15:1 (${p.control || p.card})`, p.ratio >= 1.15, p)
    if (r.tds.length) check('light', `${route}: .data-table td border-bottom-color equals --border`, r.tds.every((c) => c === r.borderRgb), { tds: r.tds, borderRgb: r.borderRgb })
    await shot(page, `accept-light-${slug(route)}`, true)
  }
  check('light', 'at least one active segmented button inside a card was measured', measured.some((m) => m.pairs.length > 0), measured.map((m) => ({ route: m.route, pairs: m.pairs.length })))
  check('light', 'at least one .data-table td was measured', measured.some((m) => m.tds.length > 0), measured.map((m) => ({ route: m.route, tds: m.tds.length })))
  check('light', '--fill, --scrim and --shadow are declared in the light theme (spec §6)', measured.every((m) => m.tokens.fill && m.tokens.scrim && m.tokens.shadow), measured[0] && measured[0].tokens)
  check('light', 'no console errors during the light walk', errors.length === 0, errors)
  await ctx.close()
}
```

- [ ] **Step 2: Run the group alone**

```bash
ONLY=light node scratchpad/ux-audit-2026-09-13/accept.mjs; echo "exit $?"
```

Expected: 5 theme checks + N contrast pairs (≈ 3 on Appearance, 1 on Categories, 1 on Overview, 1–2 on ESPP) + 2–3 hairline checks + 4 closing checks — **all `ok`**, `ACCEPT OK`, `exit 0`. With spec §6's tokens the arithmetic is fixed: `--fill #e6ebf2` on a `#ffffff` card → L(fill) ≈ 0.826, L(card) = 1.0 → ratio **≈ 1.20** (≥ 1.15); `--border #e1e7ef` → `borderRgb "rgb(225, 231, 239)"` and every `td` reads the same string. Pre-batch reference: `.segmented button.active` used `--surface-2 #f7f9fc` (ratio ≈ 1.05) and `td` hairlines were `var(--surface-2)`.

Reading a FAIL: `ratio` ≈ 1.05 = the active fill still uses `--surface-2` (F2 §6 token not applied to `.segmented button.active` in `shell.css`/`panels.css`); `tds` ≠ `borderRgb` = a table still draws its hairline from `--surface-2`; `tokens.fill: ""` = the light `:root` block in `index.css` lacks the new token (and `tokens.test.ts` should have caught it — check the vitest log).

- [ ] **Step 3: Record**

Fill Results → `light` row with every measured `ratio` (control → ratio), the `borderRgb`, and the three token values.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-09-13-polish-v-verify.md
git commit -m "docs(plan): lane V — light-theme contrast and hairline acceptance recorded"
```

---

### Task 10: Allocation checks (§15.8) — Classify path, classification card, targets form

**Files:**
- Modify: `scratchpad/ux-audit-2026-09-13/accept.mjs` (append in the runners region)

- [ ] **Step 1: Append the `allocation` runner**

```js
RUNNERS.allocation = async () => {
  const ctx = await makeContext('dark', 'reduce')
  const page = await ctx.newPage()
  const errors = []
  attachConsole(page, errors)
  await open(page, '/portfolio?section=allocation'); await warm(page)
  const before = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter((b) => /^Classify these \d+ holdings$/.test(b.textContent.trim()))
    const inRanked = btns.find((b) => b.closest('table'))
    const btn = inRanked || btns[0]
    const card = [...document.querySelectorAll('.card')].find((c) => { const h = c.querySelector('.eyebrow, h2, h3'); return h && /^Security classifications$/i.test(h.textContent.trim()) })
    const legacy = { details: !!document.querySelector('details.allocation-classifications'), grid: !!document.querySelector('.allocation-overview-grid'), ranked: !!document.querySelector('.allocation-ranked'), heat: !!document.querySelector('details.allocation-heat') }
    const labels = [...document.querySelectorAll('.allocation-category-button')].map((b) => b.textContent.trim())
    return { buttons: btns.length, inRanked: !!inRanked, buttonText: btn ? btn.textContent.trim() : null, n: btn ? Number(btn.textContent.match(/\d+/)[0]) : null, hasCard: !!card, cardTop: card ? Math.round(card.getBoundingClientRect().top + scrollY) : null, legacy, labels }
  })
  check('allocation', 'the ranked table exposes a "Classify these N holdings" button', before.buttons > 0 && before.inRanked, before)
  check('allocation', 'a "Security classifications" card exists; the two accordions and the two-column grid are gone', before.hasCard && !before.legacy.details && !before.legacy.grid && !before.legacy.ranked && !before.legacy.heat, { hasCard: before.hasCard, legacy: before.legacy })
  check('allocation', 'ranked labels say "Unclassified", never "Unknown"', before.labels.length > 0 && !before.labels.some((l) => /^Unknown$/i.test(l)), before.labels)
  if (before.buttons > 0) {
    await page.evaluate(() => {
      const all = [...document.querySelectorAll('button')].filter((x) => /^Classify these \d+ holdings$/.test(x.textContent.trim()))
      ;(all.find((x) => x.closest('table')) || all[0]).click()
    })
    await sleep(900)
    const after = await page.evaluate(() => {
      const card = [...document.querySelectorAll('.card')].find((c) => { const h = c.querySelector('.eyebrow, h2, h3'); return h && /^Security classifications$/i.test(h.textContent.trim()) })
      if (!card) return null
      const r = card.getBoundingClientRect()
      const sticky = parseFloat(getComputedStyle(document.querySelector('.page-frame-body')).getPropertyValue('--sticky-inset')) || 0
      const ae = document.activeElement
      const firstRow = card.querySelector('tbody tr')
      const firstSelect = firstRow ? firstRow.querySelector('select') : null
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), stickyInset: sticky, inView: r.top >= sticky - 2 && r.top < window.innerHeight - 80, activeTag: ae ? ae.tagName.toLowerCase() : null, activeInCard: !!(ae && card.contains(ae)), activeIsFirstSelect: !!(firstSelect && ae === firstSelect), rows: card.querySelectorAll('tbody tr').length, filter: [...card.querySelectorAll('.segmented button.active')].map((b) => b.textContent.trim()), selectsPerRow: firstRow ? firstRow.querySelectorAll('select').length : 0 }
    })
    check('allocation', 'Classify: the classification card scrolls into view under the sticky inset', !!(after && after.inView), after)
    check('allocation', "Classify: focus lands on the first row's <select> inside the card", !!(after && after.activeTag === 'select' && after.activeInCard), after && { activeTag: after.activeTag, activeInCard: after.activeInCard, activeIsFirstSelect: after.activeIsFirstSelect })
    check('allocation', 'Classify: the Unclassified filter lists exactly N rows, each with inline asset-class + geography selects', !!(after && after.rows === before.n && after.selectsPerRow >= 2), after && { rows: after.rows, n: before.n, filter: after.filter, selectsPerRow: after.selectsPerRow })
    await shot(page, 'accept-allocation-classify')
  }
  // Targets form (spec §13): no __unknown__ row, no Unknown option, the "classify first" line with its action.
  await page.evaluate(() => window.scrollTo(0, 0)); await sleep(200)
  const opened = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /^(Set|Edit) targets$/.test(x.textContent.trim())); if (!b) return null; b.click(); return b.textContent.trim() })
  await sleep(500)
  const form = await page.evaluate(() => {
    const table = [...document.querySelectorAll('table')].find((t) => t.querySelector('input[aria-label$="target percent"]'))
    if (!table) return null
    const rows = [...table.querySelectorAll('tbody tr th[scope=row]')].map((th) => th.textContent.trim())
    const sel = document.querySelector('.allocation-add-target select') || [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => /Choose a category/.test(o.textContent)))
    const options = sel ? [...sel.options].map((o) => ({ value: o.value, text: o.textContent.trim() })) : []
    const formRoot = table.closest('.card') || table.parentElement.parentElement
    const classifyLine = [...formRoot.querySelectorAll('p, .hint')].map((p) => p.textContent.trim()).find((t) => /classify first/i.test(t)) || null
    const classifyButton = [...formRoot.querySelectorAll('button')].some((b) => /^Classify these \d+ holdings$/.test(b.textContent.trim()))
    return { rows, options, unknownRow: rows.some((r) => /^(Unknown|Unclassified)$/i.test(r)), unknownOption: options.some((o) => o.value === '__unknown__' || /^(Unknown|Unclassified)$/i.test(o.text)), classifyLine, classifyButton }
  })
  check('allocation', 'the targets form opened (Set targets / Edit targets)', opened !== null && form !== null, { opened, rows: form ? form.rows.length : null, options: form ? form.options.length : null })
  check('allocation', 'TargetForm renders no Unknown/Unclassified (__unknown__) row', !!(form && !form.unknownRow), form && form.rows)
  check('allocation', 'TargetForm Add list offers no Unknown option', !!(form && !form.unknownOption), form && form.options)
  check('allocation', 'TargetForm shows "… classify first" with the Classify action while Unknown value > 0', !!(form && form.classifyLine && form.classifyButton), form && { classifyLine: form.classifyLine, classifyButton: form.classifyButton })
  await shot(page, 'accept-allocation-targets', true)
  check('allocation', 'no console errors on the allocation view', errors.length === 0, errors)
  await ctx.close()
}
```

- [ ] **Step 2: Run the group alone**

```bash
ONLY=allocation node scratchpad/ux-audit-2026-09-13/accept.mjs; echo "exit $?"
```

Expected: 3 + 3 + 4 + 1 = **11 `ok` lines**, `ACCEPT OK`, `exit 0`. Indicative observations against the prod clone (spec §15.8: 12 unclassified of 37 securities, Unknown 65.6 %): `before` `{buttons: 1, inRanked: true, buttonText: "Classify these 12 holdings", n: 12, hasCard: true, legacy: {details: false, grid: false, ranked: false, heat: false}, labels: [… "Unclassified"]}`; `after` `{inView: true, activeTag: "select", activeInCard: true, activeIsFirstSelect: true, rows: 12, filter: ["Unclassified"], selectsPerRow: 2}`; `form` `{unknownRow: false, unknownOption: false, classifyLine: "Unknown is 65.6% of the priced book — classify first", classifyButton: true}`. Nothing is saved: the selects are focused, never changed; the form is opened, never submitted — `writesBlocked` stays empty.

Reading a FAIL: `buttons: 0` = P2's §13 action is missing; `legacy.details: true` = the classification accordion is still there; `rows` ≠ `n` = the filter did not default to Unclassified or the count excludes not-yet-reviewed rows differently from the button's N (record both — the lead decides which count the button should carry); `unknownOption: true` = `TargetForm` still seeds `UNKNOWN_CLASSIFICATION` (`AllocationTargetEditor.tsx:100`).

- [ ] **Step 3: Record**

Fill Results → `allocation` row with `buttonText`, `n`, `rows`, `activeTag`, the form flags and the classify line.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-09-13-polish-v-verify.md
git commit -m "docs(plan): lane V — allocation classify-path and targets-form acceptance recorded"
```

---

### Task 11: Full acceptance run, triage, 1920 spot check

**Files:**
- Create: `scratchpad/ux-audit-2026-09-13/after/accept-run.log`, `after/accept-report.json` (final), `after/accept-*.png`, `after/w1920/accept-report.json`, `after/accept-run-1920.log`

- [ ] **Step 1: Run every group in one process**

```bash
cd /c/Users/edyli/personal-finance-dashboard
node scratchpad/ux-audit-2026-09-13/accept.mjs 2>&1 | tee scratchpad/ux-audit-2026-09-13/after/accept-run.log; echo "exit ${PIPESTATUS[0]}"
ls scratchpad/ux-audit-2026-09-13/after/accept-*.png | wc -l
node -e "const r=require('./scratchpad/ux-audit-2026-09-13/after/accept-report.json');const g={};for(const c of r.checks){g[c.group]??={ok:0,fail:0};g[c.group][c.ok?'ok':'fail']++}console.table(g);console.log('problems',r.problems.length,'writesBlocked',r.writesBlocked.length,'files',r.files.length)"
```

Expected: eight `== group ==` banners; roughly **160 checks** (motion 19 · strip 52 · orphans 25 · layout 17 · tables 11 · loading 12 · light ≈ 15 · allocation 11); `problems 0`; `writesBlocked 0` (this driver never sends a chat, saves a target or changes a select — a blocked write here is itself a finding: name the URL); `ACCEPT OK`; `exit 0`; **38 PNGs** (`accept-dock-open`, `-chart-expand`, `-customize-popover`, `-spending-dock`, ten `accept-strip-*-scrolled`, `accept-layout-{overview,settings-household,allocation}`, seven `accept-kpi-*-dock` (the routes with a metric (i) button: root, net-worth, portfolio, spending, paycheck, projection, calendar), five `accept-table-*`, `accept-loading-{update,settings-data}`, five `accept-light-*`, `accept-allocation-{classify,targets}`); the `console.table` shows `fail: 0` in every row. Runtime ≈ 6–8 minutes.

- [ ] **Step 2: Triage every `PROBLEM` line — three bins, no source edits**

For each `PROBLEM [group] name {observed}` in the log:

1. **Driver drift the spec permits** (the lane chose a name the spec left open — e.g. the GhostCard wrapper class, the eyebrow element of the classification card, a Segmented `aria-label`): extend that check's fallback list in `accept.mjs` (never loosen a threshold), re-run only that group with `ONLY=<group>`, and list the change under Results → "Driver adjustments made during triage" with the selector that answered.
2. **Lane deviation from the spec** (a threshold or a spec-fixed selector fails): do **not** touch source. Record it under Results → "Remaining deviations" with the check name, the observed numbers verbatim, the owning lane from the spec §1 table, the spec section, and the decision the lead must make. Re-run nothing.
3. **Timing flake** (the frame-budget count, a `settle within 15000ms` line, the 100 ms ghost window): re-run that group twice more (`ONLY=motion` / `ONLY=loading`); if it passes twice, record it as flaky with all three observations; if it fails twice, it is bin 2.

After bin-1 fixes, re-run the **whole** driver once more (Step 1's command) so `after/accept-report.json` is a single coherent run; the Results row "full run" quotes that final run.

- [ ] **Step 3: 1920×1080 spot check (spec §15: "plus 1920 dark") — strip and layout only, into its own folder so the 1440 report is not overwritten**

```bash
WIDTH=1920 OUT=scratchpad/ux-audit-2026-09-13/after/w1920 ONLY=strip,layout node scratchpad/ux-audit-2026-09-13/accept.mjs 2>&1 | tee scratchpad/ux-audit-2026-09-13/after/accept-run-1920.log; echo "exit ${PIPESTATUS[0]}"
```

Expected: `checks 69, problems 0 … ACCEPT OK`, `exit 0` (52 strip + 17 layout). Observations of interest at 1920: `contentW` ≈ 1630, `.projection-outcomes` still `rows: 1`, and no `lone: true` row with the dock open (the content column is ≈ 1230 px with a 400 px dock, so five tiles fit one line).

- [ ] **Step 4: Record**

Fill Results → "full run" and "1920 spot check" rows, the "Remaining deviations" table and "Driver adjustments made during triage" from the final logs.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-09-13-polish-v-verify.md
git commit -m "docs(plan): lane V — full acceptance run, triage and 1920 spot check recorded"
```

---

### Task 12: Re-run `audit.mjs` for the after captures and summaries

**Files:**
- Create: `scratchpad/ux-audit-2026-09-13/after/shots/after-*.png`, `after/report-after-dark-1440-both.json`, `after/report-after-light-1440-walk.json`, `after/summary-after-dark-1440.txt`, `after/summary-after-light-1440.txt`, `after/run-after-{dark,light}-1440.log`

- [ ] **Step 1: Dark, both modes (walk + interactions)**

`audit.mjs` writes its report next to `OUT`'s parent (`path.join(OUT, '..', …)`), so `OUT=…/after/shots` puts the JSON in `after/`. `TAG=after` prefixes every PNG `after-`. `ONLY_ROUTE` is not used here; if a partial re-run is ever needed remember the MSYS rule — `ONLY_ROUTE=spending`, never `ONLY_ROUTE=/spending`.

```bash
cd /c/Users/edyli/personal-finance-dashboard
A=scratchpad/ux-audit-2026-09-13
mkdir -p $A/after/shots
TAG=after OUT=$A/after/shots THEMES=dark WIDTHS=1440 MODE=both TOKEN_FILE=$A/token-prod.txt APP_BASE=http://localhost:5174 \
  node $A/audit.mjs 2>&1 | tee $A/after/run-after-dark-1440.log
```

Expected: thirteen `walked dark-1440-<route> (n views)` lines with the same view counts as the pre-batch run (overview 1, update 3, networth 2, portfolio 5, spending 4, cards 3, paycheck 3, comp 3, espp 3, taxes 4, projection 2, calendar 2, settings 5), then `wrote …\after\report-after-dark-1440-both.json; pages 13, interactions 21, writesBlocked 1, problems 0`. The one blocked write is the pre-existing `POST /assistant/chat` the "Explain this number" click provokes (fenced; the before-run recorded the same). `problems` must be 0 — a `settle timeout` line names a view whose skeleton/`loading-dim` never cleared. Five interaction captures are **expected to be absent** because their pre-batch selectors were retired by the batch: `inspector-overlay` and `inspector-expanded` (the `.detail-panel-toolbar` buttons became the header `Segmented`, §4), `overview-customize` (`details` → popover, §11), `assistant-findings` (`.assistant-tabs` → `Segmented`, §4), `taxes-years-open` (accordion removed, §11). The `*-accordions-open` shots are still taken (the driver screenshots even when `openDetails` finds nothing) and now show the converted surfaces. Runtime ≈ 5 minutes.

- [ ] **Step 2: Light, walk only**

```bash
A=scratchpad/ux-audit-2026-09-13
TAG=after OUT=$A/after/shots THEMES=light WIDTHS=1440 MODE=walk TOKEN_FILE=$A/token-prod.txt APP_BASE=http://localhost:5174 \
  node $A/audit.mjs 2>&1 | tee $A/after/run-after-light-1440.log
```

Expected: the same thirteen `walked light-1440-…` lines, then `pages 13, interactions 0, writesBlocked 0, problems 0`.

- [ ] **Step 3: Summarise and compare with the pre-batch summaries**

```bash
A=scratchpad/ux-audit-2026-09-13
node $A/summarize.cjs $A/after/report-after-dark-1440-both.json > $A/after/summary-after-dark-1440.txt
node $A/summarize.cjs $A/after/report-after-light-1440-walk.json > $A/after/summary-after-light-1440.txt
for f in $A/summary-prod-dark-1440.txt $A/after/summary-after-dark-1440.txt $A/summary-prod-light-1440.txt $A/after/summary-after-light-1440.txt; do
  echo "$(basename $f): ORPHAN=$(grep -c ' ORPHAN ' $f) GAP=$(grep -c ' GAP ' $f) HOLLOW=$(grep -c ' HOLLOW ' $f) DETAILS=$(grep -c ' DETAILS ' $f) DETAILS-not-disclosure=$(grep ' DETAILS ' $f | grep -vc 'disclosure') LOADING-NOTES=$(grep -c ' EMPTY-NOTE \"Loading' $f) WIDE=$(grep -c ' WIDE:' $f) CONSOLE=$(grep -c ' CONSOLE:' $f)"
done
grep ' ORPHAN ' $A/after/summary-after-dark-1440.txt
grep ' HOLLOW ' $A/after/summary-after-dark-1440.txt
grep ' DETAILS ' $A/after/summary-after-dark-1440.txt | grep -v disclosure
ls $A/after/shots | grep -c '^after-dark-1440-'; ls $A/after/shots | grep -c '^after-light-1440-'
```

Expected, with the pre-batch figures for the same greps as the reference row:

| summary | ORPHAN | GAP | HOLLOW | DETAILS | DETAILS not `.disclosure` | "Loading…" notes | WIDE | CONSOLE |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| before dark 1440 | 26 | 1 | 6 | 27 | 27 | 5 | 5 | 0 |
| after dark 1440 (expected) | ≤ 5 | ≤ 1 | 0–2 | well below 27 | **0** | **0** | ≤ 5 | 0 |
| before light 1440 | 26 | 1 | 4 | 27 | 27 | 10 | 5 | 0 |
| after light 1440 (expected) | ≤ 5 | ≤ 1 | 0–2 | well below 27 | **0** | **0** | ≤ 5 | 0 |

The "≤ 5" ORPHAN allowance is an instrument artefact, not a pass: `audit.mjs`'s `vis()` counts the five `visually-hidden` Settings bands (1×1 px, `panels.css:649`) as visible text; Task 5's refined check is the verdict. Any other surviving ORPHAN line is a finding for the owning lane — copy it into Results. `DETAILS not .disclosure` must be 0: every `<details>` left on a page is the §2.6 primitive. `after-dark-1440-*` count **54** (59 − the five retired interaction captures), `after-light-1440-*` count **40** (walk views only).

- [ ] **Step 4: Record**

Fill Results → "Audit re-run" table with the observed counts (all eight columns, both themes) and any surviving ORPHAN/HOLLOW/non-disclosure DETAILS lines verbatim.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-09-13-polish-v-verify.md
git commit -m "docs(plan): lane V — audit.mjs after-run counts recorded (dark both, light walk)"
```

---

### Task 13: Before/after index

**Files:**
- Create: `scratchpad/ux-audit-2026-09-13/index.cjs`
- Create: `scratchpad/ux-audit-2026-09-13/after/INDEX.md`

- [ ] **Step 1: Write `index.cjs`**

```js
// index.cjs — before/after index for the 2026-09-13 polish batch. Pairs shots/prod-{theme}-1440-*.png (pre-batch walk)
// with after/shots/after-{theme}-1440-*.png (the same audit.mjs on merged main), then lists the acceptance captures,
// the acceptance problems and the 1920 spot check. Usage: node scratchpad/ux-audit-2026-09-13/index.cjs [scratchpad/ux-audit-2026-09-13]
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(process.argv[2] ?? path.join('scratchpad', 'ux-audit-2026-09-13'))
const BEFORE = path.join(ROOT, 'shots')
const AFTER = path.join(ROOT, 'after', 'shots')
const INTERACTION = /^(inspector-|chart-|assistant-|overview-customize|update-review-open|allocation-(open|select)|budgets-open|paycheck-changes-open|taxes-years-open|reveal-midscroll)/
const acceptFile = path.join(ROOT, 'after', 'accept-report.json')
const accept = fs.existsSync(acceptFile) ? JSON.parse(fs.readFileSync(acceptFile, 'utf8')) : null
const lines = [
  '# Before / after index — 2026-09-13 polish batch', '',
  `Generated ${new Date().toISOString()}. Before = \`shots/prod-*\` (pre-batch walk of the production clone, 2026-09-13 02:10). After = \`after/shots/after-*\` (the same \`audit.mjs\` on merged main). Dark ran \`MODE=both\`; light ran \`MODE=walk\`, so light interaction views have no after twin by design.`, '',
]
if (accept) {
  lines.push('## Acceptance (`after/accept-report.json`)', '', `${accept.checks.length} checks, **${accept.problems.length} problems**, ${accept.writesBlocked.length} fenced write attempts. Groups: ${accept.groups.join(', ')}.`, '')
  for (const p of accept.problems) lines.push(`- FAIL [${p.group}] ${p.name} — \`${JSON.stringify(p.observed).slice(0, 220)}\``)
  if (accept.problems.length) lines.push('')
}
const summary = []
for (const theme of ['dark', 'light']) {
  const prefix = `prod-${theme}-1440-`
  const befores = fs.existsSync(BEFORE) ? fs.readdirSync(BEFORE).filter((f) => f.startsWith(prefix) && f.endsWith('.png')).sort() : []
  if (!befores.length) continue
  const afters = fs.existsSync(AFTER) ? fs.readdirSync(AFTER).filter((f) => f.startsWith(`after-${theme}-1440-`)) : []
  lines.push(`## ${theme} · 1440×900`, '', '| view | before | after |', '| --- | --- | --- |')
  let paired = 0; let walkOnly = 0; const missing = []
  for (const b of befores) {
    const view = b.slice(prefix.length, -4)
    const a = `after-${theme}-1440-${view}.png`
    let cell
    if (afters.includes(a)) { paired++; cell = `[after](shots/${a})` }
    else if (theme === 'light' && INTERACTION.test(view)) { walkOnly++; cell = '_interaction — the light after-run was walk-only_' }
    else { missing.push(view); cell = "_no after capture — the driver's selector was retired by the batch (see accept-report)_" }
    lines.push(`| ${view} | [before](../shots/${b}) | ${cell} |`)
  }
  const extras = afters.filter((a) => !befores.includes(a.replace(/^after-/, 'prod-'))).map((a) => a.slice(`after-${theme}-1440-`.length, -4))
  lines.push('', `${befores.length} before views · ${paired} paired · ${missing.length} without an after twin${missing.length ? ` (${missing.join(', ')})` : ''}${walkOnly ? ` · ${walkOnly} light interaction views (walk-only run)` : ''} · ${extras.length} after-only views${extras.length ? ` (${extras.join(', ')})` : ''}`, '')
  summary.push(`${theme}: ${befores.length} before, ${paired} paired, ${missing.length} missing${walkOnly ? `, ${walkOnly} walk-only` : ''}`)
}
const afterDir = path.join(ROOT, 'after')
const acceptPngs = fs.existsSync(afterDir) ? fs.readdirSync(afterDir).filter((f) => f.startsWith('accept-') && f.endsWith('.png')).sort() : []
lines.push('## Acceptance captures (`after/accept-*.png`)', '', ...acceptPngs.map((f) => `- [${f.slice(7, -4)}](${f})`), '')
const w1920 = path.join(afterDir, 'w1920', 'accept-report.json')
if (fs.existsSync(w1920)) { const r = JSON.parse(fs.readFileSync(w1920, 'utf8')); lines.push('## 1920 spot check (`after/w1920/accept-report.json`)', '', `${r.checks.length} checks, ${r.problems.length} problems (groups: ${r.groups.join(', ')}).`, '') }
fs.mkdirSync(afterDir, { recursive: true })
fs.writeFileSync(path.join(afterDir, 'INDEX.md'), lines.join('\n'))
console.log(`wrote ${path.join(afterDir, 'INDEX.md')} — ${summary.join('; ')}; acceptance captures: ${acceptPngs.length}`)
```

- [ ] **Step 2: Build the index**

```bash
cd /c/Users/edyli/personal-finance-dashboard
node scratchpad/ux-audit-2026-09-13/index.cjs scratchpad/ux-audit-2026-09-13
head -12 scratchpad/ux-audit-2026-09-13/after/INDEX.md
grep -c '^| ' scratchpad/ux-audit-2026-09-13/after/INDEX.md
```

Expected: `wrote …\after\INDEX.md — dark: 59 before, 54 paired, 5 missing; light: 59 before, 40 paired, 0 missing, 19 walk-only; acceptance captures: 38`; the head shows the title, the acceptance line (`≈160 checks, **0 problems**, 0 fenced write attempts`) and the dark table header; the table-row count is 59 + 59 + 4 header/separator rows = **122**. The five `missing` views must be exactly `inspector-overlay, inspector-expanded, overview-customize, assistant-findings, taxes-years-open`; any other name means an after capture failed for a reason the lead should hear (open `after/run-after-dark-1440.log`).

- [ ] **Step 3: Spot-read three pairs in the image viewer** (the morning eyeball is the user's; this is the lane's own sanity pass): `overview-default` (Data status card in the agenda column, no freshness row at the bottom), `settings-household` (Categories `span-8` beside Household `span-4`, no void under Household), `portfolio-allocation` (one card with the donut + ranked aside, the Security classifications card directly beneath). Note anything that reads wrong in Results → "Hand-off" as an eyeball finding.

- [ ] **Step 4: Record and commit**

Fill Results → "Before/after index" with the summary line, then:

```bash
git add docs/superpowers/plans/2026-09-13-polish-v-verify.md
git commit -m "docs(plan): lane V — before/after index built (after/INDEX.md)"
```

---

### Task 14: Fill the Results section, write the hand-off, final commit

**Files:**
- Modify: `docs/superpowers/plans/2026-09-13-polish-v-verify.md` (Results section below — the lane's only tracked change)

- [ ] **Step 1: Fill every `← record` cell in the Results section** from `after/gates/*.log`, `after/accept-run.log`, `after/accept-report.json`, `after/accept-run-1920.log`, `after/run-after-*.log`, the summary greps of Task 12 Step 3 and the `index.cjs` line. Quote numbers verbatim (no rounding beyond what the driver printed); where a check failed, the "Remaining deviations" row carries the observed JSON. Leave no `← record` marker behind:

```bash
grep -c '← record' docs/superpowers/plans/2026-09-13-polish-v-verify.md
```

Expected: `0`.

- [ ] **Step 2: Write the hand-off in the final message to the lead** (not a new file), covering: (a) the gate numbers; (b) `ACCEPT OK` or the list of remaining deviations, each with owning lane + spec § + observed numbers; (c) flakes and driver adjustments; (d) the five expected-missing after captures and any unexpected one; (e) that both server pairs were **left running** (house practice, for the morning eyeball on 5174); (f) that the spec's `Status:` line (`…design.md` line 3) was **not** edited by this lane — the lead confirms "implemented" after reading the deviations; (g) the deferred cleanup list below, **not executed**; (h) a note that the vite dev proxy pin (`vite.config.ts:55`) means a future 5174 restart needs `VITE_API_PROXY=http://127.0.0.1:8010` again.

- [ ] **Step 3: Final commit**

```bash
git add docs/superpowers/plans/2026-09-13-polish-v-verify.md
git commit -m "docs(plan): lane V — 2026-09-13 polish batch verified: gates, acceptance, before/after index, hand-off"
git status --porcelain | wc -l
```

Expected: the commit lands on `main`; `0` (nothing else tracked changed — `scratchpad/` is gitignored).

---

## Results (filled by Tasks 0–14; every `← record` cell is replaced with the observed value)

### Preconditions (Task 0)

| item | observed |
| --- | --- |
| `main` HEAD (short SHA) and commits since `ab92b91` | ← record |
| `git diff --name-only ab92b91 HEAD -- backend` | ← record (empty → pytest skipped) |
| servers listening (8000, 8010, 5173, 5174) | ← record |
| tokens re-minted (bytes each; `/prefs` status on 8000 and 8010) | ← record |
| accounts via 5174 / 8010 direct / 8000 direct | ← record |

### Gates (Task 1)

| gate | pre-batch baseline | observed on merged `main` |
| --- | --- | --- |
| `npx tsc -b` | exit 0 | ← record |
| `npx eslint .` | `✖ 24 problems (0 errors, 24 warnings)`, all `react-refresh/only-export-components` (measured on `ab92b91`, 2026-09-13) | ← record (N, delta, any non-react-refresh rule with file:line) |
| `npx vitest run` | 193 files / 2753 tests (2026-09-12) | ← record (files, tests, duration, failures) |
| `npm run build` | tooltip chunk ≈ 748 kB | ← record (status, top three chunks) |
| backend `pytest -q` | 1971 passed, 1 skipped (2026-09-12) — run only if the backend diff is non-empty | ← record ("not run — backend untouched" or the numbers) |

### Driver (Task 2)

- Scaffold run: ← record (`checks 0, problems 0`, exit 0; fence probe `PATCH status 200 blocked [...]`)

### Acceptance groups (Tasks 3–11, final full run)

| group | checks | problems | key observations |
| --- | --- | --- | --- |
| motion | ← record | ← record | distinct frames ≤300ms; finalWidth/expectedWidth; `.detail-panel`, dialog, popover, indicator durations; reduce readings; Spending frames/long/worst |
| strip | ← record | ← record | ten `navW/contentW` pairs; `/update` entry-footer |
| orphans | ← record | ← record | surviving lines per route (or none); Portfolio allowlisted count |
| layout | ← record | ← record | overview gap; household slack; allocation flags; band h/rows; lone-tile verdicts |
| tables | ← record | ← record | five right/scrollerRight/overflow/cellPosition tuples; Comp columnSet |
| loading | ← record | ← record | `/update` skeletonAt/cardAt ×2; Accounts heights; four tab ghostAt/first |
| light | ← record | ← record | contrast ratios per control; borderRgb; tokens |
| allocation | ← record | ← record | buttonText, n, rows, activeTag, form flags, classify line |
| **full run** | ← record | ← record | `ACCEPT OK` / `ACCEPT FAILED: n`; exit code; PNG count; writesBlocked |
| 1920 spot check (strip + layout) | ← record | ← record | contentW; band rows; lone-tile verdicts |

### Remaining deviations (Task 11 triage, bin 2 — recorded, not fixed)

| # | check | observed (verbatim) | owning lane | spec § | decision for the lead |
| --- | --- | --- | --- | --- | --- |
| — | ← record (or "none") | | | | |

### Driver adjustments made during triage (bin 1) and flakes (bin 3)

- ← record (or "none")

### Audit re-run (Task 12)

| summary | ORPHAN | GAP | HOLLOW | DETAILS | DETAILS not `.disclosure` | "Loading…" notes | WIDE | CONSOLE | driver problems |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| before dark 1440 | 26 | 1 | 6 | 27 | 27 | 5 | 5 | 0 | 0 |
| after dark 1440 | ← record | ← record | ← record | ← record | ← record | ← record | ← record | ← record | ← record |
| before light 1440 | 26 | 1 | 4 | 27 | 27 | 10 | 5 | 0 | 0 |
| after light 1440 | ← record | ← record | ← record | ← record | ← record | ← record | ← record | ← record | ← record |

Surviving ORPHAN / HOLLOW / non-disclosure DETAILS lines (verbatim): ← record (or "none beyond the five visually-hidden Settings bands")

### Before/after index (Task 13)

- `index.cjs` summary line: ← record
- Eyeball notes on the three spot-read pairs: ← record

### Hand-off (Task 14)

- Follow-ups for the lead (deviations → lane → spec §): ← record
- Servers left running: uvicorn 8000 + vite 5173 (dev book), uvicorn 8010 + vite 5174 (prod clone, `VITE_API_PROXY=http://127.0.0.1:8010`).
- Spec `Status:` line: not edited by this lane.
- Deferred cleanup: listed below, **not executed**.

## Deferred cleanup (listed for the morning, NOT executed by this lane)

Run only after the user confirms the merged `main`. `git branch -d` refuses unmerged branches and `git worktree remove` refuses a dirty worktree — those refusals are the safety net; add `--force` only after eyeballing `git -C .worktrees/<name> status`.

```bash
cd /c/Users/edyli/personal-finance-dashboard
# 1. This batch's worktrees and branches (names as `git worktree list` prints them — the lead named p1–p4)
git worktree list
git worktree remove .worktrees/polish-f1
git worktree remove .worktrees/polish-f2
git worktree remove .worktrees/polish-p1
git worktree remove .worktrees/polish-p2
git worktree remove .worktrees/polish-p3
git worktree remove .worktrees/polish-p4
git branch -d polish/f1-surfaces polish/f2-shell polish/p1-overview polish/p2-portfolio polish/p3-income polish/p4-planning
# 2. Stale worktrees and branches left from the ESPP-visuals (merged 2026-09-08) and tax (merged 2026-09-12) batches
for w in espp-1 espp-2 espp-3 tax-a tax-b tax-c tax-d; do git worktree remove .worktrees/$w; done
git branch -d espp-visuals-1 espp-visuals-2 espp-visuals-3 tax/a-computed-totals-backend tax/b-computed-totals-form tax/c-payroll-tables-backend tax/d-payroll-tables-ui
git worktree prune
# 3. The production-clone server pair (find the PIDs first; Git Bash needs the doubled slashes) and its database
netstat -ano | grep LISTENING | grep -E ':(8010|5174) '
taskkill //PID <pid-of-8010> //F
taskkill //PID <pid-of-5174> //F
psql -h localhost -p 5433 -U finance -d postgres -c 'DROP DATABASE finance_uxreview'
```

Left alone on purpose: branches `budget-seed-from-averages` and `feat/dashboard-experience` (not part of any batch this plan covers), the dev pair 8000/5173, and the `.worktrees/` folder itself.

## Self-review (writing-plans checklist, run by the plan author on 2026-09-13)

1. **Spec coverage.** §15.1 motion → Task 3 (trace, durations, reduce, frame budget incl. the §2.2 fallback trigger). §15.2 tab strip → Task 4 (inside scope, width, 700 px scroll) plus the §16 `container-type` risk (`.entry-footer`, `.page-frame-scope` still stuck). §15.3 orphans → Task 5 (seven routes, every section, Portfolio allowlisted; one documented refinement for `visually-hidden`). §15.4 layout → Task 6 (Overview columns, Household slack, allocation single card + no stretched twin, Projection band, KPI rows under a dock). §15.5 tables → Task 7 (five tables, header-matched, sticky cell). §15.6 loading → Task 8 (`/update` skeleton cold + warm, Accounts height, four Settings tabs). §15.7 light → Task 9 (WCAG contrast, hairline colour, tokens). §15.8 allocation → Task 10 (Classify button, card scroll + focus, N rows, TargetForm rows/options, classify-first line). §15.9 gates → Task 1 (with the conditional pytest). §15.10 screenshots + index → Tasks 12–13. §15's 1920 spot check → Task 11 Step 3; light spot check → Task 9 + the light walk. Hand-off and cleanup list → Task 14. Gaps: none found.
2. **Placeholder scan.** No to-be-determined markers, deferred-implementation notes or "similar to Task N" references. The only `← record` markers are the Results form that Task 14 fills (Task 14 Step 1 asserts zero remain). Every code step shows the complete code; every command has its expected output.
3. **Type consistency.** Node side: `check(group, name, ok, observed)`, `makeContext(theme, reducedMotion)`, `settle(page, ms)`, `warm(page)`, `open(page, route)`, `shot(page, name, full)`, `attachConsole(page, sink)`, `dedupe(frames, keys)`, `slug(route)`, constants `BASE`, `WIDTH`, `HEIGHT`, `OUT`, `RUNNERS`, `report.{checks, problems, writesBlocked, files, groups}` — the same names in Tasks 2–10; `index.cjs` reads exactly `checks`, `problems`, `writesBlocked`, `groups` from the report. Page side: `window.__acc.{durations, rect, vis, desc}` defined once in `makeContext`'s init script and used in Tasks 3, 6, 7, 9, 10 with those signatures (`durations(selOrEl)` → `{animation, transition, max}`; `vis(el)` → boolean). Group names in `ALL_GROUPS` match the `RUNNERS.<group>` keys and the `ONLY=` values quoted in every run step.
