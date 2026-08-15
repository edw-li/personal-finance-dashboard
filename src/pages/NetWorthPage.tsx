import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PencilLine } from 'lucide-react'
import { fetchSummary, fetchTimeseries } from '../api/netWorth'
import { ApiError } from '../api/client'
import EChart from '../components/EChart'
import MonthRibbon from '../components/MonthRibbon'
import StatTile from '../components/StatTile'
import type { EChartsOption } from '../charts/echarts'
import {
  GROUP_COLORS,
  GROUP_LABELS,
  GROUP_ORDER,
  INK,
  PALETTE,
} from '../charts/theme'
import type { AccountGroup, NetWorthSummary, NetWorthTimeseries } from '../types/api'
import {
  formatCurrency,
  formatCurrencyCompact,
  formatMonth,
  formatPct,
} from '../utils/format'
import { currentMonthIso } from '../utils/months'
import '../components/panels.css'
import './NetWorthPage.css'

const ASSET_GROUPS = GROUP_ORDER.filter((g): g is AccountGroup => g !== 'liability')
const MAX_DRILL = 3

function pctChange(curr: string | null, prev: string | null): number | null {
  if (curr === null || prev === null || Number(prev) === 0) return null
  return (Number(curr) - Number(prev)) / Math.abs(Number(prev))
}

