import { useDetailPanel } from '../components/details/DetailPanelProvider'
import { LocalSectionNav, LocalSectionPanel, useLocalSections } from '../components/shell/LocalSections'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { ApiError, describeError } from '../api/client'
import { fetchHousehold } from '../api/household'
import {
  fetchAllocation,
  fetchDividendEvents,
  fetchDividends,
  fetchHistory,
  fetchHoldings,
  fetchPortfolioAccounts,
  fetchRealized,
  fetchSecurities,
  fetchTransactions,
  updateSecurity,
} from '../api/portfolio'
import type { OwnerScope } from '../api/portfolio'
import { fetchRefreshStatus, fetchSparklines } from '../api/prices'
import { getSnapshot, setSnapshot } from '../api/snapshotCache'
import { useAssistantView } from '../components/assistant/viewState'
import ChartCard from '../components/ChartCard'
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
import PageFrame from '../components/shell/PageFrame'
import ScopeBar from '../components/shell/ScopeBar'
import { useScope } from '../components/shell/useScope'
import StatTile from '../components/StatTile'
import { metricReceipt } from '../utils/metricReceipt'
import { useArrivalParam, useArrivalValue } from '../components/useArrivalParam'
import { usePriceRefresh } from '../components/usePriceRefresh'
import { rangeZoom, resolvedWindow } from '../charts/timeZoom'
import type { RangeState, ZoomWindow } from '../charts/timeZoom'
import type {
  AllocationResponse,
  DividendEventOut,
  DividendOut,
  HoldingsResponse,
  PortfolioAccountOut,
  PortfolioHistory,
  RealizedResponse,
  RefreshStatus,
  SecurityOut,
  SparklinesResponse,
  TransactionOut,
} from '../types/api'
import { formatCurrency, formatDate, formatDateTime, formatPct } from '../utils/format'
import { isStaleQuote } from '../utils/staleness'
import { toneOf } from '../utils/tone'
import '../components/panels.css'
import '../components/portfolio/portfolio.css'
import './PortfolioPage.css'

type Tab = 'transactions' | 'dividends' | 'securities' | 'realized'

// Explicit arrivals also reopen Transactions after another record editor was visited.
const TAB_ARRIVALS: readonly Tab[] = ['transactions', 'dividends', 'securities', 'realized']

// Keyed by the fetch parameters, exactly like NetWorthPage's netWorthKey: an owner switch
// is a DIFFERENT snapshot. 'all' spells the household view so the key can never collide
// with a person id.
function portfolioKey(owner: OwnerScope): string {
  return `portfolio:${owner ?? 'all'}`
}

interface PortfolioSnapshot {
  holdings: HoldingsResponse
  securities: SecurityOut[]
  // The account roster and the name a NEW account would be tagged with (2026-09-09 audit
  // item 27) — the two ledgers' Account boxes complete from the first and warn with the
  // second. Null is "unknown", which is a different thing from an empty household.
  accounts: PortfolioAccountOut[] | null
  primaryName: string | null
  transactions: TransactionOut[]
  dividends: DividendOut[]
  dividendEvents: DividendEventOut[]
  byType: AllocationResponse
  byAccount: AllocationResponse
  sparklines: SparklinesResponse
  history: PortfolioHistory
  realized: RealizedResponse
  refreshStatus: RefreshStatus
}

const PAGE_SECTIONS = [{"id":"overview","label":"Overview"},{"id":"holdings","label":"Holdings"},{"id":"allocation","label":"Allocation"},{"id":"income","label":"Income"},{"id":"manage","label":"Manage"}] as const

