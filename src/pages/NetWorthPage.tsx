import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PencilLine } from 'lucide-react'
import { fetchSummary, fetchTimeseries } from '../api/netWorth'
import { ApiError } from '../api/client'
import EChart from '../components/EChart'
import InfoHint from '../components/InfoHint'
import MonthRibbon from '../components/MonthRibbon'
import RangeChips from '../components/RangeChips'
import StatTile from '../components/StatTile'
import {
  NOTES_SERIES,
  netWorthCsv,
  netWorthStackedTooltipFormatter,
} from '../components/networth/netWorthChartOptions'
import type { EChartsOption } from '../charts/echarts'
import { rangeZoom } from '../charts/timeZoom'
import type { RangeState, ZoomWindow } from '../charts/timeZoom'
import {
  GROUP_COLORS,
  GROUP_LABELS,
  GROUP_ORDER,
  INK,
  MUTED,
  PALETTE,
} from '../charts/theme'
import type { AccountGroup, NetWorthSummary, NetWorthTimeseries } from '../types/api'
import { nestComponents } from '../utils/accounts'
import {
  formatCurrency,
  formatCurrencyCompact,
  formatMonth,
  formatPct,
} from '../utils/format'
import { currentMonthIso } from '../utils/months'
import { toneOf } from '../utils/tone'
import '../components/panels.css'
import './NetWorthPage.css'

const ASSET_GROUPS = GROUP_ORDER.filter((g): g is AccountGroup => g !== 'liability')
// One slot per validated palette hue (theme.ts: never cycle past 8).
const MAX_DRILL = PALETTE.length

