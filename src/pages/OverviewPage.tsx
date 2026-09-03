import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { fetchCalendar } from '../api/calendar'
import { ApiError } from '../api/client'
import { fetchLots } from '../api/espp'
import { fetchSummary, fetchTimeseries } from '../api/netWorth'
import type { OwnerScope } from '../api/netWorth'
import { fetchMoneyFlow } from '../api/overview'
import { fetchDividends, fetchHistory, fetchHoldings } from '../api/portfolio'
import { fetchMatrix, fetchYearly } from '../api/spending'
import { fetchSystemStatus } from '../api/system'
import { fetchAllTaxSummaries, fetchTaxYears } from '../api/taxes'
import { getSnapshot, setSnapshot } from '../api/snapshotCache'
import ChartCard from '../components/ChartCard'
import type { EChartEventParams } from '../components/EChart'
import InfoHint from '../components/InfoHint'
import { eventKey } from '../components/calendar/calendarView'
import { attentionItems } from '../components/overview/attention'
import MoneyFlowCard from '../components/overview/MoneyFlowCard'
import { UP_NEXT_WINDOW_DAYS, upNextItems } from '../components/overview/upNext'
import { ytdStats } from '../components/overview/ytd'
import {
  netWorthTrendCsv,
  netWorthTrendOption,
  pickTaxSummary,
  RECENT_SPEND_MONTHS,
  recentSpendCsv,
  recentSpendOption,
  spendStats,
} from '../components/overview/overviewChartOptions'
import {
  liveFromHoldings,
  portfolioHistoryCsv,
  portfolioHistoryOption,
} from '../components/portfolio/historyChartOptions'
import PageFrame from '../components/shell/PageFrame'
import ScopeBar from '../components/shell/ScopeBar'
import { useScope } from '../components/shell/useScope'
import StatTile from '../components/StatTile'
import type {
  CalendarEvent,
  DividendOut,
  EsppLotsResponse,
  HoldingsResponse,
  MoneyFlowOut,
  NetWorthSummary,
  NetWorthTimeseries,
  PortfolioHistory,
  SpendingMatrix,
  SpendingYearly,
  SystemStatus,
  TaxSummariesOut,
  TaxYearOut,
} from '../types/api'
import { formatCurrency, formatDate, formatMonth, formatPct } from '../utils/format'
import { addDays, todayIso } from '../utils/months'
import { isStaleQuote } from '../utils/staleness'
import { toneOf } from '../utils/tone'
import '../components/panels.css'
import './OverviewPage.css'

// One payload object, never eleven pieces of state: the page is a SNAPSHOT, and a tile
// that belongs to a newer fetch than the chart beside it is a lie about the same instant.
interface OverviewData {
  summary: NetWorthSummary
  ts: NetWorthTimeseries
  holdings: HoldingsResponse
  history: PortfolioHistory
  matrix: SpendingMatrix
  taxes: TaxSummariesOut
  // The attention strip's feeds (ESPP countdowns, tax-year input counts, the system
  // status — last refresh run, backup marker, environment) and the YTD card's (yearly
  // rollup, dividend log) ride the same all-or-nothing snapshot: per-slot degradation
  // stays the documented v2 shape.
  lots: EsppLotsResponse
  taxYears: TaxYearOut[]
  yearly: SpendingYearly
  dividends: DividendOut[]
  system: SystemStatus
}

// Keyed by the fetch parameters, like every other page's: an owner scope is a DIFFERENT
// snapshot, and one key for all of them would paint the wrong person's numbers.
function overviewKey(owner: OwnerScope): string {
  return `overview:${owner ?? 'all'}`
}

// The two feeds with no owner dimension server-side. Under an owner scope their cards say
// so, rather than letting the chip imply a filter that never ran.
const SPENDING_HINT =
  "The latest entered month's total spend against your trailing 12-month average."
