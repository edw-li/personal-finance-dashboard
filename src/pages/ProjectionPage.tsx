import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchHousehold } from '../api/household'
import { fetchProjection } from '../api/projection'
import { getSnapshot, setSnapshot } from '../api/snapshotCache'
import ChartCard from '../components/ChartCard'
import { projectionCsv, projectionOption } from '../components/projection/projectionChartOptions'
import { decodeProjection, encodeProjection, isEmptyProjection, labelForProjection, toParams, COMPARE_ROWS, projectionValue, type ProjectionScenario } from '../components/projection/projectionScenario'
import { balanceAsOf, displayProjection, fiDateTile, milestoneWindow, moneyLastsTile, projectionReceipts, projectionSelection, type ProjectionDollars } from '../components/projection/projectionDisplay'
import ProjectionTrendPanel from '../components/projection/ProjectionTrendPanel'
import ScenarioPanel, { ScenarioHints } from '../components/projection/ScenarioPanel'
import { useAssistantView } from '../components/assistant/viewState'
import StatTile from '../components/StatTile'
import Segmented from '../components/shell/Segmented'
import PageFrame from '../components/shell/PageFrame'
import { LocalSectionNav, LocalSectionPanel, useLocalSections } from '../components/shell/LocalSections'
import { useSandbox, type SandboxSpec } from '../sandbox/useSandbox'
import { PinRow } from '../sandbox/SandboxPanel'
import CompareTable from '../sandbox/CompareTable'
import type { HouseholdOut, PersonOut, ProjectionOut } from '../types/api'
import type { ChartSelection } from '../types/metrics'
import { formatCurrency, formatMonth, formatPct } from '../utils/format'
import '../components/panels.css'
import './ProjectionPage.css'

const NO_PEOPLE: PersonOut[] = []
const SECTIONS = [{ id: 'planning', label: 'Planning workspace' }, { id: 'trend', label: 'Historical trend' }] as const

