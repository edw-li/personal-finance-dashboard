/** Source receipts are application data, not numbers reconstructed from a tooltip. */
export interface MetricEvidence {
  id: string
  definition_version: string
  label: string
  definition: string
  value: string | number | null
  unit: string
  /** Fractional digits in the displayed unit; preserve precise election rates. */
  display_precision?: number | null
  scope: string | number | null
  window?: {
    from: string | null
    to: string | null
    included: string[]
    excluded: { month: string; reason: string }[]
    unreviewed_history_count?: number
  } | null
  completeness: string
  components: { label: string; value: string | number | null; unit?: string; included?: boolean; description?: string }[]
  source_link: string
  source_label: string
  as_of: string | null
  warnings: string[]
  description?: string
}

export type SelectionValue = {
  label: string
  value: string | number | null
  unit?: string
}

export type SelectionContextValue = string | number | boolean | null | SelectionContextValue[] | { [key: string]: SelectionContextValue }

interface SelectionBase {
  /** Stable within this chart and scope; never a display label used as a database id. */
  id: string
  label: string
  values: SelectionValue[]
  scope?: string | number | null
  source?: { href: string; label: string }
  evidence?: MetricEvidence[]
  context?: Record<string, SelectionContextValue>
}

export type ChartSelection = SelectionBase & (
  | { kind: 'period'; period: string }
  | { kind: 'entity'; entityType: 'security' | 'category' | 'account' | 'allocation' | string; entityId: string | number }
  | { kind: 'heatmap'; period: string; categoryId: string | number }
  | { kind: 'flow'; sourceId: string; targetId?: string }
  | { kind: 'projection'; date: string; scenario?: Record<string, SelectionContextValue> }
  | { kind: 'point'; series?: string; date?: string; index?: number }
)

export interface ExplainSelectionRequest {
  selection: ChartSelection
  /** Captured at send time; a later page navigation cannot change the question. */
  sourceRoute: string
  chartTitle: string
  capturedAt: string
}

/** Only app destinations can be presented as source-record navigation. */
export function isApplicationSource(href: string): boolean {
  return /^\/(?:$|[?#]|(?:update|net-worth|portfolio|spending|credit-cards|paycheck|comp|espp|taxes|projection|calendar|settings)(?:[/?#]|$))/.test(href)
    && !href.includes('\\') && !Array.from(href).some((character) => character.charCodeAt(0) < 32)
}
