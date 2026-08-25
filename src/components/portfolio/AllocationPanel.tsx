import { useMemo, useState } from 'react'
import EChart from '../EChart'
import InfoHint from '../InfoHint'
import type { AllocationResponse } from '../../types/api'
import { donutOption, positiveSlices, treemapOption } from './allocationChartOptions'
import './portfolio.css'

export default function AllocationPanel({
  industry,
  byType,
  byAccount,
}: {
  industry: AllocationResponse | null
  byType: AllocationResponse | null
  byAccount: AllocationResponse | null
}) {
  const [donutDim, setDonutDim] = useState<'type' | 'account'>('type')
  const donutData = donutDim === 'type' ? byType : byAccount
  // Memoized: EChart keys its effect on [option] with notMerge, so a fresh object per
  // render replays entry animations on unrelated state flips (Task 14 review I4). The
  // guards use the FILTERED count — an all-oversold book must show the note, not an
  // empty chart (M1).
  const treemap = useMemo(
    () => (industry && positiveSlices(industry).length > 0 ? treemapOption(industry) : null),
    [industry],
  )
  const donut = useMemo(
    () =>
      donutData && positiveSlices(donutData).length > 0
        ? donutOption(donutData, donutDim === 'type')
        : null,
    [donutData, donutDim],
  )
  return (
    <div className="allocation-grid">
      <section className="panel">
        <h2 className="panel-title">
          Allocation by industry
          <InfoHint text="Holdings grouped by industry; cell size and shading both follow market value." />
        </h2>
        {treemap ? (
          <EChart
            option={treemap}
            height={300}
            ariaLabel="Treemap of holdings by industry, sized and shaded by market value"
          />
        ) : (
          <p className="empty-note">No priced holdings yet.</p>
        )}
      </section>
      <section className="panel">
        <div className="panel-title-row">
          <h2 className="panel-title">
            Allocation
            <InfoHint text="Portfolio share by holding type or account — top three slices named, the rest folded into Other." />
          </h2>
          <div className="toggle-row" role="group" aria-label="Donut dimension">
            <button
              type="button"
              aria-pressed={donutDim === 'type'}
              onClick={() => setDonutDim('type')}
            >
              Type
            </button>
            <button
              type="button"
              aria-pressed={donutDim === 'account'}
              onClick={() => setDonutDim('account')}
            >
              Account
            </button>
          </div>
        </div>
        {donut ? (
          <EChart
            option={donut}
            height={300}
            ariaLabel={`Donut chart of portfolio share by ${donutDim === 'type' ? 'holding type' : 'account'}`}
          />
        ) : (
          <p className="empty-note">No priced holdings yet.</p>
        )}
      </section>
    </div>
  )
}
