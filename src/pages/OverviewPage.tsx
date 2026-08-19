import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { ApiError } from '../api/client'
import { fetchLots } from '../api/espp'
import { fetchSummary, fetchTimeseries } from '../api/netWorth'
import { fetchDividends, fetchHistory, fetchHoldings } from '../api/portfolio'
import { fetchMatrix, fetchYearly } from '../api/spending'
import { fetchAllTaxSummaries, fetchTaxYears } from '../api/taxes'
import EChart from '../components/EChart'
import { attentionItems } from '../components/overview/attention'
import { ytdStats } from '../components/overview/ytd'
import {
  netWorthSparkOption,
  pickTaxSummary,
  recentSpendOption,
  spendStats,
} from '../components/overview/overviewChartOptions'
import { liveFromHoldings, portfolioHistoryOption } from '../components/portfolio/historyChartOptions'
import StatTile from '../components/StatTile'
import type {
  DividendOut,
  EsppLotsResponse,
  HoldingsResponse,
  NetWorthSummary,
  NetWorthTimeseries,
  PortfolioHistory,
  SpendingMatrix,
  SpendingYearly,
  TaxSummariesOut,
  TaxYearOut,
} from '../types/api'
import { formatCurrency, formatDate, formatMonth, formatPct } from '../utils/format'
import { todayIso } from '../utils/months'
import { isStaleQuote } from '../utils/staleness'
import { toneOf } from '../utils/tone'
import '../components/panels.css'
import './OverviewPage.css'

