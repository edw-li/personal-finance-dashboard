import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchHousehold } from '../api/household'
import { fetchProjection } from '../api/projection'
import { getSnapshot, setSnapshot } from '../api/snapshotCache'
import ChartCard from '../components/ChartCard'
import { projectionCsv, projectionOption } from '../components/projection/projectionChartOptions'
import { decodeProjection, encodeProjection, isEmptyProjection, labelForProjection, toParams, COMPARE_ROWS, projectionValue, type ProjectionScenario } from '../components/projection/projectionScenario'
import { displayProjection, milestoneWindow, projectionReceipts, projectionSelection, type ProjectionDollars } from '../components/projection/projectionDisplay'
import ProjectionTrendPanel from '../components/projection/ProjectionTrendPanel'
import ScenarioPanel from '../components/projection/ScenarioPanel'
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
  return <div className="page projection-page">
    <PageFrame title="Projection" resource={{
      status: missing ? 'ready' : data === null ? pageError !== null ? 'error' : 'loading' : 'ready',
      error: pageError, busy: false, fromCache,
      retry: () => !sandbox.empty && sandbox.errorStatus === 422 ? sandbox.reset() : setRetryNonce((n) => n + 1),
    }} skeleton={{ tiles: 5, cards: [{ span: 12, height: 400 }] }}>
      {missing ? <section className="card"><h2 className="eyebrow">Projected investable balance</h2>
        <p className="empty-note">{sandbox.error} — <Link to="/update">enter a monthly update</Link> to start one.</p></section>
        : data !== null && display !== null && receipts !== null && <>
          <LocalSectionNav state={sections} label="Projection views" />
          <LocalSectionPanel state={sections} section="planning">
            <div className="kpi-row projection-outcomes" aria-label="Planning outcomes">
              <StatTile label="FI target" value={formatCurrency(data.fi_target)}
                delta={data.fi_target === null ? undefined : `annual spend ÷ ${formatPct(data.swr_pct, { signed: false })} SWR`}
                hint="Annual spend ÷ withdrawal rate — the balance at which withdrawals could cover spending."
                evidence={receipts.target} tone="neutral" />
              <StatTile label="FI ratio" value={formatPct(data.fi_ratio, { signed: false })} evidence={receipts.ratio}
                hint="Investable balance as a share of the FI target." />
              <StatTile label="Investable balance" value={formatCurrency(data.starting_balance)} delta={`as of ${formatMonth(data.base_month)}`}
                tone="neutral" evidence={receipts.balance} hint="Pre-tax + post-tax + taxable + equity from the latest snapshot; cash and liabilities excluded." />
              <StatTile label="Projected FI date" value={data.fi_month === null ? data.fi_target === null ? '—' : 'Not reached' : formatMonth(data.fi_month)} evidence={receipts.reachDate}
                delta={data.coast_fi_month === null ? 'At your assumed constant return' : `growth alone: ${formatMonth(data.coast_fi_month)}`}
                tone="neutral" hint="First month the deterministic projection reaches the target. Growth alone repeats it with contributions off." />
              <StatTile label={`Reach FI target within ${data.years} years`} value={formatPct(data.fi_probability, { signed: false })}
                delta={data.fi_month_p50 === null ? undefined : `Median reach: ${formatMonth(data.fi_month_p50)}`}
                tone="neutral" evidence={receipts.probability} hint="Share of 500 simulated paths reaching the target within this horizon. It does not measure retirement spending sustainability." />
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
                  footer={<p className="drill-hint">{display.display_dollars === 'future' ? 'Future dollars include the modeled price inflation in each month; the target rises by the same factor.' : `Today's dollars express buying power at ${formatMonth(data.start_month)}.`} Inputs and headline targets stay in that starting dollar basis. Growth only excludes contributions. {log ? 'The log axis omits values at or below zero.' : ''}</p>} />
                <p className="projection-method-note">The central line uses a constant assumed return; simulated paths vary around it. Identical assumptions reuse the same samples for a stable comparison.</p>
                {unknownPinInflation && <p className="projection-method-note">A pinned scenario has no inflation assumption, so its future-dollar line is unavailable. Its starting-dollar results remain in the comparison table.</p>}
                {data.warnings.length > 0 && <div className="projection-warnings">{data.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
              </div>
              <aside id="projection-assumptions" className="projection-assumptions" tabIndex={-1} aria-label="Planning assumptions controls">
                <ScenarioPanel sandbox={sandbox} baseline={sandbox.baseline} people={roster} compact />
              </aside>
            </div>
            <section className="card projection-comparisons" aria-label="Scenario comparisons">
              <h2 className="eyebrow">Compare your scenarios</h2>
              <p className="hint">Money inputs and FI targets below use {formatMonth(data.start_month)} dollars. Each probability uses its own scenario horizon.</p>
              <CompareTable<ProjectionOut> rows={COMPARE_ROWS} baseline={sandbox.baseline} scenario={sandbox.result} valueOf={projectionValue}
                pins={sandbox.pins.map((pin) => ({ id: pin.id, label: pin.label, result: sandbox.pinResults[pin.id] }))}
                onUnpin={sandbox.unpin} caption="Headline figures — baseline against the live scenario and any pins" />
              <PinRow sandbox={sandbox} />
            </section>
          </LocalSectionPanel>
          <LocalSectionPanel state={sections} section="trend"><ProjectionTrendPanel startMonth={data.start_month} /></LocalSectionPanel>
        </>}
    </PageFrame>
  </div>
}
