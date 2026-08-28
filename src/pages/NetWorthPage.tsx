import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PencilLine } from 'lucide-react'
import { fetchSummary, fetchTimeseries } from '../api/netWorth'
import type { OwnerScope } from '../api/netWorth'
import { fetchHousehold } from '../api/household'
import { ApiError } from '../api/client'
import { getSnapshot, setSnapshot } from '../api/snapshotCache'
import ChartZoomHint from '../components/ChartZoomHint'
import EChart from '../components/EChart'
import InfoHint from '../components/InfoHint'
import MonthRibbon from '../components/MonthRibbon'
import RangeChips from '../components/RangeChips'
import StatTile from '../components/StatTile'
import {
  NOTES_SERIES,
  marriageMarkLine,
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
import type {
  AccountGroup,
  HouseholdOut,
  NetWorthSummary,
  NetWorthTimeseries,
} from '../types/api'
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

// Keyed by the fetch parameters: flipping granularity or owner is a DIFFERENT snapshot.
function netWorthKey(granularity: 'monthly' | 'quarterly', owner: OwnerScope): string {
  return `net-worth:${granularity}:${owner ?? 'all'}`
}

interface NetWorthSnapshot {
  ts: NetWorthTimeseries
  summary: NetWorthSummary
}

// Default drill pick — the single biggest account by latest balance (signed, so
// liabilities never win; components skipped — their aggregate represents them).
// Extracted from load()'s .then so a cache-seeded mount derives the same default.
function defaultDrill(ts: NetWorthTimeseries): { accountId: number; slot: number }[] {
  if (ts.months.length === 0) return []
  const last = ts.months.length - 1
  const valueById = new Map(ts.series.map((s) => [s.account_id, s.values[last]]))
  const best = ts.accounts
    .filter((a) => !a.is_component)
    .map((a) => ({ id: a.id, value: Number(valueById.get(a.id) ?? 0) }))
    .filter((c) => Number.isFinite(c.value))
    .sort((a, b) => b.value - a.value)[0]
  return best ? [{ accountId: best.id, slot: 0 }] : []
}

export default function NetWorthPage() {
  const navigate = useNavigate()
  const [granularity, setGranularity] = useState<'monthly' | 'quarterly'>('monthly')
  // The page's ownership scope: null = the whole household (and NO owner param at all, so
  // the request is byte-identical to the pre-ownership one). It scopes the tiles, both
  // charts and the accounts table, which is why the chips sit above the tiles rather than
  // inside a card header.
  const [owner, setOwner] = useState<OwnerScope>(null)
  // Fetched on its own, never inside the page's Promise.all: the chips are an affordance,
  // and a household hiccup must not blank the net worth (OverviewPage's isolated-fetch
  // posture). null covers both "not loaded yet" and "failed".
  const [household, setHousehold] = useState<HouseholdOut | null>(null)
  // Group stacking stays the default (spec §6): "how is it invested" is the question this
  // chart has always answered; "whose is it" is the new second reading of the same total.
  const [stackBy, setStackBy] = useState<'group' | 'owner'>('group')
  // The initial fetch parameters are monthly + the whole household, so the mount seed
  // reads exactly the key that mount's load() will write.
  const cached = getSnapshot<NetWorthSnapshot>(netWorthKey('monthly', null))
  const [data, setData] = useState<NetWorthTimeseries | null>(cached?.ts ?? null)
  const [summary, setSummary] = useState<NetWorthSummary | null>(cached?.summary ?? null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // false once a revalidation actually CHANGES the data — charts may animate again.
  const [fromCache, setFromCache] = useState(cached !== undefined)
  // Drill-down: selection order assigns the lowest free palette slot; removing one
  // never repaints the survivors (dataviz: color follows the entity, not its rank).
  const [drill, setDrill] = useState<{ accountId: number; slot: number }[]>(() =>
    cached ? defaultDrill(cached.ts) : [],
  )
  // Seed the drill-down once per visit so the card is never an empty box by default;
  // a deliberate clear-all afterwards must stay cleared across refetches.
  const seededDrillRef = useRef(cached !== undefined && cached.ts.months.length > 0)
  // Ribbon coverage is captured ONLY from monthly responses — the quarterly fetch
  // filters months server-side and must not make covered months read as missing.
  const [coverageMonths, setCoverageMonths] = useState<string[]>(cached ? cached.ts.months : [])
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
  // MERGED, never replaced: echarts hands over the FIRING chart's whole name→shown map,
  // and the stacked chart's groups are not the drill chart's accounts — replacing would
  // let a toggle on one resurrect a series hidden on the other. A stale key is inert in
  // legend.selected (echarts ignores names no series claims), so merging is the safe way.
  const onLegendChange = (selected: Record<string, boolean>) =>
    setLegendSelected((current) => ({ ...current, ...selected }))
  const onZoomWindow = (nextWindow: ZoomWindow) =>
    setRange((current) => ({ preset: current.preset, window: nextWindow }))

  // Promise callbacks rather than async/await, and no setState before the fetch starts:
  // every state update has to land in an async continuation, never in the synchronous
  // body of the effect below (react-hooks/set-state-in-effect — the same constraint
  // AuthContext documents; the rule reads `await` continuations as synchronous).
  const load = useCallback(() => {
    Promise.all([fetchTimeseries(granularity, owner), fetchSummary(owner)])
      .then(([ts, sum]) => {
        const key = netWorthKey(granularity, owner)
        const snapshot: NetWorthSnapshot = { ts, summary: sum }
        const previous = getSnapshot<NetWorthSnapshot>(key)
        setSnapshot(key, snapshot)
        setError(null)
        // Identical payload: nothing re-renders, the charts stay still (spec §1).
        if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(snapshot))
          return
        setFromCache(false)
        setData(ts)
        setSummary(sum)
        if (granularity === 'monthly') setCoverageMonths(ts.months)
        if (!seededDrillRef.current && ts.months.length > 0) {
          seededDrillRef.current = true
          const seed = defaultDrill(ts)
          if (seed.length > 0) {
            setDrill((current) => (current.length > 0 ? current : seed))
          }
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Failed to load net worth data')
      })
      .finally(() => setLoading(false))
  }, [granularity, owner])

  // The "we're fetching" flip therefore lives in the event handlers that cause a fetch —
  // the mount fetch is covered by useState's initial `true`.
  const beginLoad = () => {
    setLoading(true)
    setError(null)
  }

  useEffect(() => {
    load()
  }, [load])

  // Once per visit, and deliberately not part of `load`: setState lives in the promise
  // continuations, never in the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    fetchHousehold()
      .then(setHousehold)
      .catch(() => setHousehold(null))
  }, [])

  // Primary first, then everyone else by id — the same order the server uses for
  // owner_series/owner_totals, so chips and stack read left-to-right the same way. The
  // `?? []` lives INSIDE the memo: a fresh literal in the dep list would re-sort on every
  // render (react-hooks/exhaustive-deps), which is the memo doing nothing.
  const orderedPeople = useMemo(
    () =>
      [...(household?.people ?? [])].sort(
        (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.id - b.id,
      ),
    [household],
  )
  // One person means there is nothing to choose between: no chips, no stack toggle.
  const ownerScopes: { scope: OwnerScope; label: string }[] =
    orderedPeople.length > 1
      ? [
          { scope: null, label: 'All' },
          ...orderedPeople.map((p) => ({ scope: p.id as OwnerScope, label: p.name })),
          { scope: 'joint' as OwnerScope, label: 'Joint' },
        ]
      : []

  const selectOwner = (next: OwnerScope) => {
    if (next === owner) return
    beginLoad()
    // The drill-down holds ACCOUNT ids, and the next scope may not contain them — clear it
    // and let the seed pick this scope's biggest account instead of leaving empty series.
    setDrill([])
    seededDrillRef.current = false
    setOwner(next)
  }

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
    const marriageMark = marriageMarkLine(data.months, household?.marriage_date ?? null)
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
        // Owner columns already sum to the net-worth row, so an "Assets" subtotal would
        // just print the same number twice: no asset set in owner mode, no subtotal row.
        formatter: netWorthStackedTooltipFormatter(
          stackBy === 'owner' ? [] : ASSET_GROUPS.map((g) => GROUP_LABELS[g]),
        ),
      },
      xAxis: { type: 'category', data: labels, boundaryGap: false },
      yAxis: {
        type: 'value',
        axisLabel: { formatter: (value: number) => formatCurrencyCompact(value) },
      },
      series: [
        ...(stackBy === 'owner'
          ? (data.owner_series ?? []).map((series) => ({
              // The server's owner_series is EXCLUSIVE and sums to net_worth, so the stack
              // lands exactly on the line below. `?? []` is stale-deploy armor, like notes.
              name: series.name ?? 'Joint',
              type: 'line' as const,
              stack: 'owner',
              // Owner columns are NET (assets minus that owner's liabilities), so one of
              // them can go negative. echarts' default 'samesign' strategy would then park
              // it on the baseline and the stack would stop meeting the net-worth line;
              // 'all' keeps the sum honest.
              stackStrategy: 'all' as const,
              symbol: 'none' as const,
              lineStyle: { width: 1 },
              areaStyle: { opacity: 0.5 },
              // Colour is keyed by the person's HOUSEHOLD slot (primary first, then by id,
              // joint last), not by position in this response — owner_series membership
              // varies with the chip scope, and a person must keep their colour across
              // scopes. Households are far smaller than PALETTE (theme.ts caps at 8).
              color:
                PALETTE[
                  (series.person_id === null
                    ? orderedPeople.length
                    : Math.max(
                        orderedPeople.findIndex((p) => p.id === series.person_id),
                        0,
                      )) % PALETTE.length
                ],
              data: series.values.map(Number),
            }))
          : [
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
            ]),
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
          // The wedding rule rides the net-worth line: one annotation, on the series that
          // is present in BOTH stack modes.
          ...(marriageMark ? { markLine: marriageMark } : {}),
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
  }, [data, range, legendSelected, stackBy, household, orderedPeople])

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

      {ownerScopes.length > 0 && (
        <div className="networth-owner-row">
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
          <InfoHint text="A person's view is their own accounts plus the joint ones — that is what a joint account is. Joint shows only the shared accounts." />
        </div>
      )}

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
              {ownerScopes.length > 0 && (
                <div className="segmented" role="group" aria-label="Stack by">
                  {(['group', 'owner'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={stackBy === mode ? 'active' : ''}
                      aria-pressed={stackBy === mode}
                      onClick={() => setStackBy(mode)}
                    >
                      {mode === 'group' ? 'By group' : 'By owner'}
                    </button>
                  ))}
                </div>
              )}
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
            <>
              <EChart
                option={stackedOption}
                height={360}
                onLegendChange={onLegendChange}
                onDataZoom={onZoomWindow}
                exportConfig={{ name: 'net-worth', csv: () => netWorthCsv(data) }}
                animateEntrance={!fromCache}
              />
              <ChartZoomHint />
            </>
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
            <>
              <EChart
                option={drillOption}
                height={280}
                onLegendChange={onLegendChange}
                onDataZoom={onZoomWindow}
                animateEntrance={!fromCache}
              />
              <ChartZoomHint />
            </>
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
