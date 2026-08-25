import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { ApiError } from '../api/client'
import {
  fetchAllocation,
  fetchDividends,
  fetchHistory,
  fetchHoldings,
  fetchRealized,
  fetchSecurities,
  fetchTransactions,
  updateSecurity,
} from '../api/portfolio'
import { fetchRefreshStatus, fetchSparklines, refreshPrices } from '../api/prices'
import EChart from '../components/EChart'
import InfoHint from '../components/InfoHint'
import AllocationPanel from '../components/portfolio/AllocationPanel'
import DividendsPanel from '../components/portfolio/DividendsPanel'
import { buildEventMarkers, liveFromHoldings, portfolioHistoryOption } from '../components/portfolio/historyChartOptions'
import HoldingDetailPanel from '../components/portfolio/HoldingDetailPanel'
import HoldingsTable from '../components/portfolio/HoldingsTable'
import RealizedPanel from '../components/portfolio/RealizedPanel'
import SecuritiesPanel from '../components/portfolio/SecuritiesPanel'
import TransactionsPanel from '../components/portfolio/TransactionsPanel'
import RangeChips from '../components/RangeChips'
import StatTile from '../components/StatTile'
import { rangeZoom } from '../charts/timeZoom'
import type { RangeState, ZoomWindow } from '../charts/timeZoom'
import type {
  AllocationResponse,
  DividendOut,
  HoldingsResponse,
  PortfolioHistory,
  RealizedResponse,
  RefreshResult,
  RefreshStatus,
  SecurityOut,
  SparklinesResponse,
  TransactionOut,
} from '../types/api'
import { formatCurrency, formatDate, formatDateTime, formatPct } from '../utils/format'
import { toneOf } from '../utils/tone'
import '../components/panels.css'
import '../components/portfolio/portfolio.css'
import './PortfolioPage.css'

type Tab = 'transactions' | 'dividends' | 'securities' | 'realized'

// A whole-book failure would otherwise paste ~37 tickers into the header note.
const MAX_FAILED_SHOWN = 5

interface RefreshNote {
  text: string
  detail: string
  failed: number
}

const NO_NOTE: RefreshNote = { text: '', detail: '', failed: 0 }

function describeRefresh(result: RefreshResult): RefreshNote {
  const failed = Object.entries(result.failed)
  const shown = failed.slice(0, MAX_FAILED_SHOWN).map(([ticker]) => ticker)
  const more = failed.length - shown.length
  return {
    text:
      `${result.updated.length} updated` +
      (failed.length > 0
        ? `, ${failed.length} failed (${shown.join(', ')}${more > 0 ? `, +${more} more` : ''})`
        : '') +
      (result.skipped_manual.length > 0
        ? `, ${result.skipped_manual.length} manual skipped`
        : '') +
      // Only when the run actually wrote some: a steady-state refresh between ex-dates
      // ingests nothing, and ", 0 dividends logged" would read as a failure.
      (result.dividends_ingested > 0
        ? `, ${result.dividends_ingested} dividends logged`
        : '') +
      ` in ${Math.round(result.duration_ms / 1000)}s`,
    // Per-ticker reasons ride in the title attribute — React escapes attribute values, so
    // provider error text cannot inject markup (the RefreshOut.failed escaping note).
    detail: failed.map(([ticker, reason]) => `${ticker}: ${reason}`).join('\n'),
    failed: failed.length,
  }
}

