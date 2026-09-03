# Sandbox lane G — shared grammar (`src/sandbox/*`, `whatif.ts` → `apiReadOnly`, parity fixture) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the page-independent half of `docs/superpowers/specs/2026-09-03-planning-sandboxes-design.md`: the `whatif` URL entry grammar (§6), the `useSandbox` hook (§7), the control grammar — `SandboxPanel`, `SliderBox`, `DeltaChip`, `CompareTable`, `PresetRow` (§8) — the localStorage pin store (§4, §8.5), the encoder/decoder parity fixture shared with the backend (§12), and the source-text conformance test (§14). The spec's one grammar-level API change — `runWhatIf()` riding `apiReadOnly` so a preview never empties the snapshot cache — is ALREADY on main (commit `c3d6dca`, with `src/api/whatif.test.ts` pinning it); this lane does not touch `src/api/`. No page adopts anything here — lanes P, T and J do.

**Architecture:** `scenarioUrl.ts` is pure string code over `URLSearchParams` (the server's wire vocabulary in, the same strings out — encode∘decode is identity, pinned by tests). `useSandbox` treats the URL as the only copy of the live scenario: `set()` encodes and schedules ONE `replace`-style write at the trailing edge of a debounce; a request effect keyed on the URL's `whatif` entries runs the page's `preview()` under a sequence guard and keeps the last result (marked `stale`) on failure. `busy`/`stale`/`pinResults` are DERIVED from run keys, never set from an effect body (react-hooks 7's `set-state-in-effect` rule, the house's "promise callbacks only" idiom). Pins are entry arrays in `finance.sandbox.<page>`, validated with the page's own decoder on read and re-run against live data on every mount and `dataKey` change. Controls are plain React over the existing vocabulary (`AmountInput`, `Segmented`, `Feed`, `InfoHint`, `.card`/`.chip`/`.data-table`), with one new sheet `src/sandbox/sandbox.css`. Exact decimal helpers (`decimal.ts`, BigInt-backed) do the two subtractions and one division the grammar itself needs (a knob's distance from actual, a preset's limit ÷ salary) so no float ever reaches a wire string.

**Tech Stack:** React 19, react-router 7 (`useSearchParams`, `useLocation`, `useNavigationType`), TypeScript 5.9, vitest 3 + Testing Library (fake timers for the debounce tests), `node:fs` for the parity fixture and the conformance walk.

**Worktree / commands:** Branch `sandbox-grammar`, worktree `.worktrees/sandbox-grammar` (create with `git worktree add .worktrees/sandbox-grammar -b sandbox-grammar main`). Frontend lanes need `node_modules`: from the worktree root run `cmd /c mklink /J node_modules ..\..\node_modules` (Windows junction — never copy). Tests: `npx vitest run <file>`; types: `npx tsc -b`; lint: `npx eslint src/sandbox`. This lane runs no backend tests (its only backend artifact is a JSON fixture).

**Prerequisites on main:** shell Plan 1a (`src/components/shell/Segmented.tsx`), Plan 3 Task 1 (`src/components/shell/Feed.tsx`) — both present at the time of writing. Nothing here depends on lane B, the chart grammar, or the page lanes.

**Shared-file hotspots (coordinate at merge):** `backend/tests/fixtures/sandbox_entries.json` (created here, READ by lane A's parity test — lane A must not edit it). Everything else this lane creates lives under `src/sandbox/`, which no other lane creates files in. This lane modifies no existing file.

**Overnight rule:** no file deletions in this plan. Anything made obsolete is listed under "Retire at end" in `2026-09-04-sandbox-verify.md`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/sandbox/scenarioUrl.ts` (new) | `whatif` entry grammar: split/format an entry, wire-token guards, `readEntries`/`withEntries`, legacy alias readers, typed `sale:`/`espp:`/`retire:`/override/knob parsers and formatters, `lastWins` |
| `src/sandbox/scenarioUrl.test.ts` (new) | round trips per kind, garbage dropped, last-wins, legacy aliases, the shared parity fixture |
| `backend/tests/fixtures/sandbox_entries.json` (new) | the encoder/decoder parity pins — entries + the exact URL both sides must produce |
| `src/sandbox/decimal.ts` (new) | exact string arithmetic on wire decimals: `subtractDecimals`, `divideDecimals`, `compareDecimals`, `decimalsIn`, `trimZeros` |
| `src/sandbox/decimal.test.ts` (new) | pins for each helper, including negative and mixed-scale inputs |
| `src/sandbox/pins.ts` (new) | `finance.sandbox.<page>`: versioned read (validated), write, `newPin`, `PIN_LIMIT` |
| `src/sandbox/pins.test.ts` (new) | corrupt blob → empty, validator drops, round trip |
| `src/sandbox/useSandbox.ts` (new) | URL ⇄ scenario, trailing-edge debounce, one flight with a sequence guard, baseline, keep-last-on-failure, pins + pin runs, `link` |
| `src/sandbox/useSandbox.test.tsx` (new) | drag collapses to one request, `immediate`, stale sequence dropped, arrival runs at once, failure keeps result + stale/error, reset, replace-only writes, pins (max three, corrupt storage, `dataKey` re-run, per-pin error) |
| `src/sandbox/DeltaChip.tsx` (new) | signed formatted delta with tone; `invert`; `formatDelta`, `inverted` |
| `src/sandbox/DeltaChip.test.tsx` (new) | money/points/plain formatting, tones, invert, em dash |
| `src/sandbox/SliderBox.tsx` (new) | range + `AmountInput` pair on one wire value; actual tick and caption reset; per-knob delta chip; drag vs commit; box fence |
| `src/sandbox/SliderBox.test.tsx` (new) | fraction ⇄ percent, drag/release commit flags, tick + caption reset, chip text, box fence sentence |
| `src/sandbox/CompareTable.tsx` (new) | rows × (Baseline · Scenario · Δ? · pins…) with Unpin headers, pending/error pin columns |
| `src/sandbox/CompareTable.test.tsx` (new) | columns, inverted tones, em dash, pinned header, Δ column absent without a delta reader |
| `src/sandbox/PresetRow.tsx` (new) | chips; disabled with a `title` naming the missing datum |
| `src/sandbox/PresetRow.test.tsx` (new) | apply fires, disabled chip carries its title |
| `src/sandbox/SandboxPanel.tsx` (new) | card frame: eyebrow · toggle · Reset · presets · controls · `Feed`-wrapped compare · pin row · Apply slot |
| `src/sandbox/SandboxPanel.test.tsx` (new) | closed/open, Reset disabled when empty, body order, pin row wiring, Copy link, Apply slot only when non-empty |
| `src/sandbox/sandbox.css` (new) | the sandbox vocabulary (`.sandbox-*`, `.slider-box*`, `.delta-chip*`, `.compare-table`) |
| `src/sandbox/sandboxConformance.test.ts` (new) | source-text walk: nothing under `src/sandbox/` or the three panels imports `api` from the client or spells a mutating `method:` |

Already on main (do not redo): `src/api/whatif.ts` rides `apiReadOnly`; `src/api/whatif.test.ts` pins that `api()` is never called; `src/api/client.ts`'s `apiReadOnly` comment names the what-if sandbox as a caller.

---

### Task 1: `scenarioUrl.ts` — the entry grammar and the parity fixture

**Files:**
- Create: `src/sandbox/scenarioUrl.ts`, `backend/tests/fixtures/sandbox_entries.json`
- Test: `src/sandbox/scenarioUrl.test.ts`

- [ ] **Step 1: Write the parity fixture** (the backend's lane A reads this same file). Every case is in the page codecs' CANONICAL order — sales · ESPP · overrides sorted by key for Taxes; knobs alphabetical for Paycheck; knobs alphabetical then `retire:` by person for Projection — so an arriving fixture URL is never rewritten by the hook's normalization.

```json
{
  "version": 1,
  "note": "Encoder/decoder parity pins for the sandbox `whatif` URL grammar (2026-09-03 planning-sandboxes spec §6, §12). Read by src/sandbox/scenarioUrl.test.ts and backend/tests/test_sandbox_links.py; both must produce `url` from `entries` byte for byte.",
  "cases": [
    {
      "page": "taxes",
      "entries": [
        "sale:7:40",
        "sale:9:10:62.50:S",
        "sale:11:5::S",
        "espp:3",
        "espp:4:150.0000",
        "qualified_dividends:null",
        "trad_401k_contributions:23500"
      ],
      "url": "/taxes?whatif=sale%3A7%3A40&whatif=sale%3A9%3A10%3A62.50%3AS&whatif=sale%3A11%3A5%3A%3AS&whatif=espp%3A3&whatif=espp%3A4%3A150.0000&whatif=qualified_dividends%3Anull&whatif=trad_401k_contributions%3A23500"
    },
    {
      "page": "paycheck",
      "entries": ["hsa_coverage:family", "hsa_per_check:250", "trad_401k_pct:0.15"],
      "url": "/paycheck?whatif=hsa_coverage%3Afamily&whatif=hsa_per_check%3A250&whatif=trad_401k_pct%3A0.15"
    },
    {
      "page": "projection",
      "entries": ["annual_return:0.06", "monthly_contribution:5400", "retire:2:2035-06"],
      "url": "/projection?whatif=annual_return%3A0.06&whatif=monthly_contribution%3A5400&whatif=retire%3A2%3A2035-06"
    },
    {
      "page": "taxes",
      "entries": [],
      "url": "/taxes"
    }
  ]
}
```

- [ ] **Step 2: Write the failing test**

```ts
// src/sandbox/scenarioUrl.test.ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LEGACY_LOT_PARAM,
  WHATIF_PARAM,
  formatEntry,
  formatEspp,
  formatOverride,
  formatRetire,
  formatSale,
  isWireDecimal,
  lastWins,
  legacyLotId,
  legacyTicker,
  parseEntry,
  parseEspp,
  parseKnob,
  parseOverride,
  parseRetire,
  parseSale,
  readEntries,
  withEntries,
} from './scenarioUrl'

const fixture = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../backend/tests/fixtures/sandbox_entries.json'), 'utf8'),
) as { cases: { page: string; entries: string[]; url: string }[] }

describe('parseEntry / formatEntry', () => {
  it('splits on the first colon and keeps empty fields', () => {
    expect(parseEntry('sale:7:40::S')).toEqual({ key: 'sale', fields: ['7', '40', '', 'S'] })
    expect(parseEntry('trad_401k_pct:0.15')).toEqual({ key: 'trad_401k_pct', fields: ['0.15'] })
    expect(formatEntry('sale', '7', '40', '', 'S')).toBe('sale:7:40::S')
  })

  it('returns null for a value with no colon (a legacy ticker) or an empty key', () => {
    expect(parseEntry('NVDA')).toBeNull()
    expect(parseEntry(':7')).toBeNull()
    expect(parseEntry('')).toBeNull()
  })
})

describe('wire tokens', () => {
  it('accepts canonical decimals only', () => {
    for (const ok of ['0', '0.15', '250', '250.00', '-0.5', '23500']) expect(isWireDecimal(ok)).toBe(true)
    for (const bad of ['', '.', '5.', '.5', '+5', '1e3', '$5', '1,000', ' 5']) expect(isWireDecimal(bad)).toBe(false)
  })
})

