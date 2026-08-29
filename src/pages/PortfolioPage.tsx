import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { ApiError } from '../api/client'
import { fetchHousehold } from '../api/household'
import {
  fetchAllocation,
  fetchDividendEvents,
  fetchDividends,
  fetchHistory,
  fetchHoldings,
  fetchRealized,
  fetchSecurities,
  fetchTransactions,
  updateSecurity,
} from '../api/portfolio'
import type { OwnerScope } from '../api/portfolio'
import { fetchRefreshStatus, fetchSparklines, refreshPrices } from '../api/prices'
import { getSnapshot, setSnapshot } from '../api/snapshotCache'
import ChartZoomHint from '../components/ChartZoomHint'
import EChart from '../components/EChart'
import InfoHint from '../components/InfoHint'
import AllocationPanel from '../components/portfolio/AllocationPanel'
import DividendsPanel from '../components/portfolio/DividendsPanel'
import {
  buildEventMarkers,
  liveFromHoldings,
  portfolioHistoryCsv,
  portfolioHistoryOption,
} from '../components/portfolio/historyChartOptions'
import HoldingDetailPanel from '../components/portfolio/HoldingDetailPanel'
import HoldingsTable from '../components/portfolio/HoldingsTable'
import RealizedPanel from '../components/portfolio/RealizedPanel'
import SecuritiesPanel from '../components/portfolio/SecuritiesPanel'
import TransactionsPanel from '../components/portfolio/TransactionsPanel'
import RangeChips from '../components/RangeChips'
import PageSkeleton from '../components/PageSkeleton'
import StatTile from '../components/StatTile'
import { useArrivalParam } from '../components/useArrivalParam'
import { rangeZoom, resolvedWindow } from '../charts/timeZoom'
import type { RangeState, ZoomWindow } from '../charts/timeZoom'
import type {
  AllocationResponse,
  DividendEventOut,
  DividendOut,
  HoldingsResponse,
  HouseholdOut,
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

// The ?tab= arrival vocabulary: the three non-default tabs (arriving at the default
// needs no command). Module-level so the hook's deps stay identity-stable.
const TAB_ARRIVALS: readonly Tab[] = ['dividends', 'securities', 'realized']

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
  // `listed`, not `shown`: the page's `shown` ref (below) is the rendered snapshot, and
  // two different meanings under one name is how a future edit picks the wrong one.
  const listed = failed.slice(0, MAX_FAILED_SHOWN).map(([ticker]) => ticker)
  const more = failed.length - listed.length
  return {
    text:
      `${result.updated.length} updated` +
      (failed.length > 0
        ? `, ${failed.length} failed (${listed.join(', ')}${more > 0 ? `, +${more} more` : ''})`
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

// Keyed by the fetch parameters, exactly like NetWorthPage's netWorthKey: an owner switch
// is a DIFFERENT snapshot. 'all' spells the household view so the key can never collide
// with a person id.
function portfolioKey(owner: OwnerScope): string {
  return `portfolio:${owner ?? 'all'}`
}

interface PortfolioSnapshot {
  holdings: HoldingsResponse
  securities: SecurityOut[]
  transactions: TransactionOut[]
  dividends: DividendOut[]
  dividendEvents: DividendEventOut[]
  industry: AllocationResponse
  byType: AllocationResponse
  byAccount: AllocationResponse
  sparklines: SparklinesResponse
  history: PortfolioHistory
  realized: RealizedResponse
  refreshStatus: RefreshStatus
}

export default function PortfolioPage() {
  // The initial fetch scope is the whole household, so the mount seed reads exactly the
  // key that mount's load() will write.
  const cached = getSnapshot<PortfolioSnapshot>(portfolioKey(null))
  const [holdings, setHoldings] = useState<HoldingsResponse | null>(cached?.holdings ?? null)
  const [securities, setSecurities] = useState<SecurityOut[]>(cached?.securities ?? [])
  const [transactions, setTransactions] = useState<TransactionOut[]>(cached?.transactions ?? [])
  const [dividends, setDividends] = useState<DividendOut[]>(cached?.dividends ?? [])
  const [dividendEvents, setDividendEvents] = useState<DividendEventOut[]>(
    cached?.dividendEvents ?? [],
  )
  const [industry, setIndustry] = useState<AllocationResponse | null>(cached?.industry ?? null)
  const [byType, setByType] = useState<AllocationResponse | null>(cached?.byType ?? null)
  const [byAccount, setByAccount] = useState<AllocationResponse | null>(
    cached?.byAccount ?? null,
  )
  const [sparklines, setSparklines] = useState<SparklinesResponse>(cached?.sparklines ?? {})
  const [history, setHistory] = useState<PortfolioHistory | null>(cached?.history ?? null)
  const [realized, setRealized] = useState<RealizedResponse | null>(cached?.realized ?? null)
  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus | null>(
    cached?.refreshStatus ?? null,
  )
  // Ticker being deactivated from the failed-refresh row (the old manual-psql ritual for
  // a delisted symbol, one click now); single-flight like the panels' busy flags.
  const [deactivating, setDeactivating] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('transactions')
  // Arrival deep link (?tab=dividends — the palette's "Add dividend" lands on the
  // dividends ledger, spec §4 item 9). A hook, not a useState initializer: the palette
  // can fire the navigate while this page is ALREADY mounted, where an initializer
  // never re-runs. The param is consumed (stripped) after applying; the tab strip
  // itself never writes the URL.
  useArrivalParam('tab', TAB_ARRIVALS, setTab)
  // Performance-chart window; object identity so a re-click of the active chip snaps a
  // ctrl+wheel wander back to the preset (NetWorthPage's `range`) — and it now carries
  // any manual window mirrored back from the chart's datazoom event (spec §2e).
  const [range, setRange] = useState<RangeState>({ preset: 'all' })
  // Mirrors of the chart's own events (2026-08-25 spec §2e): legend picks and a manual
  // ctrl+wheel window become page state, fed back through the memoized option, so a
  // reload or notMerge rebuild no longer resets them.
  const [legendSelected, setLegendSelected] = useState<Record<string, boolean>>({})
  // MERGED, never replaced. One chart mirrors here today, so this is equivalent — it is
  // written the sibling pages' way so a second mirroring chart cannot silently
  // reintroduce their cross-chart clobber (a stale key is inert in legend.selected).
  const onLegendChange = (selected: Record<string, boolean>) =>
    setLegendSelected((current) => ({ ...current, ...selected }))
  const onZoomWindow = (nextWindow: ZoomWindow) =>
    setRange((current) => ({ preset: current.preset, window: nextWindow }))
  // Holdings drill-in: the TICKER whose detail panel is open (never an index — a reload
  // that resorts the table cannot mis-target, and a ticker that vanished simply finds no
  // holding and the panel folds away: SpendingPage's detailMonth posture).
  const [detailTicker, setDetailTicker] = useState<string | null>(null)
  // The page's ownership scope: null = the whole household (and NO owner param at all, so
  // the requests stay byte-identical to the pre-ownership ones). It scopes the tiles, the
  // holdings table, the allocation charts and the three record tabs — which is why the
  // chips sit under the page header rather than inside one card.
  const [owner, setOwner] = useState<OwnerScope>(null)
  // Fetched on its own, never inside the page's Promise.all: the chips are an affordance,
  // and a household hiccup must not blank the portfolio (NetWorthPage's isolated-fetch
  // posture). null covers both "not loaded yet" and "failed".
  const [household, setHousehold] = useState<HouseholdOut | null>(null)
  // Seeded off the cache: the `loading ?` render branch must not swallow a seeded paint.
  const [loading, setLoading] = useState(cached === undefined)
  // false once a revalidation actually CHANGES the data — charts may animate again.
  const [fromCache, setFromCache] = useState(cached !== undefined)
  // Seeded off the cache like `loading`: a cache hit paints full and revalidates under the
  // reload dim. Seeded rather than flipped by the mount effect because reload()'s
  // setReloading(true) would be a synchronous setState in an effect body (react-hooks v7).
  const [reloading, setReloading] = useState(cached !== undefined)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshNote, setRefreshNote] = useState<RefreshNote>(NO_NOTE)
  const [error, setError] = useState<string | null>(null)
  // Four things trigger a load (mount, refresh, three panels' onChanged) and the twelve
  // requests are not ordered — a slow earlier load must never overwrite a later one.
  const seqRef = useRef(0)
  // What the page is actually SHOWING. The revalidation skip in load() is judged against
  // this, never against the snapshot cache: render and cache diverge across an owner
  // switch (the previous scope's panels are still up while the next scope's key is warm),
  // and skipping on the cache stranded the page on the previous scope forever (the
  // 2026-08-28 bug NetWorthPage fixed @9e20d15 — no cache-compared skips, house rule).
  const shown = useRef<PortfolioSnapshot | null>(cached ?? null)

  // The ONLY place a snapshot reaches the page — load()'s apply and selectOwner's peek both come through here; add new PortfolioSnapshot slots HERE.
  // useCallback with an empty dep list: useState setters and the ref are identity-stable,
  // so this stays stable and `load` below keeps changing identity ONLY with the scope (a
  // fresh identity per render would re-fire the mount effect on every render).
  const applySnapshot = useCallback((snap: PortfolioSnapshot, fromCache: boolean) => {
    shown.current = snap
    setFromCache(fromCache)
    setHoldings(snap.holdings)
    setSecurities(snap.securities)
    setTransactions(snap.transactions)
    setDividends(snap.dividends)
    setDividendEvents(snap.dividendEvents)
    setIndustry(snap.industry)
    setByType(snap.byType)
    setByAccount(snap.byAccount)
    setSparklines(snap.sparklines)
    setHistory(snap.history)
    setRealized(snap.realized)
    setRefreshStatus(snap.refreshStatus)
  }, [])

  // Promise callbacks, no setState in the effect's synchronous body — house react-hooks
  // law (see NetWorthPage). One load() refetches EVERYTHING: twelve cheap local queries,
  // and every mutation path (panels' onChanged, refresh) converges through it. Returns
  // the chain so callers can keep their own busy flag up until the data is on screen.
  // useCallback over [owner] because the mount effect keys on it: flipping the scope IS
  // what re-runs the effect, and exhaustive-deps requires the dependency now that load
  // reads a reactive value.
  const load = useCallback(() => {
    const seq = ++seqRef.current
    return Promise.all([
      fetchHoldings(owner),
      fetchSecurities(),
      fetchTransactions(owner),
      fetchDividends(owner),
      fetchAllocation('industry', owner),
      fetchAllocation('type', owner),
      fetchAllocation('account', owner),
      fetchSparklines(),
      fetchHistory(),
      fetchRealized(owner),
      fetchRefreshStatus(),
      fetchDividendEvents(),
    ])
      .then(([h, secs, txns, divs, ind, typ, acct, spark, hist, real, status, divEvents]) => {
        if (seq !== seqRef.current) return
        const snapshot: PortfolioSnapshot = {
          holdings: h,
          securities: secs,
          transactions: txns,
          dividends: divs,
          dividendEvents: divEvents,
          industry: ind,
          byType: typ,
          byAccount: acct,
          sparklines: spark,
          history: hist,
          realized: real,
          refreshStatus: status,
        }
        setSnapshot(portfolioKey(owner), snapshot)
        setError(null)
        // Identical payload: nothing re-renders, the charts stay still (spec §1) — judged
        // against the RENDERED snapshot, never the cache (see `shown`).
        if (shown.current !== null && JSON.stringify(shown.current) === JSON.stringify(snapshot))
          return
        applySnapshot(snapshot, false)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(err instanceof ApiError ? err.message : 'Failed to load portfolio data')
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false)
      })
  }, [owner, applySnapshot])

  // Panel mutations refetch WITHOUT unmounting the panels (a spinner swap would throw
  // away the form the user is typing in) — the body dims instead.
  const reload = () => {
    setReloading(true)
    load().finally(() => setReloading(false))
  }

  // Scope switches dim the body rather than swapping in the skeleton: a chip must not
  // unmount the panels (and the tab the user is reading) under them.
  const selectOwner = (next: OwnerScope) => {
    if (next === owner) return
    setReloading(true)
    setError(null)
    // The open drill-in holds a TICKER the next scope may not own — close it rather than
    // leave a detail panel resolving to null.
    setDetailTicker(null)
    // Already-seen scope: paint it instantly and revalidate underneath (NetWorthPage's
    // selectOwner). Seeding `shown` here is what keeps load()'s equality skip truthful —
    // the guard is about what is RENDERED, and the destination payload is about to be it.
    const peeked = getSnapshot<PortfolioSnapshot>(portfolioKey(next))
    if (peeked !== undefined) applySnapshot(peeked, true)
    setOwner(next)
  }

  // Mount AND every owner switch: `load` changes identity with the scope, which is what
  // re-runs this effect. A cache hit revalidates under the reload dim (raised by
  // `reloading`'s initializer on mount, by selectOwner on a switch); the trailing release
  // is a no-op on a cold mount, where `reloading` never went up.
  useEffect(() => {
    load().finally(() => setReloading(false))
  }, [load])

  // Once per visit, and deliberately not part of `load`: setState lives in the promise
  // continuations, never in the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    fetchHousehold()
      .then(setHousehold)
      .catch(() => setHousehold(null))
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

  // Primary first, then everyone else by id — the same order the server uses, so these
  // chips read left-to-right like the net-worth ones. The `?? []` lives INSIDE the memo: a
  // fresh literal in the dep list would re-sort on every render, which is the memo doing
  // nothing.
  const orderedPeople = useMemo(
    () =>
      [...(household?.people ?? [])].sort(
        (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.id - b.id,
      ),
    [household],
  )
  // One person means there is nothing to choose between: no chips at all.
  const ownerScopes: { scope: OwnerScope; label: string }[] =
    orderedPeople.length > 1
      ? [
          { scope: null, label: 'All' },
          ...orderedPeople.map((p) => ({ scope: p.id as OwnerScope, label: p.name })),
          { scope: 'joint' as OwnerScope, label: 'Joint' },
        ]
      : []

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
    const events = buildEventMarkers(history, transactions, dividends, tickerById, dividendEvents)
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
  }, [history, holdings, securities, transactions, dividends, dividendEvents, range, legendSelected])

  // Resolved target for EChart's animated zoom path — memoized so the wrapper's
  // fingerprint compare runs only when the window can actually have moved. Reads the
  // BUILT option's axis, not history.dates: the live ping appends one category past
  // the dates (portfolioHistoryOption's extendAxis), and a preset window must resolve
  // out to it — a dates-derived end index would clip "now" off the chart.
  const zoomWindow = useMemo(() => {
    if (history === null || performanceOption === null) return undefined
    const axis = (performanceOption.xAxis as { data?: unknown[] }).data ?? []
    return resolvedWindow(history.dates, range, axis.length)
  }, [history, performanceOption, range])

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
      {ownerScopes.length > 0 && (
        <div className="portfolio-owner-row">
          <span className="eyebrow">Whose money</span>
          <div className="segmented" role="group" aria-label="Owner">
            {ownerScopes.map(({ scope, label }) => (
              <button
                key={label}
                type="button"
                className={owner === scope ? 'active' : ''}
                aria-pressed={owner === scope}
                onClick={() => selectOwner(scope)}
              >
                {label}
              </button>
            ))}
          </div>
          <InfoHint text="A person's view is their own portfolio accounts plus the joint ones — that is what a joint account is. Joint shows only the shared accounts. Performance, sparklines and price refresh always cover the whole household." />
        </div>
      )}
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
        <PageSkeleton
          tiles={4}
          cards={[
            { span: 12, height: 340 },
            { span: 12, height: 300 },
          ]}
        />
      ) : holdings ? (
        // A failed FIRST load leaves holdings null: show the error banner alone rather
        // than a page of empty tables that read as "you own nothing".
        <div className={`loading-dim${reloading ? ' is-loading' : ''}`}>
          {totals && (
            <div className="tiles-row">
              <StatTile
                label="Portfolio value"
                value={formatCurrency(totals.market_value)}
                // Fresh paints only (spec §8); a decimal-string amount, so Number() for the ease.
                countUp={
                  !fromCache
                    ? { value: Number(totals.market_value), format: formatCurrency }
                    : undefined
                }
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
                <InfoHint text="Value vs cost basis, checkpointed weekly after Monday's close. The pinging dot is the live value at the latest prices. The S&P 500 baseline invests only the starting balance; VOO (your contributions) invests every inferred contribution instead. Estimated: contributions inferred from weekly cost-basis changes; dividends excluded on the VOO leg. Event markers annotate dated buys and sells, logged dividends, and older ex-dividend dates (per-share only — dollar amounts that old are unknowable from undated imports)." />
              </h2>
              {performanceOption && <RangeChips value={range.preset} onChange={setRange} />}
            </div>
            {/* Outside the ternary on purpose: the caveat is true whether or not there is
                a history to draw, and it only appears once a chip has actually narrowed
                the rest of the page (spec §5 — on All it would be noise). */}
            {owner !== null && (
              <p className="hint">
                Performance, sparklines and price refresh always cover the whole household —
                the owner chips scope holdings, allocation, dividends, transactions and
                realized gains.
              </p>
            )}
            {performanceOption && history ? (
              <>
                <EChart
                  option={performanceOption}
                  height={300}
                  onLegendChange={onLegendChange}
                  onDataZoom={onZoomWindow}
                  zoomWindow={zoomWindow}
                  exportConfig={{
                    name: 'portfolio-performance',
                    csv: () => portfolioHistoryCsv(history),
                  }}
                  animateEntrance={!fromCache}
                />
                <ChartZoomHint />
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
