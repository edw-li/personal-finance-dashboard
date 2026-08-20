import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { fetchLots } from '../../api/espp'
import { fetchHoldings } from '../../api/portfolio'
import { runWhatIf } from '../../api/whatif'
import StatTile from '../StatTile'
import type {
  EsppLotOut,
  EsppLotsResponse,
  EsppSaleIn,
  HoldingOut,
  HoldingsResponse,
  SaleLegIn,
  WhatIfOut,
} from '../../types/api'
import { formatCurrency, formatDate, formatPct, formatShares } from '../../utils/format'
import { isPlainDecimal } from '../../utils/percent'
import { toneOf } from '../../utils/tone'
import type { Tone } from '../../utils/tone'
// This component's own sheet, like its three siblings: the app-wide vocabulary
// (.card/.eyebrow/.kpi-row/.data-table/.error-banner/.empty-note) is panels.css, which the
// PAGE imports — and StatTile brings it along regardless.
import './taxes.css'

// The API's own ceiling (schemas/taxes.py: WhatIfIn.sales / .espp_sales max_length=20).
const MAX_LEGS = 20

// Strings as typed, converted at submit — a leg is form text until the moment it ships.
interface SaleLegForm {
  securityId: string
  shares: string
  price: string
  term: 'long' | 'short'
}

interface EsppLegForm {
  lotId: string
  salePrice: string
}

// The whole position at the latest quote: the common question is "what if I sold this",
// and every figure is the holdings feed's own text, never re-derived. An unpriced holding
// prefills BLANK, which is the omit case — and the server then 422s by ticker.
function saleLegFor(holding: HoldingOut): SaleLegForm {
  return {
    securityId: String(holding.security_id),
    shares: holding.shares,
    price: holding.price ?? '',
    term: 'long',
  }
}

// The lot's whole share count is implied (the API sells the lot, not a slice of it), so the
// only knob is the price — prefilled from the quote the lots table itself was priced at.
function esppLegFor(lot: EsppLotOut, quote: string | null): EsppLegForm {
  return { lotId: String(lot.id), salePrice: quote ?? '' }
}

/**
 * Δ tax splits StatTile's three channels, because MORE tax is a WORSE outcome (Overview's
 * spending tile, and the same inversion): the GLYPH follows the number, the COLOUR follows
 * good/bad, and the tile's words carry the judgment. Left to derive the glyph from the
 * tone, a scenario that RAISED the tax would print ▼ on a number that went up.
 */
function inverted(tone: Tone): Tone {
  return tone === 'positive' ? 'negative' : tone === 'negative' ? 'positive' : 'neutral'
}

function directionOf(tone: Tone): 'up' | 'down' | undefined {
  return tone === 'positive' ? 'up' : tone === 'negative' ? 'down' : undefined
}

/**
 * The tax sandbox: prospective brokerage sales and ESPP lot sales run against the stored
 * year, baseline vs. scenario vs. delta. NOTHING is stored — the endpoint reads the year's
 * inputs and brackets, runs the engine twice and answers; a run is safe to repeat.
 *
 * Own feeds, own failure surface (SummaryPanel's posture), and both of them LAZY: the page
 * is already long and these are two GETs for a card the user may never open.
 */
