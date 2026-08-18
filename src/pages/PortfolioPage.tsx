import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { ApiError } from '../api/client'
import {
  fetchAllocation,
  fetchDividends,
  fetchHistory,
  fetchHoldings,
  fetchSecurities,
  fetchTransactions,
} from '../api/portfolio'
import { fetchSparklines, refreshPrices } from '../api/prices'
import EChart from '../components/EChart'
import AllocationPanel from '../components/portfolio/AllocationPanel'
import DividendsPanel from '../components/portfolio/DividendsPanel'
import { liveFromHoldings, portfolioHistoryOption } from '../components/portfolio/historyChartOptions'
import HoldingsTable from '../components/portfolio/HoldingsTable'
import SecuritiesPanel from '../components/portfolio/SecuritiesPanel'
import TransactionsPanel from '../components/portfolio/TransactionsPanel'
import StatTile from '../components/StatTile'
import type {
  AllocationResponse,
  DividendOut,
  HoldingsResponse,
  PortfolioHistory,
  RefreshResult,
  SecurityOut,
  SparklinesResponse,
  TransactionOut,
} from '../types/api'
import { formatCurrency, formatDate, formatPct } from '../utils/format'
import { toneOf } from '../utils/tone'
import '../components/panels.css'
import '../components/portfolio/portfolio.css'
import './PortfolioPage.css'

type Tab = 'transactions' | 'dividends' | 'securities'

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
  const [tab, setTab] = useState<Tab>('transactions')
  const [loading, setLoading] = useState(true)
  const [reloading, setReloading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshNote, setRefreshNote] = useState<RefreshNote>(NO_NOTE)
  const [error, setError] = useState<string | null>(null)
  // Four things trigger a load (mount, refresh, three panels' onChanged) and the nine
  // requests are not ordered — a slow earlier load must never overwrite a later one.
  const seqRef = useRef(0)

  // Promise callbacks, no setState in the effect's synchronous body — house react-hooks
  // law (see NetWorthPage). One load() refetches EVERYTHING: nine cheap local queries,
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
    ])
      .then(([h, secs, txns, divs, ind, typ, acct, spark, hist]) => {
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

  // The page's only memoized value (OverviewPage's rule): EChart keys its setOption effect
  // on [option], so a fresh object per render would redraw the chart on every tab click.
  const performanceOption = useMemo(
    () => (history && holdings ? portfolioHistoryOption(history, liveFromHoldings(holdings)) : null),
    [history, holdings],
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
                hero
              />
              <StatTile
                label="Unrealized gain"
                value={formatCurrency(totals.unrealized_gl)}
                delta={totals.unrealized_gl_pct !== null ? formatPct(totals.unrealized_gl_pct) : undefined}
                tone={toneOf(totals.unrealized_gl)}
              />
              <StatTile label="Cost basis" value={formatCurrency(totals.cost_basis)} />
              <StatTile
                label="Dividends collected"
                value={formatCurrency(totals.dividends_collected)}
                delta={`${formatCurrency(totals.annual_income)}/yr expected`}
                tone="neutral"
              />
            </div>
          )}
          <section className="panel">
            <h2 className="panel-title">Performance</h2>
            {performanceOption ? (
              <>
                <EChart option={performanceOption} height={300} />
                {/* The sheet's baseline invests only the STARTING balance in VOO; saying so here
                    keeps the gap under the blue line from reading as outperformance. */}
                <p className="hint">
                  S&amp;P 500 baseline tracks the starting balance invested in VOO — later
                  contributions are not added to it.
                </p>
              </>
            ) : (
              <p className="empty-note">
                No performance history yet — import your workbook in Settings to load it.
              </p>
            )}
          </section>
          <section className="panel">
            <h2 className="panel-title">Holdings</h2>
            {totals && totals.unpriced_count > 0 && (
              <p className="hint">
                {totals.unpriced_count} holding(s) have no price yet — run a refresh or set
                a manual price in Securities.
              </p>
            )}
            <HoldingsTable holdings={holdings.holdings} sparklines={sparklines} />
          </section>
          <AllocationPanel industry={industry} byType={byType} byAccount={byAccount} />
          {/* group, not tablist: these buttons toggle panels below rather than owning
              tabpanels, and the aria-labels keep "Dividends" from colliding with the
              holdings table's sort header of the same name. */}
          <div className="tab-row" role="group" aria-label="Portfolio records">
            {(['transactions', 'dividends', 'securities'] as const).map((t) => (
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
            <DividendsPanel securities={securities} dividends={dividends} onChanged={reload} />
          )}
          {tab === 'securities' && <SecuritiesPanel securities={securities} onChanged={reload} />}
        </div>
      ) : null}
    </div>
  )
}
