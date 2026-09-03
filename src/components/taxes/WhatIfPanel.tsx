import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { fetchLots } from '../../api/espp'
import { fetchLimits } from '../../api/limits'
import { fetchHoldings } from '../../api/portfolio'
import { runWhatIf } from '../../api/whatif'
import CompareTable from '../../sandbox/CompareTable'
import { inverted } from '../../sandbox/DeltaChip'
import PresetRow from '../../sandbox/PresetRow'
import SandboxPanel from '../../sandbox/SandboxPanel'
import {
  isWireDecimal,
  legacyLotId,
  legacyTicker,
  readEntries,
  type EsppEntry,
  type SaleEntry,
} from '../../sandbox/scenarioUrl'
import { SEP, useSandbox, type PinResult, type SandboxSpec } from '../../sandbox/useSandbox'
import type {
  ChangedInput,
  EsppLotOut,
  EsppLotsResponse,
  HoldingOut,
  HoldingsResponse,
  LimitsOut,
  TaxBracketsOut,
  TaxInputsOut,
  TaxSummaryOut,
  WhatIfOut,
} from '../../types/api'
import { canonicalAmount, isAmount } from '../../utils/amount'
import { formatCurrency, formatDate, formatPct, formatShares } from '../../utils/format'
import { toneOf } from '../../utils/tone'
import type { Tone } from '../../utils/tone'
import AmountInput from '../AmountInput'
import ChartCard from '../ChartCard'
import InfoHint from '../InfoHint'
import { FeedBanner } from '../shell/Feed'
import StatTile from '../StatTile'
import { whatIfDeltaBarOption } from './taxChartOptions'
import {
  COMPARE_ROWS,
  decodeTax,
  deltaValue,
  encodeTax,
  isEmptyTax,
  labelForTax,
  summaryValue,
  taxPresets,
  toWhatIfBody,
  type TaxPresetPatch,
  type TaxScenario,
} from './taxScenario'
// This component's own sheet, like its three siblings: the app-wide vocabulary
// (.card/.eyebrow/.kpi-row/.data-table/.error-banner/.empty-note) is panels.css, which the
// PAGE imports — and StatTile brings it along regardless.
import './taxes.css'

// The API's own ceiling (schemas/taxes.py: WhatIfIn.sales / .espp_sales max_length=20).
const MAX_LEGS = 20
// The endpoint folds the portfolio on every call (spec §10).
const DEBOUNCE_MS = 400

/** One option of the override select — the definition table's own label + key. TaxesPage
 *  dedupes per-person repeats before handing these down: overrides address the HOUSEHOLD
 *  key map (the endpoint applies them after aggregation), so a key appears once. */
export interface OverrideDefinition {
  key: string
  label: string
}

// The whole position at the latest quote: the common question is "what if I sold this",
// and every figure is the holdings feed's own text, never re-derived. An unpriced holding
// carries NO price, which is the omit case — and the server then 422s by ticker.
function saleLegFor(holding: HoldingOut): SaleEntry {
  return {
    security_id: holding.security_id,
    shares: holding.shares,
    term: 'long',
    ...(holding.price === null ? {} : { price: holding.price }),
  }
}

// The lot's whole share count is implied (the API sells the lot, not a slice of it), so the
// only knob is the price — prefilled from the quote the lots table itself was priced at.
function esppLegFor(lot: EsppLotOut, quote: string | null): EsppEntry {
  return { lot_id: lot.id, ...(quote === null ? {} : { sale_price: quote }) }
}

/**
 * Δ tax splits StatTile's three channels, because MORE tax is a WORSE outcome (Overview's
 * spending tile, and the same inversion): the GLYPH follows the number, the COLOUR follows
 * good/bad, and the tile's words carry the judgment. Left to derive the glyph from the
 * tone, a scenario that RAISED the tax would print ▼ on a number that went up.
 */
function directionOf(tone: Tone): 'up' | 'down' | undefined {
  return tone === 'positive' ? 'up' : tone === 'negative' ? 'down' : undefined
}

/**
 * The tax sandbox (2026-09-03 planning-sandboxes spec §10): prospective brokerage sales, ESPP
 * lot sales and input overrides run LIVE against the stored year — baseline vs. scenario vs.
 * delta, compared side by side with up to three pins. The scenario lives in the URL
 * (`whatif=sale:…`, `espp:…`, `<input_key>:…`); the text boxes hold a draft only while
 * focused. NOTHING is stored: the endpoint reads the year's inputs and brackets, runs the
 * engine twice and answers. Apply (overrides only) is the PAGE's write, handed up.
 *
 * Own feeds, own failure surface (SummaryPanel's posture), all three LAZY: the page is
 * already long and these are three GETs for a card the user may never open.
 */
