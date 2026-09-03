import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { fetchPriceHistory } from '../../api/prices'
import ChartCard from '../ChartCard'
import Segmented from '../shell/Segmented'
import type { DividendOut, HoldingOut, PricePoint, TransactionOut } from '../../types/api'
import {
  formatCurrency,
  formatDate,
  formatPct,
  formatShares,
} from '../../utils/format'
import { todayIso } from '../../utils/months'
import { TYPE_LABELS } from './allocationChartOptions'
import { buildEventMarkers } from './historyChartOptions'
import {
  PRICE_SPANS,
  priceHistoryCsv,
  priceHistoryOption,
  priceWindowSummary,
  reachableSpans,
} from './priceChartOptions'
import type { SpanDays } from './priceChartOptions'
import './portfolio.css'

// Same three-liner as HoldingsTable's private tone() — the tone-rule copies are a known,
// tracked cleanup (Plan 6 residuals); this file joins the family rather than forking it.
function tone(value: string | null): string {
  if (value === null) return ''
  const n = Number(value)
  return n > 0 ? 'pos' : n < 0 ? 'neg' : ''
}

/**
 * The click-through behind a holdings row: everything the table has no room for, told for
 * ONE security — the unsurfaced per-row figures (avg cost, realized G/L, the accounts the
 * shares sit in), a real daily price chart (the sparkline's grown-up form, fed by
 * GET /prices/history), and the security's own slice of the ledgers the page already
 * fetched.
 *
 * A BODY, not a card: it renders IN PLACE of the holdings table inside the page's own
 * Holdings panel, whose header carries the ticker and the "All holdings" way back — so
 * the drill-in never takes the user out of the section they acted in (the SpendingPage
 * bars-to-pie swap, holdings-flavoured). Mounted keyed by security, so a remount resets
 * the span and the feed.
 */
