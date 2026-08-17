import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { ApiError } from '../api/client'
import { fetchSummary, fetchTimeseries } from '../api/netWorth'
import { fetchAllocation, fetchHoldings } from '../api/portfolio'
import { fetchMatrix } from '../api/spending'
import { fetchAllTaxSummaries } from '../api/taxes'
import EChart from '../components/EChart'
import {
  netWorthSparkOption,
  pickTaxSummary,
  recentSpendOption,
  spendStats,
} from '../components/overview/overviewChartOptions'
import { donutOption, positiveSlices } from '../components/portfolio/allocationChartOptions'
import StatTile from '../components/StatTile'
import type {
  AllocationResponse,
  HoldingsResponse,
  NetWorthSummary,
  NetWorthTimeseries,
  SpendingMatrix,
  TaxSummariesOut,
} from '../types/api'
import { formatCurrency, formatDate, formatMonth, formatPct } from '../utils/format'
import { isStaleQuote } from '../utils/staleness'
import '../components/panels.css'
import './OverviewPage.css'

// One payload object, never six pieces of state: the page is a SNAPSHOT, and a tile that
// belongs to a newer fetch than the chart beside it is a lie about the same instant.
interface OverviewData {
  summary: NetWorthSummary
  ts: NetWorthTimeseries
  holdings: HoldingsResponse
  allocation: AllocationResponse
  matrix: SpendingMatrix
  taxes: TaxSummariesOut
}

// Direction × colour for a signed money string, asked four times by the tiles below.
// Number() is display-only here (src/utils/format.ts's rule) — nothing derived from it is
// ever rendered as a figure or sent back to the API.
const toneOf = (v: string | null | undefined) =>
  v == null ? ('neutral' as const) : Number(v) < 0 ? ('negative' as const) : ('positive' as const)

