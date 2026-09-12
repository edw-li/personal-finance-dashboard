import type { ChartSelection } from '../../types/metrics'
import { formatMetricScope } from '../../utils/metricReceipt'
import { useDetailPanel } from './DetailPanelProvider'
import { explainSelection } from './explainSelection'
import MetricInspector, { ApplicationSourceLink, formatEvidenceValue } from './MetricInspector'

export default function SelectionDetail({ selection, chartTitle, onClear, onOpenSource }: { selection: ChartSelection; chartTitle: string; onClear?: () => void; onOpenSource?: () => void }) {
  const panel = useDetailPanel()
  return <article className="selection-detail" aria-label={`${selection.label} selected values`}>
    <p>{selection.label}</p>
    {selection.scope !== undefined && <p>Scope: {formatMetricScope(selection.scope)}</p>}
    <dl className="metric-receipt-list">{selection.values.map((value, index) => <div key={`${value.label}-${index}`}>
      <dt>{value.label}</dt><dd>{formatEvidenceValue(value.value, value.unit)}</dd>
    </div>)}</dl>
    {selection.evidence?.map((evidence) => <details key={evidence.id}><summary>{evidence.label}: calculation</summary><MetricInspector evidence={evidence} /></details>)}
    <div className="selection-detail-actions">
      {selection.source && <ApplicationSourceLink href={selection.source.href} onClick={() => { panel?.close(); onOpenSource?.() }}>{selection.source.label}</ApplicationSourceLink>}
      <button type="button" className="button" onClick={() => explainSelection(selection, chartTitle)}>Explain selection</button>
      {onClear && <button type="button" className="button" onClick={onClear}>Clear selection</button>}
    </div>
  </article>
}
