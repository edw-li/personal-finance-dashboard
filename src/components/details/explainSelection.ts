import type { ChartSelection, ExplainSelectionRequest } from '../../types/metrics'

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
