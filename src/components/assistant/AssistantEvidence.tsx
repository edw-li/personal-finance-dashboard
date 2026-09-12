import { Children, cloneElement, isValidElement, memo, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { deleteFinding, fetchFindings, saveFinding } from '../../api/assistantFindings'
import { errorDetail } from '../../api/client'
import type { AssistantEvidenceBundle, AssistantFinding } from '../../types/assistantEvidence'
import type { MetricEvidence } from '../../types/metrics'
import MetricInspector, { ApplicationSourceLink, formatEvidenceValue } from '../details/MetricInspector'
import { useDetailPanel } from '../details/DetailPanelProvider'
import { renderMarkdown } from './markdown'

function EvidenceReference({ metric }: { metric: MetricEvidence }) {
  const panel = useDetailPanel()
  const [expanded, setExpanded] = useState(false)
  return <span className="assistant-metric-reference">
    <button type="button" className="assistant-evidence-link" aria-label={`Inspect ${metric.label}`} onClick={() => {
      if (panel) panel.open({ id: `assistant-metric:${metric.id}`, title: metric.label, subtitle: 'Evidence captured with this answer', content: <MetricInspector evidence={metric} /> })
      else setExpanded((value) => !value)
    }}>{formatEvidenceValue(metric.value, metric.unit, metric.display_precision)}</button>
    {!panel && expanded && <span className="assistant-evidence-inline">{metric.definition} <ApplicationSourceLink href={metric.source_link}>Open source</ApplicationSourceLink></span>}
  </span>
}

function withReferences(nodes: ReactNode, metrics: MetricEvidence[]): ReactNode {
  return Children.map(nodes, (node) => {
    if (typeof node === 'string') return node.split(/(\[\[metric:[^\]\n]+\]\])/g).map((part, index) => {
      const match = /^\[\[metric:([^\]]+)\]\]$/.exec(part)
      if (!match) return part
      const metric = metrics.find((m) => m.id === match[1])
      return metric ? <EvidenceReference key={index} metric={metric} /> : <span key={index}>[Evidence unavailable]</span>
    })
    if (isValidElement<{ children?: ReactNode }>(node) && node.props.children !== undefined)
      return cloneElement(node, {}, withReferences(node.props.children, metrics))
    return node
  })
}

export const AssistantMessageBody = memo(function AssistantMessageBody({ text, metrics = [] }: { text: string; metrics?: MetricEvidence[] }) {
  return <>{withReferences(renderMarkdown(text), metrics)}</>
})

export function ComputedSummary({ bundle }: { bundle: AssistantEvidenceBundle }) {
  if (bundle.metrics.length === 0) return null
  return <section className="assistant-computed-summary" aria-label="Computed summary">
    <strong>{bundle.title}</strong>
    <p className="assistant-meta">Calculated from your records · {bundle.month?.slice(0, 7) ?? 'Captured selection'}</p>
    <AssistantMessageBody text={bundle.summary_text} metrics={bundle.metrics} />
    <details><summary>Inspect the figures and comparison window</summary>
      <dl>{bundle.metrics.map((metric) => <div key={metric.id}><dt>{metric.label}</dt><dd><EvidenceReference metric={metric} /></dd></div>)}</dl>
    </details>
    <p className="assistant-meta">Evidence as of {new Date(bundle.as_of).toLocaleString()}</p>
  </section>
}

export function SaveFindingButton({ question, content, model, bundle, onSaved }: {
  question: string; content: string; model?: string; bundle: AssistantEvidenceBundle; onSaved: () => void
}) {
  const [state, setState] = useState<'ready' | 'saving' | 'saved'>('ready')
  const [error, setError] = useState<string | null>(null)
  return <div className="assistant-save-finding">
    <button type="button" className="button" disabled={state !== 'ready'} onClick={() => {
      setState('saving'); setError(null)
      saveFinding(question, content, model, bundle).then(() => { setState('saved'); onSaved() })
        .catch((e: unknown) => { setError(errorDetail(e)); setState('ready') })
    }}>{state === 'saved' ? 'Finding saved' : state === 'saving' ? 'Saving…' : 'Save finding'}</button>
    {error && <p className="assistant-error" role="alert">Could not save this finding: {error}</p>}
  </div>
}

export function SavedFindings({ revision }: { revision: number }) {
  const [findings, setFindings] = useState<AssistantFinding[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [deleting, setDeleting] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    fetchFindings().then((rows) => { if (alive) { setFindings(rows); setError(null) } })
      .catch((e: unknown) => { if (alive) setError(errorDetail(e)) })
    return () => { alive = false }
  }, [revision, retry])
  return <div className="assistant-saved-findings">
    <p>Saved findings retain their original figures and source context. Open a source to see current data.</p>
    {error && <p role="alert">Could not load findings: {error} <button className="button" onClick={() => setRetry((n) => n + 1)}>Retry</button></p>}
    {findings === null && !error && <p role="status">Loading saved findings…</p>}
    {findings?.length === 0 && <p>No saved findings yet. Save a useful answer from your conversation.</p>}
    {findings?.map((finding) => <details key={finding.id} className="assistant-saved-finding">
      <summary>{finding.title}<small>Evidence from {new Date(finding.evidence_as_of).toLocaleString()}</small></summary>
      <AssistantMessageBody text={finding.content} metrics={finding.evidence} />
      {finding.evidence.length > 0 && <dl>{finding.evidence.map((metric) => <div key={metric.id}><dt>{metric.label}</dt><dd><EvidenceReference metric={metric} /></dd></div>)}</dl>}
      <p className="assistant-meta">Saved {new Date(finding.created_at).toLocaleString()}{finding.model_used ? ` · ${finding.model_used}` : ''}</p>
      <button type="button" className="button" disabled={deleting === finding.id} onClick={() => {
        setDeleting(finding.id)
        deleteFinding(finding.id).then(() => setFindings((rows) => rows?.filter((row) => row.id !== finding.id) ?? null))
          .catch((e: unknown) => setError(errorDetail(e))).finally(() => setDeleting(null))
      }}>{deleting === finding.id ? 'Removing…' : 'Remove saved finding'}</button>
    </details>)}
  </div>
}
