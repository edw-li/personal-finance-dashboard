import { useEffect, useMemo, useState } from 'react'
import { describeError } from '../../api/client'
import { fetchTimeseries } from '../../api/netWorth'
import { getSnapshot, setSnapshot } from '../../api/snapshotCache'
import type { NetWorthTimeseries } from '../../types/api'
import ChartCard from '../ChartCard'
import Segmented from '../shell/Segmented'
import { fitPolyTrend } from './polyTrend'
import { netWorthProjectionCsv, netWorthProjectionOption } from './projectionChartOptions'

const SPANS = [1, 5, 10, 40] as const

/** Mounted only after opening Historical trend. History never gates the planning model. */
export default function ProjectionTrendPanel({ startMonth }: { startMonth: string }) {
  const [history, setHistory] = useState<NetWorthTimeseries | null>(() => getSnapshot<NetWorthTimeseries>('projection:history') ?? null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [years, setYears] = useState<number>(10)
  const [legend, setLegend] = useState<Record<string, boolean>>({})
  useEffect(() => {
    let cancelled = false
    void fetchTimeseries().then((value) => {
      if (cancelled) return
      setSnapshot('projection:history', value)
      setHistory(value); setError(null)
    }).catch((err) => { if (!cancelled) setError(describeError(err, 'the net-worth history')) })
    return () => { cancelled = true }
  }, [retry])
  const fit = useMemo(() => history ? fitPolyTrend(history.months, history.net_worth) : null, [history])
  const option = useMemo(() => history ? netWorthProjectionOption(history, fit, startMonth, years, { selected: legend }) : null, [history, fit, startMonth, years, legend])
  // 2026-09-23 correctness spec §R8: the tab, the fit and its reach stay — the words say what the
  // curve is (fitted to history, nominal, not a forecast) and that nothing on the plan moves it.
  return <ChartCard title="Net worth trend — a curve fitted to your recorded history"
    hint="Every snapshot as dots with a quadratic best-fit extended forward. This explores historical momentum rather than modeling a financial plan. Log axis: equal steps are equal multiples."
    lede={`A second-degree curve fitted to every recorded net-worth snapshot, in nominal dollars, extended ${years} years. It is not a forecast and uses none of your plan's assumptions.`}
    ariaLabel={fit === null ? 'Net worth history as dots, on a log scale' : `Net worth history with a fitted trend extended ${years} years forward, on a log scale`}
    option={option} error={error} busy={history === null && error === null}
    empty="Not enough monthly snapshots to chart yet." exportName="net-worth-trend"
    csv={history ? () => netWorthProjectionCsv(history, fit, startMonth, years) : undefined} height={430} zoomable
    onLegendChange={setLegend}
    actions={error ? <button className="button" onClick={() => setRetry((value) => value + 1)}>Retry history</button> : undefined}
    controls={<Segmented variant="toggle" size="sm" ariaLabel="Trend span" options={SPANS.map((value) => ({ value: String(value), label: `${value}Y` }))}
      value={String(years)} onChange={(value) => setYears(Number(value))} />}
    footer={<p className="drill-hint">{fit === null ? 'The polynomial trendline needs at least three snapshots — showing the history alone.'
      : `Second-degree polynomial best-fit over every monthly net-worth snapshot, extended ${years} years.`} Its reach is set by the 1Y–40Y chips; the planning horizon and &quot;plan until&quot; do not change it. Months at or below $0 cannot be shown on this log axis.</p>} />
}
