import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PencilLine } from 'lucide-react'
import { fetchSummary, fetchTimeseries } from '../api/netWorth'
import type { OwnerScope } from '../api/netWorth'
import { fetchHousehold } from '../api/household'
import { ApiError } from '../api/client'
import { getSnapshot, setSnapshot } from '../api/snapshotCache'
import { useAssistantView } from '../components/assistant/viewState'
import ChartCard from '../components/ChartCard'
import InfoHint from '../components/InfoHint'
import PageFrame from '../components/shell/PageFrame'
import ScopeBar from '../components/shell/ScopeBar'
import Segmented from '../components/shell/Segmented'
import { useScope } from '../components/shell/useScope'
import StatTile from '../components/StatTile'
import { useArrivalValue } from '../components/useArrivalParam'
import {
  STACK_MODES,
  netWorthBridgeCsv,
  netWorthBridgeOption,
  netWorthCsv,
  netWorthDrillCsv,
  netWorthDrillOption,
  netWorthStackOption,
} from '../components/networth/netWorthChartOptions'
import type { StackMode } from '../components/networth/netWorthChartOptions'
import { resolvedWindow } from '../charts/timeZoom'
import type { RangeState, ZoomWindow } from '../charts/timeZoom'
import { GROUP_LABELS, PALETTE } from '../charts/theme'
import type {
  AccountGroup,
  HouseholdOut,
  NetWorthSummary,
  NetWorthTimeseries,
} from '../types/api'
import { nestComponents } from '../utils/accounts'
import { formatCurrency, formatMonth, formatPct } from '../utils/format'
import { toneOf } from '../utils/tone'
import '../components/panels.css'
import './NetWorthPage.css'

// One slot per validated palette hue (theme.ts: never cycle past 8).
const MAX_DRILL = PALETTE.length

// The three group tiles are one map over one shape, so they share one hint — three copies
// of the same sentence would be three chances to edit only two of them.
const GROUP_TILE_HINT = "This group's latest total and its change from the prior snapshot."

function pctChange(curr: string | null, prev: string | null): number | null {
  if (curr === null || prev === null || Number(prev) === 0) return null
  return (Number(curr) - Number(prev)) / Math.abs(Number(prev))
}