export default function PortfolioPage() {
  const [holdings, setHoldings] = useState<HoldingsResponse | null>(null)
  const [securities, setSecurities] = useState<SecurityOut[]>([])
  const [transactions, setTransactions] = useState<TransactionOut[]>([])
  const [dividends, setDividends] = useState<DividendOut[]>([])
  const [industry, setIndustry] = useState<AllocationResponse | null>(null)
  const [byType, setByType] = useState<AllocationResponse | null>(null)
  const [byAccount, setByAccount] = useState<AllocationResponse | null>(null)
  const [sparklines, setSparklines] = useState<SparklinesResponse>({})
  const [history, setHistory] = useState<PortfolioHistory | null>(null)
  const [realized, setRealized] = useState<RealizedResponse | null>(null)
  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus | null>(null)
  // Ticker being deactivated from the failed-refresh row (the old manual-psql ritual for
  // a delisted symbol, one click now); single-flight like the panels' busy flags.
  const [deactivating, setDeactivating] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('transactions')
  // Performance-chart window; object identity so a re-click of the active chip snaps a
  // ctrl+wheel wander back to the preset (NetWorthPage's `range`) — and it now carries
  // any manual window mirrored back from the chart's datazoom event (spec §2e).
  const [range, setRange] = useState<RangeState>({ preset: 'all' })
  // Mirrors of the chart's own events (2026-08-25 spec §2e): legend picks and a manual
  // ctrl+wheel window become page state, fed back through the memoized option, so a
  // reload or notMerge rebuild no longer resets them.
  const [legendSelected, setLegendSelected] = useState<Record<string, boolean>>({})
  const onLegendChange = (selected: Record<string, boolean>) => setLegendSelected(selected)
  const onZoomWindow = (nextWindow: ZoomWindow) =>
    setRange((current) => ({ preset: current.preset, window: nextWindow }))
  // Holdings drill-in: the TICKER whose detail panel is open (never an index — a reload
  // that resorts the table cannot mis-target, and a ticker that vanished simply finds no
  // holding and the panel folds away: SpendingPage's detailMonth posture).
  const [detailTicker, setDetailTicker] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloading, setReloading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshNote, setRefreshNote] = useState<RefreshNote>(NO_NOTE)
  const [error, setError] = useState<string | null>(null)
  // Four things trigger a load (mount, refresh, three panels' onChanged) and the eleven
  // requests are not ordered — a slow earlier load must never overwrite a later one.
  const seqRef = useRef(0)

  // Promise callbacks, no setState in the effect's synchronous body — house react-hooks
  // law (see NetWorthPage). One load() refetches EVERYTHING: eleven cheap local queries,
  // and every mutation path (panels' onChanged, refresh) converges through it. Returns
  // the chain so callers can keep their own busy flag up until the data is on screen.
  const load = () => {
    const seq = ++seqRef.current
    return Promise.all([
      fetchHoldings(),
      fetchSecurities(),
      fetchTransactions(),
      fetchDividends(),
      fetchAllocation('industry'),
      fetchAllocation('type'),
      fetchAllocation('account'),
      fetchSparklines(),
      fetchHistory(),
      fetchRealized(),
      fetchRefreshStatus(),
    ])
      .then(([h, secs, txns, divs, ind, typ, acct, spark, hist, real, status]) => {
        if (seq !== seqRef.current) return
        setHoldings(h)
        setSecurities(secs)
        setTransactions(txns)
        setDividends(divs)
        setIndustry(ind)
        setByType(typ)
        setByAccount(acct)
        setSparklines(spark)
        setHistory(hist)
        setRealized(real)
        setRefreshStatus(status)
        setError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(err instanceof ApiError ? err.message : 'Failed to load portfolio data')
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false)
      })
  }

  // Panel mutations refetch WITHOUT unmounting the panels (a spinner swap would throw
  // away the form the user is typing in) — the body dims instead.
  const reload = () => {
    setReloading(true)
    load().finally(() => setReloading(false))
  }

  // Mount-only fetch. react-hooks 7 reports nothing here (load is re-created per render
  // but reads no reactive value beyond the setters), so an exhaustive-deps suppression
  // would be an unused directive — which ESLint 9 flat config warns about by default.
  useEffect(() => {
    load()
  }, [])

  const onRefresh = () => {
    setRefreshing(true)
    setRefreshNote(NO_NOTE)
    setError(null)
    refreshPrices()
      .then((result) => {
        setRefreshNote(describeRefresh(result))
        // Returned, not fired-and-forgotten: the button re-enables only once the fresh
        // prices are actually on screen.
        return load()
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Price refresh failed')
      })
      .finally(() => setRefreshing(false))
  }

  const totals = holdings?.totals
  const asOf = holdings?.as_of ?? null

  // The SERVER already scopes `failed` to tickers a future refresh would still attempt
  // (active, auto-priced) — one rule on one side of the wire, so a deactivation clears
  // this chip AND the Overview strip's item on their next fetch alike.
  const failedEntries = Object.entries(refreshStatus?.last?.failed ?? {})

  const deactivate = (ticker: string) => {
    const security = securities.find((s) => s.ticker === ticker)
    if (security === undefined || deactivating !== null) return
    setDeactivating(ticker)
    updateSecurity(security.id, { is_active: false })
      .then(() => load())
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : `Failed to deactivate ${ticker}`)
      })
      .finally(() => setDeactivating(null))
  }

  // The page's only memoized values (OverviewPage's rule): EChart keys its setOption
  // effect on [option], so a fresh object per render would redraw the chart on every tab
  // click. The zoom is spread on here rather than inside the builder, which stays pure and
  // shared with OverviewPage (whose copy is a fixed snapshot, no chips).
  const performanceOption = useMemo(() => {
    if (!history || !holdings) return null
    // Markers come from the ledgers this page ALREADY fetches in the same Promise.all —
    // Overview keeps the two-arg call and never starts fetching them (spec Decision log).
    const tickerById = new Map(securities.map((s) => [s.id, s.ticker]))
    const events = buildEventMarkers(history, transactions, dividends, tickerById)
    const base = portfolioHistoryOption(history, liveFromHoldings(holdings), events)
    return base === null
      ? null
      : {
          ...base,
          // The builder's legend is a plain {top: 0}, shared verbatim with OverviewPage
          // (which has no picks to persist) — the page layers its mirrors over it here.
          legend: { top: 0, selected: legendSelected },
          // startValue indexes history.dates; the appended live category sits at the
          // END, so the indices are unshifted and the window runs out to the ping.
          dataZoom: rangeZoom(history.dates, range),
        }
  }, [history, holdings, securities, transactions, dividends, range, legendSelected])

  // The open row's holding, resolved fresh from every reload so the panel always shows
  // the CURRENT figures; a sold-off ticker resolves to null and the panel folds away.
  const detailHolding = useMemo(
    () => holdings?.holdings.find((h) => h.ticker === detailTicker) ?? null,
    [holdings, detailTicker],
  )

  return (
    <div className="page portfolio-page">
      <header className="page-header">
        <h1>Portfolio</h1>
        <div className="header-actions">
          {asOf ? (
            <span className="as-of">prices as of {formatDate(asOf)}</span>
          ) : (
            <span className="as-of">prices never refreshed</span>
          )}
          <button type="button" className="refresh-btn" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? 'spin' : undefined} />
            {refreshing ? 'Refreshing…' : 'Refresh prices'}
          </button>
        </div>
      </header>
      {/* One element, always mounted: a live region added at announce-time is not read.
          Partial failures are an alert, not a status — they need the user's attention. */}
      <div
        className={refreshNote.failed > 0 ? 'hint refresh-note-bad' : 'hint'}
        role={refreshNote.failed > 0 ? 'alert' : 'status'}
        title={refreshNote.detail || undefined}
      >
        {refreshNote.text}
      </div>
      {/* The scheduler, finally visible: what ran last (manual or scheduled — the outcome
          persists either way now) and when the next run fires. Wall-clock stamps, local
          time — these answer "when", not "which bar". */}
      {refreshStatus?.last && (
        <div className="hint refresh-status-line">
          Last refresh {formatDateTime(refreshStatus.last.at)} ({refreshStatus.last.trigger}) ·{' '}
          {refreshStatus.last.updated} updated
          {refreshStatus.last.failed && Object.keys(refreshStatus.last.failed).length > 0 && (
            <> · {Object.keys(refreshStatus.last.failed).length} failed</>
          )}
          {refreshStatus.next_run_at && <> · next {formatDateTime(refreshStatus.next_run_at)}</>}
        </div>
      )}
      {failedEntries.length > 0 && (
        <div className="refresh-failures">
          {failedEntries.map(([ticker, reason]) => (
            <span key={ticker} className="refresh-failure" title={reason}>
              {ticker}
              {/* One click retires the ZI ritual (README 7.4's manual is_active edit):
                  deactivating removes the ticker from every future refresh; the
                  Securities tab can always bring it back. */}
              <button
                type="button"
                aria-label={`Deactivate ${ticker} so refreshes skip it`}
                disabled={deactivating !== null}
                onClick={() => deactivate(ticker)}
              >
                {deactivating === ticker ? 'Deactivating…' : 'Deactivate'}
              </button>
            </span>
          ))}
        </div>
      )}
      {error && <div className="error-banner" role="alert">{error}</div>}
      {loading ? (
        <p className="empty-note">Loading…</p>
      ) : holdings ? (
        // A failed FIRST load leaves holdings null: show the error banner alone rather
        // than a page of empty tables that read as "you own nothing".
        <div className={`loading-dim${reloading ? ' is-loading' : ''}`}>
          {totals && (
            <div className="tiles-row">
              <StatTile
                label="Portfolio value"
                value={formatCurrency(totals.market_value)}
                delta={
                  totals.day_change_amount !== null || totals.day_change_pct !== null
                    ? `${formatCurrency(totals.day_change_amount)} today (${formatPct(totals.day_change_pct)})`
                    : undefined
                }
                tone={toneOf(totals.day_change_amount)}
                hint="Market value of every priced holding at the latest quotes."
                hero
              />
              <StatTile
                label="Unrealized gain"
                value={formatCurrency(totals.unrealized_gl)}
                delta={totals.unrealized_gl_pct !== null ? formatPct(totals.unrealized_gl_pct) : undefined}
                tone={toneOf(totals.unrealized_gl)}
                hint="Market value minus cost basis across current holdings."
              />
              {/* The totals field that never rendered anywhere until the Realized tab
                  landed — the tile is the headline, the tab below is the breakdown. */}
              <StatTile
                label="Realized gains"
                value={formatCurrency(totals.realized_gl)}
                tone={toneOf(totals.realized_gl)}
                hint="Lifetime gains and losses booked on sells, by the average-cost method."
              />
              <StatTile
                label="Cost basis"
                value={formatCurrency(totals.cost_basis)}
                hint="What the current holdings cost to acquire, fees included, average-cost method."
              />
              <StatTile
                label="Dividends collected"
                value={formatCurrency(totals.dividends_collected)}
                delta={`${formatCurrency(totals.annual_income)}/yr expected`}
                tone="neutral"
                hint="Every dividend logged — auto-ingested and manual — with the expected annual income at current rates."
              />
            </div>
          )}
          <section className="panel">
            <div className="panel-title-row">
              <h2 className="panel-title">
                Performance
                <InfoHint text="Value vs cost basis, checkpointed weekly after Monday's close. The pinging dot is the live value at the latest prices. The S&P 500 baseline invests only the starting balance; VOO (your contributions) invests every inferred contribution instead. Estimated: contributions inferred from weekly cost-basis changes; dividends excluded on the VOO leg." />
              </h2>
              {performanceOption && <RangeChips value={range.preset} onChange={setRange} />}
            </div>
            {performanceOption ? (
              <>
                <EChart
                  option={performanceOption}
                  height={300}
                  onLegendChange={onLegendChange}
                  onDataZoom={onZoomWindow}
                />
                {/* Two benchmark legs, one distinction: the baseline invests only the
                    STARTING balance; the contribution-matched line adds every inferred
                    flow. Said here so neither gap reads as outperformance. */}
                <p className="hint">
                  S&amp;P 500 baseline tracks the starting balance invested in VOO — later
                  contributions are not added to it. VOO (your contributions) adds each
                  inferred contribution as it lands.
                </p>
              </>
            ) : (
              <p className="empty-note">
                No performance history yet — import your workbook in Settings to load it.
              </p>
            )}
          </section>
          <section className="panel">
            <div className="panel-title-row">
              <h2 className="panel-title">
                {/* The section keeps its NAME while drilled — "where am I" survives the
                    swap (SpendingPage's header does the same dance). */}
                {detailHolding ? `Holdings — ${detailHolding.ticker}` : 'Holdings'}
                <InfoHint text="One row per held security: price, value, weight, gains, yields, and money-weighted return. XIRR needs dated transactions — imported rows have none until backfilled." />
              </h2>
              {detailHolding && (
                <button type="button" className="button" onClick={() => setDetailTicker(null)}>
                  All holdings
                </button>
              )}
            </div>
            {detailHolding ? (
              // IN PLACE of the table, not below it: a panel appended under ~25 rows was
              // born off-screen. Keyed by SECURITY so a remount resets the span to 1Y and
              // starts a fresh history feed (the taxes editors' keying lesson) — moot
              // while the table is hidden, load-bearing again the day the detail gains an
              // in-place way to switch tickers.
              <HoldingDetailPanel
                key={detailHolding.security_id}
                holding={detailHolding}
                transactions={transactions}
                dividends={dividends}
              />
            ) : (
              <>
                {totals && totals.unpriced_count > 0 && (
                  <p className="hint">
                    {totals.unpriced_count} holding(s) have no price yet — run a refresh or
                    set a manual price in Securities.
                  </p>
                )}
                <p className="drill-hint">Click a holding to expand its detail.</p>
                <HoldingsTable
                  holdings={holdings.holdings}
                  sparklines={sparklines}
                  selectedTicker={detailTicker}
                  // Functional toggle: normally the swap hides the table the moment a row
                  // is picked, but a vanished ticker leaves the table up with a stale
                  // selection — re-clicking that row must close, not reopen.
                  onSelect={(ticker) =>
                    setDetailTicker((current) => (current === ticker ? null : ticker))
                  }
                />
              </>
            )}
          </section>
          <AllocationPanel industry={industry} byType={byType} byAccount={byAccount} />
          {/* group, not tablist: these buttons toggle panels below rather than owning
              tabpanels, and the aria-labels keep "Dividends" from colliding with the
              holdings table's sort header of the same name. */}
          <div className="tab-row" role="group" aria-label="Portfolio records">
            {(['transactions', 'dividends', 'securities', 'realized'] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-label={`Show ${t}`}
                aria-pressed={tab === t}
                onClick={() => setTab(t)}
              >
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          {tab === 'transactions' && (
            <TransactionsPanel securities={securities} transactions={transactions} onChanged={reload} />
          )}
          {tab === 'dividends' && (
            <DividendsPanel
              securities={securities}
              dividends={dividends}
              annualIncome={totals?.annual_income ?? null}
              onChanged={reload}
            />
          )}
          {tab === 'securities' && <SecuritiesPanel securities={securities} onChanged={reload} />}
          {tab === 'realized' && realized && <RealizedPanel realized={realized} />}
        </div>
      ) : null}
    </div>
  )
}