export default function HoldingDetailPanel({
  holding,
  transactions,
  dividends,
}: {
  holding: HoldingOut
  /** The page's WHOLE ledgers — filtered here, so the page stays a pass-through. */
  transactions: TransactionOut[]
  dividends: DividendOut[]
}) {
  // An OBJECT, not bare days: Retry re-asserts the same span, and only a fresh identity
  // re-runs the load effect (TaxesPage's `selection`). The chip handler guards same-span
  // re-clicks so they cannot blink the chart (MonthlyUpdatePage's same-month lesson).
  const [span, setSpan] = useState<{ days: SpanDays }>({ days: 365 })
  const [points, setPoints] = useState<PricePoint[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  // Two span flips in a row are two feeds in flight; only the newest may land or complain.
  const seqRef = useRef(0)
  const rootRef = useRef<HTMLDivElement>(null)

  const ticker = holding.ticker

  // Promise callbacks only — no setState in the effect's synchronous body (react-hooks 7).
  // The mount fetch is covered by the initial busy value; the handlers below flip it.
  useEffect(() => {
    const seq = ++seqRef.current
    fetchPriceHistory(ticker, span.days)
      .then((res) => {
        if (seq !== seqRef.current) return
        setPoints(res.points)
        setError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        // The previous window's chart is KEPT (EsppPage's same-entity rule — the panel is
        // per-security by key, so whatever is on screen is still this security's prices);
        // the banner below carries the stale cue whenever a chart is actually up.
        setError(err instanceof ApiError ? err.message : 'Failed to load price history')
      })
      .finally(() => {
        if (seq === seqRef.current) setBusy(false)
      })
  }, [ticker, span])

  // The swap happens at the SECTION's top, but the row that triggered it may have sat 25
  // rows deep — collapsing the table can leave the viewport past the now-shorter panel
  // entirely. 'nearest' pulls the body back into view as a jump, not an animation —
  // reduced-motion safe by construction. Optional-call: jsdom has no scrollIntoView.
  useEffect(() => {
    rootRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])

  const pickSpan = (days: SpanDays) => {
    if (days === span.days) return
    setBusy(true)
    setError(null)
    setSpan({ days })
  }

  const retry = () => {
    setBusy(true)
    setError(null)
    setSpan((current) => ({ days: current.days }))
  }

  const rows = useMemo(
    () => transactions.filter((t) => t.security_id === holding.security_id),
    [transactions, holding.security_id],
  )
  const paid = useMemo(
    () => dividends.filter((d) => d.security_id === holding.security_id),
    [dividends, holding.security_id],
  )
  // Dated buys/sells/dividends for THIS security, snapped to the daily bars — the performance
  // chart's marker grammar over a finer axis (F4).
  const events = useMemo(
    () =>
      points === null
        ? []
        : buildEventMarkers(
            { dates: points.map((p) => p.d), market_value: points.map((p) => p.c) },
            rows,
            paid,
            new Map([[holding.security_id, holding.ticker]]),
          ),
    [points, rows, paid, holding.security_id, holding.ticker],
  )
  const chart = useMemo(
    () => (points === null ? null : priceHistoryOption({ points, avgCost: holding.avg_cost, events })),
    [points, holding.avg_cost, events],
  )
  const summary = points === null ? null : priceWindowSummary(points)
  // Chips the history cannot reach are disabled (F4): a response shorter than it asked for
  // reveals the whole extent, and every longer span would fetch the same rows again.
  const reachable = useMemo(
    () =>
      points === null
        ? { 365: true, 1095: true, 3650: true }
        : reachableSpans(points, span.days, todayIso()),
    [points, span.days],
  )

  // WHY the XIRR cell is blank, said next to the numbers: the backend computes XIRR only
  // when every transaction carries a date (imported rows carry none), and it never returns
  // the reason. The count here is display-side inference over the same rows the ledger
  // below shows — an explanation of absence, not a re-derived figure (global rule 9 is
  // about the server's numbers; this is about a missing one).
  const undated = rows.filter((t) => t.txn_date === null).length

  return (
    <div ref={rootRef}>
      {/* The full NAME lives here — the panel header above says only "Holdings — {ticker}",
          and the eyebrow register would shout a long fund name in uppercase. */}
      <p className="hint">
        {holding.name} · {holding.industry ?? 'Uncategorized'} ·{' '}
        {TYPE_LABELS[holding.holding_type] ?? holding.holding_type}
        {holding.is_manual_priced && <span className="badge">manual</span>}
        {holding.accounts.length > 0 && <> · Held in {holding.accounts.join(', ')}</>}
      </p>

      {/* Every figure is the server's, rendered as it arrived (global rule 9) — this dl is
          the row's overflow, including the fields the table never had room for. */}
      <dl className="holding-facts">
        <div className="holding-fact">
          <dt>Shares</dt>
          <dd>{formatShares(holding.shares)}</dd>
        </div>
        <div className="holding-fact">
          <dt>Price</dt>
          <dd>
            {formatCurrency(holding.price)}
            {holding.quoted_at && (
              <span className="sub"> as of {formatDate(holding.quoted_at)}</span>
            )}
          </dd>
        </div>
        <div className="holding-fact">
          <dt>Avg cost</dt>
          <dd>{formatCurrency(holding.avg_cost)}</dd>
        </div>
        <div className="holding-fact">
          <dt>Cost basis</dt>
          <dd>{formatCurrency(holding.cost_basis)}</dd>
        </div>
        <div className="holding-fact">
          <dt>Market value</dt>
          <dd>{formatCurrency(holding.market_value)}</dd>
        </div>
        <div className="holding-fact">
          <dt>Unrealized</dt>
          <dd className={tone(holding.unrealized_gl)}>
            {formatCurrency(holding.unrealized_gl)}
            {holding.unrealized_gl_pct !== null && (
              <span className="sub"> {formatPct(holding.unrealized_gl_pct)}</span>
            )}
          </dd>
        </div>
        <div className="holding-fact">
          <dt>Realized</dt>
          <dd className={tone(holding.realized_gl)}>{formatCurrency(holding.realized_gl)}</dd>
        </div>
        <div className="holding-fact">
          <dt>Dividends collected</dt>
          <dd>{formatCurrency(holding.dividends_collected)}</dd>
        </div>
        <div className="holding-fact">
          <dt>Annual income</dt>
          <dd>{formatCurrency(holding.annual_income)}</dd>
        </div>
        <div className="holding-fact">
          <dt>Yield</dt>
          <dd>{formatPct(holding.yield_pct, { signed: false, decimals: 2 })}</dd>
        </div>
        <div className="holding-fact">
          <dt>Yield on cost</dt>
          <dd>{formatPct(holding.yoc_pct, { signed: false, decimals: 2 })}</dd>
        </div>
        <div className="holding-fact">
          <dt>XIRR</dt>
          <dd className={tone(holding.xirr_pct)}>{formatPct(holding.xirr_pct)}</dd>
        </div>
      </dl>
      {holding.xirr_pct === null && undated > 0 && (
        <p className="hint">
          XIRR needs dated transactions — {undated} of {rows.length} below{' '}
          {undated === 1 ? 'has' : 'have'} no date. Backfill dates in the Transactions tab
          to light it up.
        </p>
      )}
      {/* The unrealized figure above raises exactly one question this panel cannot answer —
          what selling it would COST — and /taxes is where the engine answers it. The ticker
          rides the URL and the what-if card seeds one leg from it; encoded, because a
          ticker is server text and this page does not get to assume it is [A-Z]. */}
      <p className="hint">
        <Link to={`/taxes?whatif=${encodeURIComponent(holding.ticker)}`}>
          Model selling {holding.ticker} in Taxes →
        </Link>
      </p>

      <ChartCard
        title="Price history"
        hint="Daily closes for this security over the chosen window against your average cost — the wash reads green above it and red below; markers are dated buys, sells and dividends. Manual-priced securities accrue one point per hand entry."
        ariaLabel={`Line chart of ${ticker}'s daily closing prices against the average cost`}
        option={chart}
        empty={`Not enough price history to chart yet${
          holding.is_manual_priced ? ' — manual pricing adds one point per entry.' : '.'
        }`}
        exportName={`${ticker.toLowerCase()}-price-history`}
        csv={points === null ? undefined : () => priceHistoryCsv(points)}
        height={260}
        zoomable
        busy={busy}
        // The stale cue only when there IS something stale: a span-change failure leaves the
        // previous window's chart up, a first load leaves nothing.
        error={
          error === null
            ? null
            : points === null
              ? error
              : `${error} — the chart may be showing the previous window.`
        }
        controls={
          <Segmented
            variant="toggle"
            size="sm"
            ariaLabel="History window"
            options={PRICE_SPANS.map((s) => ({
              value: String(s.days),
              label: s.label,
              disabled: !reachable[s.days],
            }))}
            value={String(span.days)}
            onChange={(value) => pickSpan(Number(value) as SpanDays)}
          />
        }
        actions={
          error !== null ? (
            <button
              type="button"
              className="button"
              aria-label="Retry loading price history"
              onClick={retry}
            >
              Retry
            </button>
          ) : undefined
        }
        footer={
          summary === null ? undefined : (
            <p className="drill-hint">
              {formatPct(summary.changePct)} over this window · history since {summary.since}
            </p>
          )
        }
      />

      <div className="holding-detail-grid">
        <div>
          <h3 className="eyebrow">Transactions</h3>
          {rows.length === 0 ? (
            <p className="empty-note">No transactions for {ticker}.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Account</th>
                  <th className="num">Shares</th>
                  <th className="num">Price</th>
                  <th className="num">Fees</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td>{formatDate(t.txn_date)}</td>
                    {/* A split's shares/price are the Plan 1 dummy zeros — the factor is
                        the row's whole content, so it rides the type cell. */}
                    <td>{t.type === 'split' ? `split ×${Number(t.split_factor)}` : t.type}</td>
                    <td>{t.account}</td>
                    <td className="num">{t.type === 'split' ? '—' : formatShares(t.shares)}</td>
                    <td className="num">{t.type === 'split' ? '—' : formatCurrency(t.price)}</td>
                    <td className="num">{formatCurrency(t.fees)}</td>
                    <td className="notes-cell" title={t.notes ?? undefined}>
                      {t.notes ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div>
          <h3 className="eyebrow">Dividends</h3>
          {paid.length === 0 ? (
            <p className="empty-note">No dividends recorded for {ticker}.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Pay date</th>
                  <th>Account</th>
                  <th className="num">Amount</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {paid.map((d) => (
                  <tr key={d.id}>
                    <td>{formatDate(d.pay_date)}</td>
                    <td>{d.account ?? '—'}</td>
                    <td className="num">{formatCurrency(d.amount)}</td>
                    <td className="notes-cell" title={d.notes ?? undefined}>
                      {d.notes ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