export default function NetWorthPage() {
  const navigate = useNavigate()
  const [granularity, setGranularity] = useState<'monthly' | 'quarterly'>('monthly')
  const [data, setData] = useState<NetWorthTimeseries | null>(null)
  const [summary, setSummary] = useState<NetWorthSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Drill-down: selection order assigns the lowest free palette slot; removing one
  // never repaints the survivors (dataviz: color follows the entity, not its rank).
  const [drill, setDrill] = useState<{ accountId: number; slot: number }[]>([])
  // Ribbon coverage is captured ONLY from monthly responses — the quarterly fetch
  // filters months server-side and must not make covered months read as missing.
  const [coverageMonths, setCoverageMonths] = useState<string[]>([])

  // Promise callbacks rather than async/await, and no setState before the fetch starts:
  // every state update has to land in an async continuation, never in the synchronous
  // body of the effect below (react-hooks/set-state-in-effect — the same constraint
  // AuthContext documents; the rule reads `await` continuations as synchronous).
  const load = useCallback(() => {
    Promise.all([fetchTimeseries(granularity), fetchSummary()])
      .then(([ts, sum]) => {
        setData(ts)
        setSummary(sum)
        setError(null)
        if (granularity === 'monthly') setCoverageMonths(ts.months)
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Failed to load net worth data')
      })
      .finally(() => setLoading(false))
  }, [granularity])

  // The "we're fetching" flip therefore lives in the event handlers that cause a fetch —
  // the mount fetch is covered by useState's initial `true`.
  const beginLoad = () => {
    setLoading(true)
    setError(null)
  }

  useEffect(() => {
    load()
  }, [load])

  const filledMonths = useMemo(() => new Set(coverageMonths), [coverageMonths])
  const anchor = useMemo(() => {
    const cur = currentMonthIso()
    const latest = coverageMonths.at(-1)
    return latest && latest > cur ? latest : cur
  }, [coverageMonths])

  const stackedOption = useMemo<EChartsOption | null>(() => {
    if (!data || data.months.length === 0) return null
    const labels = data.months.map(formatMonth)
    return {
      grid: { left: 70, right: 84, top: 40, bottom: 28 },
      legend: { top: 0 },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (value) => formatCurrency(value as number),
      },
      xAxis: { type: 'category', data: labels, boundaryGap: false },
      yAxis: {
        type: 'value',
        axisLabel: { formatter: (value: number) => formatCurrencyCompact(value) },
      },
      series: [
        ...ASSET_GROUPS.map((group) => ({
          name: GROUP_LABELS[group],
          type: 'line' as const,
          stack: 'assets',
          symbol: 'none' as const,
          lineStyle: { width: 1 },
          areaStyle: { opacity: 0.5 },
          color: GROUP_COLORS[group],
          data: data.group_totals[group].map(Number),
        })),
        {
          name: GROUP_LABELS.liability,
          type: 'line' as const,
          symbol: 'none' as const,
          lineStyle: { width: 1 },
          areaStyle: { opacity: 0.5 },
          color: GROUP_COLORS.liability,
          data: data.group_totals.liability.map(Number),
        },
        {
          name: 'Net worth',
          type: 'line' as const,
          symbol: 'none' as const,
          lineStyle: { width: 2.5 },
          color: INK,
          z: 10,
          endLabel: {
            show: true,
            color: INK,
            fontWeight: 600,
            formatter: (params: { value?: unknown }) =>
              formatCurrencyCompact(params.value as number),
          },
          data: data.net_worth.map(Number),
        },
      ],
    }
  }, [data])

  const drillOption = useMemo<EChartsOption | null>(() => {
    if (!data || drill.length === 0) return null
    const byId = new Map(data.series.map((s) => [s.account_id, s.values]))
    const nameById = new Map(data.accounts.map((a) => [a.id, a.name]))
    return {
      grid: { left: 70, right: 24, top: 40, bottom: 28 },
      legend: { top: 0 },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (value) =>
          value === null || value === undefined ? '—' : formatCurrency(value as number),
      },
      xAxis: { type: 'category', data: data.months.map(formatMonth), boundaryGap: false },
      yAxis: {
        type: 'value',
        axisLabel: { formatter: (value: number) => formatCurrencyCompact(value) },
      },
      series: drill.map(({ accountId, slot }) => ({
        name: nameById.get(accountId) ?? String(accountId),
        type: 'line' as const,
        symbol: 'circle' as const,
        symbolSize: 8,
        showSymbol: false,
        lineStyle: { width: 2 },
        color: PALETTE[slot],
        connectNulls: false,
        data: (byId.get(accountId) ?? []).map((v) => (v === null ? null : Number(v))),
      })),
    }
  }, [data, drill])

  const toggleDrill = (accountId: number) => {
    setDrill((current) => {
      const existing = current.find((d) => d.accountId === accountId)
      if (existing) return current.filter((d) => d.accountId !== accountId)
      if (current.length >= MAX_DRILL) return current
      const used = new Set(current.map((d) => d.slot))
      const slot = [0, 1, 2].find((s) => !used.has(s)) ?? 0
      return [...current, { accountId, slot }]
    })
  }

  const months = data?.months ?? []
  const lastIndex = months.length - 1
  const momHeader = granularity === 'quarterly' ? 'QoQ %' : 'MoM %'

  return (
    <div className="page">
      <div className="page-header">
        <h1>Net worth</h1>
        <div className="spacer" />
        <MonthRibbon
          anchor={anchor}
          filledMonths={filledMonths}
          onSelect={(month) => navigate(`/update?month=${month}`)}
        />
        <button className="button button-primary" onClick={() => navigate('/update')}>
          <PencilLine size={15} /> Enter month
        </button>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          {error}{' '}
          <button
            className="button"
            onClick={() => {
              beginLoad()
              load()
            }}
          >
            Retry
          </button>
        </div>
      )}

      {summary && summary.month && (
        <div className="kpi-row">
          <StatTile
            hero
            label={`Net worth — ${formatMonth(summary.month)}`}
            value={formatCurrency(summary.net_worth)}
            delta={
              summary.mom_delta === null
                ? undefined
                : `${formatCurrency(summary.mom_delta)} (${formatPct(summary.mom_pct)}) vs prior month`
            }
            tone={
              summary.mom_delta === null
                ? 'neutral'
                : Number(summary.mom_delta) >= 0
                  ? 'positive'
                  : 'negative'
            }
          />
          {(['taxable', 'pre_tax', 'liability'] as AccountGroup[]).map((group) => {
            const entry = summary.groups.find((g) => g.group === group)
            if (!entry) return null
            const delta = entry.mom_delta
            return (
              <StatTile
                key={group}
                label={GROUP_LABELS[group]}
                value={formatCurrency(entry.total)}
                delta={delta === null ? undefined : `${formatCurrency(delta)} vs prior`}
                tone={delta === null ? 'neutral' : Number(delta) >= 0 ? 'positive' : 'negative'}
              />
            )
          })}
        </div>
      )}

      <div className={`card-grid loading-dim${loading ? ' is-loading' : ''}`}>
        <div className="card span-12">
          <div className="networth-chart-header">
            <h2 className="eyebrow">By group over time</h2>
            <div className="segmented" role="group" aria-label="Granularity">
              {(['monthly', 'quarterly'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  className={granularity === g ? 'active' : ''}
                  onClick={() => {
                    if (g === granularity) return
                    beginLoad()
                    setGranularity(g)
                  }}
                >
                  {g === 'monthly' ? 'Monthly' : 'Quarterly'}
                </button>
              ))}
            </div>
          </div>
          {stackedOption ? (
            <EChart option={stackedOption} height={360} />
          ) : (
            !loading &&
            !error && (
              <div className="empty-note">
                No snapshots yet — enter your first month to start the chart.
              </div>
            )
          )}
        </div>

        <div className="card span-12">
          <h2 className="eyebrow">Accounts — latest {granularity === 'quarterly' ? 'quarter' : 'month'}</h2>
          <p className="drill-hint">
            Select up to {MAX_DRILL} accounts to compare their history below.
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Group</th>
                <th className="num">Balance</th>
                <th className="num">{momHeader}</th>
              </tr>
            </thead>
            <tbody>
              {data?.accounts.map((account) => {
                const values = data.series.find((s) => s.account_id === account.id)?.values ?? []
                const curr = lastIndex >= 0 ? values[lastIndex] : null
                const prev = lastIndex >= 1 ? values[lastIndex - 1] : null
                const pct = pctChange(curr, prev)
                const selected = drill.some((d) => d.accountId === account.id)
                return (
                  <tr
                    key={account.id}
                    className={account.is_component ? 'component-row' : undefined}
                    onClick={() => toggleDrill(account.id)}
                    style={{ cursor: 'pointer', background: selected ? 'var(--surface-2)' : undefined }}
                  >
                    <td>
                      <button
                        type="button"
                        className="row-toggle"
                        aria-pressed={selected}
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleDrill(account.id)
                        }}
                      >
                        {account.name}
                      </button>
                      {account.is_component && <span className="badge">component</span>}
                      {!account.is_active && <span className="badge">inactive</span>}
                    </td>
                    <td>{GROUP_LABELS[account.group]}</td>
                    <td className="num">{formatCurrency(curr)}</td>
                    <td className="num">
                      {pct === null ? (
                        '—'
                      ) : (
                        <span className={pct >= 0 ? 'delta-positive' : 'delta-negative'}>
                          {formatPct(pct)}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {data && months.length > 0 && (
              <tfoot>
                <tr>
                  <td style={{ fontWeight: 600 }}>Net worth</td>
                  <td />
                  <td className="num" style={{ fontWeight: 600 }}>
                    {formatCurrency(data.net_worth[lastIndex])}
                  </td>
                  <td className="num">{formatPct(data.mom_pct[lastIndex])}</td>
                </tr>
              </tfoot>
            )}
          </table>
          <p className="drill-hint" style={{ marginTop: '0.5rem' }}>
            Component accounts are tracked inside an aggregate account and are excluded
            from group totals and net worth.
          </p>
        </div>

        {drillOption && (
          <div className="card span-12">
            <h2 className="eyebrow">Account drill-down</h2>
            <EChart option={drillOption} height={280} />
          </div>
        )}
      </div>
    </div>
  )
}