export default function WhatIfPanel({
  year,
  definitions = [],
  inputs = null,
  brackets = null,
  summary = null,
  onApplyOverrides,
}: {
  year: number
  /** The year payload's input definitions (deduped by key, payload order) — the override
   *  rows' key select. Optional so fetch-free mounts need no list; with none, Add override
   *  stays shut. */
  definitions?: OverrideDefinition[]
  /** The year's payloads, for the presets (employer HSA, the CG table, the gains stack). */
  inputs?: TaxInputsOut | null
  brackets?: TaxBracketsOut | null
  summary?: TaxSummaryOut | null
  /** The page's write door: confirm before → after, PUT the inputs, remount the form. Absent
   *  → no Apply slot. */
  onApplyOverrides?: (overrides: Record<string, string | null>, changed: ChangedInput[]) => void
}) {
  const [params] = useSearchParams()
  // The legacy deep links (`?whatif=TICKER`, `?whatif-lot=<id>`), pinned at MOUNT — the hook's
  // arrival normalization drops the colon-less value on its first effect, so it is read here,
  // in the initializer, before that runs. A ticker or lot id only means something against a
  // feed, so the rewrite rides the feeds' promise callback.
  const [legacy] = useState(() => ({ ticker: legacyTicker(params), lotId: legacyLotId(params) }))
  // Arriving with a scenario opens the card (spec §6); otherwise it mounts closed (§8.1).
  const entriesKey = readEntries(params).join(SEP)
  const [open, setOpen] = useState(
    entriesKey !== '' || legacy.ticker !== null || legacy.lotId !== null,
  )
  // ...and so does a navigation INTO a scenario link while the page is already mounted. The
  // assistant's "Open in what-if" is exactly that, and when it names the year already on
  // screen the page does NOT remount this card — read only in the initializer, `enabled`
  // would stay false and the link would change the URL and nothing else.
  //
  // Adjusted DURING render, never from an effect body (the house rule): React re-renders
  // immediately, so nothing paints closed.
  //
  // The latch is the ENTRIES, not merely whether there are any: a SECOND link — the
  // assistant's next answer, a second drill-in from Portfolio — is a second arrival and
  // opens the card again. A card closed by hand stays closed while the URL sits on the
  // entries it was closed on. `?year=` is not in the key, so a year chip cannot re-open it
  // (lane P's TryItPanel, same shape).
  const [arrivedAt, setArrivedAt] = useState(entriesKey)
  if (entriesKey !== arrivedAt) {
    setArrivedAt(entriesKey)
    if (entriesKey !== '') setOpen(true)
  }
  // null = the feed has not answered yet (never [] — an empty book is a real answer, and
  // the two say different things under the form).
  const [holdings, setHoldings] = useState<HoldingsResponse | null>(null)
  const [lots, setLots] = useState<EsppLotsResponse | null>(null)
  const [limits, setLimits] = useState<LimitsOut | null>(null)
  const [feedError, setFeedError] = useState<string | null>(null)
  // The box's own refusal (an oversell, a garbled value): the request is WITHHELD and the URL
  // keeps the last valid scenario, so `stale` stays false (spec §10).
  const [formError, setFormError] = useState<string | null>(null)
  // The feeds are fetched ONCE per mount. The ref — not `holdings === null` — is the guard,
  // so a set that FAILED does not re-fire on every re-open.
  const feedsRef = useRef(false)

  const held = holdings?.holdings ?? []

  const spec = useMemo<SandboxSpec<TaxScenario, WhatIfOut>>(
    () => ({
      page: 'taxes',
      decode: decodeTax,
      encode: encodeTax,
      isEmpty: isEmptyTax,
      preview: (scenario) => runWhatIf(toWhatIfBody(year, scenario)),
      baselineOf: (result) => result,
      dataKey: String(year),
      debounceMs: DEBOUNCE_MS,
      enabled: open,
      // The pin label names tickers when the feed has landed; `holdings` lands once per
      // mount, so a re-created spec is cheap.
      labelFor: (scenario) =>
        labelForTax(
          scenario,
          (securityId) => holdings?.holdings.find((h) => h.security_id === securityId)?.ticker ?? null,
        ),
    }),
    [year, open, holdings],
  )
  const sandbox = useSandbox(spec)
  const { scenario, result } = sandbox

  const patch = (change: (current: TaxScenario) => TaxScenario, immediate: boolean) => {
    setFormError(null) // the sentence described the legs as they WERE
    sandbox.set(change, { immediate })
  }

  // A plain function over stable setters (TaxesPage's `loadYears`), called from both doors
  // into the card. Promise callbacks only — no setState in an effect's synchronous body
  // (react-hooks 7).
  const loadFeeds = () => {
    if (feedsRef.current) return
    feedsRef.current = true
    Promise.all([fetchHoldings(), fetchLots(), fetchLimits(year)])
      .then(([heldRes, lotsRes, limitsRes]) => {
        setHoldings(heldRes)
        setLots(lotsRes)
        setLimits(limitsRes)
        // Alias normalization (spec §6): resolve the legacy ticker / lot against the feed and
        // rewrite the URL to the new entries in ONE replace that also drops `whatif-lot`. A
        // name that matches nothing (sold since the link was made) seeds nothing — the open
        // card with its empty legs is the honest answer, not an error.
        const additions: { sale?: SaleEntry; espp?: EsppEntry } = {}
        if (legacy.ticker !== null) {
          const ticker = legacy.ticker.toUpperCase()
          const match = heldRes.holdings.find((h) => h.ticker.toUpperCase() === ticker)
          if (match !== undefined) additions.sale = saleLegFor(match)
        }
        if (legacy.lotId !== null) {
          const lot = lotsRes.lots.find((row) => row.id === legacy.lotId && !row.is_sold)
          if (lot !== undefined) additions.espp = esppLegFor(lot, lotsRes.current_price)
        }
        if (legacy.ticker !== null || legacy.lotId !== null) {
          const sale = additions.sale
          const espp = additions.espp
          sandbox.set(
            (current) => ({
              ...current,
              sales:
                sale === undefined
                  ? current.sales
                  : [...current.sales.filter((s) => s.security_id !== sale.security_id), sale],
              espp:
                espp === undefined
                  ? current.espp
                  : [...current.espp.filter((e) => e.lot_id !== espp.lot_id), espp],
            }),
            { immediate: true, drop: ['whatif-lot'] },
          )
        }
      })
      .catch((err: unknown) => {
        setFeedError(
          err instanceof ApiError ? err.message : 'Failed to load holdings, ESPP lots and limits',
        )
      })
  }

  useEffect(() => {
    // EVERY open — the arrival mount, the toggle, and the render adjust above that follows an
    // in-page link — goes through here, so there is one door and `feedsRef` inside loadFeeds
    // is what makes it once-per-mount. loadFeeds reads no reactive value beyond its setters
    // and refs.
    if (open) loadFeeds()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on `open` alone (PortfolioPage's `load`)
  }, [open])

  const unsoldLots = lots?.lots.filter((lot) => !lot.is_sold) ?? []
  const holdingFor = (securityId: number) => held.find((h) => h.security_id === securityId)
  // Deliberately NOT counting the override rows: legCount feeds the MAX_LEGS fence, which is
  // the server's per-LIST sales/ESPP cap — the overrides are a dict, with no such cap.
  const legCount = scenario.sales.length + scenario.espp.length

  const toggle = () => setOpen((o) => !o)

  // The feeds are fetched once per mount, so without this door a single blip would leave the
  // card dead until a year switch remounted it — the house rule that a recoverable banner
  // carries its own Retry (TaxesPage's).
  const retryFeeds = () => {
    feedsRef.current = false
    setFeedError(null)
    loadFeeds()
  }

  // The first held security not already in a leg: two rows for one ticker are almost always
  // a mis-click, and the server classifies each leg against the FULL position — so the pair
  // would sell the same shares twice without ever tripping the oversell fence.
  const nextHolding = () => held.find((h) => !scenario.sales.some((s) => s.security_id === h.security_id))
  const nextLot = () => unsoldLots.find((lot) => !scenario.espp.some((e) => e.lot_id === lot.id))
  const nextDefinition = () => definitions.find((d) => !(d.key in scenario.overrides))

  const addSale = () => {
    const holding = nextHolding()
    if (holding !== undefined) patch((s) => ({ ...s, sales: [...s.sales, saleLegFor(holding)] }), true)
  }
  const addEsppSale = () => {
    const lot = nextLot()
    if (lot !== undefined) patch((s) => ({ ...s, espp: [...s.espp, esppLegFor(lot, lots?.current_price ?? null)] }), true)
  }
  const addOverride = () => {
    const definition = nextDefinition()
    if (definition !== undefined) patch((s) => ({ ...s, overrides: { ...s.overrides, [definition.key]: null } }), true)
  }

  const setSale = (index: number, change: Partial<SaleEntry>, immediate: boolean) =>
    patch((s) => ({ ...s, sales: s.sales.map((leg, i) => (i === index ? { ...leg, ...change } : leg)) }), immediate)
  // Switching the ticker re-prefills the amounts with it: the old row's share count belongs
  // to the old position, and leaving it there is an oversell one keystroke from happening.
  const setSaleSecurity = (index: number, securityId: number) => {
    const holding = holdingFor(securityId)
    if (holding === undefined) return
    patch(
      (s) => ({ ...s, sales: s.sales.map((leg, i) => (i === index ? { ...saleLegFor(holding), term: leg.term } : leg)) }),
      true,
    )
  }
  const removeSale = (index: number) => patch((s) => ({ ...s, sales: s.sales.filter((_, i) => i !== index) }), true)
  const setEspp = (index: number, change: Partial<EsppEntry>, immediate: boolean) =>
    patch((s) => ({ ...s, espp: s.espp.map((leg, i) => (i === index ? { ...leg, ...change } : leg)) }), immediate)
  const removeEspp = (index: number) => patch((s) => ({ ...s, espp: s.espp.filter((_, i) => i !== index) }), true)

  const overrideKeys = Object.keys(scenario.overrides)
  const setOverrideKey = (from: string, to: string) => {
    if (to in scenario.overrides) {
      // Last-write-wins on a dict would silently drop the earlier row — refuse instead.
      const label = definitions.find((d) => d.key === to)?.label ?? to
      setFormError(`${label} is overridden twice — one row per key`)
      return
    }
    patch((s) => {
      const overrides: Record<string, string | null> = {}
      for (const [key, value] of Object.entries(s.overrides)) overrides[key === from ? to : key] = value
      return { ...s, overrides }
    }, true)
  }
  const setOverrideValue = (key: string, value: string | null, immediate: boolean) =>
    patch((s) => ({ ...s, overrides: { ...s.overrides, [key]: value } }), immediate)
  const removeOverride = (key: string) =>
    patch((s) => {
      const overrides = { ...s.overrides }
      delete overrides[key]
      return { ...s, overrides }
    }, true)

  const applyPreset = (change: TaxPresetPatch) => {
    if ('overrides' in change) patch((s) => ({ ...s, overrides: { ...s.overrides, ...change.overrides } }), true)
    else
      patch(
        (s) => ({ ...s, sales: [...s.sales.filter((leg) => leg.security_id !== change.sale.security_id), change.sale] }),
        true,
      )
  }
  const presets = taxPresets(
    { year, limits, inputs, holdings: holdings === null ? null : held, brackets, summary },
    applyPreset,
  )

  const taxTone = result === null ? 'neutral' : toneOf(result.delta.total_tax)
  const takeHomeTone = result === null ? 'neutral' : toneOf(result.delta.take_home)
  // A pin column compares SUMMARIES; the payload's own baseline half is the same for every
  // column, so a pin contributes its scenario side.
  const pinSide = (r: PinResult<WhatIfOut>): PinResult<TaxSummaryOut> =>
    r === 'pending' || 'error' in r ? r : r.scenario
  const overrideCount = overrideKeys.length
  // "The result on screen IS this URL's answer": nothing in flight, nothing withheld, no
  // refusal standing. Apply reads both halves, so both have to describe one scenario.
  const settled =
    result !== null &&
    !sandbox.busy &&
    !sandbox.stale &&
    sandbox.error === null &&
    formError === null

  return (
    <SandboxPanel
      eyebrow={`What if — ${year}`}
      hint="Model prospective sales or input changes against this year's stored return — nothing is saved."
      open={open}
      onToggle={toggle}
      toggleLabels={{ open: 'Open what-if', close: 'Close what-if' }}
      sandbox={sandbox}
      closedHint={
        <p className="drill-hint">
          Model prospective share sales against {year}&apos;s stored inputs — nothing is saved, and the
          stored year is never touched.
        </p>
      }
      presets={holdings === null ? null : <PresetRow presets={presets} />}
      staleNoun="this scenario"
      skeletonHeight={220}
      compare={
        result === null ? null : (
          <div className="whatif-result">
            {/* Every figure is the server's, rendered as it arrived (global rule 9) — the
                deltas are the endpoint's own subtraction of two quantized summaries. */}
            <div className="kpi-row">
              <StatTile
                label="Δ total tax"
                value={formatCurrency(result.delta.total_tax)}
                delta={
                  taxTone === 'neutral'
                    ? 'no change'
                    : `${taxTone === 'positive' ? 'more' : 'less'} tax than ${year} as stored`
                }
                tone={inverted(taxTone)}
                direction={directionOf(taxTone)}
                hint="Scenario total tax minus baseline — positive means the scenario owes more."
              />
              <StatTile
                label="Δ take-home"
                value={formatCurrency(result.delta.take_home)}
                delta={`${formatCurrency(result.baseline.totals.take_home)} → ${formatCurrency(
                  result.scenario.totals.take_home,
                )}`}
                tone={takeHomeTone}
                hint="Scenario take-home minus baseline."
              />
              {/* A rate is a level, not a movement: both sides, no arrow. */}
              <StatTile
                label="Effective rate"
                value={`${formatPct(result.baseline.totals.effective_rate, {
                  signed: false,
                })} → ${formatPct(result.scenario.totals.effective_rate, { signed: false })}`}
                hint="Overall effective rate, baseline → scenario."
              />
            </div>
            {/* The three tiles say how much moved; this says WHERE. One bar per tax line,
                diverging around zero so the arms mean the same thing, and null — the card's
                own empty sentence — when nothing moved at all. */}
            <ChartCard
              title="Δ by jurisdiction"
              hint="Each tax line's scenario minus baseline — bars to the left are less tax."
              ariaLabel="Change in tax by jurisdiction, scenario minus baseline"
              option={whatIfDeltaBarOption(result.delta)}
              empty="Nothing moved — every jurisdiction computes to the stored year."
              exportName="whatif-delta"
              height={220}
            />
            <CompareTable<TaxSummaryOut>
              rows={COMPARE_ROWS}
              baseline={result.baseline}
              scenario={result.scenario}
              valueOf={summaryValue}
              delta={(key) => deltaValue(result.delta, key)}
              pins={sandbox.pins.map((pin) => ({
                id: pin.id,
                label: pin.label,
                result: pinSide(sandbox.pinResults[pin.id]),
              }))}
              onUnpin={sandbox.unpin}
            />
            {result.warnings.length > 0 && (
              // Advisory, never an error banner: the scenario RAN — these are the honest
              // asterisks on what it ran with (the engine's own register).
              <div className="tax-warnings">
                {result.warnings.map((warning, i) => (
                  <p key={i}>{warning}</p>
                ))}
              </div>
            )}
            {result.sale_details.length > 0 && (
              <div className="tax-section">
                <h3 className="eyebrow">Sale legs</h3>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th className="num">Shares</th>
                      <th className="num">Price</th>
                      <th className="num">Proceeds</th>
                      <th className="num">Cost basis</th>
                      <th className="num">Gain</th>
                      <th>Term</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.sale_details.map((detail, i) => (
                      <tr key={i}>
                        <td>{detail.ticker}</td>
                        <td className="num">{formatShares(detail.shares)}</td>
                        <td className="num">{formatCurrency(detail.price)}</td>
                        <td className="num">{formatCurrency(detail.proceeds)}</td>
                        <td className="num">{formatCurrency(detail.cost_basis)}</td>
                        <td className="num">{formatCurrency(detail.gain)}</td>
                        <td>{detail.term}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {result.espp_sale_details.length > 0 && (
              <div className="tax-section">
                <h3 className="eyebrow">ESPP legs</h3>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Lot</th>
                      <th className="num">Shares</th>
                      <th className="num">Sale price</th>
                      <th className="num">Proceeds</th>
                      <th className="num">Ordinary income</th>
                      <th className="num">Capital gain</th>
                      <th>Term</th>
                      <th>Disposition</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.espp_sale_details.map((detail, i) => (
                      <tr key={i}>
                        <td>{formatDate(detail.purchase_date)}</td>
                        <td className="num">{formatShares(detail.shares)}</td>
                        <td className="num">{formatCurrency(detail.sale_price)}</td>
                        <td className="num">{formatCurrency(detail.proceeds)}</td>
                        <td className="num">{formatCurrency(detail.ordinary_income)}</td>
                        <td className="num">{formatCurrency(detail.capital_gain)}</td>
                        <td>{detail.term}</td>
                        <td>{detail.disposition}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="tax-section">
              <h3 className="eyebrow">Inputs this scenario moved</h3>
              {result.changed_inputs.length === 0 ? (
                <p className="empty-note">Nothing moved — this scenario computes to the stored year.</p>
              ) : (
                <ul className="whatif-changed">
                  {result.changed_inputs.map((changed) => (
                    // An em dash, not a colon: the label is the definition table's own text
                    // and often carries a colon already ("LTCG: Brokerage Gain/Loss").
                    <li key={changed.key}>
                      {changed.label} — {formatCurrency(changed.before)} → {formatCurrency(changed.after)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )
      }
      apply={
        onApplyOverrides !== undefined && overrideCount > 0 ? (
          <>
            {/* The confirmation quotes `changed_inputs` from the run ON SCREEN while the PUT
                sends the URL's overrides — and between a keystroke and the 400 ms tick, or
                after a refusal, those are two different scenarios: 210000's before → after
                would be confirmed and 220000 written. Gated on a SETTLED run, so the numbers
                confirmed are the numbers written. */}
            <button
              type="button"
              className="button button-primary"
              disabled={!settled}
              title={settled ? undefined : 'Waiting for this scenario to finish running'}
              onClick={() => onApplyOverrides({ ...scenario.overrides }, result?.changed_inputs ?? [])}
            >
              Apply {overrideCount} override{overrideCount === 1 ? '' : 's'} to {year}
            </button>
            <span className="drill-hint">
              Overrides only — sale and ESPP legs are hypothetical and are never applied.
            </span>
          </>
        ) : undefined
      }
    >
      <p className="drill-hint">
        Sales are classified at average cost, the app&apos;s only basis method, and ESPP ordinary income
        lands in Other W2 Income — which raises the engine&apos;s Medicare/Social Security/SDI wage bases,
        exactly as the sheet does it. Real ESPP ordinary income is FICA-exempt; this sandbox inherits the
        sheet&apos;s structure. Long/short is your call: imported transactions carry no dates, so the app
        cannot verify a holding period. Nothing here is stored.
      </p>
      <FeedBanner error={feedError} retry={retryFeeds} />
      {/* All three feeds land together (one Promise.all) or none does, so one null is the
          whole "still waiting" question — and a set that FAILED leaves the banner above as
          the card's only content: there is nothing to build a leg out of, and a form of
          empty selects would read as "you hold nothing". */}
      {holdings === null && feedError === null && (
        <p className="empty-note">Loading holdings, ESPP lots and limits…</p>
      )}
      {holdings !== null && (
        <>
          <div className="whatif-legs">
            {/* Position IS the identity here (a leg has no id of its own), and every field is
                controlled from the URL's scenario — so an index key cannot strand a typed
                value in a reused row (BracketsEditor's note). */}
            {scenario.sales.map((leg, index) => {
              const holding = holdingFor(leg.security_id)
              const ticker = holding?.ticker ?? `#${leg.security_id}`
              return (
                <div key={index} className="whatif-form">
                  <label htmlFor={`whatif-sale-security-${index}`}>Sell</label>
                  <select
                    id={`whatif-sale-security-${index}`}
                    className="field-input whatif-select"
                    value={String(leg.security_id)}
                    onChange={(e) => setSaleSecurity(index, Number(e.target.value))}
                  >
                    {/* A link made before the position was sold names an id nobody holds; the
                        row says so rather than silently reading as another ticker. */}
                    {holding === undefined && <option value={String(leg.security_id)}>{ticker} (not held)</option>}
                    {held.map((h) => (
                      <option key={h.security_id} value={String(h.security_id)}>
                        {h.ticker}
                      </option>
                    ))}
                  </select>
                  <DraftInput
                    ariaLabel={`Sale ${index + 1} shares`}
                    value={leg.shares}
                    validate={(text) => {
                      const shares = text.trim()
                      // The CODEC's fence, never a looser Number() test: ".5", "+5" and
                      // "5." all pass Number() but parseSale refuses them on arrival, so a
                      // box that took one would write an entry the next decode drops — the
                      // leg would vanish without a word (lane P's BoxKnob, same lesson).
                      if (shares === '' || !isWireDecimal(shares) || !(Number(shares) > 0))
                        return `${ticker}: shares must be a number greater than 0, like 12.5`
                      // The server's own sentence (api/taxes.py's oversell 422) — one vocabulary.
                      if (holding !== undefined && Number(shares) > Number(holding.shares))
                        return `selling ${shares} ${ticker} — only ${holding.shares} held`
                      return null
                    }}
                    onCommit={(text, immediate) => setSale(index, { shares: text.trim() }, immediate)}
                    onInvalid={setFormError}
                  />
                  <DraftInput
                    ariaLabel={`Sale ${index + 1} price`}
                    placeholder="latest"
                    value={leg.price ?? ''}
                    validate={(text) => {
                      const price = text.trim()
                      return price !== '' && (!isWireDecimal(price) || !(Number(price) > 0))
                        ? `${ticker}: price must be a number greater than 0, or blank — like 62.50`
                        : null
                    }}
                    onCommit={(text, immediate) => {
                      const price = text.trim()
                      patch(
                        (s) => ({
                          ...s,
                          sales: s.sales.map((row, i) => {
                            if (i !== index) return row
                            const next = { ...row }
                            if (price === '') delete next.price // the omit case: the latest quote
                            else next.price = price
                            return next
                          }),
                        }),
                        immediate,
                      )
                    }}
                    onInvalid={setFormError}
                  />
                  <div className="segmented" role="group" aria-label={`Sale ${index + 1} term`}>
                    <button
                      type="button"
                      className={leg.term === 'long' ? 'active' : ''}
                      aria-pressed={leg.term === 'long'}
                      onClick={() => setSale(index, { term: 'long' }, true)}
                    >
                      Long
                    </button>
                    <button
                      type="button"
                      className={leg.term === 'short' ? 'active' : ''}
                      aria-pressed={leg.term === 'short'}
                      onClick={() => setSale(index, { term: 'short' }, true)}
                    >
                      Short
                    </button>
                  </div>
                  <span className="drill-hint">{formatShares(holding?.shares)} held</span>
                  <button
                    type="button"
                    className="button"
                    aria-label={`Remove sale ${index + 1}`}
                    onClick={() => removeSale(index)}
                  >
                    Remove
                  </button>
                </div>
              )
            })}
            {scenario.espp.map((leg, index) => {
              const lot = unsoldLots.find((row) => row.id === leg.lot_id)
              return (
                <div key={index} className="whatif-form">
                  <label htmlFor={`whatif-espp-lot-${index}`}>ESPP lot</label>
                  <select
                    id={`whatif-espp-lot-${index}`}
                    className="field-input whatif-select"
                    value={String(leg.lot_id)}
                    onChange={(e) => setEspp(index, { lot_id: Number(e.target.value) }, true)}
                  >
                    {lot === undefined && (
                      <option value={String(leg.lot_id)}>Lot {leg.lot_id} (not available)</option>
                    )}
                    {unsoldLots.map((row) => (
                      <option key={row.id} value={String(row.id)}>
                        {formatDate(row.purchase_date)} — {formatShares(row.shares)} sh
                      </option>
                    ))}
                  </select>
                  <DraftInput
                    ariaLabel={`ESPP sale ${index + 1} price`}
                    placeholder="latest"
                    value={leg.sale_price ?? ''}
                    validate={(text) => {
                      const price = text.trim()
                      return price !== '' && (!isWireDecimal(price) || !(Number(price) > 0))
                        ? `Lot ${lot === undefined ? leg.lot_id : formatDate(lot.purchase_date)}: sale price must be a number greater than 0, or blank — like 150.00`
                        : null
                    }}
                    onCommit={(text, immediate) => {
                      const price = text.trim()
                      patch(
                        (s) => ({
                          ...s,
                          espp: s.espp.map((row, i) => {
                            if (i !== index) return row
                            const next = { ...row }
                            if (price === '') delete next.sale_price
                            else next.sale_price = price
                            return next
                          }),
                        }),
                        immediate,
                      )
                    }}
                    onInvalid={setFormError}
                  />
                  <button
                    type="button"
                    className="button"
                    aria-label={`Remove ESPP sale ${index + 1}`}
                    onClick={() => removeEspp(index)}
                  >
                    Remove
                  </button>
                </div>
              )
            })}
          </div>

          {overrideKeys.length > 0 && (
            <div className="tax-section whatif-overrides">
              <h3 className="eyebrow">
                Input overrides
                <InfoHint text="Absolute replacements applied AFTER the sale legs. An override addresses the household key map — on a married year a per-person line is replaced as one combined figure, the same aggregation the engine applies." />
              </h3>
              <p className="drill-hint">
                Overrides set a key&apos;s household value for this scenario only. A blank value clears the
                input (the scenario computes it as 0).
              </p>
              <div className="whatif-legs">
                {overrideKeys.map((key, index) => {
                  const label = definitions.find((d) => d.key === key)?.label ?? key
                  return (
                    <div key={key} className="whatif-form">
                      <label htmlFor={`whatif-override-key-${index}`}>Override</label>
                      <select
                        id={`whatif-override-key-${index}`}
                        className="field-input whatif-select"
                        value={key}
                        onChange={(e) => setOverrideKey(key, e.target.value)}
                      >
                        {!definitions.some((d) => d.key === key) && <option value={key}>{key}</option>}
                        {definitions.map((d) => (
                          <option key={d.key} value={d.key}>
                            {d.label} ({d.key})
                          </option>
                        ))}
                      </select>
                      <DraftAmount
                        ariaLabel={`Override ${index + 1} value`}
                        value={scenario.overrides[key] ?? ''}
                        onCommit={(canonical, immediate) => setOverrideValue(key, canonical, immediate)}
                        onInvalid={() =>
                          setFormError(
                            `${label}: enter a number, or leave the value blank to clear it — like 210000`,
                          )
                        }
                      />
                      <button
                        type="button"
                        className="button"
                        aria-label={`Remove override ${index + 1}`}
                        onClick={() => removeOverride(key)}
                      >
                        Remove
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {sandbox.empty && (
            <p className="empty-note">
              No legs yet — add a sale or an input override to model it against {year}&apos;s stored inputs.
            </p>
          )}

          <div className="whatif-actions">
            <button
              type="button"
              className="button"
              disabled={legCount >= MAX_LEGS || nextHolding() === undefined}
              onClick={addSale}
            >
              Add sale
            </button>
            <button
              type="button"
              className="button"
              disabled={legCount >= MAX_LEGS || nextLot() === undefined}
              onClick={addEsppSale}
            >
              Add ESPP sale
            </button>
            <button type="button" className="button" disabled={nextDefinition() === undefined} onClick={addOverride}>
              Add override
            </button>
            <span className="drill-hint">
              A blank price uses the latest quote. At most {MAX_LEGS} legs. Edits run as you type.
            </span>
          </div>
          <FeedBanner error={formError} />
        </>
      )}
    </SandboxPanel>
  )
}

/** A leg text box: the typed text is control-local while focused (AmountInput's posture); a
 *  keystroke commits valid text debounced, blur/Enter commit at once, invalid text raises the
 *  panel's sentence and commits nothing — the URL keeps the last valid scenario. */
function DraftInput({
  ariaLabel,
  placeholder,
  value,
  validate,
  onCommit,
  onInvalid,
}: {
  ariaLabel: string
  placeholder?: string
  value: string
  validate: (text: string) => string | null
  onCommit: (text: string, immediate: boolean) => void
  onInvalid: (sentence: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const push = (text: string, immediate: boolean) => {
    const problem = validate(text)
    if (problem !== null) {
      // Judged on blur/Enter only: "1" on the way to "12.5" is not a mistake, and a sentence
      // per keystroke would flicker under the form (lane P's BoxKnob). The request is
      // withheld either way — `push` returns without committing.
      if (immediate) onInvalid(problem)
      return
    }
    onCommit(text, immediate)
  }
  const settle = () => {
    if (draft === null) return
    push(draft, true)
    setDraft(null)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      settle()
    }
  }
  return (
    <input
      aria-label={ariaLabel}
      className="field-input"
      inputMode="decimal"
      placeholder={placeholder}
      value={draft ?? value}
      onChange={(e) => {
        setDraft(e.target.value)
        push(e.target.value, false)
      }}
      onBlur={settle}
      onKeyDown={onKeyDown}
    />
  )
}

/** The override value box: AmountInput's tolerant grammar ("$1,600") canonicalized at commit
 *  (InputsForm's boundary); a blank is the explicit null — the endpoint's "clear this input". */
function DraftAmount({
  ariaLabel,
  value,
  onCommit,
  onInvalid,
}: {
  ariaLabel: string
  value: string
  onCommit: (canonical: string | null, immediate: boolean) => void
  onInvalid: () => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  // AmountInput canonicalizes on ITS OWN blur, which fires before this wrapper's: the ref is
  // what settle() reads, so the canonical text lands even though `draft` has not re-rendered.
  const draftRef = useRef<string | null>(null)
  const settle = () => {
    const text = draftRef.current
    if (text === null) return
    draftRef.current = null
    setDraft(null)
    const trimmed = text.trim()
    if (trimmed === '') {
      onCommit(null, true)
      return
    }
    // isAmount is the TOLERANT grammar ("$1,600"); canonicalAmount strips the dressing but
    // passes ".5", "+5" and "5." through unchanged — and formatOverride would then write an
    // entry parseOverride refuses. Gate on the codec's own accept, like the leg boxes above.
    const canonical = isAmount(trimmed) ? canonicalAmount(trimmed) : ''
    if (!isWireDecimal(canonical)) {
      onInvalid()
      return
    }
    onCommit(canonical, true)
  }
  return (
    <span
      onBlur={settle}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          settle()
        }
      }}
    >
      <AmountInput
        aria-label={ariaLabel}
        value={draft ?? value}
        placeholder="blank clears"
        onValueChange={(next) => {
          draftRef.current = next
          setDraft(next)
        }}
      />
    </span>
  )
}
