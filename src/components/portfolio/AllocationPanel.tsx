import { useMemo, useState } from 'react'
import ChartCard from '../ChartCard'
import Segmented from '../shell/Segmented'
import type { AllocationResponse, HoldingOut } from '../../types/api'
import {
  HEAT_METRICS,
  donutCsv,
  donutOption,
  heatTreemapCsv,
  heatTreemapOption,
  positiveSlices,
} from './allocationChartOptions'
import type { HeatMetric } from './allocationChartOptions'
import './portfolio.css'

/**
 * The two allocation cards. The industry map is a HEAT-treemap (F5): area is market value,
 * fill is the chosen performance metric on the diverging ramp — which is why it takes the
 * holdings themselves rather than an `AllocationResponse`, whose slices carry no per-holding
 * gain figures. A ticker cell click is the page's drill-in (the `?ticker=` arrival's twin).
 */
export default function AllocationPanel({
  holdings,
  byType,
  byAccount,
  onSelectTicker,
}: {
  holdings: HoldingOut[]
  byType: AllocationResponse | null
  byAccount: AllocationResponse | null
  /** A ticker cell click → the page's drill-in (the ?ticker= arrival's twin). */
  onSelectTicker: (ticker: string) => void
}) {
  const [metric, setMetric] = useState<HeatMetric>('unrealized')
  const [donutDim, setDonutDim] = useState<'type' | 'account'>('type')
  const donutData = donutDim === 'type' ? byType : byAccount
  // Memoized: EChart keys its effect on [option] with notMerge, so a fresh object per render
  // replays entry animations on unrelated state flips (Task 14 review I4).
  const treemap = useMemo(() => heatTreemapOption(holdings, metric), [holdings, metric])
  const donut = useMemo(
    () =>
      donutData && positiveSlices(donutData).length > 0
        ? donutOption(donutData, donutDim === 'type')
        : null,
    [donutData, donutDim],
  )
  return (
    <div className="card-grid">
      <ChartCard
        span={6}
        title="Allocation by industry"
        hint="Industry → ticker: cell area is market value, fill is the chosen metric on the orange ↔ blue scale, clamped at ±50%. Holdings under 0.5% of the book fold into Other. Click a ticker to open it."
        ariaLabel={`Treemap of holdings by industry and ticker, sized by market value and shaded by ${
          metric === 'unrealized' ? 'unrealized gain' : 'day change'
        }`}
        option={treemap}
        empty="No priced holdings yet."
        exportName="allocation-industry"
        csv={() => heatTreemapCsv(holdings)}
        height={300}
        controls={
          <Segmented
            variant="toggle"
            size="sm"
            ariaLabel="Heat metric"
            options={HEAT_METRICS}
            value={metric}
            onChange={setMetric}
          />
        }
        onClick={(params) => {
          const ticker = (params as unknown as { data?: { ticker?: string | null } }).data?.ticker
          if (ticker) onSelectTicker(ticker)
        }}
        // A colour key for cells that were not drawn is a key to nothing, so it leaves
        // with them (the same rule the paycheck flow's node legend and the tax drill-in's
        // way-back prose follow since C7).
        footer={
          treemap === null ? undefined : (
            <p className="drill-hint">
              Orange = loss, blue = gain; the deeper the tone, the larger the move (to ±50%).
            </p>
          )
        }
      />
      <ChartCard
        span={6}
        title="Allocation"
        hint="Portfolio share by holding type or account — top three slices named, the rest folded into Other."
        ariaLabel={`Donut chart of portfolio share by ${
          donutDim === 'type' ? 'holding type' : 'account'
        }`}
        option={donut}
        empty="No priced holdings yet."
        exportName={`allocation-${donutDim}`}
        csv={donutData === null ? undefined : () => donutCsv(donutData, donutDim === 'type')}
        height={300}
        controls={
          <Segmented
            variant="toggle"
            size="sm"
            ariaLabel="Donut dimension"
            options={[
              { value: 'type', label: 'Type' },
              { value: 'account', label: 'Account' },
            ]}
            value={donutDim}
            onChange={setDonutDim}
          />
        }
      />
    </div>
  )
}