describe('sale / espp / retire / override / knob round trips', () => {
  it('sale: id and shares, optional price, S for short, long omitted', () => {
    expect(parseSale(['7', '40'])).toEqual({ security_id: 7, shares: '40', term: 'long' })
    expect(parseSale(['9', '10', '62.50', 'S'])).toEqual({ security_id: 9, shares: '10', price: '62.50', term: 'short' })
    expect(parseSale(['11', '5', '', 'S'])).toEqual({ security_id: 11, shares: '5', term: 'short' })
    expect(parseSale(['11', '5', '', 'L'])).toEqual({ security_id: 11, shares: '5', term: 'long' })
    for (const sale of [
      { security_id: 7, shares: '40', term: 'long' as const },
      { security_id: 9, shares: '10', price: '62.50', term: 'short' as const },
      { security_id: 11, shares: '5', term: 'short' as const },
    ]) {
      const text = formatSale(sale)
      expect(parseSale(parseEntry(text)!.fields)).toEqual(sale)
    }
    expect(formatSale({ security_id: 11, shares: '5', term: 'short' })).toBe('sale:11:5::S')
    expect(formatSale({ security_id: 7, shares: '40', term: 'long' })).toBe('sale:7:40')
  })

  it('sale: garbage is null — bad id, zero shares, bad price, unknown term', () => {
    expect(parseSale(['0', '40'])).toBeNull()
    expect(parseSale(['7', '0'])).toBeNull()
    expect(parseSale(['7', '-1'])).toBeNull()
    expect(parseSale(['7', '40', 'abc'])).toBeNull()
    expect(parseSale(['7', '40', '62.50', 'X'])).toBeNull()
    expect(parseSale(['7'])).toBeNull()
  })

  it('espp: lot id and optional price', () => {
    expect(parseEspp(['3'])).toEqual({ lot_id: 3 })
    expect(parseEspp(['4', '150.0000'])).toEqual({ lot_id: 4, sale_price: '150.0000' })
    expect(parseEspp(['x'])).toBeNull()
    expect(parseEspp(['4', '-1'])).toBeNull()
    expect(formatEspp({ lot_id: 4, sale_price: '150.0000' })).toBe('espp:4:150.0000')
    expect(formatEspp({ lot_id: 3 })).toBe('espp:3')
  })

  it('retire: person id and YYYY-MM', () => {
    expect(parseRetire(['2', '2035-06'])).toEqual({ person_id: 2, month: '2035-06' })
    expect(parseRetire(['2', '2035-13'])).toBeNull()
    expect(parseRetire(['2', '2035-06-01'])).toBeNull()
    expect(formatRetire({ person_id: 2, month: '2035-06' })).toBe('retire:2:2035-06')
  })

  it('override: <key>:<decimal|null> in the input-definition vocabulary', () => {
    expect(parseOverride(parseEntry('trad_401k_contributions:23500')!)).toEqual({ key: 'trad_401k_contributions', value: '23500' })
    expect(parseOverride(parseEntry('qualified_dividends:null')!)).toEqual({ key: 'qualified_dividends', value: null })
    expect(parseOverride(parseEntry('qualified_dividends:abc')!)).toBeNull()
    expect(parseOverride(parseEntry('qualified_dividends:1:2')!)).toBeNull()
    expect(formatOverride('qualified_dividends', null)).toBe('qualified_dividends:null')
    expect(formatOverride('trad_401k_contributions', '23500')).toBe('trad_401k_contributions:23500')
  })

  it('knob: an allow-listed key with an accepted value', () => {
    const keys = ['trad_401k_pct', 'hsa_coverage'] as const
    const accept = (key: string, value: string) =>
      key === 'hsa_coverage' ? ['none', 'self', 'family'].includes(value) : isWireDecimal(value)
    expect(parseKnob(parseEntry('trad_401k_pct:0.15')!, keys, accept)).toEqual({ key: 'trad_401k_pct', value: '0.15' })
    expect(parseKnob(parseEntry('hsa_coverage:family')!, keys, accept)).toEqual({ key: 'hsa_coverage', value: 'family' })
    expect(parseKnob(parseEntry('hsa_coverage:spouse')!, keys, accept)).toBeNull()
    expect(parseKnob(parseEntry('bonus_pct:0.1')!, keys, accept)).toBeNull()
    expect(parseKnob(parseEntry('trad_401k_pct:0.1:0.2')!, keys, accept)).toBeNull()
  })
})

describe('URL helpers', () => {
  it('reads every whatif value, rewrites only the whatif family (plus asked-for keys), and never touches other params', () => {
    const params = new URLSearchParams('year=2026&whatif=sale%3A7%3A40&owner=2&whatif=espp%3A3&whatif-lot=9')
    expect(readEntries(params)).toEqual(['sale:7:40', 'espp:3'])
    const next = withEntries(params, ['trad_401k_contributions:23500'], [LEGACY_LOT_PARAM])
    expect(next.toString()).toBe('year=2026&owner=2&whatif=trad_401k_contributions%3A23500')
    expect(params.toString()).toBe('year=2026&whatif=sale%3A7%3A40&owner=2&whatif=espp%3A3&whatif-lot=9') // input untouched
    expect(withEntries(params, []).getAll(WHATIF_PARAM)).toEqual([])
  })

  it('recognizes the legacy aliases: a colon-less whatif value is a ticker, whatif-lot an integer', () => {
    expect(legacyTicker(new URLSearchParams('whatif=NVDA'))).toBe('NVDA')
    expect(legacyTicker(new URLSearchParams('whatif=BRK.B%2BX'))).toBe('BRK.B+X')
    expect(legacyTicker(new URLSearchParams('whatif=sale%3A7%3A40'))).toBeNull()
    expect(legacyTicker(new URLSearchParams('whatif='))).toBeNull()
    expect(legacyLotId(new URLSearchParams('whatif-lot=4'))).toBe(4)
    expect(legacyLotId(new URLSearchParams('whatif-lot=0'))).toBeNull()
    expect(legacyLotId(new URLSearchParams('whatif-lot=abc'))).toBeNull()
    expect(legacyLotId(new URLSearchParams(''))).toBeNull()
  })

  it('lastWins keeps the LAST entry per identity, in first-seen order', () => {
    const entries = ['a:1', 'b:2', 'a:3'].map((e) => parseEntry(e)!)
    expect(lastWins(entries, (e) => e.key).map((e) => formatEntry(e.key, ...e.fields))).toEqual(['a:3', 'b:2'])
  })
})

