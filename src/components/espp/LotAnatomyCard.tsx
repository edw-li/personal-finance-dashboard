import { useMemo, useState } from 'react'
import ChartCard from '../ChartCard'
import Segmented from '../shell/Segmented'
import type { EsppLotsResponse } from '../../types/api'
import { formatCurrency, formatDate } from '../../utils/format'
import { hasAnatomy, lotAnatomyCsv, lotAnatomyOption, sortLots } from './esppChartOptions'
import type { AnatomyView } from './esppChartOptions'
import '../panels.css'

// The house sentence the mount carries (F11) — the fixtures copy it from here.
export const ANATOMY_ARIA =
  "Stacked bar chart of each ESPP lot's value split into amount paid, bargain element at purchase and appreciation since, with a per-share view"

const VIEWS = [
  { value: 'dollars', label: 'Dollars' },
  { value: 'per-share', label: 'Per share' },
] as const

/**
 * The lot anatomy card (2026-09-07 spec §5): the builder's two views behind a chart-local
 * toggle, legend picks mirrored back (grammar §9), and the two footer sentences — the quote the
 * unsold lots were priced at, and the bargain element's split into discount and lookback from the
 * server's totals. A payload without the anatomy fields (a warm pre-batch snapshot) holds the
 * skeleton until the mount's own fetch lands; it is never "no lots".
 */
export default function LotAnatomyCard({
  data,
  onHoverLot,
  onSelectLot,
}: {
  data: EsppLotsResponse
  /** The hovered lot's id, or null when the pointer leaves — the lots table lights the row. */
  onHoverLot?: (id: number | null) => void
  onSelectLot?: (id: number) => void
}) {
  const [view, setView] = useState<AnatomyView>('dollars')
  const [legend, setLegend] = useState<Record<string, boolean>>({})
  const ready = data.totals !== undefined && hasAnatomy(data.lots)
  // Chain order is the builder's axis order, so a dataIndex maps to a lot through it.
  const chain = useMemo(() => sortLots(data.lots), [data.lots])
  // Memoized: EChart keys its effect on [option] with notMerge (AllocationPanel's note).
  const option = useMemo(
    () => (ready ? lotAnatomyOption(data, { view, selected: legend }) : null),
    [data, ready, view, legend],
  )
  const lotAt = (index: number | undefined): number | null =>
    index === undefined ? null : (chain[index]?.id ?? null)
  const held = data.totals?.held
  const soldAny = data.totals !== undefined && data.totals.sold.lots > 0

  return (
    <ChartCard
      title="Lot anatomy"
      hint="Each purchase split three ways: what you paid, the bargain element at purchase (the plan discount, plus the lookback when the price had risen above the subscription price), and the market's move since. Unsold lots at the current quote; sold lots at their sale price, drawn hollow."
      ariaLabel={ANATOMY_ARIA}
      option={option}
      empty="No lots yet — add your first purchase in the Lots card below."
      exportName="espp-lot-anatomy"
      csv={ready ? () => lotAnatomyCsv(data) : undefined}
      height={300}
      span={6}
      busy={!ready && data.lots.length > 0}
      controls={
        <Segmented
          variant="toggle"
          size="sm"
          ariaLabel="Lot chart view"
          options={VIEWS}
          value={view}
          onChange={setView}
        />
      }
      onLegendChange={(selected) => setLegend((current) => ({ ...current, ...selected }))}
      onHover={(p) => onHoverLot?.(lotAt(p.dataIndex))}
      onHoverEnd={() => onHoverLot?.(null)}
      onClick={(p) => {
        const id = lotAt(p.dataIndex)
        if (id !== null) onSelectLot?.(id)
      }}
      footer={
        // The fragment stays mounted while the card is not ready, so the caption row keeps its
        // reserved height (panels.css --m-caption-row) — but it says NOTHING: a skeleton must not
        // assert the quote its lots were priced at, and on a pre-batch payload that sentence would
        // also double the Lots card's own line word for word.
        <>
          {ready && (
            <>
              {/* The quote line the Lots card prints, plus the outline's text backup. The date is
                  rendered, not judged (the table's own note). */}
              <p className="drill-hint">
                {data.espp_ticker === null
                  ? 'No ESPP ticker configured — set the espp_ticker setting to price these lots.'
                  : data.current_price === null
                    ? `${data.espp_ticker} — no live quote; unsold lots are unpriced.`
                    : `${data.espp_ticker} · ${formatCurrency(data.current_price)} · as of ${formatDate(
                        data.quoted_at,
                      )}`}
                {soldAny && ' · Hollow = sold'}
              </p>
              {held !== undefined && Number(held.bargain_element) > 0 && (
                <p className="drill-hint">
                  {`Of the ${formatCurrency(held.bargain_element)} bargain element across your held lots, ${formatCurrency(
                    held.discount_component,
                  )} was the plan discount and ${formatCurrency(held.lookback_component)} the lookback.`}
                </p>
              )}
            </>
          )}
        </>
      }
    />
  )
}
