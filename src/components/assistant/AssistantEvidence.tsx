import { Children, cloneElement, isValidElement, memo, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { ReactNode } from 'react'
import { deleteFinding, fetchFindings, saveFinding } from '../../api/assistantFindings'
import { errorDetail } from '../../api/client'
import type { AssistantEvidenceBundle, AssistantFinding } from '../../types/assistantEvidence'
import type { MetricEvidence } from '../../types/metrics'
import Disclosure from '../Disclosure'
import BusyButton from '../feedback/BusyButton'
import { useConfirm } from '../feedback/confirm'
import { useLatest } from '../reorder/useLatest'
import { useToast } from '../ToastProvider'
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
    <Disclosure summary="Inspect the figures and comparison window">
      <dl>{bundle.metrics.map((metric) => <div key={metric.id}><dt>{metric.label}</dt><dd><EvidenceReference metric={metric} /></dd></div>)}</dl>
    </Disclosure>
    <p className="assistant-meta">Evidence as of {new Date(bundle.as_of).toLocaleString()}</p>
  </section>
}

export function SaveFindingButton({ question, content, model, bundle, onSaved }: {
  question: string; content: string; model?: string; bundle: AssistantEvidenceBundle; onSaved: () => void
}) {
  const [state, setState] = useState<'ready' | 'saving' | 'saved'>('ready')
  const [error, setError] = useState<string | null>(null)
  return <div className="assistant-save-finding">
    <BusyButton type="button" className="button" busy={state === 'saving'} inert={state === 'saved'} onClick={() => {
      setState('saving'); setError(null)
      saveFinding(question, content, model, bundle).then(() => { setState('saved'); onSaved() })
        .catch((e: unknown) => { setError(errorDetail(e)); setState('ready') })
    }}>{state === 'saved' ? 'Finding saved' : state === 'saving' ? 'Saving…' : 'Save finding'}</BusyButton>
    {error && <p className="assistant-error" role="alert">Could not save this finding: {error}</p>}
  </div>
}

export function SavedFindings({ revision }: { revision: number }) {
  const [findings, setFindings] = useState<AssistantFinding[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [deleting, setDeleting] = useState<Set<number>>(new Set())
  const deletingRef = useLatest(deleting)
  const ask = useConfirm()
  const toast = useToast()
  const regionRef = useRef<HTMLDivElement>(null)
  const findingsRef = useLatest(findings)
  const remove = async (finding: AssistantFinding, anchor: HTMLButtonElement) => {
    if (deletingRef.current.has(finding.id)) return
    if (!(await ask({ anchor, title: `Remove ${finding.title}?`, body: "This can't be undone.", confirmLabel: 'Remove saved finding' }))) return
    if (deletingRef.current.has(finding.id)) return
    setDeleting(current => new Set(current).add(finding.id))
    try {
      await deleteFinding(finding.id)
      const rows = findingsRef.current ?? []
      const index = rows.findIndex((row) => row.id === finding.id)
      const neighbour = rows[index + 1] ?? rows[index - 1]
      flushSync(() => setFindings((current) => current?.filter((row) => row.id !== finding.id) ?? null))
      const target = neighbour ? document.getElementById(`assistant-finding-${neighbour.id}`)?.querySelector<HTMLElement>('summary') : null
      ;(target ?? regionRef.current)?.focus()
    } catch (err) {
      toast.error(errorDetail(err))
    } finally {
      setDeleting(current => { const next = new Set(current); next.delete(finding.id); return next })
    }
  }
  useEffect(() => {
    let alive = true
    fetchFindings().then((rows) => { if (alive) { setFindings(rows); setError(null) } })
      .catch((e: unknown) => { if (alive) setError(errorDetail(e)) })
    return () => { alive = false }
  }, [revision, retry])
  return <div className="assistant-saved-findings" ref={regionRef} role="region" aria-label="Saved findings" tabIndex={-1}>
    <p>Saved findings retain their original figures and source context. Open a source to see current data.</p>
    {error && <p role="alert">Could not load findings: {error} <button className="button" onClick={() => setRetry((n) => n + 1)}>Retry</button></p>}
    {findings === null && !error && <p role="status">Loading saved findings…</p>}
    {findings?.length === 0 && <p>No saved findings yet. Save a useful answer from your conversation.</p>}
    {findings?.map((finding) => <Disclosure key={finding.id} id={`assistant-finding-${finding.id}`} className="assistant-saved-finding"
      summary={<>{finding.title}<small>Evidence from {new Date(finding.evidence_as_of).toLocaleString()}</small></>}>
      <AssistantMessageBody text={finding.content} metrics={finding.evidence} />
      {finding.evidence.length > 0 && <dl>{finding.evidence.map((metric) => <div key={metric.id}><dt>{metric.label}</dt><dd><EvidenceReference metric={metric} /></dd></div>)}</dl>}
      <p className="assistant-meta">Saved {new Date(finding.created_at).toLocaleString()}{finding.model_used ? ` · ${finding.model_used}` : ''}</p>
      <BusyButton type="button" className="button" busy={deleting.has(finding.id)} onClick={(event) => void remove(finding, event.currentTarget)}>
        Remove saved finding
      </BusyButton>
    </Disclosure>)}
  </div>
}