export default function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const seqRef = useRef(0)

  // Plain function + inline chain (preserve-manual-memoization wall — Plan 3/5 notes).
  // Promise.all is deliberate: the page renders one coherent snapshot, and a partial
  // refresh would let the tiles disagree with the charts. On failure the previous payload
  // stays on screen with the staleness cue in the banner (EsppPage class).
  const load = () => {
    const seq = ++seqRef.current
    Promise.all([
      fetchSummary(),
      fetchTimeseries('monthly'),
      fetchHoldings(),
      fetchAllocation('type'),
      fetchMatrix(),
      fetchAllTaxSummaries(),
    ])
      .then(([summary, ts, holdings, allocation, matrix, taxes]) => {
        if (seq !== seqRef.current) return
        setData({ summary, ts, holdings, allocation, matrix, taxes })
        setError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(err instanceof ApiError ? err.message : 'Could not load the overview.')
      })
      .finally(() => {
        if (seq === seqRef.current) setBusy(false)
      })
  }

  useEffect(() => {
    load()
    // mount-only: load is a plain function over stable setters (house idiom)
  }, [])

  // The busy flag is raised by the CALLERS, never inside load(): load() runs in the mount
  // effect's synchronous body, where a setState is a house react-hooks violation.
  const reload = () => {
    setBusy(true)
    load()
  }

  // The only memoized values on the page — EChart keys its setOption effect on [option],
  // so a fresh object every render would redraw all three charts on every keystroke
  // elsewhere. Everything else below is a plain const.
  const spark = useMemo(() => (data ? netWorthSparkOption(data.ts) : null), [data])
  const donut = useMemo(
    () =>
      data && positiveSlices(data.allocation).length > 0
        ? donutOption(data.allocation, true)
        : null,
    [data],
  )
  const bars = useMemo(() => (data ? recentSpendOption(data.matrix) : null), [data])

  const summary = data?.summary
  // Rendered verbatim, never re-derived: these are the server's own totals fields (the
  // `totals.unrealized_gl` lesson).
  const totals = data?.holdings.totals
  const asOf = data?.holdings.as_of ?? null
  const stats = data ? spendStats(data.matrix) : null
  const currentYear = new Date().getFullYear()
  const tax = data ? pickTaxSummary(data.taxes.years, currentYear) : null

  // The matrix months are a UNION of spending rows and net-pay rows, so a month whose
  // paycheck is entered but whose spending is not comes back with an explicit "0.00". A
  // green "$0.00 vs $5,000.00 12-mo avg" would congratulate the user for a month they have
  // not entered yet, so the tile keeps its label and says nothing else.
  const cashflowOnly =
    stats !== null &&
    stats.total !== null &&
    Number(stats.total) === 0 &&
    stats.avg12 !== null &&
    stats.avg12 > 0

  // Spending up is BAD: the tone is the inverse of the direction here (StatTile's contract
  // puts "whether up is good" on the caller).
  const spendTone =
    stats === null || stats.aboveAvg === null || cashflowOnly
      ? undefined
      : stats.aboveAvg
        ? ('negative' as const)
        : ('positive' as const)

  const taxLabel =
    tax === null
      ? 'Effective tax'
      : `Effective tax — ${tax.year}${
          tax.year < currentYear
            ? ' (latest)'
            : tax.year > currentYear
              ? ' (planned)'
              : ' (est.)'
        }`

  return (
    <div className="page overview-page">
      <header className="page-header">
        <h1>Overview</h1>
        <div className="spacer" />
        {/* Six idempotent GETs and no mutation anywhere on this page, so the button stays
            live while a load is in flight: an impatient second click is harmless, the body
            dims to show the work, and seqRef decides which answer lands. */}
        <button type="button" className="button" onClick={reload}>
          Refresh
        </button>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          {/* The stale cue only when there IS something stale: a reload failure leaves the
              previous snapshot up, a first-load failure leaves nothing to be behind. */}
          {data === null ? error : `${error} — the page may be showing earlier data.`}{' '}
          <button className="button" aria-label="Retry loading the overview" onClick={reload}>
            Retry
          </button>
        </div>
      )}
      {data === null ? (
        // A failed FIRST load shows the banner alone rather than a page of $0.00 tiles that
        // reads as "you are broke" (PortfolioPage posture).
        busy && <p className="empty-note">Loading…</p>
      ) : (
        <div className={`loading-dim${busy ? ' is-loading' : ''}`}>
          <div className="kpi-row">
            <StatTile
              hero
              label={summary?.month ? `Net worth — ${formatMonth(summary.month)}` : 'Net worth'}
              value={formatCurrency(summary?.net_worth)}
              // Both halves or neither: a bare amount with no rate reads as a total.
              delta={
                summary?.mom_delta != null && summary.mom_pct != null
                  ? `${formatCurrency(summary.mom_delta)} (${formatPct(summary.mom_pct)}) MoM`
                  : undefined
              }
              tone={toneOf(summary?.mom_delta)}
            />
            <StatTile
              label="Portfolio"
              value={formatCurrency(totals?.market_value)}
              // Omitted before the first price refresh — there is no day to compare to.
              delta={
                totals?.day_change_amount != null && totals.day_change_pct != null
                  ? `${formatCurrency(totals.day_change_amount)} (${formatPct(
                      totals.day_change_pct,
                    )}) today`
                  : undefined
              }
              tone={toneOf(totals?.day_change_amount)}
            />
            <StatTile
              label={stats?.month ? `Spending — ${formatMonth(stats.month)}` : 'Spending'}
              value={cashflowOnly ? '—' : formatCurrency(stats?.total)}
              delta={
                !cashflowOnly && stats?.avg12 != null
                  ? `vs ${formatCurrency(stats.avg12)} 12-mo avg`
                  : undefined
              }
              tone={spendTone}
            />
            {/* A rate is a level, not a movement: no delta, no arrow. */}
            <StatTile
              label={taxLabel}
              value={tax === null ? '—' : formatPct(tax.totals.effective_rate, { signed: false })}
            />
          </div>
          <div className="card-grid">
            <section className="card span-8">
              <h2 className="eyebrow">Net worth trend</h2>
              <NavLink className="drill-hint" to="/net-worth">
                Open net worth →
              </NavLink>
              {spark ? (
                <EChart option={spark} height={220} />
              ) : (
                <p className="empty-note">No snapshots yet.</p>
              )}
            </section>
            {/* PALETTE[0] draws both the spark line and the donut's largest slice; the
                donut carries its own legend, which is what disambiguates them — the 260px
                height is sized to keep that legend on screen. */}
            <section className="card span-4">
              <h2 className="eyebrow">Allocation by type</h2>
              <NavLink className="drill-hint" to="/portfolio">
                Open portfolio →
              </NavLink>
              {donut ? (
                <EChart option={donut} height={260} />
              ) : (
                <p className="empty-note">No priced holdings yet.</p>
              )}
            </section>
            <section className="card span-12">
              <h2 className="eyebrow">Recent spending</h2>
              <NavLink className="drill-hint" to="/spending">
                Open spending →
              </NavLink>
              {bars ? (
                <EChart option={bars} height={240} />
              ) : (
                <p className="empty-note">No spending months yet.</p>
              )}
            </section>
          </div>
          {/* Three different clocks: quotes move daily, snapshots and spending months are
              hand-entered. The page says which date each half of it is standing on. */}
          <div className="overview-freshness">
            <span className={isStaleQuote(asOf) ? 'freshness stale' : 'freshness'}>
              {asOf ? `Prices as of ${formatDate(asOf)}` : 'prices never refreshed'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="freshness">
              {summary?.month
                ? `Net worth through ${formatMonth(summary.month)}`
                : 'Net worth — no snapshots'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="freshness">
              {stats?.month ? `Spending through ${formatMonth(stats.month)}` : 'Spending — no months'}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
