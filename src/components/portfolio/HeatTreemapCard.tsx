import { useEffect, useMemo, useState } from 'react'
import { fetchClassifications } from '../../api/allocation'
import type { SecurityClassification } from '../../api/allocation'
import { errorDetail } from '../../api/client'
import type { OwnerScope } from '../../api/netWorth'
import type { HoldingOut } from '../../types/api'
import type { ChartSelection } from '../../types/metrics'
import { formatDate } from '../../utils/format'
import ChartCard from '../ChartCard'
import Segmented from '../shell/Segmented'
import { HEAT_METRICS, heatTreemapCsv, heatTreemapOption } from './allocationChartOptions'
import type { HeatMetric } from './allocationChartOptions'
import { ownerScopeLabel } from './ownerScopeLabel'
import './portfolio.css'

// The industry heat treemap, moved out of the Allocation view's bare <details> to stand under
// the holdings table as a normal card (2026-09-13 polish §11 — T2/A1, and A3's blank-until-
// scrolled accordion). The option builder and the selection adapter are AllocationPanel's,
// verbatim; only the mount moved. It fetches the classification records itself because
// industry lives on the security's classification, not on the holding — a failed fetch
// degrades to "Unknown industry" cells and SAYS so on the card (card-local advisory).
export default function HeatTreemapCard({ holdings, owner = null, refreshKey = 0 }: {
  holdings: HoldingOut[]
  owner?: OwnerScope
  /** Bumped by the page when the Allocation view edits a classification (P2 review round 3): the
   *  industry these cells group by lives on the security's record, not on the holding, so a
   *  holdings-only revision key would leave this chart showing the classification before the edit. */
  refreshKey?: number
}) {
  const [metric, setMetric] = useState<HeatMetric>('unrealized')
  const [classifications, setClassifications] = useState<SecurityClassification[]>([])
  const [classificationError, setClassificationError] = useState<string | null>(null)
  // Refetch when a holding's shares, price or quote date moves — the same revision key
  // AllocationPanel keys its fetches on, so the two views agree on when industries are stale.
  const holdingsRevision = holdings.map((h) => `${h.security_id}:${h.shares}:${h.price}:${h.quoted_at}`).join('|')
  useEffect(() => {
    let cancelled = false
    void fetchClassifications().then((rows) => {
      if (!cancelled) { setClassifications(rows); setClassificationError(null) }
    }).catch((err) => { if (!cancelled) setClassificationError(errorDetail(err)) })
    return () => { cancelled = true }
  }, [holdingsRevision, refreshKey])
  const industryHoldings = useMemo(() => {
    const byId = new Map(classifications.map((row) => [row.security_id, row]))
    return holdings.map((holding) => ({ ...holding, industry: byId.get(holding.security_id)?.industry ?? null }))
  }, [holdings, classifications])
  const heat = useMemo(() => heatTreemapOption(industryHoldings, metric), [industryHoldings, metric])
  const scopeLabel = ownerScopeLabel(owner)
  const scopedSource = (ticker: string) =>
    `/portfolio?section=holdings${owner === null ? '' : `&owner=${owner}`}&ticker=${encodeURIComponent(ticker)}`
  const holdingSelection = (ticker: string): ChartSelection | null => {
    const holding = holdings.find((h) => h.ticker === ticker)
    if (!holding) return null
    return { kind: 'entity', id: `${owner}:${ticker}`, label: ticker, entityType: 'security', entityId: holding.security_id,
      scope: scopeLabel, context: { owner }, source: { href: scopedSource(ticker), label: `Open ${ticker} holding` },
      values: [{ label: 'Market value', value: holding.market_value, unit: 'USD' },
        { label: 'Shares', value: holding.shares }, { label: 'Quoted', value: formatDate(holding.quoted_at) }],
    }
  }
  return <ChartCard title="Holding performance · industry coverage"
    hint="Area is priced market value; color is performance. Fund industries remain unknown. Select a ticker to inspect it."
    ariaLabel="Holdings grouped by known industry and unknown exposure" option={heat} empty="No priced holdings yet."
    exportName="holdings-industry-performance" csv={() => heatTreemapCsv(industryHoldings)} height={360}
    error={classificationError === null ? null : `Industry records unavailable: ${classificationError}`}
    controls={<Segmented variant="toggle" size="sm" ariaLabel="Heat metric" options={HEAT_METRICS} value={metric} onChange={setMetric} />}
    selectionScopeKey={String(owner ?? 'household')}
    selectionAdapter={(event) => {
      const ticker = (event as unknown as { data?: { ticker?: string } }).data?.ticker
      return ticker ? holdingSelection(ticker) : null
    }} rowSelection={(row) => holdingSelection(String(row[1]))}
    footer={heat !== null ? <p className="hint">Orange = loss, blue = gain, with color capped at ±50%. Unknown industries remain visible.</p> : undefined} />
}
