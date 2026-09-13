import type { ChartSelection } from '../../types/metrics'
import { formatMetricScope } from '../../utils/metricReceipt'
import Disclosure from '../Disclosure'
import { useDetailPanel } from './DetailPanelProvider'
import { explainSelection } from './explainSelection'
import MetricInspector, { ApplicationSourceLink, formatEvidenceValue } from './MetricInspector'

// The panel's header already names the selection (ChartCard passes title = selection.label,
// subtitle = chart title — 2026-09-13 spec §4), so the body starts with the receipt: Scope as its
// first row, then the values.
export default function SelectionDetail({ selection, chartTitle, onClear, onOpenSource }: { selection: ChartSelection; chartTitle: string; onClear?: () => void; onOpenSource?: () => void }) {
  const panel = useDetailPanel()
  return <article className="selection-detail" aria-label={`${selection.label} selected values`}>
    <dl className="metric-receipt-list">
      {selection.scope !== undefined && <div><dt>Scope</dt><dd>{formatMetricScope(selection.scope)}</dd></div>}
      {selection.values.map((value, index) => <div key={`${value.label}-${index}`}>
        <dt>{value.label}</dt><dd>{formatEvidenceValue(value.value, value.unit)}</dd>
      </div>)}
    </dl>
    {selection.evidence?.map((evidence) => <Disclosure key={evidence.id} summary={`${evidence.label}: calculation`}><MetricInspector evidence={evidence} /></Disclosure>)}
    <div className="selection-detail-actions">
      {selection.source && <ApplicationSourceLink href={selection.source.href} onClick={() => { panel?.close(); onOpenSource?.() }}>{selection.source.label}</ApplicationSourceLink>}
      <button type="button" className="button" onClick={() => explainSelection(selection, chartTitle)}>Explain selection</button>
      {onClear && <button type="button" className="button" onClick={onClear}>Clear selection</button>}
    </div>
  </article>
}