const PERFORMANCE_HINT =
  "Portfolio value vs cost basis, checkpointed weekly after Monday's close; the pinging dot is live. The S&P 500 line invests only the starting balance; VOO (your contributions) invests every inferred contribution instead."

// The up-next window slides with the calendar day — key it by today so a date rollover
// misses cleanly instead of painting yesterday's window.
function upNextKey(): string {
  return `overview:upnext:${todayIso()}`
}

function flowKey(year: number | null): string {
  return `overview:flow:${year ?? 'auto'}`
}

export default function OverviewPage() {
  const navigate = useNavigate()
  // The URL owns the scope (2026-09-03 shell spec §6) and the scope row writes it; this
  // page only reads it, so there is no local owner state to keep in step.
  const { scope } = useScope({ owner: true })
  const owner = scope.owner
  const snapshotKey = overviewKey(owner)
  const cachedData = getSnapshot<OverviewData>(snapshotKey)
  const [data, setData] = useState<OverviewData | null>(cachedData ?? null)
  const [busy, setBusy] = useState(true)
  // false once a revalidation actually CHANGES the data — charts may animate again.
  const [fromCache, setFromCache] = useState(cachedData !== undefined)
  const [error, setError] = useState<string | null>(null)
  const seqRef = useRef(0)
  // What the page is actually SHOWING. The identical-payload skip in load() is judged
  // against this, never against the snapshot cache: render and cache diverge across owner
  // switches (the previous scope's tiles are still up while the next scope's key is warm),
  // and skipping on the cache would strand the page on the previous scope — NetWorthPage's
  // 2026-08-28 bug, which this page inherits the moment its key grows an owner.
  const shownRef = useRef<OverviewData | null>(cachedData ?? null)

  // The forward-looking strip is a SEPARATE fetch with its own tiny error state: the
  // snapshot Promise.all above stays untouched (its all-or-nothing contract is the
  // page's point), and a calendar hiccup must not take the overview down — or the
  // reverse. It renders inside the snapshot branch because it SITS with the freshness
  // footer; a failed first snapshot shows the banner alone, house posture.
  const [upNext, setUpNext] = useState<CalendarEvent[] | null>(
    () => getSnapshot<CalendarEvent[]>(upNextKey()) ?? null,
  )
  const [upNextFailed, setUpNextFailed] = useState(false)
  const upNextSeq = useRef(0)

  const loadUpNext = () => {
    const seq = ++upNextSeq.current
    const today = todayIso()
    fetchCalendar(today, addDays(today, UP_NEXT_WINDOW_DAYS))
      .then((data) => {
        if (seq !== upNextSeq.current) return
        const key = upNextKey()
        const previous = getSnapshot<CalendarEvent[]>(key)
        setSnapshot(key, data.events)
        setUpNextFailed(false)
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(data.events))
          return
        setUpNext(data.events)
      })
      .catch(() => {
        if (seq !== upNextSeq.current) return
        setUpNextFailed(true)
      })
  }

  // The money-flow card is the SECOND isolated fetch (spec §5, the Up-next pattern):
  // its own state, its own seq, its own inline error — a tax-engine hiccup dents one
  // card and never the snapshot, and vice versa.
  const [flow, setFlow] = useState<MoneyFlowOut | null>(
    () => getSnapshot<MoneyFlowOut>(flowKey(null)) ?? null,
  )
  const [flowFailed, setFlowFailed] = useState(false)
  // null = let the server pick the year (the current product year); a chip click pins it.
  const [flowYear, setFlowYear] = useState<number | null>(null)
  const flowSeq = useRef(0)

  const loadFlow = (year: number | null) => {
    const seq = ++flowSeq.current
    fetchMoneyFlow(year ?? undefined)
      .then((data) => {
        if (seq !== flowSeq.current) return
        const previous = getSnapshot<MoneyFlowOut>(flowKey(year))
        setSnapshot(flowKey(year), data)
        setFlowFailed(false)
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(data)) return
        setFlow(data)
      })
      .catch(() => {
        if (seq !== flowSeq.current) return
        setFlowFailed(true)
      })
  }

  // Chip flip: an already-seen year paints instantly and revalidates underneath. The peek
  // lives HERE rather than inside loadFlow because loadFlow also runs in the mount effect's
  // body, where a synchronous setState is a house react-hooks violation.
  const showFlowYear = (year: number | null) => {
    setFlowYear(year)
    const peeked = getSnapshot<MoneyFlowOut>(flowKey(year))
    if (peeked !== undefined) setFlow(peeked)
    loadFlow(year)
  }

  // Memoized over the scope, so the effect below refetches when — and only when — the
  // owner changes. Promise.all is deliberate: the page renders one coherent snapshot, and
  // a partial refresh would let the tiles disagree with the charts. On failure the previous
  // payload stays on screen with the frame's staleness line (EsppPage class).
  const load = useCallback(() => {
    const seq = ++seqRef.current
    Promise.all([
      fetchSummary(owner),
      fetchTimeseries('monthly', owner),
      fetchHoldings(owner),
      // Household-wide until the history endpoint grows an owner param; /spending has no
      // owner dimension at all. Both cards say so under a scope (see the hints below).
      fetchHistory(),
      fetchMatrix(),
      fetchAllTaxSummaries(),
      fetchLots(),
      fetchTaxYears(),
      fetchYearly(),
      fetchDividends(),
      fetchSystemStatus(),
    ])
      .then(
        ([summary, ts, holdings, history, matrix, taxes, lots, taxYears, yearly, dividends, system]) => {
          if (seq !== seqRef.current) return
          const snapshot: OverviewData = {
            summary, ts, holdings, history, matrix, taxes, lots, taxYears, yearly, dividends, system,
          }
          setSnapshot(snapshotKey, snapshot)
          setError(null)
          // Identical payload: nothing re-renders, the charts stay still (spec §1) — judged
          // against the RENDERED snapshot, never the cache (see `shownRef`).
          if (
            shownRef.current !== null &&
            JSON.stringify(shownRef.current) === JSON.stringify(snapshot)
          )
            return
          shownRef.current = snapshot
          setFromCache(false)
          setData(snapshot)
        },
      )
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(err instanceof ApiError ? err.message : 'Could not load the overview.')
      })
      .finally(() => {
        if (seq === seqRef.current) setBusy(false)
      })
  }, [owner, snapshotKey])

  // Adopting an owner change, adjust-during-render (CategoriesPanel's precedent, and the
  // shape Net worth uses): the effect below must not refetch silently — the body dims, and
  // an already-seen scope paints instantly and revalidates underneath. `shownRef` stays out
  // of this: a ref write belongs in a promise continuation, and leaving it on the previous
  // scope only costs one extra repaint when the live payload lands. It sits HERE, after
  // load(), because a render-phase setState ahead of that useCallback costs the React
  // Compiler its stable-setter inference (react-hooks/preserve-manual-memoization).
  const [seenOwner, setSeenOwner] = useState<OwnerScope>(owner)
  if (owner !== seenOwner) {
    setSeenOwner(owner)
    setBusy(true)
    const peeked = getSnapshot<OverviewData>(snapshotKey)
    if (peeked !== undefined) {
      setFromCache(true)
      setData(peeked)
    }
  }

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    loadUpNext()
    loadFlow(null)
    // mount-only: these two are household-wide and never re-run on a scope change; both
    // are plain functions over stable setters (house idiom).
  }, [])

  // The busy flag is raised by the CALLERS, never inside load(): load() runs in the mount
  // effect's synchronous body, where a setState is a house react-hooks violation.
  const reload = () => {
    setBusy(true)
    load()
    loadUpNext()
    loadFlow(flowYear)
  }

  // The only memoized values on the page — EChart keys its setOption effect on [option],
  // so a fresh object every render would redraw all three charts on every keystroke
  // elsewhere. Everything else below is a plain const.
  const nwTrend = useMemo(() => (data ? netWorthTrendOption(data.ts) : null), [data])
  const perf = useMemo(
    () =>
      data ? portfolioHistoryOption(data.history, liveFromHoldings(data.holdings)) : null,
    [data],
  )
  const bars = useMemo(() => (data ? recentSpendOption(data.matrix) : null), [data])

  // 2026-08-25 spec §2d: each chart clicks through to the page that owns its numbers;
  // the bars carry the clicked month into /spending's ?month= drill deep link, mapped
  // back through the option's own trailing-12 slice.
  const openSpendingMonth = (params: EChartEventParams) => {
    if (!data || typeof params.dataIndex !== 'number') return
    const months = data.matrix.months
    const month = months[Math.max(0, months.length - RECENT_SPEND_MONTHS) + params.dataIndex]
    if (month) navigate(`/spending?month=${month}`)
  }

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
        {
          months: data.ts.months,
          holdings: data.holdings,
          lots: data.lots,
          taxYears: data.taxYears,
          system: data.system,
        },
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

  // Two cards the owner scope cannot reach: /spending/matrix has no owner dimension, and
  // the weekly /portfolio/history checkpoints are household-wide. Saying so beats a silent
  // number that looks filtered.
  const spendingHint =
    owner === null ? SPENDING_HINT : `${SPENDING_HINT} Household total — spending has no owner.`
  const performanceHint =
    owner === null
      ? PERFORMANCE_HINT
      : `${PERFORMANCE_HINT} Household history; owner scope does not apply to the weekly checkpoints.`

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
      <PageFrame
        title="Overview"
        actions={
          /* Nothing but idempotent GETs and no mutation anywhere on this page, so the
             button stays live while a load is in flight: an impatient second click is
             harmless, the body dims to show the work, and seqRef decides which answer
             lands. */
          <button type="button" className="button" onClick={reload}>
            Refresh
          </button>
        }
        scopeRow={<ScopeBar owner />}
        resource={{
          // A failed FIRST load is the frame's alert alone rather than a page of $0.00
          // tiles that reads as "you are broke" (PortfolioPage posture); a failed RELOAD
          // keeps the previous payload up under the frame's stale line.
          status: data === null ? (error !== null ? 'error' : 'loading') : 'ready',
          error,
          busy,
          fromCache,
          retry: reload,
        }}
        skeleton={{
          tiles: 4,
          cards: [
            { span: 12, height: 220 },
            { span: 12, height: 280 },
            { span: 12, height: 240 },
            { span: 12, height: 200 },
          ],
        }}
      >
        {data !== null && (
          <>
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
                // A FRESH-paint flourish only: a cached paint is a number the user has already
                // seen, and re-counting it would fake newness. Money rides the wire as a decimal
                // string, hence Number() for the easing math — the last frame drops the override
                // and renders `value` itself, so the end state is the string above verbatim.
                countUp={
                  !fromCache && summary?.net_worth != null
                    ? { value: Number(summary.net_worth), format: formatCurrency }
                    : undefined
                }
                // Both halves or neither: a bare amount with no rate reads as a total.
                delta={
                  summary?.mom_delta != null && summary.mom_pct != null
                    ? `${formatCurrency(summary.mom_delta)} (${formatPct(summary.mom_pct)}) MoM`
                    : undefined
                }
                tone={toneOf(summary?.mom_delta)}
                hint="Assets minus liabilities from the latest monthly snapshot, with its change from the month before."
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
                hint="Market value of every priced holding at the latest quotes, and today's move vs the prior close."
              />
              <StatTile
                label={stats?.month ? `Spending — ${formatMonth(stats.month)}` : 'Spending'}
                value={cashflowOnly ? '—' : formatCurrency(stats?.total)}
                delta={spendDelta?.text}
                tone={spendDelta?.tone}
                direction={spendDelta?.direction}
                hint={spendingHint}
              />
              {/* A rate is a level, not a movement: no delta, no arrow. */}
              <StatTile
                label={taxLabel}
                value={tax === null ? '—' : formatPct(tax.totals.effective_rate, { signed: false })}
                hint="Total tax ÷ gross income from the tax engine, for the year named in the label."
              />
            </div>
            {showYtd && ytd && (
              <section className="card ytd-card">
                <h2 className="eyebrow">
                  Year to date — {ytd.year}
                  <InfoHint text="The year so far: net-worth change since the last pre-January snapshot, plus spend, net pay, savings rate, and dividends." />
                </h2>
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
              <ChartCard
                title="Net worth trend"
                hint="Net worth at every monthly snapshot — the series the Net Worth page breaks down by group."
                ariaLabel="Line chart of net worth at every monthly snapshot"
                option={nwTrend}
                empty="No snapshots yet."
                exportName="net-worth-trend"
                csv={() => netWorthTrendCsv(data.ts)}
                height={220}
                onClick={() => navigate('/net-worth')}
                footer={
                  <NavLink className="drill-hint" to="/net-worth">
                    Open net worth →
                  </NavLink>
                }
              />
              <ChartCard
                title="Portfolio performance"
                hint={performanceHint}
                ariaLabel="Line chart of portfolio value against cost basis and benchmark lines, weekly"
                option={perf}
                empty="No performance history yet."
                exportName="portfolio-performance"
                csv={() => portfolioHistoryCsv(data.history)}
                height={280}
                onClick={() => navigate('/portfolio')}
                footer={
                  <NavLink className="drill-hint" to="/portfolio">
                    Open portfolio →
                  </NavLink>
                }
              />
              <ChartCard
                title="Recent spending"
                // The dashed line is spendStats.avg12 (the twelve months BEFORE the
                // latest), which is also the figure the spend tile compares against — the
                // hint has to name that window, not "their average", or one label reads as
                // two numbers (F14).
                hint="Total spend for each of the last 12 entered months. The dashed line is the average of the 12 months before the latest — the same figure the spend tile compares this month against."
                ariaLabel="Bar chart of total spending for each of the last 12 entered months, with the 12-month average"
                option={bars}
                empty="No spending months yet."
                exportName="recent-spending"
                csv={() => recentSpendCsv(data.matrix)}
                height={240}
                onClick={openSpendingMonth}
                footer={
                  <NavLink className="drill-hint" to="/spending">
                    Open spending →
                  </NavLink>
                }
              />
              <MoneyFlowCard
                flow={flow}
                failed={flowFailed}
                onRetry={() => loadFlow(flowYear)}
                onYearChange={showFlowYear}
              />
            </div>
            <div className="up-next">
              <h2 className="eyebrow">
                Up next
                <InfoHint text="The next few dated events — vests, ESPP dates, ex-dividends, paydays, deadlines — from the calendar." />
              </h2>
              {upNextFailed ? (
                <p className="drill-hint">Couldn&apos;t load upcoming events.</p>
              ) : upNext === null ? null : upNextItems(upNext, todayIso()).length === 0 ? (
                <p className="drill-hint">
                  Nothing scheduled in the next {UP_NEXT_WINDOW_DAYS} days.
                </p>
              ) : (
                <ul className="up-next-list">
                  {upNextItems(upNext, todayIso()).map((event) => (
                    <li key={eventKey(event)}>
                      {event.href !== null ? (
                        <NavLink to={event.href} className="up-next-link">
                          <span className="up-next-date">{formatDate(event.date)}</span>{' '}
                          {event.label}
                        </NavLink>
                      ) : (
                        // Custom events are informational — no page to open (spec §9.2).
                        <span className="up-next-link up-next-plain">
                          <span className="up-next-date">{formatDate(event.date)}</span>{' '}
                          {event.label}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <NavLink className="drill-hint" to="/calendar">
                Open calendar →
              </NavLink>
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
          </>
        )}
      </PageFrame>
    </div>
  )
}