export default function PortfolioPage() {
  const detailPanel = useDetailPanel()
  const openDetailPanel = detailPanel?.open
  const closeDetailPanel = detailPanel?.close
  const views = useLocalSections(PAGE_SECTIONS, 'overview', { resolveLegacy: ({ searchParams }) => searchParams.has('ticker') ? 'holdings' : searchParams.get('tab') === 'dividends' ? 'income' : ['transactions', 'securities', 'realized'].includes(searchParams.get('tab') ?? '') ? 'manage' : null })
  // The page's ownership scope and performance window both come from the URL now
  // (2026-09-03 shell spec §6); the sticky ScopeBar below writes them.
  const { scope } = useScope({ owner: true, range: true })
  // The mount seed reads exactly the key that mount's load() will write — which is the
  // ARRIVING scope's key, so a shared /portfolio?owner=2 link paints from its own slot
  // rather than the household's.
  const cached = getSnapshot<PortfolioSnapshot>(portfolioKey(scope.owner))
  const [holdings, setHoldings] = useState<HoldingsResponse | null>(cached?.holdings ?? null)
  const [securities, setSecurities] = useState<SecurityOut[]>(cached?.securities ?? [])
  const [accounts, setAccounts] = useState<PortfolioAccountOut[] | null>(
    cached?.accounts ?? null,
  )
  const [primaryName, setPrimaryName] = useState<string | null>(cached?.primaryName ?? null)
  const [transactions, setTransactions] = useState<TransactionOut[]>(cached?.transactions ?? [])
  const [dividends, setDividends] = useState<DividendOut[]>(cached?.dividends ?? [])
  const [dividendEvents, setDividendEvents] = useState<DividendEventOut[]>(
    cached?.dividendEvents ?? [],
  )
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
  // Finished action (2026-09-03 shell spec §9): the tab alone left the ledger below the
  // fold. The arrival only RAISES a flag — the records strip does not exist yet when a
  // cold navigation consumes the param (the first payload has not landed), so the scroll
  // and the focus wait for the commit that finally renders it.
  const pendingRecordsArrival = useRef(false)
  const recordsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const arriveOnTab = useCallback((value: Tab) => {
    setTab(value === 'dividends' ? 'transactions' : value)
    pendingRecordsArrival.current = true
  }, [])
  useArrivalParam('tab', TAB_ARRIVALS, arriveOnTab)
  // Unkeyed on purpose (the palette's latest-handler idiom): the strip can appear on any
  // commit — a cold fetch, a scope flip — and this is the cheapest way to catch the first
  // one. The flag is cleared before the work is scheduled, so it runs exactly once.
  useEffect(() => {
    if (!pendingRecordsArrival.current) return
    const strip = document.getElementById('portfolio-records')
    if (!strip) return
    pendingRecordsArrival.current = false
    // setTimeout 0 rather than this effect's body: Layout's navigation hand-off focuses
    // <main> from the PARENT effect that runs right after this one, and it would take the
    // caret straight back out of the form.
    recordsTimer.current = setTimeout(() => {
      // Optional-call, like HoldingDetailPanel: jsdom has no scrollIntoView.
      const field = Array.from(strip.querySelectorAll<HTMLElement>('form input:not([type="hidden"]):not([disabled]), form select:not([disabled])'))
        .find((element) => !element.closest('[hidden]'))
      if (field) {
        strip.scrollIntoView?.({ block: 'start' })
        field.focus()
      }
    }, 0)
  })
  useEffect(() => () => clearTimeout(recordsTimer.current), [])
  // Performance-chart window, mirrored from the shared scope: the row's chips write the
  // URL and the URL writes this. The object still carries any manual ctrl+wheel window fed
  // back from the chart's datazoom event (spec §2e); a chip pick replaces it wholesale.
  const [range, setRange] = useState<RangeState>({ preset: scope.range })
  if (scope.range !== range.preset) setRange({ preset: scope.range })
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
  // ?ticker=NVDA — the palette's holding entries land straight in the drill (spec §9).
  // Uppercased because tickers are stored that way; one that no longer exists simply
  // finds no holding and the panel folds away, the drill's existing posture.
  const arriveOnTicker = useCallback((value: string) => setDetailTicker(value.toUpperCase()), [])
  useArrivalValue('ticker', arriveOnTicker)
  // The page's ownership scope: null = the whole household (and NO owner param on the wire
  // at all, so the requests stay byte-identical to the pre-ownership ones). It scopes the
  // tiles, the holdings table, the allocation charts and the three record tabs. Seeded from
  // the URL and adopted from it below — the ScopeBar's chips never talk to this page.
  const [owner, setOwner] = useState<OwnerScope>(scope.owner)
  // What the assistant must answer against: the scope, the open record tab and the drill-in
  // ticker, none of which is in the URL once the arrival param is consumed (2026-09-01
  // spec §6). `owner` is stringified because the scope is a person id OR the literal
  // 'joint' — one type on the wire beats a union.
  useAssistantView({
    owner: owner === null ? null : String(owner),
    tab: views.section === 'income' ? 'dividends' : tab,
    ticker: detailTicker,
  })
  // (The household fetch that fed the old owner row belongs to the ScopeBar now, and it
  // swallows its own failures — a household hiccup must not blank the portfolio.)
  // false once a revalidation actually CHANGES the data — charts may animate again.
  const [fromCache, setFromCache] = useState(cached !== undefined)
  // Seeded off the cache: a cache hit paints full and revalidates under the reload dim.
  // Seeded rather than flipped by the mount effect because reload()'s setReloading(true)
  // would be a synchronous setState in an effect body (react-hooks v7). There is no
  // separate `loading` flag any more — "no holdings yet" IS the frame's loading state.
  const [reloading, setReloading] = useState(cached !== undefined)
  const { refreshing, note: refreshNote, refresh } = usePriceRefresh()
  const [error, setError] = useState<string | null>(null)
  // Four things trigger a load (mount, refresh, three panels' onChanged) and the twelve
  // requests are not ordered — a slow earlier load must never overwrite a later one.
  const seqRef = useRef(0)
  // What the page is actually SHOWING. The revalidation skip in load() is judged against
  // this, never against the snapshot cache: render and cache diverge across an owner
  // switch (the previous scope's panels are still up while the next scope's key is warm),
  // and skipping on the cache stranded the page on the previous scope forever (the
  // 2026-08-28 bug NetWorthPage fixed @9e20d15 — no cache-compared skips, house rule).
  // It is a MIRROR of `applied` below rather than something callers write: the scope peek
  // applies a snapshot from render, where mutating a ref would be an impure render, so the
  // truth travels as state and lands in the ref from an effect.
  const shown = useRef<PortfolioSnapshot | null>(cached ?? null)
  const [applied, setApplied] = useState<PortfolioSnapshot | null>(cached ?? null)

  // The ONLY place a snapshot reaches the page — load()'s apply and the scope peek below
  // both come through here; add new PortfolioSnapshot slots HERE. Setters only, because the
  // peek runs DURING render (the adjust-during-render idiom): `setApplied` records what the
  // page now shows and the effect under it carries that into `shown`.
  // useCallback with an empty dep list: useState setters are identity-stable, so this
  // stays stable and `load` below keeps changing identity ONLY with the scope (a fresh
  // identity per render would re-fire the mount effect on every render).
  const applySnapshotState = useCallback((snap: PortfolioSnapshot, fromCache: boolean) => {
    setApplied(snap)
    setFromCache(fromCache)
    setHoldings(snap.holdings)
    setSecurities(snap.securities)
    setAccounts(snap.accounts)
    setPrimaryName(snap.primaryName)
    setTransactions(snap.transactions)
    setDividends(snap.dividends)
    setDividendEvents(snap.dividendEvents)
    setByType(snap.byType)
    setByAccount(snap.byAccount)
    setSparklines(snap.sparklines)
    setHistory(snap.history)
    setRealized(snap.realized)
    setRefreshStatus(snap.refreshStatus)
  }, [])

  // The mirror, from a committed render rather than from render itself. Every apply — the
  // peek's included — lands here before the next load() resolves, so the equality skip below
  // is always judged against what is genuinely on screen: a switch back to a warm scope
  // paints from cache and its identical revalidation is skipped, leaving the charts still.
  useEffect(() => {
    shown.current = applied
  }, [applied])

  // URL → page, adopted with the adjust-during-render idiom (CategoriesPanel's precedent),
  // so an owner switch never puts a setState inside an effect body. `load` keeps `owner` in
  // its deps, so the mount effect below refetches on adoption exactly as the old
  // selectOwner did.
  if (scope.owner !== owner) {
    setReloading(true)
    setError(null)
    // The open drill-in holds a TICKER the next scope may not own — close it rather than
    // leave a detail panel resolving to null.
    setDetailTicker(null)
    // Already-seen scope: paint it instantly and revalidate underneath. State setters only
    // — `shown`/ref bookkeeping belongs to load()'s continuation, never to render.
    const peeked = getSnapshot<PortfolioSnapshot>(portfolioKey(scope.owner))
    if (peeked !== undefined) applySnapshotState(peeked, true)
    setOwner(scope.owner)
  }

  // Promise callbacks, no setState in the effect's synchronous body — house react-hooks
  // law (see NetWorthPage). One load() refetches EVERYTHING: eleven cheap local queries,
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
      // No 'industry' dimension: the heat-treemap reads the holdings themselves, because it
      // needs per-ticker figures the AllocationResponse slices do not carry (F5).
      fetchAllocation('type', owner),
      fetchAllocation('account', owner),
      fetchSparklines(),
      fetchHistory(),
      fetchRealized(owner),
      fetchRefreshStatus(),
      fetchDividendEvents(),
      // The two reads behind the Account boxes' datalist and their "this will create a new
      // account" note (item 27). Both swallow their own failure: they decorate a form, and a
      // roster hiccup must no more blank this page than a household one does (the ScopeBar's
      // rule). A null roster offers no completions and warns about nothing.
      fetchPortfolioAccounts().catch(() => null),
      fetchHousehold().catch(() => null),
    ])
      .then(([h, secs, txns, divs, typ, acct, spark, hist, real, status, divEvents, roster, people]) => {
        if (seq !== seqRef.current) return
        const snapshot: PortfolioSnapshot = {
          holdings: h,
          securities: secs,
          accounts: roster,
          // Resolved here rather than in the panels: the note names a PERSON, and the page
          // is where the household is already in hand.
          primaryName: people?.people.find((person) => person.is_primary)?.name ?? null,
          transactions: txns,
          dividends: divs,
          dividendEvents: divEvents,
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
        applySnapshotState(snapshot, false)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(describeError(err, 'the portfolio'))
      })
  }, [owner, applySnapshotState])

  // Panel mutations refetch WITHOUT unmounting the panels (a spinner swap would throw
  // away the form the user is typing in) — the body dims instead.
  const reload = () => {
    setReloading(true)
    load().finally(() => setReloading(false))
  }

  // Mount AND every owner switch: `load` changes identity with the scope, which is what
  // re-runs this effect. A cache hit revalidates under the reload dim (raised by
  // `reloading`'s initializer on mount, by the adoption block on a switch); the trailing
  // release is a no-op on a cold mount, where `reloading` never went up.
  useEffect(() => {
    load().finally(() => setReloading(false))
  }, [load])

  const onRefresh = () => {
    setError(null)
    // The page keeps the failure in its OWN banner, exactly as before; the hook's `error` is
    // for callers that have nowhere else to put it.
    refresh({ after: load, onError: setError })
  }

  const totals = holdings?.totals
  // The labels the two ledgers' Account boxes complete from — null stays null, because "no
  // roster yet" is not "no accounts".
  const accountLabels = accounts === null ? null : accounts.map((account) => account.label)
  const asOf = holdings?.as_of ?? null
  // A4: the tooltip's second clock. latest_quote_at IS "the newest quote across holdings"
  // (one definition, two consumers — it also dates the live ping); the spec's original
  // as_of_newest twin was amended away 2026-08-31 once the audit surfaced this field.
  const newestQuote = holdings?.latest_quote_at ?? null
  // Audit item 12: as_of is the OLDEST quote among the SCOPED holdings, so it is null
  // whenever the view holds nothing priced — an owner with no securities, a Joint scope
  // with none. "prices never refreshed" is a claim about the APP, and the refresh line
  // right below it was already contradicting it. It is made only when the refresh status
  // agrees; every other empty header describes the view instead.
  const noPricesWords =
    (holdings !== null && holdings.holdings.length === 0) || refreshStatus?.last != null
      ? 'no priced holdings in this view'
      : 'prices never refreshed'

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
    // A3 (2026-08-31 tier-1): the ping is derived from the OWNER-FILTERED holdings, but
    // /portfolio/history is household-wide by design — plotting a person's total at the
    // end of the household series drew a fake cliff. Only the All view bridges to "now";
    // null also suppresses the dashed connector and the "Live" legend entry (both live
    // inside the builder's livePt branch).
    // The picks ride INTO the builder (F9): legendFor() owns the legend's shape, so a page
    // that spread its own `legend` over the result would drop the scroll/pager rules.
    const base = portfolioHistoryOption(
      history,
      owner === null ? liveFromHoldings(holdings) : null,
      events,
      { selected: legendSelected },
    )
    return base === null
      ? null
      : {
        ...base,
        // startValue indexes history.dates; the appended live category sits at the
        // END, so the indices are unshifted and the window runs out to the ping.
        dataZoom: rangeZoom(history.dates, range),
      }
  }, [history, holdings, securities, transactions, dividends, dividendEvents, range, legendSelected, owner])

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

  useEffect(() => {
    if (detailHolding === null || views.section !== 'holdings') { closeDetailPanel?.('portfolio-holding'); return }
    openDetailPanel?.({ id: 'portfolio-holding', title: detailHolding.ticker, subtitle: 'Holding details', content: <HoldingDetailPanel key={detailHolding.security_id} holding={detailHolding} transactions={transactions} dividends={dividends} />, onClose: () => setDetailTicker(null) })
  }, [detailHolding, transactions, dividends, views.section, openDetailPanel, closeDetailPanel])
  useEffect(() => () => closeDetailPanel?.('portfolio-holding'), [closeDetailPanel, scope.owner])

  return (
    <div className="page portfolio-page">
      <PageFrame
        title="Portfolio"
        actions={
          <button type="button" className="refresh-btn" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? 'spin' : undefined} />
            {refreshing ? 'Refreshing…' : 'Refresh prices'}
          </button>
        }
        subheader={
          <>
            {asOf ? (
              // A4 (2026-08-31 tier-1): as_of is the OLDEST quote — one manual-priced
              // straggler pins it — so the clock wears the same stale treatment Overview's
              // freshness cue uses (isStaleQuote → --warn amber) and the tooltip names the
              // clock it is NOT showing. Display-only: as_of itself is unchanged. The
              // no-newest fallback is stale-tab armor only — server-side both clocks derive
              // from one quote list, so they are null (or set) together.
              <span
                className={isStaleQuote(asOf) ? 'as-of stale' : 'as-of'}
                title={
                  newestQuote
                    ? `oldest quote across holdings — newest ${formatDate(newestQuote)}`
                    : 'oldest quote across holdings'
                }
              >
                prices as of {formatDate(asOf)}
              </span>
            ) : (
              <span className="as-of">{noPricesWords}</span>
            )}
            {/* One element, always mounted: a live region added at announce-time is not
                read. Partial failures are an alert, not a status — they need the user's
                attention. */}
            <div
              className={refreshNote.failed > 0 ? 'hint refresh-note-bad' : 'hint'}
              role={refreshNote.failed > 0 ? 'alert' : 'status'}
              title={refreshNote.detail || undefined}
            >
              {refreshNote.text}
            </div>
            {/* The scheduler, finally visible: what ran last (manual or scheduled — the
                outcome persists either way now) and when the next run fires. Wall-clock
                stamps, local time — these answer "when", not "which bar". */}
            {refreshStatus?.last && (
              <div className="hint refresh-status-line">
                Last refresh {formatDateTime(refreshStatus.last.at)} (
                {refreshStatus.last.trigger}) · {refreshStatus.last.updated} updated
                {refreshStatus.last.failed &&
                  Object.keys(refreshStatus.last.failed).length > 0 && (
                    <> · {Object.keys(refreshStatus.last.failed).length} failed</>
                  )}
                {refreshStatus.next_run_at && (
                  <> · next {formatDateTime(refreshStatus.next_run_at)}</>
                )}
              </div>
            )}
            {failedEntries.length > 0 && (
              <div className="refresh-failures">
                {failedEntries.map(([ticker, reason]) => (
                  <span key={ticker} className="refresh-failure" title={reason}>
                    {ticker}
                    {/* One click retires the ZI ritual (README 7.4's manual is_active
                        edit): deactivating removes the ticker from every future refresh;
                        the Securities tab can always bring it back. */}
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
          </>
        }
        scopeRow={
          // Overrides the bar's default "Whose": this page's accounts are portfolio labels,
          // and — the part no other page has to say — the performance line, the sparklines
          // and price refresh ignore the chips entirely.
          <ScopeBar
            owner
            range
            ownerHint="A person's view is their own portfolio accounts plus the joint ones — that is what a joint account is. Joint shows only the shared accounts. Performance, sparklines and price refresh always cover the whole household."
          />
        }
        // A failed FIRST load leaves holdings null: the frame shows the alert alone rather
        // than a page of empty tables that read as "you own nothing".
        resource={{
          status: holdings === null ? (error !== null ? 'error' : 'loading') : 'ready',
          error,
          busy: reloading,
          fromCache,
          // Clearing the error is what returns the frame to the skeleton: leaving it set
          // would keep the alert on screen, unchanged, for the whole retry.
          retry: () => {
            setError(null)
            reload()
          },
        }}
        skeleton={{
          tiles: 4,
          cards: [
            { span: 12, height: 340 },
            { span: 12, height: 300 },
          ],
        }}
      >
        <LocalSectionNav state={views} label="Portfolio views" />

        {holdings !== null && (
          <>
            {totals && (
              <div className="tiles-row">
                <StatTile
                  label="Portfolio value"
                  value={formatCurrency(totals.market_value)}
                  evidence={metricReceipt({ id: 'portfolio_market_value', label: 'Portfolio value', value: totals.market_value,
                    definition: 'Sum of current shares multiplied by each holding’s latest available quote. Holdings without a price remain unpriced; quote dates may differ from the refresh time.',
                    scope: owner ?? 'Household', as_of: holdings?.as_of ?? null, completeness: totals.unpriced_count ? 'partial' : 'complete',
                    source_link: `/portfolio?section=holdings${owner === null ? '' : `&owner=${owner}`}`,
                    components: [{ label: 'Unpriced holdings', value: totals.unpriced_count, unit: 'count' }],
                    warnings: holdings?.latest_quote_at ? [`Newest quote: ${holdings.latest_quote_at}. The as-of date above is the oldest available quote.`] : ['No quote dates are available.'] })}
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
                  evidence={metricReceipt({ id: 'portfolio_unrealized_gain', label: 'Unrealized gain', value: totals.unrealized_gl,
                    definition: 'The portfolio service’s current market value less the matched remaining average-cost basis. Missing prices reduce coverage.',
                    scope: owner ?? 'Household', as_of: holdings?.as_of ?? null, completeness: totals.unpriced_count ? 'partial' : 'complete',
                    source_link: `/portfolio?section=holdings${owner === null ? '' : `&owner=${owner}`}` })}
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
                  evidence={metricReceipt({ id: 'portfolio_cost_basis', label: 'Cost basis', value: totals.cost_basis,
                    definition: 'Remaining acquisition cost of current holdings, including recorded fees, using the existing average-cost calculation.',
                    scope: owner ?? 'Household', source_link: `/portfolio?section=manage${owner === null ? '' : `&owner=${owner}`}` })}
                  hint="What the current holdings cost to acquire, fees included, average-cost method."
                />
                <StatTile
                  label="Dividend entries"
                  value={formatCurrency(totals.dividends_collected)}
                  evidence={metricReceipt({ id: 'dividend_entries', label: 'Dividend entries', value: totals.dividends_collected,
                    definition: 'Total of recorded manual and automatic dividend entries. Automatic records use the ex-dividend date and an estimated amount; they do not confirm payment or receipt.',
                    scope: owner ?? 'Household', source_link: `/portfolio?section=income${owner === null ? '' : `&owner=${owner}`}`,
                    completeness: 'mixed', components: [{ label: 'Expected annual income at current rates', value: totals.annual_income, unit: 'USD' }],
                    warnings: ['Expected annual income is a forward estimate and is separate from the total of recorded entries.'] })}
                  delta={`${formatCurrency(totals.annual_income)}/yr expected`}
                  tone="neutral"
                  hint="Every dividend logged — auto-ingested and manual — with the expected annual income at current rates."
                />
              </div>
            )}
            <LocalSectionPanel state={views} section="overview">
              <ChartCard
                title="Performance"
                hint="Value vs cost basis, checkpointed weekly after Monday's close. The pinging dot is the live value at the latest prices. The S&P 500 baseline invests only the starting balance; VOO (your contributions) invests every inferred contribution instead. Estimated: contributions inferred from weekly cost-basis changes; dividends excluded on the VOO leg. Event markers annotate dated buys and sells, logged dividends, and older ex-dividend dates (per-share only — dollar amounts that old are unknowable from undated imports)."
                ariaLabel="Line chart of portfolio value against cost basis and benchmark lines, weekly"
                option={performanceOption}
                empty="No performance history yet — import your workbook in Settings to load it."
                exportName="portfolio-performance"
                csv={history === null ? undefined : () => portfolioHistoryCsv(history)}
                height={300}
                zoomable
                onLegendChange={onLegendChange}
                onDataZoom={onZoomWindow}
                zoomWindow={zoomWindow}
                footer={
                  <>
                    {/* True whether or not there is a history to draw, and only once a chip has
                      actually narrowed the rest of the page (spec §5 — on All it would be
                      noise). What the scope row's ⓘ already says is not repeated; what is left
                      is the part that only makes sense standing on this card — which panels the
                      chips DO scope, and the dot that goes missing. */}
                    {owner !== null && (
                      <p className="hint">
                        The owner chips scope holdings, allocation, dividends, transactions and
                        realized gains — not this chart, the sparklines or price refresh, which
                        always cover the whole household. Person views omit the live price dot
                        because the history is household-wide.
                      </p>
                    )}
                    {/* Two benchmark legs, one distinction: the baseline invests only the
                      STARTING balance; the contribution-matched line adds every inferred
                      flow. Said here so neither gap reads as outperformance. */}
                    <p className="hint">
                      S&amp;P 500 baseline tracks the starting balance invested in VOO — later
                      contributions are not added to it. VOO (your contributions) adds each
                      inferred contribution as it lands.
                    </p>
                  </>
                }
              />
            </LocalSectionPanel>
            <LocalSectionPanel state={views} section="holdings">
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
                {!detailPanel && detailHolding && (
                  // Standalone embeds retain an inline inspector; the application uses the
                  // shared detail surface while leaving the selected holding in view.
                  <HoldingDetailPanel
                    key={detailHolding.security_id}
                    holding={detailHolding}
                    transactions={transactions}
                    dividends={dividends}
                  />
                )}
                {(
                  <>
                    {totals && totals.unpriced_count > 0 && (
                      <p className="hint">
                        {totals.unpriced_count} holding(s) have no price yet — run a refresh or
                        set a manual price in Securities.
                      </p>
                    )}
                    <p className="drill-hint">Select a holding to inspect its history and income.</p>
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
            </LocalSectionPanel>
            <LocalSectionPanel state={views} section="allocation">
              <AllocationPanel
                holdings={holdings.holdings}
                owner={scope.owner}
                byType={byType}
                byAccount={byAccount}
                onSelectTicker={(ticker) => { setDetailTicker(ticker); views.setSection('holdings') }}
              />
            </LocalSectionPanel>
            {/* The ?tab= arrival's scroll-and-focus target: the strip alone would leave the
                panel it selects (and that panel's form) off-screen below it. */}
            <div id="portfolio-records"><LocalSectionPanel state={views} section="income">
              <DividendsPanel
                securities={securities}
                dividends={dividends}
                annualIncome={totals?.annual_income ?? null}
                accounts={accountLabels}
                primaryName={primaryName}
                onChanged={reload}
              />
            </LocalSectionPanel><LocalSectionPanel state={views} section="manage">
                <div className="portfolio-manage">
                  {/* group, not tablist: these buttons toggle panels below rather than owning
                  tabpanels, and the aria-labels keep "Dividends" from colliding with the
                  holdings table's sort header of the same name. */}
                  <div className="tab-row" role="group" aria-label="Portfolio records">
                    {(['transactions', 'securities', 'realized'] as const).map((t) => (
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
                  <div hidden={tab !== 'transactions'}>
                    <TransactionsPanel
                      securities={securities}
                      transactions={transactions}
                      accounts={accountLabels}
                      primaryName={primaryName}
                      onChanged={reload}
                    />
                  </div>
                  <div hidden={tab !== 'securities'}><SecuritiesPanel securities={securities} onChanged={reload} /></div>
                  <div hidden={tab !== 'realized'}>{realized && <RealizedPanel realized={realized} />}</div>
                </div>
              </LocalSectionPanel></div>
          </>
        )}
      </PageFrame>
    </div>
  )
}