export default function WhatIfPanel({
  year,
  initialTicker = null,
  initialLotId = null,
}: {
  year: number
  /**
   * The deep links' seeds (/taxes?whatif=TICKER from the holdings drill-in, ?whatif-lot={id}
   * from the ESPP lots table), read off the URL by TaxesPage and handed down. Either one
   * non-null mounts the card OPEN and prefills ONE leg once the feeds land — the ticker/lot
   * id only mean something against a feed, so the seeding rides its promise callback.
   */
  initialTicker?: string | null
  initialLotId?: number | null
}) {
  // The deep-link seeds, pinned at MOUNT. They live in a ref because `loadFeeds` below must
  // read no reactive value beyond its setters — a prop read there would make it reactive,
  // and the mount effect would then owe it a dependency that re-runs the pair of GETs on
  // every render (SettingsPage's note; the house rejects the useCallback alternative). The
  // semantics are the ones Task 5 wants anyway: the page remounts this panel by year, so a
  // seed only ever applies to the mount that carried it.
  const seedRef = useRef({ ticker: initialTicker, lotId: initialLotId })
  const [open, setOpen] = useState(initialTicker !== null || initialLotId !== null)
  // null = the feed has not answered yet (never [] — an empty book is a real answer, and
  // the two say different things under the form).
  const [holdings, setHoldings] = useState<HoldingsResponse | null>(null)
  const [lots, setLots] = useState<EsppLotsResponse | null>(null)
  const [feedError, setFeedError] = useState<string | null>(null)
  const [legs, setLegs] = useState<SaleLegForm[]>([])
  const [esppLegs, setEsppLegs] = useState<EsppLegForm[]>([])
  const [result, setResult] = useState<WhatIfOut | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Two Runs in a row are two scenarios in flight; only the newest may land (or complain).
  const seqRef = useRef(0)
  // The feeds are fetched ONCE per mount. The ref — not `holdings === null` — is the guard,
  // so a pair that FAILED does not re-fire on every re-open, and the deep-link door below
  // cannot spend a second pair.
  const feedsRef = useRef(false)

  // A plain function over stable setters (TaxesPage's `loadYears`), called from both doors
  // into the card. Promise callbacks only — no setState in an effect's synchronous body
  // (react-hooks 7).
  const loadFeeds = () => {
    if (feedsRef.current) return
    feedsRef.current = true
    Promise.all([fetchHoldings(), fetchLots()])
      .then(([heldRes, lotsRes]) => {
        setHoldings(heldRes)
        setLots(lotsRes)
        // Seeding rides the SAME callback as the feeds it reads: a deep link names a ticker
        // or a lot id, and only the feed knows which row that is. A name that matches
        // nothing seeds nothing — the open card with its empty leg list is the honest
        // answer, not an error (the holding may have been sold since the link was made).
        const seed = seedRef.current
        if (seed.ticker !== null) {
          const ticker = seed.ticker.toUpperCase()
          const match = heldRes.holdings.find((holding) => holding.ticker.toUpperCase() === ticker)
          if (match !== undefined) setLegs([saleLegFor(match)])
        }
        if (seed.lotId !== null) {
          const lot = lotsRes.lots.find((row) => row.id === seed.lotId && !row.is_sold)
          if (lot !== undefined) setEsppLegs([esppLegFor(lot, lotsRes.current_price)])
        }
      })
      .catch((err: unknown) => {
        setFeedError(
          err instanceof ApiError ? err.message : 'Failed to load holdings and ESPP lots',
        )
      })
  }

  useEffect(() => {
    // The DEEP-LINKED mount only; every other open goes through the toggle below. Mount-only,
    // and loadFeeds reads no reactive value beyond its setters and refs, so react-hooks 7
    // has nothing to report here (PortfolioPage's `load`).
    const seed = seedRef.current
    if (seed.ticker !== null || seed.lotId !== null) loadFeeds()
  }, [])

  const held = holdings?.holdings ?? []
  const unsoldLots = lots?.lots.filter((lot) => !lot.is_sold) ?? []
  const holdingFor = (securityId: string) =>
    held.find((holding) => String(holding.security_id) === securityId)
  const legCount = legs.length + esppLegs.length

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next) loadFeeds()
  }

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
  const nextHolding = () => {
    const taken = new Set(legs.map((leg) => leg.securityId))
    return held.find((holding) => !taken.has(String(holding.security_id)))
  }

  const nextLot = () => {
    const taken = new Set(esppLegs.map((leg) => leg.lotId))
    return unsoldLots.find((lot) => !taken.has(String(lot.id)))
  }

  const addSale = () => {
    const holding = nextHolding()
    if (holding === undefined) return
    setError(null) // the sentence described the legs as they WERE
    setLegs((current) => [...current, saleLegFor(holding)])
  }

  const addEsppSale = () => {
    const lot = nextLot()
    if (lot === undefined) return
    setError(null)
    setEsppLegs((current) => [...current, esppLegFor(lot, lots?.current_price ?? null)])
  }

  const setLeg = (index: number, patch: Partial<SaleLegForm>) => {
    setError(null)
    setLegs((current) => current.map((leg, i) => (i === index ? { ...leg, ...patch } : leg)))
  }

  // Switching the ticker re-prefills the amounts with it: the old row's share count belongs
  // to the old position, and leaving it there is an oversell one keystroke from happening.
  const setLegSecurity = (index: number, securityId: string) => {
    const holding = holdingFor(securityId)
    if (holding === undefined) return
    setLeg(index, { ...saleLegFor(holding), term: legs[index].term })
  }

  const setEsppLeg = (index: number, patch: Partial<EsppLegForm>) => {
    setError(null)
    setEsppLegs((current) => current.map((leg, i) => (i === index ? { ...leg, ...patch } : leg)))
  }

  const removeLeg = (index: number) => {
    setError(null)
    setLegs((current) => current.filter((_, i) => i !== index))
  }

  const removeEsppLeg = (index: number) => {
    setError(null)
    setEsppLegs((current) => current.filter((_, i) => i !== index))
  }

  /**
   * The router's own fences, refused here in the BOX's vocabulary rather than spending a
   * request on the 422 (ProjectionPage's posture) — and worded the way the server words
   * them where it has a twin, so the two never disagree about the same leg.
   *
   * Number() is display-only (utils/format.ts's rule): nothing derived from it is sent —
   * every figure that ships is the TYPED text, and the server does the quantizing.
   */
  const run = () => {
    const sales: SaleLegIn[] = []
    for (const [index, leg] of legs.entries()) {
      const holding = holdingFor(leg.securityId)
      if (holding === undefined) {
        setError(`Sale ${index + 1}: choose a security you hold`)
        return
      }
      const shares = leg.shares.trim()
      if (shares === '' || !isPlainDecimal(shares) || !(Number(shares) > 0)) {
        setError(`${holding.ticker}: shares must be a number greater than 0`)
        return
      }
      if (Number(shares) > Number(holding.shares)) {
        // The server's own sentence (api/taxes.py's oversell 422) — one vocabulary.
        setError(`selling ${shares} ${holding.ticker} — only ${holding.shares} held`)
        return
      }
      const price = leg.price.trim()
      if (price !== '' && (!isPlainDecimal(price) || !(Number(price) > 0))) {
        setError(`${holding.ticker}: price must be a number greater than 0, or blank`)
        return
      }
      // A blank price is OMITTED, never sent as "" (the projection page's blank-omit
      // convention): the key's absence is what asks for the security's latest quote.
      sales.push({
        security_id: holding.security_id,
        shares,
        term: leg.term,
        ...(price === '' ? {} : { price }),
      })
    }

    const esppSales: EsppSaleIn[] = []
    for (const [index, leg] of esppLegs.entries()) {
      const lot = unsoldLots.find((row) => String(row.id) === leg.lotId)
      if (lot === undefined) {
        setError(`ESPP sale ${index + 1}: choose an unsold lot`)
        return
      }
      const price = leg.salePrice.trim()
      if (price !== '' && (!isPlainDecimal(price) || !(Number(price) > 0))) {
        setError(
          `Lot ${formatDate(lot.purchase_date)}: sale price must be a number greater than 0, or blank`,
        )
        return
      }
      esppSales.push({ lot_id: lot.id, ...(price === '' ? {} : { sale_price: price }) })
    }

    const seq = ++seqRef.current
    setBusy(true)
    setError(null)
    runWhatIf({ year, sales, espp_sales: esppSales })
      .then((res) => {
        if (seq !== seqRef.current) return
        setResult(res)
        setError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        // Dropped, not kept: the answer is a function of the legs, and leaving the last one
        // on screen would read as the answer for the ones now in the form (ProjectionPage).
        setResult(null)
        setError(err instanceof ApiError ? err.message : 'Failed to run the scenario')
      })
      .finally(() => {
        if (seq === seqRef.current) setBusy(false)
      })
  }

  const taxTone = result === null ? 'neutral' : toneOf(result.delta.total_tax)
  const takeHomeTone = result === null ? 'neutral' : toneOf(result.delta.take_home)

  return (
    <section className="card">
      <div className="tax-chart-header">
        <h2 className="eyebrow">What if — {year}</h2>
        <button type="button" className="button" aria-expanded={open} onClick={toggle}>
          {open ? 'Close what-if' : 'Open what-if'}
        </button>
      </div>
      {!open ? (
        <p className="drill-hint">
          Model prospective share sales against {year}&apos;s stored inputs — nothing is
          saved, and the stored year is never touched.
        </p>
      ) : (
        <>
          <p className="drill-hint">
            Sales are classified at average cost, the app&apos;s only basis method, and ESPP
            ordinary income lands in Other W2 Income — which raises the engine&apos;s
            Medicare/Social Security/SDI wage bases, exactly as the sheet does it. Real ESPP
            ordinary income is FICA-exempt; this sandbox inherits the sheet&apos;s structure.
            Nothing here is stored.
          </p>
          {feedError !== null && (
            <div className="error-banner" role="alert">
              {feedError}{' '}
              <button type="button" className="button" onClick={retryFeeds}>
                Retry
              </button>
            </div>
          )}
          {/* Both feeds land together (one Promise.all) or neither does, so one null is the
              whole "still waiting" question — and a pair that FAILED leaves the banner above
              as the card's only content: there is nothing to build a leg out of, and a form
              of empty selects would read as "you hold nothing". */}
          {holdings === null && feedError === null && (
            <p className="empty-note">Loading holdings and ESPP lots…</p>
          )}
          {holdings !== null && (
            <>
              <div className="whatif-legs">
                {/* Position IS the identity here (a leg has no id of its own), and every
                    field is controlled from this array — so an index key cannot strand a
                    typed value in a reused row (BracketsEditor's note). */}
                {legs.map((leg, index) => (
                  <div key={index} className="whatif-form">
                    <label htmlFor={`whatif-sale-security-${index}`}>Sell</label>
                    <select
                      id={`whatif-sale-security-${index}`}
                      className="field-input whatif-select"
                      value={leg.securityId}
                      onChange={(e) => setLegSecurity(index, e.target.value)}
                    >
                      {held.map((holding) => (
                        <option key={holding.security_id} value={String(holding.security_id)}>
                          {holding.ticker}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={`Sale ${index + 1} shares`}
                      className="field-input"
                      inputMode="decimal"
                      value={leg.shares}
                      onChange={(e) => setLeg(index, { shares: e.target.value })}
                    />
                    <input
                      aria-label={`Sale ${index + 1} price`}
                      className="field-input"
                      inputMode="decimal"
                      placeholder="latest"
                      value={leg.price}
                      onChange={(e) => setLeg(index, { price: e.target.value })}
                    />
                    <div className="segmented" role="group" aria-label={`Sale ${index + 1} term`}>
                      <button
                        type="button"
                        className={leg.term === 'long' ? 'active' : ''}
                        aria-pressed={leg.term === 'long'}
                        onClick={() => setLeg(index, { term: 'long' })}
                      >
                        Long
                      </button>
                      <button
                        type="button"
                        className={leg.term === 'short' ? 'active' : ''}
                        aria-pressed={leg.term === 'short'}
                        onClick={() => setLeg(index, { term: 'short' })}
                      >
                        Short
                      </button>
                    </div>
                    <span className="drill-hint">
                      {formatShares(holdingFor(leg.securityId)?.shares)} held
                    </span>
                    <button
                      type="button"
                      className="button"
                      aria-label={`Remove sale ${index + 1}`}
                      onClick={() => removeLeg(index)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {esppLegs.map((leg, index) => (
                  <div key={index} className="whatif-form">
                    <label htmlFor={`whatif-espp-lot-${index}`}>ESPP lot</label>
                    <select
                      id={`whatif-espp-lot-${index}`}
                      className="field-input whatif-select"
                      value={leg.lotId}
                      onChange={(e) => setEsppLeg(index, { lotId: e.target.value })}
                    >
                      {unsoldLots.map((lot) => (
                        <option key={lot.id} value={String(lot.id)}>
                          {formatDate(lot.purchase_date)} — {formatShares(lot.shares)} sh
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={`ESPP sale ${index + 1} price`}
                      className="field-input"
                      inputMode="decimal"
                      placeholder="latest"
                      value={leg.salePrice}
                      onChange={(e) => setEsppLeg(index, { salePrice: e.target.value })}
                    />
                    <button
                      type="button"
                      className="button"
                      aria-label={`Remove ESPP sale ${index + 1}`}
                      onClick={() => removeEsppLeg(index)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              {legCount === 0 && (
                <p className="empty-note">
                  No legs yet — add a sale to model it against {year}&apos;s stored inputs.
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
                {/* Shut only with nothing to run. Deliberately NOT disabled while busy, the
                    way a SAVE button is: a run stores nothing and is safe to repeat, and
                    the natural move on seeing an answer is to edit a leg and ask again —
                    refusing that mid-flight would make the card feel stuck. Two runs in
                    flight is exactly what the seq ref is for. */}
                <button
                  type="button"
                  className="button button-primary"
                  disabled={legCount === 0}
                  onClick={run}
                >
                  {busy ? 'Running…' : 'Run what-if'}
                </button>
                <span className="drill-hint">
                  A blank price uses the latest quote. At most {MAX_LEGS} legs.
                </span>
              </div>

              {error !== null && (
                <div className="error-banner" role="alert">
                  {error}
                </div>
              )}

              {result !== null && (
                <div className="whatif-result">
                  {/* Every figure is the server's, rendered as it arrived (global rule 9) —
                      the deltas are the endpoint's own subtraction of two quantized
                      summaries, never this component's. */}
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
                    />
                    <StatTile
                      label="Δ take-home"
                      value={formatCurrency(result.delta.take_home)}
                      delta={`${formatCurrency(result.baseline.totals.take_home)} → ${formatCurrency(
                        result.scenario.totals.take_home,
                      )}`}
                      tone={takeHomeTone}
                    />
                    {/* A rate is a level, not a movement: both sides, no arrow. */}
                    <StatTile
                      label="Effective rate"
                      value={`${formatPct(result.baseline.totals.effective_rate, {
                        signed: false,
                      })} → ${formatPct(result.scenario.totals.effective_rate, { signed: false })}`}
                    />
                  </div>

                  {result.warnings.length > 0 && (
                    // Advisory, never an error banner: the scenario RAN — these are the
                    // honest asterisks on what it ran with (the engine's own register).
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
                      <p className="empty-note">
                        Nothing moved — this scenario computes to the stored year.
                      </p>
                    ) : (
                      <ul className="whatif-changed">
                        {result.changed_inputs.map((changed) => (
                          // An em dash, not a colon: the label is the definition table's own
                          // text and often carries a colon already ("LTCG: Brokerage
                          // Gain/Loss"), which a second one would double-punctuate. The
                          // label itself is rendered as it arrived, like every figure
                          // beside it.
                          <li key={changed.key}>
                            {changed.label} — {formatCurrency(changed.before)} →{' '}
                            {formatCurrency(changed.after)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}