// Keyed by the fetch parameters: flipping granularity, owner or the VIEWED month is a
// different snapshot. The family prefix is the one client.ts's invalidation map lists.
function netWorthKey(
  granularity: 'monthly' | 'quarterly',
  owner: OwnerScope,
  month: string | null,
): string {
  return `networth:${granularity}:${owner ?? 'all'}:${month ?? 'latest'}`
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
  // The URL owns owner, range and the viewed month (2026-09-03 shell spec §6); the scope
  // row writes them and this page ADOPTS them below.
  const { scope } = useScope({ owner: true, range: true, month: true })
  // The page's ownership scope: null = the whole household (and NO owner param at all, so
  // the request is byte-identical to the pre-ownership one). It scopes the tiles, both
  // charts and the accounts table. Local state, mirroring the URL, exists only so the
  // peek-and-reset sequence below runs exactly once per change.
  const [owner, setOwner] = useState<OwnerScope>(scope.owner)
  // Same job for the VIEWED month: a ribbon click swaps the table to that column instantly
  // while the summary is still in flight, so the dim is what admits the tiles are behind.
  const [seenMonth, setSeenMonth] = useState<string | null>(scope.month)
  // What the assistant must answer against: the scope and grain ON SCREEN (2026-09-01
  // spec §6). `owner` is stringified because the scope is a person id OR the literal
  // 'joint' — one type on the wire beats a union.
  useAssistantView({ owner: owner === null ? null : String(owner), granularity })
  // Fetched on its own, never inside the page's Promise.all: the chips are an affordance,
  // and a household hiccup must not blank the net worth (OverviewPage's isolated-fetch
  // posture). null covers both "not loaded yet" and "failed".
  const [household, setHousehold] = useState<HouseholdOut | null>(null)
  // Group stacking stays the default (spec §6): "how is it invested" is the question this
  // chart has always answered; "whose is it" and "what share" are the other two readings
  // of the same total.
  const [stackBy, setStackBy] = useState<StackMode>('group')
  // The initial fetch parameters are monthly + whatever the URL says, so the mount seed
  // reads exactly the key that mount's load() will write.
  const cached = getSnapshot<NetWorthSnapshot>(netWorthKey('monthly', scope.owner, scope.month))
  const [data, setData] = useState<NetWorthTimeseries | null>(cached?.ts ?? null)
  const [summary, setSummary] = useState<NetWorthSummary | null>(cached?.summary ?? null)
  // What the charts are actually SHOWING. The revalidation skip in load() is judged
  // against this, never against the snapshot cache: render and cache diverge across
  // owner/granularity switches (the previous scope's charts are still up while the next
  // scope's key is warm), and skipping on the cache stranded the page on the previous
  // scope forever (2026-08-28 bug).
  const shown = useRef<NetWorthSnapshot | null>(cached ?? null)
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
  // The scope the drill seed was last armed for — a new one re-arms it (see load()).
  const lastOwnerRef = useRef<OwnerScope>(scope.owner)
  // ?drill=<slug> — the palette's account entries pick that account's series (spec §9).
  // Matched on the SLUG the API also hands the palette, never on a name: a rename must
  // not break a deep link. An account outside the current scope simply finds nothing and
  // the drill is left alone, rather than showing an empty chart.
  const arriveOnDrill = useCallback(
    (slug: string) => {
      // Nothing to resolve the slug against yet — hold the param and answer again when
      // the payload lands (useArrivalValue's "not yet" contract).
      if (!data) return false
      const account = data.accounts.find((a) => a.slug === slug)
      if (account) setDrill([{ accountId: account.id, slot: 0 }])
      return true
    },
    [data],
  )
  useArrivalValue('drill', arriveOnDrill)
  // The page's time window, applied to BOTH time charts (they share one month axis, and
  // two range controls answering one question would drift). An OBJECT, not a bare preset:
  // it also carries any manual window mirrored back from a chart's datazoom event
  // (2026-08-25 spec §2e), which the scope row's next preset then snaps away. The preset
  // itself is the URL's — a re-click is no longer expressible, so a wander now ends by
  // choosing a DIFFERENT preset (or by zooming back out).
  const [range, setRange] = useState<RangeState>({ preset: scope.range })
  // Mirrors of the charts' own events (2026-08-25 spec §2e), fed back through the
  // memoized options so a granularity refetch or notMerge rebuild no longer resets them.
  // The ZOOM window stays shared — both charts ride one month axis and one set of chips.
  // Legend picks are one map PER CHART (2026-08-31 tier-1 A2): an account literally named
  // "Cash"/"Other"/"Taxable"/"Net worth" collides with a group series' name, and one
  // merged map let a drill toggle silently hide the same-named GROUP in the stacked chart
  // (and shrink the tooltip's Assets subtotal). Each chart feeds and reads only its own.
  // Still MERGED within a chart: echarts hands over the firing chart's whole name→shown
  // map, and a stale key is inert in legend.selected (echarts ignores unclaimed names).
  const [stackedLegend, setStackedLegend] = useState<Record<string, boolean>>({})
  const [drillLegend, setDrillLegend] = useState<Record<string, boolean>>({})
  const onStackedLegendChange = (selected: Record<string, boolean>) =>
    setStackedLegend((current) => ({ ...current, ...selected }))
  const onDrillLegendChange = (selected: Record<string, boolean>) =>
    setDrillLegend((current) => ({ ...current, ...selected }))
  const onZoomWindow = (nextWindow: ZoomWindow) =>
    setRange((current) => ({ preset: current.preset, window: nextWindow }))

  // The URL is the source of truth; this page ADOPTS a change with the adjust-during-render
  // pattern (CategoriesPanel's precedent) — never a setState inside an effect body
  // (react-hooks/set-state-in-effect).
  if (scope.owner !== owner) {
    // The drill-down holds ACCOUNT ids, and the next scope may not contain them — clear it
    // and let load()'s seed pick this scope's biggest account instead of empty series.
    setDrill([])
    setLoading(true)
    setError(null)
    // Already-seen scope: paint it instantly and revalidate underneath (Overview's
    // showFlowYear seed). `shown` is deliberately NOT written here — a ref write belongs in
    // a promise continuation, and leaving it on the previous scope costs one extra repaint
    // when the live payload lands, nothing more.
    const peeked = getSnapshot<NetWorthSnapshot>(
      netWorthKey(granularity, scope.owner, scope.month),
    )
    if (peeked !== undefined) {
      setFromCache(true)
      setData(peeked.ts)
      setSummary(peeked.summary)
      if (peeked.ts.months.length > 0) setDrill(defaultDrill(peeked.ts))
    }
    setOwner(scope.owner)
  }

  if (scope.month !== seenMonth) {
    // Month only: the drill holds account ids, and those do not change with the month.
    setSeenMonth(scope.month)
    setLoading(true)
    setError(null)
  }

  if (scope.range !== range.preset) {
    // A new preset from the scope row snaps any ctrl+wheel wander (the chips' old contract).
    setRange({ preset: scope.range })
  }

  // Promise callbacks rather than async/await, and no setState before the fetch starts:
  // every state update has to land in an async continuation, never in the synchronous
  // body of the effect below (react-hooks/set-state-in-effect — the same constraint
  // AuthContext documents; the rule reads `await` continuations as synchronous).
  const load = useCallback(() => {
    Promise.all([
      fetchTimeseries(granularity, owner),
      // The viewed month, or undefined for "the latest" — the ribbon's click-to-view.
      fetchSummary(owner, scope.month ?? undefined),
    ])
      .then(([ts, sum]) => {
        const key = netWorthKey(granularity, owner, scope.month)
        const snapshot: NetWorthSnapshot = { ts, summary: sum }
        setSnapshot(key, snapshot)
        setError(null)
        // A new owner scope re-arms the drill seed: the previous scope's pick was cleared
        // during render, and this payload's biggest account is the right default. Ahead of
        // the skip below, so two scopes that happen to answer identically still re-arm.
        if (lastOwnerRef.current !== owner) {
          lastOwnerRef.current = owner
          seededDrillRef.current = false
        }
        // Ahead of the skip for the same reason: the render that adopted the new scope
        // CLEARED the drill, so a scope whose payload happens to equal what is on screen
        // would otherwise return below and leave the card reading "No accounts selected."
        // until a manual pick. The functional form is what keeps a deliberate clear-all
        // cleared — it only fills a selection that is already empty.
        if (!seededDrillRef.current && ts.months.length > 0) {
          seededDrillRef.current = true
          const seed = defaultDrill(ts)
          if (seed.length > 0) {
            setDrill((current) => (current.length > 0 ? current : seed))
          }
        }
        // Identical payload: nothing re-renders, the charts stay still (spec §1) — judged
        // against the RENDERED snapshot, never the cache (see `shown`).
        if (shown.current !== null && JSON.stringify(shown.current) === JSON.stringify(snapshot))
          return
        shown.current = snapshot
        setFromCache(false)
        setData(ts)
        setSummary(sum)
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Failed to load net worth data')
      })
      .finally(() => setLoading(false))
  }, [granularity, owner, scope.month])

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
  // The field is `ownerScope`, not `scope`: the page's URL scope is already called that,
  // and a destructured `{ scope }` below would shadow it.
  const ownerScopes: { ownerScope: OwnerScope; label: string }[] =
    orderedPeople.length > 1
      ? [
          { ownerScope: null, label: 'All' },
          ...orderedPeople.map((p) => ({ ownerScope: p.id as OwnerScope, label: p.name })),
          { ownerScope: 'joint' as OwnerScope, label: 'Joint' },
        ]
      : []

  // The ribbon prints that month's net worth in its chip label (spec §7) — the figure the
  // page already has, rather than a second round trip per chip.
  const ribbonFigures = useMemo(
    () =>
      data === null
        ? undefined
        : Object.fromEntries(data.months.map((m, i) => [m, formatCurrency(data.net_worth[i])])),
    [data],
  )

  // Resolved target for EChart's animated zoom path — memoized so the wrapper's
  // fingerprint compare runs only when the window can actually have moved.
  const zoomWindow = useMemo(
    () => (data === null ? undefined : resolvedWindow(data.months, range)),
    [data, range],
  )

  const months = data?.months ?? []
  // The accounts table follows the VIEWED month (a ribbon click writes ?month=), and the
  // latest column when nothing is selected — or when the selection has no column in this
  // scope at all (a quarterly grain, a series that starts later).
  const selectedIndex = scope.month === null ? -1 : months.indexOf(scope.month)
  const viewedIndex = selectedIndex >= 0 ? selectedIndex : months.length - 1
  // …so the card heading names that month rather than claiming "latest" over it.
  const viewedLabel =
    selectedIndex >= 0
      ? formatMonth(months[selectedIndex])
      : `latest ${granularity === 'quarterly' ? 'quarter' : 'month'}`
  const momHeader = granularity === 'quarterly' ? 'QoQ %' : 'MoM %'

  const stackedOption = useMemo(
    () =>
      data === null
        ? null
        : netWorthStackOption({
            ts: data,
            mode: stackBy,
            people: orderedPeople,
            marriageDate: household?.marriage_date ?? null,
            range,
            selected: stackedLegend,
          }),
    [data, stackBy, orderedPeople, household, range, stackedLegend],
  )
  const drillOption = useMemo(
    () => (data === null ? null : netWorthDrillOption({ ts: data, drill, range, selected: drillLegend })),
    [data, drill, range, drillLegend],
  )
  // The viewed month against the one before it — null on the first snapshot, where there
  // is nothing to bridge FROM.
  const bridgeOption = useMemo(
    () => (data === null ? null : netWorthBridgeOption(data, viewedIndex)),
    [data, viewedIndex],
  )

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

  // Segmented hands back the FULL next selection in options order; slots are still
  // assigned one at a time, so the diff is replayed through toggleDrill — removing an
  // account never repaints the survivors (dataviz: colour follows the entity, not its rank).
  const syncDrill = (values: string[]) => {
    const next = new Set(values.map(Number))
    for (const { accountId } of drill) if (!next.has(accountId)) toggleDrill(accountId)
    for (const id of next) if (!drill.some((d) => d.accountId === id)) toggleDrill(id)
  }

  // Components sit under their parent aggregate (table indent + chip adjacency),
  // not at their raw sheet-column sort position.
  const orderedAccounts = useMemo(() => (data ? nestComponents(data.accounts) : []), [data])


  return (
    <div className="page">
      <PageFrame
        title="Net worth"
        actions={
          <button className="button button-primary" onClick={() => navigate('/update')}>
            <PencilLine size={15} /> Enter month
          </button>
        }
        scopeRow={
          <ScopeBar
            owner
            range
            month={{
              mode: 'view',
              figures: ribbonFigures,
              editHref: (m) => `/update?month=${m}`,
            }}
          />
        }
        resource={{
          status: data === null ? (error !== null ? 'error' : 'loading') : 'ready',
          error,
          busy: loading,
          fromCache,
          retry: () => {
            setLoading(true)
            setError(null)
            load()
          },
        }}
        skeleton={{
          tiles: 4,
          cards: [
            { span: 12, height: 360 },
            { span: 12, height: 300 },
          ],
        }}
      >
        {summary && summary.month && (
          <div className="kpi-row">
            <StatTile
              hero
              label={`Net worth — ${formatMonth(summary.month)}`}
              value={formatCurrency(summary.net_worth)}
              // Fresh paints only (spec §8); a decimal-string amount, so Number() for the ease.
              countUp={
                !fromCache && summary.net_worth !== null
                  ? { value: Number(summary.net_worth), format: formatCurrency }
                  : undefined
              }
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

        {/* D5 (2026-08-31): the latest snapshot split by owner — the same money the chips
            above scope, read straight off the already-fetched summary. Ordered BY the chips
            (primary, others, Joint) so the strip and the control can never disagree; an
            owner with no owner_totals row is SKIPPED, never a fabricated $0.00. Under a
            person scope the server narrows owner_totals to that person + Joint, and the
            strip honestly narrows with it. */}
        {ownerScopes.length > 0 && summary && summary.month && summary.owner_totals.length > 0 && (
          <dl className="networth-owner-strip">
            {ownerScopes
              .filter(({ ownerScope }) => ownerScope !== null)
              .map(({ ownerScope, label }) => {
                const entry = summary.owner_totals.find((total) =>
                  ownerScope === 'joint'
                    ? total.person_id === null
                    : total.person_id === ownerScope,
                )
                if (entry === undefined) return null
                return (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{formatCurrency(entry.total)}</dd>
                  </div>
                )
              })}
          </dl>
        )}

        <div className="card-grid">
          <ChartCard
            title="By group over time"
            hint={
              stackBy === 'share'
                ? 'Each asset group as a share of that month’s assets — composition, not size.'
                : 'Asset groups stacked to their combined total, with liabilities and net worth as their own lines. Diamonds mark months with a saved note. Liabilities under 1% of assets stay in the tooltip but are not drawn.'
            }
            ariaLabel={
              stackBy === 'owner'
                ? 'Stacked area chart of net worth by owner over time'
                : stackBy === 'share'
                  ? 'Stacked area chart of each asset group as a share of assets per month'
                  : 'Stacked area chart of asset groups over time with liabilities and net worth as lines'
            }
            option={stackedOption}
            empty="No snapshots yet — enter your first month to start the chart."
            exportName="net-worth"
            csv={data === null ? undefined : () => netWorthCsv(data)}
            height={360}
            zoomable
            group="net-worth"
            onLegendChange={onStackedLegendChange}
            onDataZoom={onZoomWindow}
            zoomWindow={zoomWindow}
            controls={
              <>
                <Segmented
                  variant="toggle"
                  size="sm"
                  ariaLabel="Stack by"
                  // One person means "whose" has nothing to choose between — By owner hides.
                  options={ownerScopes.length > 0 ? STACK_MODES : STACK_MODES.filter((m) => m.value !== 'owner')}
                  value={stackBy}
                  onChange={setStackBy}
                />
                <Segmented
                  variant="toggle"
                  size="sm"
                  ariaLabel="Granularity"
                  options={[
                    { value: 'monthly', label: 'Monthly' },
                    { value: 'quarterly', label: 'Quarterly' },
                  ]}
                  value={granularity}
                  onChange={(g) => {
                    // A press on the ACTIVE chip is a no-op, not a refetch: setGranularity
                    // would bail out and leave the dim raised with nothing coming to lower it.
                    if (g === granularity) return
                    setLoading(true)
                    setError(null)
                    // Same handler-side seed as the owner adoption above: a warm grain paints
                    // instantly, and the rendered-state guard in load() stays truthful. The
                    // ref write is fine HERE — an event handler, never a render.
                    const peeked = getSnapshot<NetWorthSnapshot>(
                      netWorthKey(g, owner, scope.month),
                    )
                    if (peeked !== undefined) {
                      shown.current = peeked
                      setFromCache(true)
                      setData(peeked.ts)
                      setSummary(peeked.summary)
                    }
                    setGranularity(g)
                  }}
                />
              </>
            }
          />

          {data !== null && viewedIndex >= 1 && (
            <ChartCard
              title={`What moved — ${formatMonth(months[viewedIndex])}`}
              hint="How each account group moved net worth from the prior snapshot to this one — a waterfall from last month’s total to this month’s. Groups that did not move are left out."
              ariaLabel="Waterfall chart of how each account group moved net worth from the prior month to this one"
              option={bridgeOption}
              empty="Nothing moved between these two months."
              exportName="net-worth-bridge"
              csv={() => netWorthBridgeCsv(data, viewedIndex)}
              height={280}
            />
          )}

          <ChartCard
            title="Account drill-down"
            hint="Individual account balances over time — toggle accounts below or by clicking table rows."
            ariaLabel="Line chart of the selected accounts’ balances over time"
            option={drillOption}
            empty="No accounts selected."
            exportName="net-worth-accounts"
            csv={data === null ? undefined : () => netWorthDrillCsv(data, drill)}
            height={280}
            zoomable
            group="net-worth"
            onLegendChange={onDrillLegendChange}
            onDataZoom={onZoomWindow}
            zoomWindow={zoomWindow}
            footer={
              <>
                <p className="drill-hint">
                  Pick up to {MAX_DRILL} accounts to compare their history. Clicking rows in the
                  accounts table below toggles them here too.
                </p>
                <Segmented
                  variant="chips"
                  multiple
                  ariaLabel="Accounts to compare"
                  options={orderedAccounts.map((account) => {
                    const active = drill.find((d) => d.accountId === account.id)
                    return {
                      value: String(account.id),
                      // Slot hue rides a swatch beside the name, never the text itself
                      // (SpendingPage's chip rule). The DOM swatch reads the CSS slot, not
                      // PALETTE: index.css repoints --chart-N per theme, so it tracks a
                      // light/dark switch that a baked hex would ignore. Slots are 0-based,
                      // the tokens are 1-based.
                      label: (
                        <>
                          {active !== undefined && (
                            <span
                              className="networth-drill-swatch"
                              aria-hidden="true"
                              style={{ background: `var(--chart-${active.slot + 1})` }}
                            />
                          )}
                          {account.name}
                        </>
                      ),
                      // Every palette slot spoken for: the rest go quiet rather than silently
                      // refusing the click (theme.ts: never cycle past 8).
                      disabled: active === undefined && drill.length >= MAX_DRILL,
                    }
                  })}
                  value={drill.map((d) => String(d.accountId))}
                  onChange={syncDrill}
                />
              </>
            }
          />

          <div className="card span-12">
            <h2 className="eyebrow">
              Accounts — {viewedLabel}
              <InfoHint text="Each account's balance for the month named above and its change from the one before. Component accounts live inside a parent aggregate and are excluded from totals." />
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
                  const curr = viewedIndex >= 0 ? values[viewedIndex] : null
                  const prev = viewedIndex >= 1 ? values[viewedIndex - 1] : null
                  const pct = pctChange(curr, prev)
                  const selected = drill.some((d) => d.accountId === account.id)
                  return (
                    <tr
                      key={account.id}
                      className={account.is_component ? 'component-row row-click' : 'row-click'}
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
                      {formatCurrency(data.net_worth[viewedIndex])}
                    </td>
                    <td className="num">{formatPct(data.mom_pct[viewedIndex])}</td>
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
      </PageFrame>
    </div>
  )
}