// The three group tiles are one map over one shape, so they share one hint — three copies
// of the same sentence would be three chances to edit only two of them.
const GROUP_TILE_HINT = "This group's latest total and its change from the prior snapshot."

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
  // Seed the drill-down once per visit so the card is never an empty box by default;
  // a deliberate clear-all afterwards must stay cleared across refetches.
  const seededDrillRef = useRef(false)
  // Ribbon coverage is captured ONLY from monthly responses — the quarterly fetch
  // filters months server-side and must not make covered months read as missing.
  const [coverageMonths, setCoverageMonths] = useState<string[]>([])
  // The page's time window, applied to BOTH time charts (they share one month axis, and
  // two range controls answering one question would drift). An OBJECT, not a bare preset:
  // re-clicking the active chip hands the memos a fresh identity, which is what snaps a
  // ctrl+wheel wander back to the preset (RangeChips' contract) — and it now carries any
  // manual window mirrored back from a chart's datazoom event (2026-08-25 spec §2e).
  const [range, setRange] = useState<RangeState>({ preset: 'all' })
  // Mirrors of the charts' own events (2026-08-25 spec §2e): legend picks and a manual
  // ctrl+wheel window become page state, fed back through the memoized options, so a
  // granularity refetch or notMerge rebuild no longer resets them — and both charts
  // share one window, like they share the chips.
  const [legendSelected, setLegendSelected] = useState<Record<string, boolean>>({})
  const onLegendChange = (selected: Record<string, boolean>) => setLegendSelected(selected)
  const onZoomWindow = (nextWindow: ZoomWindow) =>
    setRange((current) => ({ preset: current.preset, window: nextWindow }))

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
        if (!seededDrillRef.current && ts.months.length > 0) {
          seededDrillRef.current = true
          // Default: the single biggest account by latest balance (signed, so
          // liabilities never win; components skipped — their aggregate represents them).
          const last = ts.months.length - 1
          const valueById = new Map(ts.series.map((s) => [s.account_id, s.values[last]]))
          const best = ts.accounts
            .filter((a) => !a.is_component)
            .map((a) => ({ id: a.id, value: Number(valueById.get(a.id) ?? 0) }))
            .filter((c) => Number.isFinite(c.value))
            .sort((a, b) => b.value - a.value)[0]
          if (best) {
            setDrill((current) =>
              current.length > 0 ? current : [{ accountId: best.id, slot: 0 }],
            )
          }
        }
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
    // The annotation layer: one marker per NOTED month, sitting on the net-worth line at
    // that month's value. (data.notes ?? []) is stale-deploy armor — a tab served the old
    // bundle keeps working against a payload that already carries notes, and vice versa.
    const noted = data.months
      .map((_, i) => ({
        label: labels[i],
        value: Number(data.net_worth[i]),
        note: (data.notes ?? [])[i],
      }))
      .filter((p): p is { label: string; value: number; note: string } => !!p.note)
    return {
      // Windowed, not sliced: dataZoom keeps the whole series loaded so a ctrl+wheel or a
      // chip flip never refetches, and the y-axis re-scales to the visible window (filter
      // mode) so a zoomed-in year is read at its own scale.
      dataZoom: rangeZoom(data.months, range),
      grid: { left: 70, right: 84, top: 40, bottom: 28 },
      legend: { top: 0, selected: legendSelected },
      tooltip: {
        trigger: 'axis',
        // Asset rows + their subtotal, then liabilities/net worth/notes — the formatter
        // (and its escapeHtml duty on note text) lives in netWorthChartOptions.ts.
        formatter: netWorthStackedTooltipFormatter(ASSET_GROUPS.map((g) => GROUP_LABELS[g])),
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
        ...(noted.length > 0
          ? [
              {
                name: NOTES_SERIES,
                // Plain scatter, deliberately not effectScatter: a note is history, and
                // the ripple is the live ping's reserved "this is now" signal. Diamond +
                // MUTED = identity by SHAPE and a neutral tone — the wizard's notes are
                // an annotation layer, not a fourth data hue (theme.ts's ≤3-hue law).
                type: 'scatter' as const,
                symbol: 'diamond' as const,
                symbolSize: 9,
                color: MUTED,
                itemStyle: { borderColor: INK, borderWidth: 1 },
                emphasis: { itemStyle: { borderColor: INK } },
                z: 11,
                data: noted.map((p) => ({ value: [p.label, p.value], note: p.note })),
              },
            ]
          : []),
      ],
    }
  }, [data, range, legendSelected])

  const drillOption = useMemo<EChartsOption | null>(() => {
    if (!data || drill.length === 0) return null
    const byId = new Map(data.series.map((s) => [s.account_id, s.values]))
    const nameById = new Map(data.accounts.map((a) => [a.id, a.name]))
    return {
      dataZoom: rangeZoom(data.months, range), // the page's one window (see `range`)
      grid: { left: 70, right: 24, top: 40, bottom: 28 },
      legend: { top: 0, selected: legendSelected },
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
  }, [data, drill, range, legendSelected])

  const toggleDrill = (accountId: number) => {
    setDrill((current) => {
      const existing = current.find((d) => d.accountId === accountId)
      if (existing) return current.filter((d) => d.accountId !== accountId)
      if (current.length >= MAX_DRILL) return current
      const used = new Set(current.map((d) => d.slot))
      const slot = Array.from({ length: MAX_DRILL }, (_, i) => i).find((s) => !used.has(s)) ?? 0
      return [...current, { accountId, slot }]
    })
  }

  // Components sit under their parent aggregate (table indent + chip adjacency),
  // not at their raw sheet-column sort position.
  const orderedAccounts = useMemo(() => (data ? nestComponents(data.accounts) : []), [data])

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
            // Shared rule (src/utils/tone.ts): a flat month is NEUTRAL. This tile used to
            // fold zero into positive; ratified Plan 6 Task 8 review — a green "▲ $0.00"
            // congratulates the user for standing still.
            tone={toneOf(summary.mom_delta)}
            hint="Assets minus liabilities for the latest snapshot; liabilities are entered as negatives."
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
                tone={toneOf(delta)}
                hint={GROUP_TILE_HINT}
              />
            )
          })}
        </div>
      )}

      <div className={`card-grid loading-dim${loading ? ' is-loading' : ''}`}>
        <div className="card span-12">
          <div className="networth-chart-header">
            <h2 className="eyebrow">
              By group over time
              <InfoHint text="Asset groups stacked to their combined total, with liabilities and net worth as their own lines. Diamonds mark months with a saved note." />
            </h2>
            <div className="networth-chart-controls">
              {/* One window for the whole page: the drill-down below follows these chips
                  too (both charts share the month axis). */}
              <RangeChips value={range.preset} onChange={setRange} />
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
          </div>
          {stackedOption && data ? (
            <EChart
              option={stackedOption}
              height={360}
              onLegendChange={onLegendChange}
              onDataZoom={onZoomWindow}
              exportConfig={{ name: 'net-worth', csv: () => netWorthCsv(data) }}
            />
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
          <h2 className="eyebrow">
            Account drill-down
            <InfoHint text="Individual account balances over time — toggle accounts here or by clicking table rows." />
          </h2>
          <p className="drill-hint">
            Pick up to {MAX_DRILL} accounts to compare their history. Clicking rows in the
            accounts table below toggles them here too.
          </p>
          <div className="chip-row">
            {orderedAccounts.map((account) => {
              const active = drill.find((d) => d.accountId === account.id)
              // Slot hue goes on the BORDER, never the text (SpendingPage's chip rule).
              return (
                <button
                  key={account.id}
                  type="button"
                  className={active ? 'chip active' : 'chip'}
                  style={active ? { borderColor: PALETTE[active.slot] } : undefined}
                  aria-pressed={!!active}
                  onClick={() => toggleDrill(account.id)}
                >
                  {account.name}
                </button>
              )
            })}
          </div>
          {drillOption ? (
            <EChart
              option={drillOption}
              height={280}
              onLegendChange={onLegendChange}
              onDataZoom={onZoomWindow}
            />
          ) : (
            !loading && <div className="empty-note">No accounts selected.</div>
          )}
        </div>

        <div className="card span-12">
          <h2 className="eyebrow">
            Accounts — latest {granularity === 'quarterly' ? 'quarter' : 'month'}
            <InfoHint text="Each account's latest balance and change. Component accounts live inside a parent aggregate and are excluded from totals." />
          </h2>
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
              {orderedAccounts.map((account) => {
                const values = data?.series.find((s) => s.account_id === account.id)?.values ?? []
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
      </div>
    </div>
  )
}
