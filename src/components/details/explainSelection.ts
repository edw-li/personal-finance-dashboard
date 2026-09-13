import type { ChartSelection, ExplainSelectionRequest } from '../../types/metrics'
import { formatEvidenceValue, formatMetricScope } from '../../utils/metricReceipt'

export const EXPLAIN_SELECTION_EVENT = 'finance:explain-selection'

export function explainSelection(selection: ChartSelection, chartTitle: string): void {
  // Copy before dispatch: the receiver owns a dated snapshot, even if a page later
  // mutates/replaces its scenario or changes owner while an answer is streaming.
  const request: ExplainSelectionRequest = JSON.parse(JSON.stringify({
    selection,
    chartTitle,
    sourceRoute: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    capturedAt: new Date().toISOString(),
  })) as ExplainSelectionRequest
  window.dispatchEvent(new CustomEvent<ExplainSelectionRequest>(EXPLAIN_SELECTION_EVENT, { detail: request }))
}

export function onExplainSelection(listener: (request: ExplainSelectionRequest) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<ExplainSelectionRequest>).detail)
  window.addEventListener(EXPLAIN_SELECTION_EVENT, handler)
  return () => window.removeEventListener(EXPLAIN_SELECTION_EVENT, handler)
}

/** The assistant's opening question for a captured selection (2026-09-13 spec §5). A metric
 *  receipt (id `metric:…`) is asked about as a FIGURE — value, period or as-of date, scope —
 *  because its chart title is its own label and "Explain Net worth in Net worth" read as a
 *  stutter. A chart selection keeps the selection-in-chart form. */
export function explainPrompt(request: ExplainSelectionRequest): string {
  const { selection, chartTitle } = request
  if (!selection.id.startsWith('metric:')) {
    return `Explain ${selection.label} in ${chartTitle}. Use the captured selection and distinguish recorded facts from interpretation.`
  }
  const evidence = selection.evidence?.[0]
  const figure = selection.values[0]
  const date = 'date' in selection ? selection.date : undefined
  const period = evidence?.window?.from && evidence.window.to
    ? `${evidence.window.from} to ${evidence.window.to}`
    : evidence?.as_of ? `as of ${evidence.as_of}` : date ? `as of ${date}` : null
  const parts = [
    figure === undefined ? null : formatEvidenceValue(figure.value, figure.unit, evidence?.display_precision),
    period,
    selection.scope === undefined ? null : formatMetricScope(selection.scope),
  ].filter((part): part is string => part !== null && part !== '')
  const detail = parts.length > 0 ? ` (${parts.join(', ')})` : ''
  return `Explain the ${selection.label} figure${detail}. Use the captured evidence and distinguish recorded facts from interpretation.`
}