export default function ProjectionPage() {
  const sections = useLocalSections(SECTIONS, 'planning')
  const [cachedProjection] = useState(() => getSnapshot<ProjectionOut>('projection:default'))
  const [retryNonce, setRetryNonce] = useState(0)
  const [household, setHousehold] = useState<HouseholdOut | null>(null)
  const roster = household?.people ?? NO_PEOPLE
  const spec = useMemo<SandboxSpec<ProjectionScenario, ProjectionOut>>(() => ({
    page: 'projection', decode: decodeProjection, encode: encodeProjection, isEmpty: isEmptyProjection,
    preview: (scenario) => fetchProjection(toParams(scenario)), dataKey: `projection:${retryNonce}`,
    debounceMs: 300, initialBaseline: cachedProjection ?? null,
    onBaseline: (baseline) => setSnapshot('projection:default', baseline),
    labelFor: (scenario) => labelForProjection(scenario, roster),
  }), [retryNonce, cachedProjection, roster])
  const sandbox = useSandbox(spec)
  useAssistantView({ whatif: sandbox.entries })
  const data = sandbox.result ?? sandbox.baseline
  const missing = sandbox.result === null && sandbox.errorStatus === 404
  const pageError = missing ? null : sandbox.empty || data === null ? sandbox.error : null
  useEffect(() => {
    let cancelled = false
    void fetchHousehold().then((value) => { if (!cancelled) setHousehold(value) }).catch(() => { if (!cancelled) setHousehold(null) })
    return () => { cancelled = true }
  }, [])
  const cachedJson = useMemo(() => cachedProjection === undefined ? null : JSON.stringify(cachedProjection), [cachedProjection])
  const fromCache = useMemo(() => data !== null && cachedJson !== null && (data === cachedProjection || JSON.stringify(data) === cachedJson), [data, cachedJson, cachedProjection])
  const [log, setLog] = useState(false)
  const [dollars, setDollars] = useState<ProjectionDollars>('today')
  const [windowMode, setWindowMode] = useState<'milestone' | 'all'>('milestone')
  const [fanLegend, setFanLegend] = useState<Record<string, boolean>>({})
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const display = useMemo(() => data ? displayProjection(data, dollars) : null, [data, dollars])
  const window = useMemo(() => !data ? undefined : windowMode === 'all'
    ? { startValue: 0, endValue: Math.max(0, data.months.length - 1) } : milestoneWindow(data), [data, windowMode])
  const references = useMemo(() => sandbox.pins.flatMap((pin) => {
    const result = sandbox.pinResults[pin.id]
    if (!result || result === 'pending' || 'error' in result) return []
    const mode = display?.display_dollars ?? dollars
    const shown = displayProjection(result, mode)
    if (shown.display_dollars !== mode) return []
    // Align by month, not array offset, when pinned runs have different horizons.
    const byMonth = new Map(shown.months.map((month, i) => [month, shown.projected[i]]))
    return [{ name: pin.label, data: (data?.months ?? []).map((month) => byMonth.get(month) ?? 'NaN') }]
  }), [sandbox.pins, sandbox.pinResults, dollars, data?.months, display?.display_dollars])
  const unknownPinInflation = display?.display_dollars === 'future' && sandbox.pins.some(pin => {
    const result = sandbox.pinResults[pin.id]
    return result && result !== 'pending' && !('error' in result) && result.inflation == null
  })
  const chart = useMemo(() => display ? projectionOption(display, { log, selected: fanLegend, references, window }) : null,
    [display, log, fanLegend, references, window])
  const readout = (index: number) => {
    const point = display ? projectionSelection(display, index) : null
    if (point) point.values.push(...references.map((ref) => ({ label: `Pinned: ${ref.name}`, value: Number.isFinite(Number(ref.data[index])) ? ref.data[index] : null, unit: 'USD' })))
    return point
  }
  const selection = selectedIndex === null ? null : readout(selectedIndex)
  const select = (value: ChartSelection | null) => setSelectedIndex(value?.kind === 'projection' && display ? display.months.indexOf(value.date) : null)
  const receipts = useMemo(() => data ? projectionReceipts(data) : null, [data])
  const fiDate = data ? fiDateTile(data) : null
  const lasts = data ? moneyLastsTile(data) : null
  // The chart column sticks UNDER the outcomes band (spec §12), whose height is measured rather
  // than assumed: it is one row of tiles when their labels fit and taller when one wraps, and a
  // constant would park the chart's header under the band at exactly the widths that wrap.
  // Written on the band's parent (the section panel) so .projection-chart-area inherits it; the
  // 131px fallback in the CSS is the one-row band (115px tile + 8px padding twice). A ref callback
  // with a cleanup (React 19), memoised so React does not re-observe on every render. jsdom and
  // any browser without ResizeObserver keep the fallback.
  const measureBand = useCallback((band: HTMLDivElement | null) => {
    const target = band?.parentElement ?? null
    if (band === null || target === null || typeof ResizeObserver === 'undefined') return undefined
    const write = () => target.style.setProperty('--projection-band-h', `${band.offsetHeight}px`)
    write()
    const observer = new ResizeObserver(write)
    observer.observe(band)
    return () => {
      observer.disconnect()
      target.style.removeProperty('--projection-band-h')
    }
  }, [])
  return <div className="page projection-page">
    <PageFrame title="Projection" sections={missing ? undefined : <LocalSectionNav state={sections} label="Projection views" />} resource={{
      status: missing ? 'ready' : data === null ? pageError !== null ? 'error' : 'loading' : 'ready',
      error: pageError, busy: false, fromCache,
      retry: () => !sandbox.empty && sandbox.errorStatus === 422 ? sandbox.reset() : setRetryNonce((n) => n + 1),
    }} skeleton={{ tiles: 5, cards: [{ span: 12, height: 400 }] }}>
      {missing ? <section className="card"><h2 className="eyebrow">Projected investable balance</h2>
        <p className="empty-note">{sandbox.error} — <Link to="/update">enter a monthly update</Link> to start one.</p></section>
        : data !== null && display !== null && receipts !== null && fiDate !== null && lasts !== null && <>
          <LocalSectionPanel state={sections} section="planning">
            <div ref={measureBand} className="kpi-row kpi-row-5 projection-outcomes" aria-label="Planning outcomes">
              <StatTile label="FI target" value={formatCurrency(data.fi_target)}
                delta={data.fi_target === null ? undefined : `annual spend ÷ ${formatPct(data.swr_pct, { signed: false })} SWR`}
                hint="Annual spend ÷ withdrawal rate — the balance at which withdrawals could cover spending."
                evidence={receipts.target} tone="neutral" />
              <StatTile label="FI ratio" value={formatPct(data.fi_ratio, { signed: false })} evidence={receipts.ratio}
                hint="Investable balance as a share of the FI target." />
              {/* Named by the day its balances describe (2026-09-23 spec §R5): the current snapshot —
                  the Overview's — so next month's balances recorded early read "· provisional". */}
              <StatTile label="Investable balance" value={formatCurrency(data.starting_balance)} delta={balanceAsOf(data)}
                tone="neutral" evidence={receipts.balance} hint="Pre-tax + post-tax + taxable + equity from the current balances snapshot — the one the Overview shows; cash and liabilities excluded." />
              {/* ONE FI date (2026-09-23 spec §R6): the simulation's median reach with its range in
                  paths; the constant-return crossing lives in the receipt and on the chart. */}
              <StatTile label="FI date" value={fiDate.value} delta={fiDate.delta} tone={fiDate.tone} evidence={receipts.fiDate}
                hint="The month half of the simulated paths reach the FI target, with the months 1 in 10 and 9 in 10 get there." />
              {/* Money lasts (spec §R3, §R7): a verdict, not a movement — coloured and worded (the
                  badge), never a glyph. From the same simulation as the FI date. */}
              <StatTile label="Money lasts" value={lasts.value} unit={lasts.unit} delta={lasts.delta} tone={lasts.tone} direction="none"
                badge={lasts.badge} evidence={receipts.moneyLasts}
                hint="The share of simulated paths whose balance lasts through your plan-until year, once withdrawals start after the last retirement." />
            </div>
            <div className="projection-workspace">
              <div className="projection-chart-area">
                <ChartCard title="Projected investable balance"
                  hint="The projected line compounds at your assumptions; the bands show the middle 50% and 80% of simulated balances. Select a month for exact values. Reach dates and probabilities stay the same when you change chart dollars."
                  ariaLabel={`Projected investable balance over the next ${data.years} years`} option={chart} busy={sandbox.busy}
                  empty="Nothing to chart at this horizon." exportName={`projection-${display.display_dollars}-dollars`}
                  csv={() => projectionCsv(display, references)} height={400} zoomable
                  caption={`${formatMonth(data.start_month)} – ${formatMonth(data.months.at(-1) ?? data.start_month)} · ${display.display_dollars === 'future' ? 'future dollars' : "today's dollars"}`}
                  onLegendChange={(next) => setFanLegend((current) => ({ ...current, ...next }))}
                  selection={selection} onSelectionChange={select} selectionScopeKey={`projection:${data.start_month}:${data.years}`}
                  selectionAdapter={(event) => event.dataIndex === undefined ? null : readout(event.dataIndex)}
                  rowSelection={(_row, index) => readout(index)}
                  controls={<div className="projection-chart-controls">
                    <Segmented variant="toggle" size="sm" ariaLabel="Chart dollars" options={[
                      { value: 'today', label: "Today's dollars" }, { value: 'future', label: 'Future dollars', disabled: data.inflation == null },
                    ]} value={display.display_dollars} onChange={setDollars} />
                    <Segmented variant="toggle" size="sm" ariaLabel="Chart window" options={[
                      { value: 'milestone', label: 'Next milestone' }, { value: 'all', label: 'Full horizon' },
                    ]} value={windowMode} onChange={setWindowMode} />
                    <Segmented variant="toggle" size="sm" ariaLabel="Axis scale" options={[
                      { value: 'linear', label: 'Linear' }, { value: 'log', label: 'Log' },
                    ]} value={log ? 'log' : 'linear'} onChange={(value) => setLog(value === 'log')} />
                  </div>}
                  // Advisory sentences about what the model ran with — the tax-warnings register:
                  // nothing failed, so never an error banner; the card's own muted header strip.
                  lede={data.warnings.length > 0 ? data.warnings.map((warning) => <p key={warning}>{warning}</p>) : undefined}
                  footer={<p className="drill-hint">{display.display_dollars === 'future' ? 'Future dollars include the modeled price inflation in each month; the target rises by the same factor.' : `Today's dollars express buying power at ${formatMonth(data.start_month)}.`} Inputs and headline targets stay in that starting dollar basis. Growth only excludes contributions, vests and withdrawals. {log ? 'Paths that ran out are drawn at the axis floor. ' : ''}The central line uses a constant assumed return; simulated paths vary around it. Scenarios on the same horizon share the same 500 simulated paths, so a difference between them is what you changed; a later plan-until year only adds months to each path.{unknownPinInflation ? ' A pinned scenario has no inflation assumption, so its future-dollar line is unavailable. Its starting-dollar results remain in the comparison table.' : ''}</p>} />
              </div>
              <aside id="projection-assumptions" className="projection-assumptions" tabIndex={-1} aria-label="Planning assumptions controls">
                <ScenarioPanel sandbox={sandbox} baseline={sandbox.baseline} people={roster} compact />
              </aside>
            </div>
            <section className="card projection-comparisons" aria-label="Scenario comparisons">
              <h2 className="eyebrow">Compare your scenarios</h2>
              <p className="hint">Money inputs and FI targets in this table use {formatMonth(data.start_month)} dollars. Each probability uses its own scenario horizon and plan-until year.</p>
              <CompareTable<ProjectionOut> rows={COMPARE_ROWS} baseline={sandbox.baseline} scenario={sandbox.result} valueOf={projectionValue}
                pins={sandbox.pins.map((pin) => ({ id: pin.id, label: pin.label, result: sandbox.pinResults[pin.id] }))}
                onUnpin={sandbox.unpin} caption="Headline figures — baseline against the live scenario and any pins" />
              <PinRow sandbox={sandbox} />
              {/* The assumptions' fine print closes the card (spec §12): the knobs column is controls
                  only, and the sentences about entering them sit beside the figures they produce. */}
              <ScenarioHints people={roster} vests={data.vests ?? null} />
            </section>
          </LocalSectionPanel>
          <LocalSectionPanel state={sections} section="trend"><ProjectionTrendPanel startMonth={data.start_month} /></LocalSectionPanel>
        </>}
    </PageFrame>
  </div>
}
