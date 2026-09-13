import { Info } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useInRouterContext } from 'react-router-dom'
import type { MetricEvidence } from '../../types/metrics'
import { isApplicationSource } from '../../types/metrics'
import { formatCompleteness, formatComponentLabel, formatEvidenceValue, formatMetricScope } from '../../utils/metricReceipt'
import { useDetailPanel } from './DetailPanelProvider'
import { explainSelection } from './explainSelection'
import './details.css'

// Moved to utils/metricReceipt.ts (the explain prompt formats the same figure); re-exported so
// SelectionDetail, AssistantEvidence and the tests keep their import path.
export { formatEvidenceValue }

export function ApplicationSourceLink({ href, children, onClick }: { href: string; children: ReactNode; onClick?: () => void }) {
  const inRouter = useInRouterContext()
  if (!isApplicationSource(href)) return null
  return inRouter
    ? <Link className="metric-source-link" to={href} onClick={onClick}>{children}</Link>
    : <a className="metric-source-link" href={href} onClick={onClick}>{children}</a>
}

export default function MetricInspector({ evidence }: { evidence: MetricEvidence }) {
  const panel = useDetailPanel()
  const period = evidence.window
  return (
    <article className="metric-inspector" aria-label={`${evidence.label} calculation`}>
      <div className="metric-inspector-value">{formatEvidenceValue(evidence.value, evidence.unit, evidence.display_precision)}</div>
      {/* The definition/version identifier stays in the evidence record (design §3.4) and on hover
          for support; it is no longer printed as a footer (2026-09-13 spec §5). */}
      <p className="metric-inspector-definition" title={`Metric ${evidence.id}, definition ${evidence.definition_version}`}>{evidence.definition || evidence.description}</p>
      <dl className="metric-receipt-list">
        <div><dt>Scope</dt><dd>{formatMetricScope(evidence.scope)}</dd></div>
        <div><dt>Data status</dt><dd>{formatCompleteness(evidence.completeness)}</dd></div>
        {period && <div><dt>Period</dt><dd>{period.from} to {period.to}</dd></div>}
        {period && (period.included.length > 0 || period.excluded.length > 0) && <div><dt>Months included</dt><dd>{period.included.length}</dd></div>}
        {evidence.as_of && <div><dt>As of</dt><dd>{evidence.as_of}</dd></div>}
      </dl>
      {evidence.components.length > 0 && <>
        <h3>Components</h3>
        <dl className="metric-receipt-list">
          {evidence.components.map((component, index) => <div key={`${component.label}-${index}`}>
            {/* Defensive: callers should pass display labels (GROUP_LABELS), but a raw key must
                never reach the reader as `pre_tax`. */}
            <dt>{formatComponentLabel(component.label)}{component.included === false ? ' (excluded)' : ''}{component.description && <small> — {component.description}</small>}</dt>
            <dd>{formatEvidenceValue(component.value, component.unit ?? evidence.unit)}</dd>
          </div>)}
        </dl>
      </>}
      {period && period.included.length > 0 && <>
        <h3>Included months</h3>
        <ul className="metric-months">{period.included.map((month) => <li key={month}>{month.slice(0, 7)}</li>)}</ul>
        {(period.unreviewed_history_count ?? 0) > 0 && <p>{period.unreviewed_history_count} included {period.unreviewed_history_count === 1 ? 'month is' : 'months are'} unreviewed history.</p>}
      </>}
      {period && period.excluded.length > 0 && <>
        <h3>Excluded months</h3>
        <dl className="metric-receipt-list">{period.excluded.map(({ month, reason }) => <div key={month}><dt>{month.slice(0, 7)}</dt><dd>{formatCompleteness(reason)}</dd></div>)}</dl>
      </>}
      {evidence.warnings.length > 0 && <>
        <h3>Data notes</h3>
        <ul className="metric-warnings">{evidence.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
      </>}
      <ApplicationSourceLink href={evidence.source_link} onClick={() => panel?.close()}>{evidence.source_label || 'Open source records'}</ApplicationSourceLink>
      <div className="selection-detail-actions"><button type="button" className="button" onClick={() => explainSelection({
        kind: 'point', id: `metric:${evidence.id}`, label: evidence.label,
        date: evidence.window?.to ?? evidence.as_of ?? undefined, scope: evidence.scope,
        values: [{ label: evidence.label, value: evidence.value, unit: evidence.unit }], evidence: [evidence],
        source: { href: evidence.source_link, label: evidence.source_label },
      }, evidence.label)}>Explain this number</button></div>
    </article>
  )
}

export function MetricInfoButton({ evidence }: { evidence: MetricEvidence }) {
  const panel = useDetailPanel()
  const [inline, setInline] = useState(false)
  const id = `metric:${evidence.id}`
  const update = panel?.update
  const close = panel?.close
  const previous = useRef<string | null>(null)
  useEffect(() => {
    const key = JSON.stringify(evidence)
    if (key === previous.current) return
    previous.current = key
    update?.(id, { title: evidence.label, content: <MetricInspector evidence={evidence} /> })
  }, [id, evidence, update])
  useEffect(() => () => close?.(id), [id, close])
  return <>
    <button type="button" className="metric-info-button" aria-label={`About this number: ${evidence.label}`} aria-expanded={panel ? panel.activeId === id : inline} onClick={() => {
      if (panel) panel.open({ id, title: evidence.label, content: <MetricInspector evidence={evidence} /> })
      else setInline((value) => !value)
    }}><Info size={15} aria-hidden="true" /></button>
    {!panel && inline && <div className="metric-inline-inspector"><MetricInspector evidence={evidence} /></div>}
  </>
}