// One payload object, never ten pieces of state: the page is a SNAPSHOT, and a tile that
// belongs to a newer fetch than the chart beside it is a lie about the same instant.
interface OverviewData {
  summary: NetWorthSummary
  ts: NetWorthTimeseries
  holdings: HoldingsResponse
  history: PortfolioHistory
  matrix: SpendingMatrix
  taxes: TaxSummariesOut
  // The attention strip's feeds (ESPP countdowns, tax-year input counts) and the YTD
  // card's (yearly rollup, dividend log) ride the same all-or-nothing snapshot:
  // per-slot degradation stays the documented v2 shape.
  lots: EsppLotsResponse
  taxYears: TaxYearOut[]
  yearly: SpendingYearly
  dividends: DividendOut[]
}

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
      fetchHistory(),
      fetchMatrix(),
      fetchAllTaxSummaries(),
      fetchLots(),
      fetchTaxYears(),
      fetchYearly(),
      fetchDividends(),
    ])
      .then(([summary, ts, holdings, history, matrix, taxes, lots, taxYears, yearly, dividends]) => {
        if (seq !== seqRef.current) return
        setData({ summary, ts, holdings, history, matrix, taxes, lots, taxYears, yearly, dividends })
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
  const perf = useMemo(
    () =>
      data ? portfolioHistoryOption(data.history, liveFromHoldings(data.holdings)) : null,
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
  // Plain consts like their siblings (the memo rule below covers CHART options only) —
  // the strip's and the YTD card's rules are cheap math over the snapshot.
  const attention = data
    ? attentionItems(
        { months: data.ts.months, holdings: data.holdings, lots: data.lots, taxYears: data.taxYears },
        todayIso(),
      )
    : []
  const ytd = data ? ytdStats(data.ts, data.yearly, data.dividends, todayIso()) : null
  // Shown once ANY feed has history — on a fresh database the empty states below carry
  // the message, and a card of five dashes would just restate them.
  const showYtd =
    ytd !== null &&
    data !== null &&
    (data.ts.months.length > 0 || data.yearly.years.length > 0 || data.dividends.length > 0)

  // The matrix months are a UNION of spending rows and net-pay rows, so a month whose
  // paycheck is entered but whose spending is not comes back with an explicit "0.00". A
  // green "▼ under $5,000.00 12-mo avg" would congratulate the user for a month they have
  // not entered yet, so the tile keeps its label and says nothing else.
  const cashflowOnly =
    stats !== null &&
    stats.total !== null &&
    Number(stats.total) === 0 &&
    stats.avg12 !== null &&
    stats.avg12 > 0

  // ONE object, three channels: the words, the colour and the glyph are either all present
  // or all absent, which is the invariant a comment used to assert across three separate
  // predicates. Spending up is BAD, so tone is the INVERSE of direction here — and that is
  // exactly why the tile hands StatTile an explicit direction: left to derive the glyph
  // from the tone, an over-average month would render ▼ on a number that went UP. Glyph =
  // direction, colour = good/bad, "over"/"under" = the judgment in words; the same fact
  // three ways, and none of them wrong. (avg12 and aboveAvg are null together — spendStats
  // — but both are named so the narrowing is the compiler's job, not a reader's memory.)
  const spendDelta =
    stats && stats.avg12 !== null && stats.aboveAvg !== null && !cashflowOnly
      ? {
          text: `${stats.aboveAvg ? 'over' : 'under'} ${formatCurrency(stats.avg12)} 12-mo avg`,
          tone: stats.aboveAvg ? ('negative' as const) : ('positive' as const),
          direction: stats.aboveAvg ? ('up' as const) : ('down' as const),
        }
      : null

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
        {/* Ten idempotent GETs and no mutation anywhere on this page, so the button stays
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
          {/* The dashboard's to-do list: each line is a condition the snapshot itself
              proves and a link to where it gets fixed. Absent when nothing needs doing —
              an "all clear" badge would be one more thing to read every morning. */}
          {attention.length > 0 && (
            <nav className="attention-strip" aria-label="Needs attention">
              {attention.map((item) => (
                <NavLink key={item.key} className="attention-item" to={item.to}>
                  {item.text} →
                </NavLink>
              ))}
            </nav>
          )}
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
              delta={spendDelta?.text}
              tone={spendDelta?.tone}
              direction={spendDelta?.direction}
            />
            {/* A rate is a level, not a movement: no delta, no arrow. */}
            <StatTile
              label={taxLabel}
              value={tax === null ? '—' : formatPct(tax.totals.effective_rate, { signed: false })}
            />
          </div>
          {showYtd && ytd && (
            <section className="card ytd-card">
              <h2 className="eyebrow">Year to date — {ytd.year}</h2>
              <dl className="ytd-facts">
                <div className="ytd-fact">
                  <dt>Net worth</dt>
                  <dd>
                    {ytd.netWorthDelta === null ? (
                      '—'
                    ) : (
                      // Glyph + colour + the signed number — three channels, none alone
                      // (StatTile's delta grammar). Up is good here, so glyph and tone agree.
                      <span
                        className={
                          ytd.netWorthDelta > 0
                            ? 'delta-positive'
                            : ytd.netWorthDelta < 0
                              ? 'delta-negative'
                              : ''
                        }
                      >
                        <span aria-hidden="true">
                          {ytd.netWorthDelta > 0 ? '▲ ' : ytd.netWorthDelta < 0 ? '▼ ' : ''}
                        </span>
                        {formatCurrency(ytd.netWorthDelta)}
                        {ytd.netWorthPct !== null && ` (${formatPct(ytd.netWorthPct)})`}
                      </span>
                    )}
                    {ytd.anchorMonth && (
                      <span className="ytd-sub"> since {formatMonth(ytd.anchorMonth)}</span>
                    )}
                  </dd>
                </div>
                <div className="ytd-fact">
                  <dt>Spend</dt>
                  <dd>{formatCurrency(ytd.spend)}</dd>
                </div>
                <div className="ytd-fact">
                  <dt>Net pay</dt>
                  <dd>{formatCurrency(ytd.netPay)}</dd>
                </div>
                <div className="ytd-fact">
                  <dt>Savings rate</dt>
                  <dd>
                    {ytd.savingsRate === null
                      ? '—'
                      : formatPct(ytd.savingsRate, { signed: false })}
                  </dd>
                </div>
                <div className="ytd-fact">
                  <dt>Dividends collected</dt>
                  <dd>{ytd.dividends === null ? '—' : formatCurrency(ytd.dividends)}</dd>
                </div>
              </dl>
            </section>
          )}
          <div className="card-grid">
            <section className="card span-12">
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
            <section className="card span-12">
              <h2 className="eyebrow">Portfolio performance</h2>
              <NavLink className="drill-hint" to="/portfolio">
                Open portfolio →
              </NavLink>
              {perf ? (
                <EChart option={perf} height={280} />
              ) : (
                <p className="empty-note">No performance history yet.</p>
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
              {/* Capitalized, a deliberate departure from PortfolioPage's lowercase pair
                  ("prices as of …" / "prices never refreshed" — a note tucked beside its
                  Refresh button). This row is three PEER clauses separated by dots, and
                  its other two capitalize; a lowercase third would read as a fragment. */}
              {asOf ? `Prices as of ${formatDate(asOf)}` : 'Prices never refreshed'}
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