describe('parity fixture', () => {
  it('builds every fixture URL byte for byte from its entries, and every entry parses', () => {
    for (const c of fixture.cases) {
      const qs = withEntries(new URLSearchParams(), c.entries).toString()
      expect(`/${c.page}${qs === '' ? '' : `?${qs}`}`).toBe(c.url)
      for (const entry of c.entries) expect(parseEntry(entry)).not.toBeNull()
    }
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/sandbox/scenarioUrl.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the module**

```ts
// src/sandbox/scenarioUrl.ts
// The sandbox URL grammar (2026-09-03 planning-sandboxes spec §6): one repeated `whatif`
// query param, each value one entry `<kind>:<fields>` in the SERVER'S wire vocabulary —
// fractions, canonical decimals, ids — so decode → request body is a straight copy and the
// round trip is byte equality. Pure string code over URLSearchParams; nothing here knows a
// page. Page decoders compose these parsers and drop whatever comes back null.

export const WHATIF_PARAM = 'whatif'
/** The pre-sandbox ESPP lots-table link (`/taxes?whatif-lot=<id>`), kept working as an alias. */
export const LEGACY_LOT_PARAM = 'whatif-lot'

export interface ScenarioEntry {
  key: string
  fields: string[]
}

/** `<key>:<f1>[:<f2>…]` → parts, keeping empty fields ("sale:7:40::S" → ['7','40','','S']).
 *  Null for a value with no colon — the old `?whatif=TICKER` — or an empty key. */
export function parseEntry(raw: string): ScenarioEntry | null {
  const colon = raw.indexOf(':')
  if (colon <= 0) return null
  return { key: raw.slice(0, colon), fields: raw.slice(colon + 1).split(':') }
}

export function formatEntry(key: string, ...fields: string[]): string {
  return [key, ...fields].join(':')
}

/** The server's canonical decimal spellings and nothing else: "0.15", "250", "250.00",
 *  "-0.5". No exponent (Python's Decimal would accept "1e-3" and store a tenth of a
 *  percent for a thousandth — utils/percent.ts's warning), no "+", no bare point. */
export const WIRE_DECIMAL = /^-?\d+(?:\.\d+)?$/
export function isWireDecimal(text: string): boolean {
  return WIRE_DECIMAL.test(text)
}

/** A positive int4 (the ids' fence — api/paycheck.py's IdQuery bound). */
export function isPositiveInt(text: string): boolean {
  return /^[1-9]\d{0,9}$/.test(text) && Number(text) <= 2147483647
}

export const MONTH_TOKEN = /^\d{4}-(?:0[1-9]|1[0-2])$/

export function readEntries(params: URLSearchParams): string[] {
  return params.getAll(WHATIF_PARAM)
}

/** A COPY of `params` with the whatif family replaced by `entries` (and `drop`ped keys
 *  removed). Every other key — the shell's owner/range/month, Taxes' year — passes through
 *  untouched: the sandbox never owns them (spec §6). */
export function withEntries(
  params: URLSearchParams,
  entries: string[],
  drop: string[] = [],
): URLSearchParams {
  const next = new URLSearchParams(params)
  next.delete(WHATIF_PARAM)
  for (const key of drop) next.delete(key)
  for (const entry of entries) next.append(WHATIF_PARAM, entry)
  return next
}

/** The old `/taxes?whatif=TICKER` deep link: the first whatif value with no colon. */
export function legacyTicker(params: URLSearchParams): string | null {
  for (const value of params.getAll(WHATIF_PARAM)) {
    const text = value.trim()
    if (text !== '' && !text.includes(':')) return text
  }
  return null
}

/** The old `/taxes?whatif-lot=<id>` link — TaxesPage's integer fence, verbatim. */
export function legacyLotId(params: URLSearchParams): number | null {
  const raw = params.get(LEGACY_LOT_PARAM)
  if (raw === null) return null
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** A duplicate identity keeps the LAST entry (spec §6); order is otherwise first-seen. */
export function lastWins<T>(entries: T[], identity: (entry: T) => string): T[] {
  const byId = new Map<string, T>()
  for (const entry of entries) {
    const id = identity(entry)
    byId.delete(id)
    byId.set(id, entry)
  }
  return [...byId.values()]
}

// ── Typed kinds ─────────────────────────────────────────────────────────────────────────

/** `sale:<security_id>:<shares>[:<price>][:<L|S>]` — a brokerage leg. An empty price field
 *  is the API's omit case (the latest quote); the term defaults long. Mirrors SaleLegIn. */
export interface SaleEntry {
  security_id: number
  shares: string
  price?: string
  term: 'long' | 'short'
}

export function parseSale(fields: string[]): SaleEntry | null {
  const [id, shares, price = '', term = ''] = fields
  if (fields.length < 2 || fields.length > 4) return null
  if (!isPositiveInt(id)) return null
  if (!isWireDecimal(shares) || Number(shares) <= 0) return null
  if (price !== '' && (!isWireDecimal(price) || Number(price) <= 0)) return null
  if (term !== '' && term !== 'L' && term !== 'S') return null
  const sale: SaleEntry = { security_id: Number(id), shares, term: term === 'S' ? 'short' : 'long' }
  if (price !== '') sale.price = price
  return sale
}

export function formatSale(sale: SaleEntry): string {
  const fields = [String(sale.security_id), sale.shares]
  if (sale.price !== undefined || sale.term === 'short') fields.push(sale.price ?? '')
  if (sale.term === 'short') fields.push('S')
  return formatEntry('sale', ...fields)
}

/** `espp:<lot_id>[:<price>]` — an ESPP lot sale; empty price = the ESPP quote. */
export interface EsppEntry {
  lot_id: number
  sale_price?: string
}

export function parseEspp(fields: string[]): EsppEntry | null {
  const [id, price = ''] = fields
  if (fields.length < 1 || fields.length > 2) return null
  if (!isPositiveInt(id)) return null
  if (price !== '' && (!isWireDecimal(price) || Number(price) <= 0)) return null
  const espp: EsppEntry = { lot_id: Number(id) }
  if (price !== '') espp.sale_price = price
  return espp
}

export function formatEspp(espp: EsppEntry): string {
  return espp.sale_price === undefined
    ? formatEntry('espp', String(espp.lot_id))
    : formatEntry('espp', String(espp.lot_id), espp.sale_price)
}

/** `retire:<person_id>:<YYYY-MM>` — mirrors the projection API's `retire=` spelling. */
export interface RetireEntry {
  person_id: number
  month: string
}

export function parseRetire(fields: string[]): RetireEntry | null {
  const [id, month] = fields
  if (fields.length !== 2 || !isPositiveInt(id) || !MONTH_TOKEN.test(month)) return null
  return { person_id: Number(id), month }
}

export function formatRetire(retire: RetireEntry): string {
  return formatEntry('retire', String(retire.person_id), retire.month)
}

/** `<input_key>:<decimal|null>` — a tax override in the year's input-definition vocabulary.
 *  The caller checks the key against the definitions it has; this only checks the shape. */
export function parseOverride(entry: ScenarioEntry): { key: string; value: string | null } | null {
  if (entry.fields.length !== 1) return null
  const [value] = entry.fields
  if (value === 'null') return { key: entry.key, value: null }
  return isWireDecimal(value) ? { key: entry.key, value } : null
}

export function formatOverride(key: string, value: string | null): string {
  return formatEntry(key, value ?? 'null')
}

/** `<knob>:<token>` restricted to an allow-list; `accept` judges the token per key. */
export function parseKnob<K extends string>(
  entry: ScenarioEntry,
  keys: readonly K[],
  accept: (key: K, value: string) => boolean,
): { key: K; value: string } | null {
  if (entry.fields.length !== 1) return null
  if (!(keys as readonly string[]).includes(entry.key)) return null
  const key = entry.key as K
  const [value] = entry.fields
  return accept(key, value) ? { key, value } : null
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/sandbox/scenarioUrl.test.ts`
Expected: PASS (11 tests). If the parity case fails on encoding, compare the fixture's `%3A` spellings against `URLSearchParams.toString()` — never change the fixture to match a bug; the Python side (`urllib.parse.urlencode`) produces exactly these strings.

- [ ] **Step 6: Commit**

```bash
git add src/sandbox/scenarioUrl.ts src/sandbox/scenarioUrl.test.ts backend/tests/fixtures/sandbox_entries.json
git commit -m "feat(sandbox): whatif URL entry grammar with typed sale/espp/retire/override parsers and the parity fixture"
```

---

### Task 2: `decimal.ts` — exact string arithmetic

**Files:**
- Create: `src/sandbox/decimal.ts`
- Test: `src/sandbox/decimal.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/sandbox/decimal.test.ts
import { describe, expect, it } from 'vitest'
import { compareDecimals, decimalsIn, divideDecimals, subtractDecimals, trimZeros } from './decimal'

describe('decimal helpers', () => {
  it('subtracts exactly across scales and signs', () => {
    expect(subtractDecimals('0.15', '0.130000000')).toBe('0.02')
    expect(subtractDecimals('250', '100.00')).toBe('150')
    expect(subtractDecimals('0.13', '0.15')).toBe('-0.02')
    expect(subtractDecimals('0.13', '0.13')).toBe('0')
    expect(subtractDecimals('-0.5', '0.25')).toBe('-0.75')
    expect(subtractDecimals('0.1', '0.3')).toBe('-0.2') // never 0.30000000000000004
  })

  it('divides to a floored fixed number of places', () => {
    expect(divideDecimals('24500', '100000', 9)).toBe('0.245')
    expect(divideDecimals('23500', '188930', 9)).toBe('0.124384164') // floor, not round
    expect(divideDecimals('4300', '24', 2)).toBe('179.16')
    expect(divideDecimals('1', '3', 4)).toBe('0.3333')
    expect(divideDecimals('5', '0', 2)).toBeNull()
  })

  it('compares numerically', () => {
    expect(compareDecimals('0.15', '0.150')).toBe(0)
    expect(compareDecimals('0.2', '0.15')).toBe(1)
    expect(compareDecimals('-1', '0')).toBe(-1)
  })

  it('counts decimals and trims zeros', () => {
    expect(decimalsIn('0.005')).toBe(3)
    expect(decimalsIn('5')).toBe(0)
    expect(trimZeros('0.150')).toBe('0.15')
    expect(trimZeros('250.00')).toBe('250')
    expect(trimZeros('-0.00')).toBe('0')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/sandbox/decimal.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
// src/sandbox/decimal.ts
// Exact arithmetic on wire decimals, for the two or three places the sandbox grammar has to
// compute an INPUT itself (a knob's distance from actual, a preset's limit ÷ salary). Pure
// string/BigInt code: nothing here goes through a float, so a result can be written back
// into a URL or a request body without a 0.30000000000000004 ever appearing (the
// utils/percent.ts rule, extended from point-shifting to subtraction and division).
// Displayed FIGURES are still never computed here — those are the server's (global rule 9).

const PLAIN = /^(-?)(\d*)(?:\.(\d*))?$/

function scaled(text: string, places: number): bigint {
  const match = PLAIN.exec(text.trim())
  if (match === null) throw new Error(`not a decimal: ${text}`)
  const [, sign, whole = '', frac = ''] = match
  const digits = `${whole}${frac.padEnd(places, '0').slice(0, places)}`
  const value = BigInt(digits === '' ? '0' : digits)
  return sign === '-' ? -value : value
}

function unscaled(value: bigint, places: number): string {
  const negative = value < 0n
  const digits = (negative ? -value : value).toString().padStart(places + 1, '0')
  const whole = digits.slice(0, digits.length - places)
  const frac = digits.slice(digits.length - places)
  const text = places === 0 ? whole : `${whole}.${frac}`
  return trimZeros(`${negative ? '-' : ''}${text}`)
}

export function decimalsIn(text: string): number {
  const point = text.indexOf('.')
  return point === -1 ? 0 : text.length - point - 1
}

/** "0.150" → "0.15", "250.00" → "250", "-0.00" → "0". */
export function trimZeros(text: string): string {
  let out = text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text
  if (out === '-0' || out === '' || out === '-') out = '0'
  return out
}

export function subtractDecimals(a: string, b: string): string {
  const places = Math.max(decimalsIn(a), decimalsIn(b))
  return unscaled(scaled(a, places) - scaled(b, places), places)
}

/** a ÷ b floored to `places` decimals; null when b is zero. */
export function divideDecimals(a: string, b: string, places: number): string | null {
  const scale = Math.max(decimalsIn(a), decimalsIn(b))
  const divisor = scaled(b, scale)
  if (divisor === 0n) return null
  const numerator = scaled(a, scale) * 10n ** BigInt(places)
  // BigInt division truncates toward zero; floor toward −∞ for negatives so a cap is never
  // exceeded in either direction.
  let quotient = numerator / divisor
  if ((numerator < 0n) !== (divisor < 0n) && quotient * divisor !== numerator) quotient -= 1n
  return unscaled(quotient, places)
}

export function compareDecimals(a: string, b: string): -1 | 0 | 1 {
  const places = Math.max(decimalsIn(a), decimalsIn(b))
  const x = scaled(a, places)
  const y = scaled(b, places)
  return x < y ? -1 : x > y ? 1 : 0
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/sandbox/decimal.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sandbox/decimal.ts src/sandbox/decimal.test.ts
git commit -m "feat(sandbox): exact BigInt decimal subtract/divide/compare for knob deltas and preset sizing"
```

---

### Task 3: `pins.ts` — the localStorage pin store

**Files:**
- Create: `src/sandbox/pins.ts`
- Test: `src/sandbox/pins.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/sandbox/pins.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { PIN_LIMIT, newPin, pinsKey, readPins, writePins } from './pins'

beforeEach(() => localStorage.clear())

const acceptAll = () => true

describe('pins store', () => {
  it('names the key per page and starts empty', () => {
    expect(pinsKey('taxes')).toBe('finance.sandbox.taxes')
    expect(readPins('taxes', acceptAll)).toEqual([])
    expect(PIN_LIMIT).toBe(3)
  })

  it('round-trips pins and drops the ones the decoder rejects', () => {
    const a = newPin('Sell 40 VTI', ['sale:7:40'])
    const b = newPin('Garbage', ['nope'])
    writePins('taxes', [a, b])
    expect(readPins('taxes', acceptAll)).toEqual([a, b])
    expect(readPins('taxes', (entries) => entries[0] !== 'nope')).toEqual([a])
    expect(a.id).not.toBe(b.id)
    expect(a.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('reads a corrupt or foreign blob as empty', () => {
    localStorage.setItem(pinsKey('paycheck'), '{not json')
    expect(readPins('paycheck', acceptAll)).toEqual([])
    localStorage.setItem(pinsKey('paycheck'), JSON.stringify({ version: 99, pins: [] }))
    expect(readPins('paycheck', acceptAll)).toEqual([])
    localStorage.setItem(
      pinsKey('paycheck'),
      JSON.stringify({ version: 1, pins: [{ id: 1, label: 'x', entries: 'a:1' }, { id: 'ok', label: 'y', createdAt: 't', entries: ['a:1'] }] }),
    )
    expect(readPins('paycheck', acceptAll)).toEqual([{ id: 'ok', label: 'y', createdAt: 't', entries: ['a:1'] }])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/sandbox/pins.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
// src/sandbox/pins.ts
// Pinned scenarios (2026-09-03 planning-sandboxes spec §4, §8.5): personal working memory in
// localStorage, KNOBS ONLY — an array of the URL's entry strings, never a result — so a
// pinned column is always re-run against live data and can never show a stale number. At
// most three per page. Storage is user-writable, so every read is validated: the shape
// here, the entries by the page's own decoder (`accept`). `finance.sandbox.*` migrates with
// `finance.scope` when the Data lifecycle spec's preferences endpoint lands.

export type SandboxPage = 'paycheck' | 'taxes' | 'projection'

export const PIN_LIMIT = 3
export const PINS_VERSION = 1

export interface Pin {
  id: string
  label: string
  createdAt: string
  entries: string[]
}

export function pinsKey(page: SandboxPage): string {
  return `finance.sandbox.${page}`
}

function isPin(value: unknown): value is Pin {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.label === 'string' &&
    typeof record.createdAt === 'string' &&
    Array.isArray(record.entries) &&
    record.entries.every((entry) => typeof entry === 'string')
  )
}

/** Every stored pin whose shape is right AND whose entries the page's decoder accepts.
 *  A corrupt blob, a foreign version or a non-object reads as empty. */
export function readPins(page: SandboxPage, accept: (entries: string[]) => boolean): Pin[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(pinsKey(page)) ?? 'null')
    if (parsed === null || typeof parsed !== 'object') return []
    const blob = parsed as { version?: unknown; pins?: unknown }
    if (blob.version !== PINS_VERSION || !Array.isArray(blob.pins)) return []
    return blob.pins.filter(isPin).filter((pin) => accept(pin.entries)).slice(0, PIN_LIMIT)
  } catch {
    return []
  }
}

export function writePins(page: SandboxPage, pins: Pin[]): void {
  try {
    localStorage.setItem(pinsKey(page), JSON.stringify({ version: PINS_VERSION, pins }))
  } catch {
    // Storage full or disabled: the pin still lives in this tab's state; nothing on screen lies.
  }
}

export function newPin(label: string, entries: string[]): Pin {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    createdAt: new Date().toISOString(),
    entries: [...entries],
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/sandbox/pins.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sandbox/pins.ts src/sandbox/pins.test.ts
git commit -m "feat(sandbox): versioned, validated finance.sandbox.<page> pin store (max three, entries only)"
```

---

### Task 4: `useSandbox`

**Files:**
- Create: `src/sandbox/useSandbox.ts`
- Test: `src/sandbox/useSandbox.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/sandbox/useSandbox.test.tsx
import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { pinsKey, writePins, newPin } from './pins'
import { formatEntry, isWireDecimal, lastWins, parseEntry, parseKnob } from './scenarioUrl'
import { useSandbox, type SandboxSpec } from './useSandbox'

const toast = { success: vi.fn(), info: vi.fn(), error: vi.fn() }
vi.mock('../components/ToastProvider', () => ({ useToast: () => toast }))

// A two-knob scenario and a two-sided payload, standing in for a page.
interface S {
  a?: string
  b?: string
}
interface R {
  baseline: { a: string }
  scenario: { a: string | null; b: string | null }
}
const KEYS = ['a', 'b'] as const
const decode = (entries: string[]): S => {
  const knobs = lastWins(
    entries
      .map(parseEntry)
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .map((e) => parseKnob(e, KEYS, (_k, v) => isWireDecimal(v)))
      .filter((k): k is NonNullable<typeof k> => k !== null),
    (k) => k.key,
  )
  return Object.fromEntries(knobs.map((k) => [k.key, k.value])) as S
}
const encode = (s: S): string[] => KEYS.filter((k) => s[k] !== undefined).map((k) => formatEntry(k, s[k] as string))
const isEmpty = (s: S) => s.a === undefined && s.b === undefined

const preview = vi.fn<(s: S) => Promise<R>>()
function answer(s: S): R {
  return { baseline: { a: '0' }, scenario: { a: s.a ?? null, b: s.b ?? null } }
}

function Probe({ dataKey = 'k1', enabled = true }: { dataKey?: string; enabled?: boolean }) {
  const spec: SandboxSpec<S, R> = {
    page: 'paycheck',
    decode,
    encode,
    isEmpty,
    preview,
    baselineOf: (r) => ({ baseline: r.baseline, scenario: { a: r.baseline.a, b: null } }),
    dataKey,
    enabled,
    labelFor: (s) => `a ${s.a ?? '—'}`,
  }
  const sb = useSandbox(spec)
  const location = useLocation()
  const navType = useNavigationType()
  return (
    <div>
      <span data-testid="url">{location.pathname + location.search}</span>
      <span data-testid="nav">{navType}</span>
      <span data-testid="result">{sb.result === null ? 'null' : `${sb.result.scenario.a}|${sb.result.scenario.b}`}</span>
      <span data-testid="baseline">{sb.baseline === null ? 'null' : sb.baseline.baseline.a}</span>
      <span data-testid="flags">{`${sb.busy}|${sb.stale}|${sb.error ?? ''}|${sb.errorStatus ?? ''}|${sb.empty}`}</span>
      <span data-testid="pins">{sb.pins.map((p) => p.label).join(',')}</span>
      <span data-testid="pinResults">
        {sb.pins.map((p) => {
          const r = sb.pinResults[p.id]
          return r === 'pending' ? 'pending' : 'error' in r ? `error:${r.error}` : `ok:${r.scenario.a}`
        }).join(',')}
      </span>
      <span data-testid="link">{sb.link}</span>
      <button onClick={() => sb.set({ a: '1' })}>drag1</button>
      <button onClick={() => sb.set({ a: '2' })}>drag2</button>
      <button onClick={() => sb.set({ a: '3' }, { immediate: true })}>commit3</button>
      <button onClick={() => sb.set((s) => ({ ...s, b: '9' }), { immediate: true, drop: ['whatif-lot'] })}>b9</button>
      <button onClick={sb.reset}>reset</button>
      <button onClick={() => sb.pin()}>pin</button>
      <button onClick={() => sb.pin('Named')}>pinNamed</button>
      <button onClick={() => sb.unpin(sb.pins[0]?.id ?? '')}>unpin</button>
    </div>
  )
}

function mount(entry = '/paycheck', props: { dataKey?: string; enabled?: boolean } = {}) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Probe {...props} />
    </MemoryRouter>,
  )
}

const text = (id: string) => screen.getByTestId(id).textContent
const click = (name: string) => act(() => screen.getByText(name).click())
const tick = (ms: number) => act(async () => { vi.advanceTimersByTime(ms) })
const settle = () => act(async () => { await Promise.resolve() })

// A promise settled by hand — to hold two flights open and choose which lands first.
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  preview.mockReset()
  preview.mockImplementation(async (s) => answer(s))
  toast.info.mockReset()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useSandbox', () => {
  it('runs the empty scenario once on mount for the baseline and marks empty', async () => {
    mount()
    await settle()
    expect(preview).toHaveBeenCalledTimes(1)
    expect(preview).toHaveBeenCalledWith({})
    expect(text('baseline')).toBe('0')
    expect(text('flags')).toBe('false|false|||true')
  })

  it('collapses a drag into one trailing request, written replace-style at the tick', async () => {
    mount()
    await settle()
    click('drag1')
    click('drag2')
    expect(text('url')).toBe('/paycheck') // nothing written yet
    expect(preview).toHaveBeenCalledTimes(1)
    await tick(249)
    expect(text('url')).toBe('/paycheck')
    await tick(1)
    expect(text('url')).toBe('/paycheck?whatif=a%3A2')
    expect(text('nav')).toBe('REPLACE')
    await settle()
    expect(preview).toHaveBeenCalledTimes(2)
    expect(preview).toHaveBeenLastCalledWith({ a: '2' })
    expect(text('result')).toBe('2|null')
    expect(text('flags')).toBe('false|false|||false')
  })

  it('immediate bypasses the debounce and can drop a legacy key in the same write', async () => {
    mount('/paycheck?whatif-lot=4&year=2026')
    await settle()
    click('commit3')
    expect(text('url')).toBe('/paycheck?whatif-lot=4&year=2026&whatif=a%3A3')
    click('b9')
    expect(text('url')).toBe('/paycheck?year=2026&whatif=a%3A3&whatif=b%3A9')
    await settle()
    expect(preview).toHaveBeenLastCalledWith({ a: '3', b: '9' })
  })

  it('is busy while a run is in flight and stale until the newer run lands', async () => {
    const slow = deferred<R>()
    mount()
    await settle()
    preview.mockReturnValueOnce(slow.promise)
    click('commit3')
    expect(text('flags')).toBe('true|false|||false') // busy: no result for this scenario yet
    await act(async () => { slow.resolve(answer({ a: '3' })) })
    expect(text('flags')).toBe('false|false|||false')
  })

  it('drops a stale sequence — the older answer never replaces the newer scenario', async () => {
    const slow = deferred<R>()
    const fast = deferred<R>()
    mount()
    await settle()
    preview.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise)
    click('commit3')
    click('b9')
    await act(async () => { fast.resolve(answer({ a: '3', b: '9' })) })
    expect(text('result')).toBe('3|9')
    await act(async () => { slow.resolve(answer({ a: '3' })) })
    expect(text('result')).toBe('3|9')
  })

  it('arriving with entries runs at once', async () => {
    mount('/paycheck?whatif=a%3A5')
    await settle()
    expect(preview).toHaveBeenCalledWith({ a: '5' })
    expect(text('result')).toBe('5|null')
    expect(text('flags')).toBe('false|false|||false')
  })

  it('drops garbage entries on arrival and rewrites the URL without them (replace)', async () => {
    mount('/paycheck?whatif=NVDA&whatif=a%3A5&whatif=zzz%3A1&owner=2')
    await settle()
    expect(text('url')).toBe('/paycheck?owner=2&whatif=a%3A5')
    expect(text('nav')).toBe('REPLACE')
    expect(preview).toHaveBeenCalledTimes(1)
  })

  it('keeps the last result on failure, marked stale, with the server sentence and status', async () => {
    mount()
    await settle()
    click('commit3')
    await settle()
    expect(text('result')).toBe('3|null')
    preview.mockRejectedValueOnce(new ApiError('lot 4 already sold', 409))
    click('b9')
    await settle()
    expect(text('result')).toBe('3|null')
    expect(text('flags')).toBe('false|true|lot 4 already sold|409|false')
    // A later success clears the error and un-stales.
    click('commit3')
    await settle()
    expect(text('flags')).toBe('false|false|||false')
  })

  it('shows the error alone when there is no result yet', async () => {
    preview.mockRejectedValue(new ApiError('no paycheck profiles', 404))
    mount('/paycheck?whatif=a%3A5')
    await settle()
    expect(text('result')).toBe('null')
    expect(text('flags')).toBe('false|false|no paycheck profiles|404|false')
  })

  it('reset empties the whatif family, keeps other params and restores the baseline as the result', async () => {
    mount('/paycheck?owner=2&whatif=a%3A5')
    await settle()
    click('reset')
    expect(text('url')).toBe('/paycheck?owner=2')
    await settle()
    expect(text('result')).toBe('0|null') // the baseline run's two-sided answer
    expect(text('flags')).toBe('false|false|||true')
  })

  it('does nothing while disabled, then runs when enabled', async () => {
    const { rerender } = mount('/paycheck?whatif=a%3A5', { enabled: false })
    await settle()
    expect(preview).not.toHaveBeenCalled()
    expect(text('flags')).toBe('false|false|||false')
    rerender(
      <MemoryRouter initialEntries={['/paycheck?whatif=a%3A5']}>
        <Probe enabled />
      </MemoryRouter>,
    )
    await settle()
    expect(preview).toHaveBeenCalledWith({ a: '5' })
  })

  it('names the live scenario link from the current URL', async () => {
    mount('/paycheck?owner=2&whatif=a%3A5')
    await settle()
    expect(text('link')).toBe('/paycheck?owner=2&whatif=a%3A5')
  })

  describe('pins', () => {
    it('pins the live scenario with a default label, refuses a fourth with a toast, unpins', async () => {
      mount('/paycheck?whatif=a%3A5')
      await settle()
      click('pin')
      expect(text('pins')).toBe('a 5')
      expect(JSON.parse(localStorage.getItem(pinsKey('paycheck')) ?? '{}').pins[0].entries).toEqual(['a:5'])
      click('pinNamed')
      click('pinNamed')
      expect(text('pins')).toBe('a 5,Named,Named')
      click('pin')
      expect(text('pins')).toBe('a 5,Named,Named')
      expect(toast.info).toHaveBeenCalledWith('Unpin one first')
      click('unpin')
      expect(text('pins')).toBe('Named,Named')
    })

    it('refuses to pin an empty scenario', async () => {
      mount()
      await settle()
      click('pin')
      expect(text('pins')).toBe('')
    })

    it('reads stored pins, ignores corrupt storage, runs each pin and re-runs on dataKey change', async () => {
      writePins('paycheck', [newPin('Stored', ['a:7']), newPin('Bad', ['nope'])])
      const { rerender } = mount('/paycheck', { dataKey: 'k1' })
      await settle()
      expect(text('pins')).toBe('Stored') // the undecodable pin is dropped on read
      expect(preview).toHaveBeenCalledWith({ a: '7' })
      expect(text('pinResults')).toBe('ok:7')
      const calls = preview.mock.calls.length
      rerender(
        <MemoryRouter initialEntries={['/paycheck']}>
          <Probe dataKey="k2" />
        </MemoryRouter>,
      )
      await settle()
      expect(preview.mock.calls.length).toBeGreaterThan(calls)
      expect(preview).toHaveBeenLastCalledWith({ a: '7' })
    })

    it('renders a per-pin error column when its run fails', async () => {
      writePins('paycheck', [newPin('Gone', ['a:8'])])
      preview.mockImplementation(async (s) => {
        if (s.a === '8') throw new ApiError('paycheck profile not found', 404)
        return answer(s)
      })
      mount('/paycheck')
      await settle()
      expect(text('pinResults')).toBe('error:paycheck profile not found')
      expect(text('flags')).toBe('false|false|||true') // the live run is unaffected
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/sandbox/useSandbox.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the hook**

```ts
// src/sandbox/useSandbox.ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useToast } from '../components/ToastProvider'
import { PIN_LIMIT, newPin, readPins, writePins, type Pin, type SandboxPage } from './pins'
import { readEntries, withEntries } from './scenarioUrl'

// The sandbox hook (2026-09-03 planning-sandboxes spec §7). THE URL IS THE STATE: `scenario`
// derives from the `whatif` params through the page's `decode`; `set` encodes and writes ONE
// `replace` at the trailing edge of a debounce, so the address bar always names the request
// in flight and the back button leaves the page rather than replaying slider positions. No
// second copy of the knobs lives in React state (the useScope rule). Requests ride the
// page's `preview` — pure endpoints through apiReadOnly — under a sequence guard; a failure
// keeps the last result, marked `stale`, with the server's sentence. `busy`, `stale` and
// `pinResults` are DERIVED from run keys rather than set from effect bodies (react-hooks 7's
// set-state-in-effect rule): a run is in flight exactly when the current key has neither a
// result nor a recorded failure.

export interface SandboxSpec<S extends object, R> {
  page: SandboxPage
  /** Total: bad entries are dropped, never thrown. Define at MODULE scope — a stable identity
   *  keeps `scenario` referentially stable across renders. */
  decode: (entries: string[]) => S
  encode: (scenario: S) => string[]
  isEmpty: (scenario: S) => boolean
  /** The pure request; the hook never inspects R. May close over props. */
  preview: (scenario: S) => Promise<R>
  /** Two-sided payloads carry their own baseline; absent → the hook runs the empty scenario. */
  baselineOf?: (result: R) => R
  /** Pins (and the baseline) re-run when this changes: Taxes' year, Paycheck's profile/owner. */
  dataKey: string
  debounceMs?: number
  /** false while a panel is closed: no request leaves, pins wait. Default true. */
  enabled?: boolean
  /** One-sided pages only: an empty run the page already holds (Projection's
   *  `projection:default` snapshot) seeds `baseline` — and `result`, when the arrival scenario
   *  is empty — for an instant first paint; the mount run still revalidates. */
  initialBaseline?: R | null
  /** One-sided pages only: fires when a fresh empty run lands (Projection re-caches it). */
  onBaseline?: (baseline: R) => void
  /** The default pin label — the first two changed knobs ("401(k) 15% · HSA $250"). */
  labelFor?: (scenario: S) => string
}

export type PinResult<R> = R | 'pending' | { error: string }

export interface Sandbox<S extends object, R> {
  scenario: S
  /** The canonical entries of the live scenario (what a pin stores). */
  entries: string[]
  empty: boolean
  set: (
    patch: Partial<S> | ((current: S) => S),
    opts?: { immediate?: boolean; drop?: string[] },
  ) => void
  reset: () => void
  baseline: R | null
  result: R | null
  busy: boolean
  error: string | null
  errorStatus: number | null
  /** `result` is older than `scenario`. */
  stale: boolean
  pins: Pin[]
  pin: (label?: string) => void
  unpin: (id: string) => void
  pinResults: Record<string, PinResult<R>>
  /** The live scenario's shareable URL (path + search) — "Copy link". */
  link: string
}

export const DEFAULT_DEBOUNCE_MS = 250
const SEP = ''

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'The scenario could not be computed'
}

interface RunState<R> {
  result: R | null
  resultKey: string | null
  baseline: R | null
  baselineKey: string | null
  error: string | null
  errorKey: string | null
  errorStatus: number | null
}

export function useSandbox<S extends object, R>(spec: SandboxSpec<S, R>): Sandbox<S, R> {
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const toast = useToast()
  const { decode, encode, isEmpty, dataKey } = spec
  const enabled = spec.enabled !== false

  const entries = useMemo(() => readEntries(searchParams), [searchParams])
  const entriesKey = entries.join(SEP)
  const scenario = useMemo(() => decode(entries), [decode, entries])
  const canonical = useMemo(() => encode(scenario), [encode, scenario])
  const canonicalKey = canonical.join(SEP)
  const empty = isEmpty(scenario)
  // A run is identified by WHAT it modelled and WHICH data it modelled against.
  const runKey = `${dataKey}${SEP}${canonicalKey}`

  // The latest spec and params, readable from timers and promise callbacks. Synced in an
  // effect, not during render (react-hooks 7's refs rule); declared FIRST so every effect
  // below sees this render's values.
  const specRef = useRef(spec)
  const paramsRef = useRef(searchParams)
  const scenarioRef = useRef(scenario)
  useEffect(() => {
    specRef.current = spec
    paramsRef.current = searchParams
    scenarioRef.current = scenario
  })

  const [run, setRun] = useState<RunState<R>>(() => {
    const seeded = spec.baselineOf === undefined ? (spec.initialBaseline ?? null) : null
    const arrivalEmpty = isEmpty(decode(readEntries(searchParams)))
    return {
      result: seeded !== null && arrivalEmpty ? seeded : null,
      resultKey: seeded !== null && arrivalEmpty ? runKey : null,
      baseline: seeded,
      baselineKey: seeded !== null ? dataKey : null,
      error: null,
      errorKey: null,
      errorStatus: null,
    }
  })

  // ── Arrival normalization (useArrivalParam's rule): unknown kinds and unparsable values
  // are dropped and the URL rewritten without them, replace-style; a canonical URL is left
  // alone, so this cannot loop (encode∘decode is identity — the grammar tests pin it).
  useEffect(() => {
    if (canonicalKey === entriesKey) return
    setSearchParams(withEntries(paramsRef.current, canonical), { replace: true })
  }, [canonical, canonicalKey, entriesKey, setSearchParams])

  // ── Debounced writes. `pendingRef` is the scenario the user is heading for; the URL only
  // learns it at the tick (Safari throttles replaceState — one write per gesture, not per
  // pixel). Successive drags compose on the pending value, not on the URL's.
  const pendingRef = useRef<string[] | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    },
    [],
  )

  const flush = useCallback(
    (drop: string[] = []) => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = null
      const next = pendingRef.current
      pendingRef.current = null
      if (next === null) return
      setSearchParams(withEntries(paramsRef.current, next, drop), { replace: true })
    },
    [setSearchParams],
  )

  const set = useCallback<Sandbox<S, R>['set']>(
    (patch, opts) => {
      const s = specRef.current
      const base = pendingRef.current !== null ? s.decode(pendingRef.current) : scenarioRef.current
      const next = typeof patch === 'function' ? patch(base) : { ...base, ...patch }
      pendingRef.current = s.encode(next)
      if (opts?.immediate) {
        flush(opts.drop)
        return
      }
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => flush(opts?.drop), s.debounceMs ?? DEFAULT_DEBOUNCE_MS)
    },
    [flush],
  )

  const reset = useCallback(() => {
    set(() => specRef.current.decode([]), { immediate: true })
  }, [set])

  // ── The one flight. Keyed on the run, not the scenario object: a sequence ref drops every
  // non-current answer (WhatIfPanel's and ProjectionPage's guard; no AbortController).
  const seqRef = useRef(0)
  useEffect(() => {
    if (!enabled) return
    const s = specRef.current
    const seq = ++seqRef.current
    const mine = runKey
    const modelled = s.decode(canonical)
    const modelledEmpty = s.isEmpty(modelled)
    s.preview(modelled)
      .then((r) => {
        if (seq !== seqRef.current) return
        setRun((prev) => {
          const twoSided = s.baselineOf !== undefined
          const baseline = twoSided
            ? (s.baselineOf as (result: R) => R)(r)
            : modelledEmpty
              ? r
              : prev.baseline
          return {
            result: r,
            resultKey: mine,
            baseline,
            baselineKey: twoSided || modelledEmpty ? s.dataKey : prev.baselineKey,
            error: null,
            errorKey: null,
            errorStatus: null,
          }
        })
        if (s.baselineOf === undefined && modelledEmpty) s.onBaseline?.(r)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setRun((prev) => ({
          ...prev,
          error: messageOf(err),
          errorKey: mine,
          errorStatus: err instanceof ApiError ? err.status : null,
        }))
      })
  }, [enabled, runKey, canonical])

  // ── One-sided pages: a non-empty arrival still needs the empty run once per dataKey.
  const needsBaseline =
    enabled && spec.baselineOf === undefined && !empty && run.baselineKey !== dataKey
  useEffect(() => {
    if (!needsBaseline) return
    const s = specRef.current
    const key = s.dataKey
    let alive = true
    s.preview(s.decode([]))
      .then((r) => {
        if (!alive) return
        setRun((prev) => ({ ...prev, baseline: r, baselineKey: key }))
        s.onBaseline?.(r)
      })
      .catch(() => {
        // The live run's failure speaks for both; a baseline that would not compute is
        // simply absent, and CompareTable prints the em dash.
      })
    return () => {
      alive = false
    }
  }, [needsBaseline, dataKey])

  // ── Pins: read once per page, validated with the page's decoder; every pin re-runs on
  // mount and on each dataKey change. `pinRuns` remembers the key each answer was for, so
  // "pending" is derived — a pin whose stored key is not the current one is still running.
  const [pins, setPins] = useState<Pin[]>(() =>
    readPins(spec.page, (stored) => !isEmpty(decode(stored))),
  )
  const [pinRuns, setPinRuns] = useState<Record<string, { key: string; value: R | { error: string } }>>({})
  const pinStarted = useRef<Record<string, string>>({})
  const pinSeq = useRef<Record<string, number>>({})
  useEffect(() => {
    if (!enabled) return
    const s = specRef.current
    const key = s.dataKey
    for (const p of pins) {
      if (pinStarted.current[p.id] === key) continue
      pinStarted.current[p.id] = key
      const gen = (pinSeq.current[p.id] = (pinSeq.current[p.id] ?? 0) + 1)
      s.preview(s.decode(p.entries))
        .then((r) => {
          if (pinSeq.current[p.id] !== gen) return
          setPinRuns((cur) => ({ ...cur, [p.id]: { key, value: r } }))
        })
        .catch((err: unknown) => {
          if (pinSeq.current[p.id] !== gen) return
          setPinRuns((cur) => ({ ...cur, [p.id]: { key, value: { error: messageOf(err) } } }))
        })
    }
  }, [enabled, dataKey, pins])

  const pinResults = useMemo<Record<string, PinResult<R>>>(() => {
    const out: Record<string, PinResult<R>> = {}
    for (const p of pins) {
      const stored = pinRuns[p.id]
      out[p.id] = stored !== undefined && stored.key === dataKey ? stored.value : 'pending'
    }
    return out
  }, [pins, pinRuns, dataKey])

  const pin = useCallback(
    (label?: string) => {
      const s = specRef.current
      const live = pendingRef.current ?? s.encode(scenarioRef.current)
      if (s.isEmpty(s.decode(live))) return
      setPins((current) => {
        if (current.length >= PIN_LIMIT) {
          toast.info('Unpin one first')
          return current
        }
        const text = label?.trim() || s.labelFor?.(s.decode(live)) || `Scenario ${current.length + 1}`
        const next = [...current, newPin(text, live)]
        writePins(s.page, next)
        return next
      })
    },
    [toast],
  )

  const unpin = useCallback((id: string) => {
    setPins((current) => {
      const next = current.filter((p) => p.id !== id)
      writePins(specRef.current.page, next)
      return next
    })
  }, [])

  const busy = enabled && run.resultKey !== runKey && run.errorKey !== runKey
  const stale = run.result !== null && run.resultKey !== runKey
  const error = run.errorKey === runKey ? run.error : null
  const search = searchParams.toString()

  return {
    scenario,
    entries: canonical,
    empty,
    set,
    reset,
    baseline: run.baseline,
    result: run.result,
    busy,
    error,
    errorStatus: run.errorKey === runKey ? run.errorStatus : null,
    stale,
    pins,
    pin,
    unpin,
    pinResults,
    link: `${location.pathname}${search === '' ? '' : `?${search}`}`,
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/sandbox/useSandbox.test.tsx`
Expected: PASS (16 tests). Two things to check if a case fails: the arrival test's URL ordering (`withEntries` appends whatif LAST, after the untouched keys — the expected strings assume that), and the `stale` case (the failed run must leave `resultKey` pointing at the OLDER run, so `stale` reads true only while a result exists).

- [ ] **Step 5: Lint**

Run: `npx eslint src/sandbox/useSandbox.ts src/sandbox/useSandbox.test.tsx`
Expected: clean. If `react-hooks/exhaustive-deps` asks for `spec` on the request effect, do NOT add it (the spec object is recreated per render); the effect reads it through `specRef` by design — add `// eslint-disable-next-line react-hooks/exhaustive-deps` with the reason on that one line only.

- [ ] **Step 6: Commit**

```bash
git add src/sandbox/useSandbox.ts src/sandbox/useSandbox.test.tsx
git commit -m "feat(sandbox): useSandbox — URL-as-state, trailing-edge debounce, one flight, keep-last-on-failure, pins"
```

---

### Task 5: `DeltaChip`

**Files:**
- Create: `src/sandbox/DeltaChip.tsx`, `src/sandbox/sandbox.css`
- Test: `src/sandbox/DeltaChip.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/sandbox/DeltaChip.test.tsx
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import DeltaChip, { formatDelta, inverted } from './DeltaChip'

afterEach(cleanup)

describe('DeltaChip', () => {
  it('formats money, points and plain deltas with an explicit sign', () => {
    expect(formatDelta('50.00', 'money')).toBe('+$50.00')
    expect(formatDelta('-4321.00', 'money')).toBe('-$4,321.00')
    expect(formatDelta('0.00', 'money')).toBe('$0.00')
    expect(formatDelta('2', 'points')).toBe('+2.0 pp')
    expect(formatDelta('-0.05', 'points')).toBe('-0.05 pp')
    expect(formatDelta('3', 'plain')).toBe('+3')
    expect(formatDelta('-3', 'plain')).toBe('-3')
  })

  it('tones follow the sign; invert flips them for cost lines; null is an em dash', () => {
    const { container, rerender } = render(<DeltaChip value="4321.00" kind="money" />)
    expect(container.firstElementChild?.className).toBe('delta-chip delta-chip-positive')
    rerender(<DeltaChip value="4321.00" kind="money" invert />)
    expect(container.firstElementChild?.className).toBe('delta-chip delta-chip-negative')
    rerender(<DeltaChip value="0" kind="money" invert />)
    expect(container.firstElementChild?.className).toBe('delta-chip delta-chip-neutral')
    rerender(<DeltaChip value={null} kind="money" />)
    expect(container.textContent).toBe('—')
    expect(inverted('positive')).toBe('negative')
    expect(inverted('neutral')).toBe('neutral')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/sandbox/DeltaChip.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component and the sheet**

```tsx
// src/sandbox/DeltaChip.tsx
import { formatCurrency } from '../utils/format'
import { toneOf } from '../utils/tone'
import type { Tone } from '../utils/tone'
import { decimalsIn, trimZeros } from './decimal'
import './sandbox.css'

// A signed, formatted delta with a tone (2026-09-03 planning-sandboxes spec §8.3). `invert`
// flips the colour for cost lines so a RISE reads red — WhatIfPanel's inverted() promoted to
// a component: the glyph follows the number, the colour follows good/bad. Number() is
// display-only (utils/format.ts's rule); the value shown is the server's string, signed.
export type DeltaKind = 'money' | 'points' | 'plain'

export function inverted(tone: Tone): Tone {
  return tone === 'positive' ? 'negative' : tone === 'negative' ? 'positive' : 'neutral'
}

export function formatDelta(value: string, kind: DeltaKind): string {
  const tone = toneOf(value)
  const sign = tone === 'positive' ? '+' : tone === 'negative' ? '-' : ''
  const abs = value.startsWith('-') ? value.slice(1) : value
  if (kind === 'money') return tone === 'neutral' ? formatCurrency(abs) : `${sign}${formatCurrency(abs)}`
  if (kind === 'points') {
    // Percentage POINTS, at least one decimal so "+2 pp" and "+2.0 pp" cannot both appear.
    const decimals = Math.max(1, Math.min(2, decimalsIn(trimZeros(abs))))
    return `${sign}${Number(abs).toFixed(decimals)} pp`
  }
  return `${sign}${trimZeros(abs)}`
}

export default function DeltaChip({
  value,
  kind,
  invert = false,
}: {
  value: string | null
  kind: DeltaKind
  invert?: boolean
}) {
  if (value === null) return <span className="delta-chip delta-chip-neutral">—</span>
  const tone = toneOf(value)
  const shown = invert ? inverted(tone) : tone
  return <span className={`delta-chip delta-chip-${shown}`}>{formatDelta(value, kind)}</span>
}
```

```css
/* src/sandbox/sandbox.css — the sandbox vocabulary (2026-09-03 planning-sandboxes spec §8).
   Tokens only; panels.css supplies .card/.eyebrow/.chip/.data-table/.button/.field-input. */

.sandbox-card .sandbox-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.sandbox-header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.sandbox-controls {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 0.9rem 1.25rem;
  margin: 0.75rem 0 1rem;
}

.sandbox-presets {
  margin: 0.5rem 0 0.25rem;
}

.sandbox-badge {
  font-size: 0.68rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
  border: 1px solid var(--muted);
  border-radius: 999px;
  padding: 1px 7px;
}

.sandbox-field-error {
  margin: 0.25rem 0 0;
  font-size: 0.78rem;
  color: var(--negative);
}

.sandbox-pins {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.9rem;
}

.sandbox-pins .field-input {
  max-width: 220px;
}

.sandbox-pin-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.sandbox-pin-chip button {
  border: 0;
  background: none;
  color: var(--muted);
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
}

.sandbox-pin-chip button:hover,
.sandbox-pin-chip button:focus-visible {
  color: var(--text);
}

.sandbox-apply {
  margin-top: 1rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

/* ── DeltaChip ─────────────────────────────────────────────────────────────── */

.delta-chip {
  display: inline-block;
  font-variant-numeric: tabular-nums;
  font-size: 0.8rem;
  padding: 0 6px;
  border-radius: 6px;
  background: var(--surface-2);
}

.delta-chip-positive { color: var(--positive); }
.delta-chip-negative { color: var(--negative); }
.delta-chip-neutral { color: var(--muted); }

/* ── SliderBox ─────────────────────────────────────────────────────────────── */

.slider-box {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.slider-box-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.85rem;
}

.slider-box-track {
  position: relative;
  padding: 4px 0;
}

.slider-box-track input[type='range'] {
  width: 100%;
  accent-color: var(--accent);
  margin: 0;
}

.slider-box-tick {
  position: absolute;
  top: 0;
  width: 2px;
  height: 100%;
  background: var(--muted);
  transform: translateX(-1px);
  pointer-events: none;
  opacity: 0.7;
}

.slider-box-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.slider-box-row .field-input {
  max-width: 140px;
}

.slider-box-actual {
  border: 0;
  background: none;
  padding: 0;
  font-size: 0.75rem;
  color: var(--muted);
  cursor: pointer;
  text-decoration: underline dotted;
}

.slider-box-actual:hover,
.slider-box-actual:focus-visible {
  color: var(--text);
}

/* ── CompareTable ──────────────────────────────────────────────────────────── */

.compare-table th .compare-pin-head {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.compare-table .compare-pin-error {
  color: var(--muted);
  font-size: 0.8rem;
  vertical-align: top;
}

.compare-table td.num,
.compare-table th.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/sandbox/DeltaChip.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sandbox/DeltaChip.tsx src/sandbox/DeltaChip.test.tsx src/sandbox/sandbox.css
git commit -m "feat(sandbox): DeltaChip — signed formatted deltas with invertible tone; sandbox.css"
```

---

### Task 6: `SliderBox`

**Files:**
- Create: `src/sandbox/SliderBox.tsx`
- Test: `src/sandbox/SliderBox.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/sandbox/SliderBox.test.tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SliderBox, { snapToStep } from './SliderBox'

afterEach(cleanup)

function mount(over: Partial<Parameters<typeof SliderBox>[0]> = {}) {
  const onChange = vi.fn()
  render(
    <SliderBox
      id="trad"
      label="Traditional 401(k)"
      kind="percent"
      value="0.15"
      actual="0.13"
      min="0"
      max="0.5"
      step="0.005"
      onChange={onChange}
      {...over}
    />,
  )
  return onChange
}

const range = () => screen.getByRole('slider', { name: 'Traditional 401(k) slider' }) as HTMLInputElement
const box = () => screen.getByLabelText('Traditional 401(k)') as HTMLInputElement

describe('SliderBox', () => {
  it('runs the slider on the fraction and the box on the percent', () => {
    mount()
    expect(range().value).toBe('0.15')
    expect(box().value).toBe('15%') // AmountInput's blurred echo of "15"
    fireEvent.focus(box())
    expect(box().value).toBe('15')
  })

  it('drag emits commit=false with a step-snapped wire value; release emits commit=true', () => {
    const onChange = mount()
    fireEvent.change(range(), { target: { value: '0.15500000000000003' } })
    expect(onChange).toHaveBeenLastCalledWith('0.155', false)
    fireEvent.mouseUp(range())
    expect(onChange).toHaveBeenLastCalledWith('0.155', true)
    fireEvent.keyDown(range(), { key: 'ArrowRight' })
    fireEvent.change(range(), { target: { value: '0.16' } })
    fireEvent.keyUp(range(), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('0.16', true)
  })

  it('the box commits on blur and Enter, shifting the percent back to the fraction', () => {
    const onChange = mount()
    fireEvent.focus(box())
    fireEvent.change(box(), { target: { value: '17.5' } })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.blur(box())
    expect(onChange).toHaveBeenLastCalledWith('0.175', true)
    fireEvent.focus(box())
    fireEvent.change(box(), { target: { value: '20' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith('0.2', true)
  })

  it('refuses a box value outside the track in the box’s own vocabulary, spending no change', () => {
    const onChange = mount()
    fireEvent.focus(box())
    fireEvent.change(box(), { target: { value: '60' } })
    fireEvent.blur(box())
    expect(screen.getByRole('alert').textContent).toBe('Traditional 401(k) must be between 0% and 50%')
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.focus(box())
    fireEvent.change(box(), { target: { value: 'abc' } })
    fireEvent.blur(box())
    expect(screen.getByRole('alert').textContent).toBe('Traditional 401(k) must be a number')
  })

  it('shows the actual as a tick and a caption that resets the knob alone, plus the delta chip', () => {
    const onChange = mount()
    const tick = document.querySelector('.slider-box-tick') as HTMLElement
    expect(tick.style.left).toBe('26%') // (0.13 − 0) / 0.5
    const caption = screen.getByRole('button', { name: 'actual 13%' })
    expect(screen.getByText('+2.0 pp').className).toContain('delta-chip-positive')
    fireEvent.click(caption)
    expect(onChange).toHaveBeenCalledWith('0.13', true)
  })

  it('a not-set value sits on the actual and wears the derived badge instead of a chip', () => {
    mount({ value: '', actual: '0.06', min: '-0.5', max: '0.5', step: '0.001' })
    expect(range().value).toBe('0.06')
    expect(screen.getByText('derived')).toBeTruthy()
    expect(document.querySelector('.delta-chip')).toBeNull()
    expect(box().value).toBe('') // the echo is the placeholder, not a value
    expect(box().placeholder).toBe('6')
  })

  it('money kind: no shifting, dollar chip', () => {
    const onChange = mount({ kind: 'money', value: '250', actual: '100.00', min: '0', max: '500', step: '5' })
    expect(box().value).toBe('$250.00')
    expect(screen.getByText('+$150.00')).toBeTruthy()
    fireEvent.change(range(), { target: { value: '255.00000001' } })
    expect(onChange).toHaveBeenLastCalledWith('255', false)
  })

  it('snapToStep uses the step’s own decimals', () => {
    expect(snapToStep('0.15500000000000003', '0.005')).toBe('0.155')
    expect(snapToStep('255.00000001', '5')).toBe('255')
    expect(snapToStep('-0.0500000001', '0.001')).toBe('-0.05')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/sandbox/SliderBox.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

```tsx
// src/sandbox/SliderBox.tsx
import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import AmountInput from '../components/AmountInput'
import InfoHint from '../components/InfoHint'
import { canonicalAmount, isAmount } from '../utils/amount'
import { formatCurrency } from '../utils/format'
import { shiftPoint } from '../utils/percent'
import { compareDecimals, decimalsIn, subtractDecimals, trimZeros } from './decimal'
import DeltaChip from './DeltaChip'
import './sandbox.css'

// A labelled range above an AmountInput of the same kind, on ONE wire value (2026-09-03
// planning-sandboxes spec §8.2). The slider runs on the fraction and the box shows the
// percent (shiftPoint), so the two cannot disagree by a unit — the percent shift happens in
// exactly this one place. Dragging emits commit=false; release, blur and Enter emit
// commit=true. The transient drag/typing text is control-local (AmountInput's own
// focused/raw posture), never a second copy of the knob: the parent's `value` is the URL's.
export interface SliderBoxProps {
  id: string
  label: string
  hint?: string
  kind: 'percent' | 'money' | 'plain'
  /** Wire vocabulary; '' = not set (derived / actual). */
  value: string
  /** The baseline's value: the track tick and the reset target. */
  actual: string | null
  min: string
  max: string
  step: string
  onChange: (next: string, commit: boolean) => void
  disabled?: boolean
}

/** A range input's float ("0.15500000000000003") back onto the step's grid, as a wire string. */
export function snapToStep(raw: string, step: string): string {
  const decimals = decimalsIn(step)
  return trimZeros(Number(raw).toFixed(decimals))
}

export default function SliderBox({
  id,
  label,
  hint,
  kind,
  value,
  actual,
  min,
  max,
  step,
  onChange,
  disabled,
}: SliderBoxProps) {
  // Drag text while the pointer is down (or a key is held) — cleared on release.
  const [drag, setDrag] = useState<string | null>(null)
  // Box text while typing — cleared on commit. A ref mirrors it because AmountInput's own
  // blur commit and our wrapper's blur run in the same event, before state has updated.
  const [draft, setDraft] = useState<string | null>(null)
  const draftRef = useRef<string | null>(null)
  const [boxError, setBoxError] = useState<string | null>(null)

  const toBox = (wire: string) => (kind === 'percent' ? shiftPoint(wire, 2) : wire)
  const fromBox = (text: string) => (kind === 'percent' ? shiftPoint(text, -2) : text)
  const display = (wire: string) =>
    kind === 'money' ? formatCurrency(wire) : kind === 'percent' ? `${toBox(wire)}%` : wire

  const shown = value !== '' ? value : (actual ?? min)
  const sliderValue = drag ?? shown
  const range = Number(max) - Number(min)
  const tickLeft = actual === null || range <= 0 ? null : ((Number(actual) - Number(min)) / range) * 100
  const delta = value === '' || actual === null ? null : subtractDecimals(value, actual)

  const commitBox = () => {
    const text = draftRef.current
    if (text === null) return
    draftRef.current = null
    setDraft(null)
    if (text.trim() === '') {
      setBoxError(null)
      onChange('', true)
      return
    }
    if (!isAmount(text, { expressions: false })) {
      setBoxError(`${label} must be a number`)
      return
    }
    const wire = fromBox(canonicalAmount(text, { expressions: false }))
    if (compareDecimals(wire, min) < 0 || compareDecimals(wire, max) > 0) {
      setBoxError(`${label} must be between ${display(min)} and ${display(max)}`)
      return
    }
    setBoxError(null)
    onChange(wire, true)
  }

  const onBoxKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitBox()
    }
  }

  const release = () => {
    if (drag === null) return
    const settled = drag
    setDrag(null)
    onChange(settled, true)
  }

  return (
    <div className="slider-box">
      <div className="slider-box-head">
        <label htmlFor={`${id}-box`}>
          {label}
          {hint !== undefined && <InfoHint text={hint} />}
        </label>
        {value === '' ? (
          <span className="sandbox-badge">{actual === null ? 'not set' : 'derived'}</span>
        ) : (
          <DeltaChip
            value={delta === null ? null : kind === 'percent' ? shiftPoint(delta, 2) : delta}
            kind={kind === 'money' ? 'money' : kind === 'percent' ? 'points' : 'plain'}
          />
        )}
      </div>
      <div className="slider-box-track">
        <input
          id={`${id}-range`}
          type="range"
          aria-label={`${label} slider`}
          min={Number(min)}
          max={Number(max)}
          step={Number(step)}
          value={Number(sliderValue)}
          disabled={disabled}
          onChange={(e) => {
            // React fires onChange on every input event for a range — this IS the drag.
            const next = snapToStep(e.currentTarget.value, step)
            setDrag(next)
            onChange(next, false)
          }}
          onMouseUp={release}
          onTouchEnd={release}
          onKeyUp={release}
          onBlur={release}
        />
        {tickLeft !== null && (
          <span className="slider-box-tick" style={{ left: `${tickLeft}%` }} aria-hidden="true" />
        )}
      </div>
      {/* The wrapper hears the box's blur/Enter AFTER AmountInput's own commit has rewritten
          the draft to canonical text (focusout bubbles), so `draftRef` is what ships. */}
      <div className="slider-box-row" onBlur={commitBox} onKeyDown={onBoxKey}>
        <AmountInput
          id={`${id}-box`}
          kind={kind}
          aria-label={label}
          value={draft ?? (value === '' ? '' : toBox(value))}
          placeholder={actual === null ? undefined : toBox(actual)}
          disabled={disabled}
          onValueChange={(next) => {
            draftRef.current = next
            setDraft(next)
          }}
        />
        {actual !== null && (
          <button
            type="button"
            className="slider-box-actual"
            disabled={disabled}
            onClick={() => {
              setBoxError(null)
              onChange(actual, true)
            }}
          >
            actual {display(actual)}
          </button>
        )}
      </div>
      {boxError !== null && (
        <p className="sandbox-field-error" role="alert">
          {boxError}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/sandbox/SliderBox.test.tsx`
Expected: PASS (8 tests). If the "box commits on blur" case sees `onChange` called with `'0.175'` twice, AmountInput's own commit is also reaching the parent — it must not: only the wrapper's `commitBox` calls `onChange`; `onValueChange` only writes the draft. If `box().value` reads `'15'` before focus, AmountInput's echo needs `kind="percent"` (check the `kind` prop is passed through).

- [ ] **Step 5: Commit**

```bash
git add src/sandbox/SliderBox.tsx src/sandbox/SliderBox.test.tsx
git commit -m "feat(sandbox): SliderBox — range + AmountInput on one wire value, actual tick/caption, delta chip, box fence"
```

---

### Task 7: `CompareTable` and `PresetRow`

**Files:**
- Create: `src/sandbox/CompareTable.tsx`, `src/sandbox/PresetRow.tsx`
- Test: `src/sandbox/CompareTable.test.tsx`, `src/sandbox/PresetRow.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/sandbox/CompareTable.test.tsx
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CompareTable, { type CompareRow } from './CompareTable'

afterEach(cleanup)

type R = Record<string, string | null>
const ROWS: CompareRow[] = [
  { key: 'total_tax', label: 'Total tax', kind: 'money', invert: true },
  { key: 'take_home', label: 'Take-home', kind: 'money' },
  { key: 'effective_rate', label: 'Effective rate', kind: 'percent' },
  { key: 'fi_month', label: 'FI date', kind: 'month' },
]
const baseline: R = { total_tax: '72824.61', take_home: '376543.22', effective_rate: '0.246914', fi_month: '2041-03-01' }
const scenario: R = { total_tax: '77145.61', take_home: '372222.22', effective_rate: '0.281234', fi_month: null }
const delta: R = { total_tax: '4321.00', take_home: '-4321.00', effective_rate: '0.034320' }

function mount(over: Partial<Parameters<typeof CompareTable<R>>[0]> = {}) {
  const onUnpin = vi.fn()
  render(
    <CompareTable<R>
      rows={ROWS}
      baseline={baseline}
      scenario={scenario}
      valueOf={(r, key) => r[key] ?? null}
      delta={(key) => delta[key] ?? null}
      pins={[]}
      onUnpin={onUnpin}
      {...over}
    />,
  )
  return onUnpin
}

const row = (label: string) => screen.getByText(label).closest('tr') as HTMLElement
const cells = (label: string) => within(row(label)).getAllByRole('cell').map((c) => c.textContent)

describe('CompareTable', () => {
  it('lays out Baseline · Scenario · Δ with formatted values and inverted tones on cost lines', () => {
    mount()
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['', 'Baseline', 'Scenario', 'Δ'])
    expect(cells('Total tax')).toEqual(['Total tax', '$72,824.61', '$77,145.61', '+$4,321.00'])
    expect(within(row('Total tax')).getByText('+$4,321.00').className).toContain('delta-chip-negative') // more tax reads red
    expect(within(row('Take-home')).getByText('-$4,321.00').className).toContain('delta-chip-negative')
    expect(cells('Effective rate')).toEqual(['Effective rate', '24.7%', '28.1%', '+3.4 pp'])
    expect(cells('FI date')).toEqual(['FI date', 'Mar 2041', '—', '—']) // null value and no month arithmetic
  })

  it('omits the Δ column when no delta reader is given', () => {
    mount({ delta: undefined })
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['', 'Baseline', 'Scenario'])
  })

  it('adds one column per pin headed by its label and an Unpin button; pending and error columns', () => {
    const onUnpin = mount({
      pins: [
        { id: 'p1', label: 'Sell 40 VTI', result: { ...scenario, total_tax: '70000.00' } },
        { id: 'p2', label: 'Waiting', result: 'pending' },
        { id: 'p3', label: 'Gone', result: { error: 'lot 4 already sold' } },
      ],
    })
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(heads.slice(4)).toEqual(['Sell 40 VTIUnpin', 'WaitingUnpin', 'GoneUnpin'])
    expect(cells('Total tax').slice(4)).toEqual(['$70,000.00', '…', 'lot 4 already sold'])
    expect(cells('Take-home')).toHaveLength(5) // the error cell spans the rows below
    fireEvent.click(screen.getByRole('button', { name: 'Unpin Sell 40 VTI' }))
    expect(onUnpin).toHaveBeenCalledWith('p1')
  })
})
```

```tsx
// src/sandbox/PresetRow.test.tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PresetRow from './PresetRow'

afterEach(cleanup)

describe('PresetRow', () => {
  it('renders chips that apply, and disabled chips that name the missing datum', () => {
    const apply = vi.fn()
    render(
      <PresetRow
        presets={[
          { id: 'max401k', label: 'Max 401(k)', apply },
          { id: 'maxhsa', label: 'Max HSA', apply: vi.fn(), disabled: true, title: "Enter this year's HSA limit in Settings › Limits" },
        ]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Max 401(k)' }))
    expect(apply).toHaveBeenCalledTimes(1)
    const hsa = screen.getByRole('button', { name: 'Max HSA' }) as HTMLButtonElement
    expect(hsa.disabled).toBe(true)
    expect(hsa.title).toBe("Enter this year's HSA limit in Settings › Limits")
    expect(screen.getByRole('group', { name: 'Presets' })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/sandbox/CompareTable.test.tsx src/sandbox/PresetRow.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the components**

```tsx
// src/sandbox/CompareTable.tsx
import { formatCurrency, formatMonth, formatPct } from '../utils/format'
import { shiftPoint } from '../utils/percent'
import DeltaChip from './DeltaChip'
import type { PinResult } from './useSandbox'
import './sandbox.css'

// Rows × (Baseline · Scenario · Δ · pinned…) (2026-09-03 planning-sandboxes spec §8.3). The
// page declares the rows and how to read a value out of its payload; the Δ column indexes
// the SERVER's delta object by key — nothing here subtracts. Pinned columns show values
// only; null is the em dash; a pin that would not compute renders the server's sentence.
export type CompareKind = 'money' | 'percent' | 'plain' | 'month'

export interface CompareRow {
  key: string
  label: string
  kind: CompareKind
  /** Cost lines: a rise reads red. */
  invert?: boolean
}

export interface ComparePin<R> {
  id: string
  label: string
  result: PinResult<R>
}

export interface CompareTableProps<R> {
  rows: CompareRow[]
  baseline: R | null
  scenario: R | null
  valueOf: (result: R, key: string) => string | null
  /** The server's delta for a row key; omit the prop and the Δ column is omitted too. */
  delta?: (key: string) => string | null
  pins: ComparePin<R>[]
  onUnpin: (id: string) => void
  caption?: string
}

function cell(value: string | null, kind: CompareKind): string {
  if (value === null) return '—'
  if (kind === 'money') return formatCurrency(value)
  if (kind === 'percent') return formatPct(value, { signed: false })
  if (kind === 'month') return formatMonth(value)
  return value
}

export default function CompareTable<R>({
  rows,
  baseline,
  scenario,
  valueOf,
  delta,
  pins,
  onUnpin,
  caption,
}: CompareTableProps<R>) {
  const read = (result: R | null, key: string) => (result === null ? null : valueOf(result, key))
  return (
    <table className="data-table compare-table">
      {caption !== undefined && <caption>{caption}</caption>}
      <thead>
        <tr>
          <th />
          <th className="num">Baseline</th>
          <th className="num">Scenario</th>
          {delta !== undefined && <th className="num">Δ</th>}
          {pins.map((pin) => (
            <th key={pin.id} className="num">
              <span className="compare-pin-head">
                {pin.label}
                <button
                  type="button"
                  className="button"
                  aria-label={`Unpin ${pin.label}`}
                  onClick={() => onUnpin(pin.id)}
                >
                  Unpin
                </button>
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={row.key}>
            <td>{row.label}</td>
            <td className="num">{cell(read(baseline, row.key), row.kind)}</td>
            <td className="num">{cell(read(scenario, row.key), row.kind)}</td>
            {delta !== undefined && (
              <td className="num">
                {row.kind === 'month' ? (
                  '—'
                ) : (
                  <DeltaChip
                    value={
                      row.kind === 'percent'
                        ? (() => {
                            const d = delta(row.key)
                            return d === null ? null : shiftPoint(d, 2)
                          })()
                        : delta(row.key)
                    }
                    kind={row.kind === 'money' ? 'money' : row.kind === 'percent' ? 'points' : 'plain'}
                    invert={row.invert}
                  />
                )}
              </td>
            )}
            {pins.map((pin) => {
              if (pin.result === 'pending') return <td key={pin.id} className="num">…</td>
              if (typeof pin.result === 'object' && pin.result !== null && 'error' in pin.result) {
                // The sentence once, spanning the column; later rows skip the cell.
                return index === 0 ? (
                  <td key={pin.id} className="compare-pin-error" rowSpan={rows.length}>
                    {(pin.result as { error: string }).error}
                  </td>
                ) : null
              }
              return (
                <td key={pin.id} className="num">
                  {cell(valueOf(pin.result as R, row.key), row.kind)}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

```tsx
// src/sandbox/PresetRow.tsx
import './sandbox.css'

// Preset chips (2026-09-03 planning-sandboxes spec §8.4): each sets several knobs at once,
// `immediate`. A preset is a function of the baseline payload and reference data already on
// the page — the URL carries the expanded knobs, never the preset's name. One whose datum is
// missing renders disabled with a `title` naming what to enter and where.
export interface Preset {
  id: string
  label: string
  apply: () => void
  disabled?: boolean
  title?: string
}

export default function PresetRow({
  presets,
  ariaLabel = 'Presets',
}: {
  presets: Preset[]
  ariaLabel?: string
}) {
  if (presets.length === 0) return null
  return (
    <div className="chip-row sandbox-presets" role="group" aria-label={ariaLabel}>
      {presets.map((preset) => (
        <button
          key={preset.id}
          type="button"
          className="chip"
          disabled={preset.disabled}
          title={preset.title}
          onClick={preset.apply}
        >
          {preset.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/sandbox/CompareTable.test.tsx src/sandbox/PresetRow.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sandbox/CompareTable.tsx src/sandbox/CompareTable.test.tsx src/sandbox/PresetRow.tsx src/sandbox/PresetRow.test.tsx
git commit -m "feat(sandbox): CompareTable (baseline/scenario/delta/pins) and PresetRow chips"
```

---

### Task 8: `SandboxPanel`

**Files:**
- Create: `src/sandbox/SandboxPanel.tsx`
- Test: `src/sandbox/SandboxPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/sandbox/SandboxPanel.test.tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SandboxPanel from './SandboxPanel'
import type { Sandbox } from './useSandbox'

const toast = { success: vi.fn(), info: vi.fn(), error: vi.fn() }
vi.mock('../components/ToastProvider', () => ({ useToast: () => toast }))

type S = { a?: string }
type R = { v: string }

function sandbox(over: Partial<Sandbox<S, R>> = {}): Sandbox<S, R> {
  return {
    scenario: { a: '1' },
    entries: ['a:1'],
    empty: false,
    set: vi.fn(),
    reset: vi.fn(),
    baseline: { v: '0' },
    result: { v: '1' },
    busy: false,
    error: null,
    errorStatus: null,
    stale: false,
    pins: [],
    pin: vi.fn(),
    unpin: vi.fn(),
    pinResults: {},
    link: '/taxes?year=2026&whatif=a%3A1',
    ...over,
  }
}

function mount(sb: Sandbox<S, R>, over: Partial<Parameters<typeof SandboxPanel<S, R>>[0]> = {}) {
  const onToggle = vi.fn()
  render(
    <SandboxPanel<S, R>
      eyebrow="What if — 2026"
      hint="Model a scenario — nothing is saved"
      open
      onToggle={onToggle}
      sandbox={sb}
      presets={<div data-testid="presets" />}
      compare={<div data-testid="compare" />}
      apply={<button type="button">Apply 1 override</button>}
      staleNoun="this scenario"
      {...over}
    >
      <div data-testid="controls" />
    </SandboxPanel>,
  )
  return onToggle
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SandboxPanel', () => {
  it('closed: eyebrow, toggle with aria-expanded=false, the closed hint, nothing else', () => {
    const onToggle = mount(sandbox(), { open: false, closedHint: <p>Try a scenario.</p> })
    expect(screen.getByRole('heading', { name: /What if — 2026/ })).toBeTruthy()
    const toggle = screen.getByRole('button', { name: 'Try it' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('Try a scenario.')).toBeTruthy()
    expect(screen.queryByTestId('controls')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reset to actual' })).toBeNull()
    fireEvent.click(toggle)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('open: presets · controls · compare · pin row · Apply, in that order; Reset resets', () => {
    const sb = sandbox()
    mount(sb)
    const ids = [...document.querySelectorAll('[data-testid], .sandbox-pins, .sandbox-apply')].map(
      (el) => el.getAttribute('data-testid') ?? el.className,
    )
    expect(ids).toEqual(['presets', 'controls', 'compare', 'sandbox-pins', 'sandbox-apply'])
    expect(screen.getByRole('button', { name: 'Close' }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Reset to actual' }))
    expect(sb.reset).toHaveBeenCalledTimes(1)
  })

  it('empty scenario: Reset disabled, Pin and Copy link disabled, no Apply slot', () => {
    mount(sandbox({ empty: true, entries: [], scenario: {} }))
    expect((screen.getByRole('button', { name: 'Reset to actual' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Pin this scenario' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Copy link' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Apply 1 override' })).toBeNull()
  })

  it('pins: label box feeds pin(), chips unpin, Copy link writes the origin + link and toasts', async () => {
    const sb = sandbox({ pins: [{ id: 'p1', label: 'Sell 40 VTI', createdAt: 't', entries: ['a:1'] }] })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    mount(sb)
    fireEvent.change(screen.getByLabelText('Pin label'), { target: { value: 'My pin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pin this scenario' }))
    expect(sb.pin).toHaveBeenCalledWith('My pin')
    expect((screen.getByLabelText('Pin label') as HTMLInputElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Unpin Sell 40 VTI' }))
    expect(sb.unpin).toHaveBeenCalledWith('p1')
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/taxes?year=2026&whatif=a%3A1`)
    await Promise.resolve()
    expect(toast.success).toHaveBeenCalledWith('Link copied')
  })

  it('a failed run keeps the compare on screen under the stale line; no result shows the error alone', () => {
    mount(sandbox({ error: 'lot 4 already sold', stale: true }))
    expect(screen.getByRole('alert').textContent).toBe('lot 4 already sold — this scenario may be showing earlier data.')
    expect(screen.getByTestId('compare')).toBeTruthy()
    cleanup()
    mount(sandbox({ result: null, error: 'no paycheck profiles' }))
    expect(screen.getByRole('alert').textContent).toBe('no paycheck profiles')
    expect(screen.queryByTestId('compare')).toBeNull()
  })

  it('renders no pin row when asked (hidePins) and a custom reset label', () => {
    mount(sandbox(), { hidePins: true, resetLabel: 'Reset to derived' })
    expect(document.querySelector('.sandbox-pins')).toBeNull()
    expect(screen.getByRole('button', { name: 'Reset to derived' })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/sandbox/SandboxPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

```tsx
// src/sandbox/SandboxPanel.tsx
import { useState } from 'react'
import type { ReactNode } from 'react'
import InfoHint from '../components/InfoHint'
import Feed from '../components/shell/Feed'
import { useToast } from '../components/ToastProvider'
import type { Sandbox } from './useSandbox'
import './sandbox.css'

// The sandbox card frame (2026-09-03 planning-sandboxes spec §8.1): eyebrow with the hint
// ("— nothing is saved"), a header toggle with aria-expanded, Reset to actual (disabled when
// the scenario is empty), then — open — presets · controls · the compare region (through
// Feed, so loading and stale states are the shell's) · the pin row · the Apply slot, which
// renders only when the scenario is non-empty and the page provides one. Nothing here
// posts; Apply is the PAGE's button, handed in as a node.
export interface SandboxPanelProps<S extends object, R> {
  eyebrow: string
  hint: string
  open: boolean
  onToggle: () => void
  toggleLabels?: { open: string; close: string }
  closedHint?: ReactNode
  sandbox: Sandbox<S, R>
  resetLabel?: string
  presets?: ReactNode
  children: ReactNode
  compare?: ReactNode
  staleNoun?: string
  skeletonHeight?: number
  apply?: ReactNode
  hidePins?: boolean
}

export default function SandboxPanel<S extends object, R>({
  eyebrow,
  hint,
  open,
  onToggle,
  toggleLabels = { open: 'Try it', close: 'Close' },
  closedHint,
  sandbox,
  resetLabel = 'Reset to actual',
  presets,
  children,
  compare,
  staleNoun = 'this scenario',
  skeletonHeight = 160,
  apply,
  hidePins = false,
}: SandboxPanelProps<S, R>) {
  return (
    <section className="card sandbox-card">
      <div className="sandbox-header">
        <h2 className="eyebrow">
          {eyebrow}
          <InfoHint text={hint} />
        </h2>
        <div className="sandbox-header-actions">
          {open && (
            <button type="button" className="button" disabled={sandbox.empty} onClick={sandbox.reset}>
              {resetLabel}
            </button>
          )}
          <button type="button" className="button" aria-expanded={open} onClick={onToggle}>
            {open ? toggleLabels.close : toggleLabels.open}
          </button>
        </div>
      </div>
      {!open ? (
        closedHint
      ) : (
        <>
          {presets}
          <div className="sandbox-controls">{children}</div>
          <Feed
            data={sandbox.result}
            error={sandbox.error}
            busy={sandbox.busy}
            staleNoun={staleNoun}
            skeleton={{ height: skeletonHeight, label: 'Running the scenario…' }}
          >
            {() => <>{compare}</>}
          </Feed>
          {!hidePins && <PinRow sandbox={sandbox} />}
          {!sandbox.empty && apply !== undefined && <div className="sandbox-apply">{apply}</div>}
        </>
      )}
    </section>
  )
}

/** Label box · Pin this scenario · pinned chips · Copy link (spec §8.5). Pins are never part
 *  of a link; Copy link copies the LIVE scenario's URL. Exported for the page tests. */
export function PinRow<S extends object, R>({ sandbox }: { sandbox: Sandbox<S, R> }) {
  const [label, setLabel] = useState('')
  const toast = useToast()
  const copy = () => {
    const url = `${window.location.origin}${sandbox.link}`
    const clipboard = navigator.clipboard
    if (clipboard === undefined) {
      toast.error('Clipboard unavailable — copy the address bar instead')
      return
    }
    clipboard.writeText(url).then(
      () => toast.success('Link copied'),
      () => toast.error('Clipboard unavailable — copy the address bar instead'),
    )
  }
  return (
    <div className="sandbox-pins">
      <input
        className="field-input"
        aria-label="Pin label"
        placeholder="Name this scenario"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <button
        type="button"
        className="button"
        disabled={sandbox.empty}
        onClick={() => {
          sandbox.pin(label)
          setLabel('')
        }}
      >
        Pin this scenario
      </button>
      {sandbox.pins.map((pin) => (
        <span key={pin.id} className="chip sandbox-pin-chip">
          {pin.label}
          <button type="button" aria-label={`Unpin ${pin.label}`} onClick={() => sandbox.unpin(pin.id)}>
            ×
          </button>
        </span>
      ))}
      <button type="button" className="button" disabled={sandbox.empty} onClick={copy}>
        Copy link
      </button>
      <span className="drill-hint">{sandbox.pins.length}/3 pinned</span>
    </div>
  )
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/sandbox/SandboxPanel.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sandbox/SandboxPanel.tsx src/sandbox/SandboxPanel.test.tsx
git commit -m "feat(sandbox): SandboxPanel frame — toggle, Reset, presets/controls/compare/pins/Apply slots through Feed"
```

---

### Task 9: The write-purity conformance walk

**Files:**
- Create: `src/sandbox/sandboxConformance.test.ts`

(`src/api/whatif.ts` already rides `apiReadOnly` on main — commit `c3d6dca` — and `src/api/whatif.test.ts` already asserts `api` is never called. Read both once so you know the contract; change neither.)

- [ ] **Step 1: Write the test**

```ts
// src/sandbox/sandboxConformance.test.ts
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The no-write conformance walk (2026-09-03 planning-sandboxes spec §14): every module under
// src/sandbox/ and the three sandbox panels are read as TEXT and must neither import `api`
// from the client (only `apiReadOnly` may carry a preview) nor spell a mutating `method:`.
// The Apply handlers live in the pages, which this walk deliberately excludes.
const ROOT = path.resolve(__dirname, '..')
const PANELS = [
  'components/paycheck/TryItPanel.tsx',
  'components/taxes/WhatIfPanel.tsx',
  'components/projection/ScenarioPanel.tsx',
]

function sandboxSources(): string[] {
  const dir = path.join(ROOT, 'sandbox')
  return readdirSync(dir)
    .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => path.join(dir, name))
}

const API_IMPORT = /import\s*\{[^}]*\bapi\b[^}]*\}\s*from\s*'(?:\.\.\/)+api\/client'/
const MUTATION = /method:\s*'(?:POST|PUT|PATCH|DELETE)'/i

describe('sandbox write-purity conformance', () => {
  const files = [...sandboxSources(), ...PANELS.map((p) => path.join(ROOT, p)).filter(existsSync)]

  it('walks at least the grammar modules', () => {
    expect(files.length).toBeGreaterThanOrEqual(8)
  })

  for (const file of files) {
    it(`${path.relative(ROOT, file)} imports no api() and spells no mutating method`, () => {
      const text = readFileSync(file, 'utf8')
      expect(API_IMPORT.test(text)).toBe(false)
      expect(MUTATION.test(text)).toBe(false)
    })
  }
})
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/sandbox/sandboxConformance.test.ts`
Expected: PASS for the eight grammar modules (no panel exists yet — the `existsSync` filter skips them). This is the pin the page lanes run against: a panel that imports `api` or spells `method: 'PUT'` fails here the moment it exists. To see the walk bite, temporarily add `import { api } from '../api/client'` to `pins.ts`, run, watch it fail, and revert.

- [ ] **Step 3: Commit**

```bash
git add src/sandbox/sandboxConformance.test.ts
git commit -m "test(sandbox): write-purity conformance walk over src/sandbox and the three sandbox panels"
```

---

### Task 10: Type-check, lint, whole suite

- [ ] **Step 1: Frontend**

Run: `npx tsc -b && npx eslint src/sandbox && npx vitest run`
Expected: clean; all green (the pre-existing 1450+ tests plus this lane's ~50).

- [ ] **Step 2: Report**

The lane report names: the exported API surface page lanes import (`useSandbox`, `SandboxSpec`, `Sandbox`, `PinResult`, `SandboxPanel`, `SliderBox`, `DeltaChip`, `CompareTable`/`CompareRow`, `PresetRow`/`Preset`, `scenarioUrl` parsers, `decimal` helpers), the fixture path lane A reads, and any eslint-disable line added in Task 4 with its reason.

---

## Self-review

**Spec coverage:** §6 grammar (entry kinds, wire vocabulary, unknown dropped + URL rewritten, last-wins, legacy aliases, replace-only writes, the sandbox never touches other keys) → Tasks 1, 4. §7 `useSandbox` (URL is the state, trailing-edge debounce, `immediate`, sequence guard without AbortController, baseline via `baselineOf` or one empty run, keep-last-on-failure with `stale` + server sentence, never cached, pins max three with toast, validated storage, re-run on `dataKey`, per-pin error) → Task 4. §8.1 SandboxPanel (eyebrow, hint, toggle with `aria-expanded`, body order, Reset disabled when empty, Feed states, pin row, Apply slot only when non-empty and provided) → Task 8. §8.2 SliderBox (range on the fraction, box on the percent, commit flags, tick + caption reset, delta chip, box fence, AmountInput's select-all/Escape/canonicalize kept by composition) → Task 6. §8.3 DeltaChip/CompareTable (invert, columns, Δ indexed by key, pinned header with Unpin, em dash) → Tasks 5, 7. §8.4 PresetRow disabled + title → Task 7. §8.5 pins/Copy link → Tasks 3, 8. §2/§5 `whatif.ts` → `apiReadOnly` → already on main (`c3d6dca`), verified in Task 9's read. §12/§14 parity fixture and the conformance test → Tasks 1, 9. §14's `Segmented` unit toggle over the compare table is page composition (Paycheck lane). **Placeholders:** none — every step carries its code. **Type consistency:** `Sandbox.set(patch, { immediate?, drop? })`, `Sandbox.empty`/`entries`/`link`/`errorStatus`, `SandboxSpec.enabled/initialBaseline/onBaseline/labelFor`, `PinResult<R>`, `CompareTable<R>({ rows, baseline, scenario, valueOf, delta?, pins, onUnpin })`, `SliderBox({ id, label, kind, value, actual, min, max, step, onChange(next, commit) })`, `PresetRow({ presets: Preset[] })`, `SandboxPanel({ eyebrow, hint, open, onToggle, sandbox, presets, children, compare, apply, hidePins, resetLabel })` are the names the P/T/J plans use.
