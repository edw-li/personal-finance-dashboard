# Polish V browser verification

This is a dev-box probe for the approved 2026-09-25 polish design §9. It does not ship with the app. Run it from the verification worktree after L5–L8 are merged; its plan is `docs/superpowers/plans/2026-09-25-polish-V-verify.md`.

`smoke.mjs` covers both themes at 1280×800, 1366×768, 1440×900, 1536×864 and 1920×1080. It measures sidebar fit, chart pair and Table geometry, Overview/Settings/calendar/tax/allocation/meter/Guide layout, all tile sites, dock layouts, every offered Net worth/Spending month, cold skeletons and route CLS. Every context records native dialogs, console/page/network errors and fenced writes. Unknown filters, missing expected elements, unobserved applicable skeletons and missing mutation artifacts are failures. Artifacts are progressive JSON plus screenshots in ignored scratch storage.

The browser uses headless Edge with classic scrollbars. All API reads go directly to the explicit loopback backend through Playwright's transparent request forwarding. This retains real data and avoids the intermittent Vite proxy truncation observed by the earlier table-scroll and L6 probes. Successful GET retries are recorded. UI preferences are overlaid in memory; the read-only driver rejects every other mutation except the documented compute-only POSTs. It never targets a remote origin.

## Private source and stack

Acquire one fresh read-only production `pg_dump` with the already authorized project SSH procedure. Use a byte-preserving pipe/file (Python `subprocess` binary streams or Git Bash; Windows PowerShell5 text redirection corrupts byte streams). Restore the same file into **new** `finance_polish_v_read` and `finance_polish_v_write` databases on `127.0.0.1:5433`. Refuse existing destinations. Do not drop or overwrite databases or run production mutations.

Run the copied-data backends on 8089 and 8091 with `SCHEDULER_ENABLED=0`, `SNAPSHOT_ENABLED=0`, `PRODUCT_TODAY=2026-09-25`, explicit local URLs and separate local data directories. The read database additionally uses `default_transaction_read_only=on`. Run worktree Vites on 5279/5280 with strict ports, the corresponding API target and private cache directories. Port8090 belongs to an unrelated Windows process on this box.

The source manifest is ignored JSON with at least:

```json
{
  "acquisition": "production-read-only-pg_dump",
  "acquiredAt": "2026-09-26T07:33:31.559862+00:00",
  "sha256": "<SHA-256 of the acquired dump bytes>",
  "readDatabase": "finance_polish_v_read",
  "writeDatabase": "finance_polish_v_write"
}
```

The actual manifest also records byte count, schema, identical initial table counts, read-only setting and local auth method. Authentication uses a newly locally signed token for the existing copied user; no production password or copied database row needs changing. Keep tokens and signing keys out of source control and logs.

## Run the matrix

PowerShell, from `.worktrees/polish-verify`:

```powershell
$env:APP_BASE = 'http://127.0.0.1:5279'
$env:API_BASE = 'http://127.0.0.1:8089'
$env:TOKEN_FILE = (Resolve-Path 'scratchpad/polish-v/token.txt').Path
$env:SOURCE_MANIFEST = (Resolve-Path 'scratchpad/polish-v/source.json').Path
$env:EVIDENCE_MANIFEST = (Resolve-Path 'scratchpad/polish-v/lane-evidence.json').Path
$env:EXPECT_HEAD = '<coordinator-provided merged product commit>'
$env:PLAYWRIGHT_CORE = '<installed playwright-core module directory>'
$env:SMOKE_OUT = 'scratchpad/polish-v/final'
node tools/probes/polish-v/smoke.mjs
```

`EXPECT_HEAD` must be an ancestor of the worktree, cannot be the wave-1 baseline, and is recorded separately from the probe commit. A final run requires a source manifest less than48hours old. The coordinator must first clear the heavy test gate and all writable browser flows so CPU/memory pressure and mutations do not distort CLS. Each browser/context closes in `finally`.

Filters are comma lists and reject misspellings:

- `ONLY_GROUP`: `sidebar,pairs,layout,walk,months,evidence`.
- `ONLY_SIZE`: `1280x800,1366x768,1440x900,1536x864,1920x1080`.
- `ONLY_THEME`: `dark,light`.
- `ONLY_ROUTE`: route names in `baseline.mjs` (applies to `walk`).
- `PREPARE=1`: a clearly marked instrument smoke; never a final acceptance result.

Exit2 means refused preflight/arguments; exit1 means failed checks, driver error or zero coverage; exit0 means the requested checks passed. `completeMatrix` can become true only for an unfiltered final run with every check passing. `fullAcceptance` deliberately remains false: fresh integrated mutation reports and the merged-main code gates must also be reviewed in the plan's final as-built. A filtered rerun supplements the retained full report; it never erases its failed observations.

## Mutation evidence and fresh runs

`evidence.mjs` imports historical lane JSON as explicitly historical evidence. The ignored manifest contains:

```json
{
  "artifacts": [
    {
      "lane": "L6",
      "head": "<actual lane product commit>",
      "file": "<absolute or manifest-relative JSON artifact>",
      "status": "passed",
      "covers": ["transaction exact Undo and focus"],
      "note": "Historical lane run; integrated rerun reported separately."
    }
  ]
}
```

Allowed statuses are `passed`, `partial`, `observed`. The importer hashes every source and rejects zero/unrecognized records, false recognized assertions, nested transport/native-dialog/fenced-write errors or cleanup failures when the entry claims `passed`. Partial artifacts must have an explanatory note. The original L7 main script's locator timeout and L5's injected error remain visible alongside their successful supplements; importing them does not turn them into new merged-head checks.

`flows-harness.mjs` adapts the existing audited lane scripts: exports `launch`, `open`, `settle`, `sleep`, `BASE`, `API_BASE`, `provenance`; `open(browser,{writes:true,theme,width,height,reducedMotion})` allows real mutations **only** on5280/8091. Set the same token/source/head variables as the matrix, change `APP_BASE`/`API_BASE` to the writable twin, and write fresh artifacts separately from historical files.

The tracked L7 representatives are:

```powershell
$env:APP_BASE = 'http://127.0.0.1:5280'
$env:API_BASE = 'http://127.0.0.1:8091'
$env:FLOW_OUT = 'scratchpad/polish-v/fresh-L7'
node tools/probes/polish-v/flows-money-b.mjs
node tools/probes/polish-v/flows-money-b-overrides.mjs
```

These create temporary card/category/dependent rows and a custom event, prove exact API equality after Undo, exercise budget validation/history, matrix Enter/Escape/Save, pins, a fixture-only saved finding and generated Calendar overrides, and check light/reduced motion. Each owned record is removed or batch-Undone in `finally`; cleanup failure fails the process. Existing findings are never deleted. L5/L6/L8 lane owners use the same adapter for their fresh integrated scripts and hand off source/head/time metadata, error logs and cleanup proof. Run write flows sequentially, then the read-only matrix.

`baseline.mjs` carries the archived audit numbers and IDs; `tiles.mjs` preserves L2's reviewed DOM baseline instrument (temporary markers removed within one evaluation); `measurements.mjs` adapts L1/L5 geometry. Do not change product code in this verification worktree. Report concrete failures to the coordinator for scoped fixes and rerun affected checks after integration.
