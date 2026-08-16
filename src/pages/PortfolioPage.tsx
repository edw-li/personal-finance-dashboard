import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { ApiError } from '../api/client'
import {
  fetchAllocation,
  fetchDividends,
  fetchHoldings,
  fetchSecurities,
  fetchTransactions,
} from '../api/portfolio'
import { fetchSparklines, refreshPrices } from '../api/prices'
import AllocationPanel from '../components/portfolio/AllocationPanel'
import DividendsPanel from '../components/portfolio/DividendsPanel'
import HoldingsTable from '../components/portfolio/HoldingsTable'
import SecuritiesPanel from '../components/portfolio/SecuritiesPanel'
import TransactionsPanel from '../components/portfolio/TransactionsPanel'
import StatTile from '../components/StatTile'
import type {
  AllocationResponse,
  DividendOut,
  HoldingsResponse,
  SecurityOut,
  SparklinesResponse,
  TransactionOut,
} from '../types/api'
import { formatCurrency, formatDate, formatPct } from '../utils/format'
import '../components/panels.css'
import './PortfolioPage.css'

type Tab = 'transactions' | 'dividends' | 'securities'

function toneFor(value: string | null | undefined): 'positive' | 'negative' | 'neutral' {
  if (value === null || value === undefined) return 'neutral'
  const n = Number(value)
  return n > 0 ? 'positive' : n < 0 ? 'negative' : 'neutral'
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
  const [tab, setTab] = useState<Tab>('transactions')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshNote, setRefreshNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Promise callbacks, no setState in the effect's synchronous body — house react-hooks
  // law (see NetWorthPage). One load() refetches EVERYTHING: eight cheap local queries,
  // and every mutation path (panels' onChanged, refresh) converges through it.
  const load = () => {
    Promise.all([
      fetchHoldings(),
      fetchSecurities(),
      fetchTransactions(),
      fetchDividends(),
      fetchAllocation('industry'),
      fetchAllocation('type'),
      fetchAllocation('account'),
      fetchSparklines(),
    ])
      .then(([h, secs, txns, divs, ind, typ, acct, spark]) => {
        setHoldings(h)
        setSecurities(secs)
        setTransactions(txns)
        setDividends(divs)
        setIndustry(ind)
        setByType(typ)
        setByAccount(acct)
        setSparklines(spark)
        setError(null)
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Failed to load portfolio data')
      })
      .finally(() => setLoading(false))
  }

  // Mount-only fetch. react-hooks 7 reports nothing here (load is re-created per render
  // but reads no reactive value beyond the setters), so an exhaustive-deps suppression
  // would be an unused directive — which ESLint 9 flat config warns about by default.
  useEffect(() => {
    load()
  }, [])

  const onRefresh = () => {
    setRefreshing(true)
    setRefreshNote(null)
    setError(null)
    refreshPrices()
      .then((result) => {
        const failed = Object.keys(result.failed)
        setRefreshNote(
          `${result.updated.length} updated` +
            (failed.length > 0 ? `, ${failed.length} failed (${failed.join(', ')})` : '') +
            (result.skipped_manual.length > 0
              ? `, ${result.skipped_manual.length} manual skipped`
              : ''),
        )
        load()
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Price refresh failed')
      })
      .finally(() => setRefreshing(false))
  }

  const totals = holdings?.totals
  const asOf = holdings?.as_of ?? null

  return (
    <div className="page portfolio-page">
      <header className="page-header">
        <h1>Portfolio</h1>
        <div className="header-actions">
          {asOf && <span className="as-of">prices as of {formatDate(asOf.slice(0, 10))}</span>}
          <button type="button" className="refresh-btn" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? 'spin' : undefined} />
            {refreshing ? 'Refreshing…' : 'Refresh prices'}
          </button>
        </div>
      </header>
      {refreshNote && <div className="hint" role="status">{refreshNote}</div>}
      {error && <div className="error-banner" role="alert">{error}</div>}
      {loading ? (
        <p className="empty-note">Loading…</p>
      ) : (
        <>
          {totals && (
            <div className="tiles-row">
              <StatTile
                label="Portfolio value"
                value={formatCurrency(totals.market_value)}
                delta={
                  totals.day_change_amount !== null
                    ? `${formatCurrency(totals.day_change_amount)} today (${formatPct(totals.day_change_pct)})`
                    : undefined
                }
                tone={toneFor(totals.day_change_amount)}
                hero
              />
              <StatTile
                label="Unrealized gain"
                value={formatCurrency(totals.unrealized_gl)}
                delta={totals.unrealized_gl_pct !== null ? formatPct(totals.unrealized_gl_pct) : undefined}
                tone={toneFor(totals.unrealized_gl)}
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
            <h2 className="panel-title">Holdings</h2>
            {totals && totals.unpriced_count > 0 && (
              <p className="hint">
                {totals.unpriced_count} holding(s) have no price yet — run a refresh or set
                a manual price in Securities.
              </p>
            )}
            <HoldingsTable holdings={holdings?.holdings ?? []} sparklines={sparklines} />
          </section>
          <AllocationPanel industry={industry} byType={byType} byAccount={byAccount} />
          <div className="tab-row" role="tablist" aria-label="Portfolio records">
            {(['transactions', 'dividends', 'securities'] as const).map((t) => (
              <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          {tab === 'transactions' && (
            <TransactionsPanel securities={securities} transactions={transactions} onChanged={load} />
          )}
          {tab === 'dividends' && (
            <DividendsPanel securities={securities} dividends={dividends} onChanged={load} />
          )}
          {tab === 'securities' && <SecuritiesPanel securities={securities} onChanged={load} />}
        </>
      )}
    </div>
  )
}
