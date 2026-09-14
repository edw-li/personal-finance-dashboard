import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  ALLOCATION_DIMENSIONS, displayLabel, fetchAllocationData, fetchClassifications, fetchEmployerExposure,
} from '../../api/allocation'
import type { AllocationData, AllocationDimension, EmployerExposure, ExposureSlice, SecurityClassification } from '../../api/allocation'
import type { OwnerScope } from '../../api/netWorth'
import { errorDetail } from '../../api/client'
import type { AllocationResponse, HoldingOut } from '../../types/api'
import type { ChartSelection } from '../../types/metrics'
import { formatCurrency, formatDate, formatPct, formatShares } from '../../utils/format'
import ChartCard from '../ChartCard'
import { useDetailPanel } from '../details/DetailPanelProvider'
import Disclosure from '../Disclosure'
import Segmented from '../shell/Segmented'
import SelectionDetail from '../details/SelectionDetail'
import AllocationTargetEditor from './AllocationTargetEditor'
import ClassificationEditor from './ClassificationEditor'
import type { ClassificationEditorHandle } from './ClassificationEditor'
import ClassifyButton from './ClassifyButton'
import { exposureCsv, exposureOption } from './allocationChartOptions'
import { ownerScopeLabel } from './ownerScopeLabel'
import './portfolio.css'
import './allocation.css'

interface Props {
  holdings: HoldingOut[]
  byType?: AllocationResponse | null
  byAccount?: AllocationResponse | null
  owner?: OwnerScope
  refreshKey?: number
  onSelectTicker: (ticker: string) => void
  /** A classification was edited here. The industry it sets also colours the Holdings treemap, so
   *  the page bumps a version other views key their own fetches on (P2 review round 3). */
  onClassificationsChanged?: () => void
}

// The Allocation view (2026-09-13 polish §12–13): ONE allocation card (donut + ranked aside),
// then the Security classifications card, then targets, then employer equity. Every
// "Classify these N holdings" button on the view drives the classifications card's handle.
export default function AllocationPanel({ holdings, owner = null, refreshKey = 0, onSelectTicker, onClassificationsChanged }: Props) {
  const [dimension, setDimension] = useState<AllocationDimension>('asset_class')
  const [reload, setReload] = useState(0)
  const [result, setResult] = useState<{ key: string; data: AllocationData } | null>(null)
  const [classificationRows, setClassificationRows] = useState<SecurityClassification[]>([])
  const [employer, setEmployer] = useState<{ owner: OwnerScope; data: EmployerExposure } | null>(null)
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)
  const [classificationError, setClassificationError] = useState<string | null>(null)
  const [employerError, setEmployerError] = useState<{ owner: OwnerScope; message: string } | null>(null)
  const [selection, setSelection] = useState<ChartSelection | null>(null)
  const classificationsCard = useRef<ClassificationEditorHandle>(null)
  const detailPanel = useDetailPanel()
  const dataKey = `${owner ?? 'household'}:${dimension}`
  const scopeLabel = ownerScopeLabel(owner)
  const holdingsRevision = holdings.map((h) => `${h.security_id}:${h.shares}:${h.price}:${h.quoted_at}`).join('|')
  useEffect(() => {
    let cancelled = false
    void fetchAllocationData(dimension, owner).then((data) => {
      if (!cancelled) { setResult({ key: dataKey, data }); setFailure(null) }
    }).catch((err) => { if (!cancelled) setFailure({ key: dataKey, message: errorDetail(err) }) })
    return () => { cancelled = true }
  }, [dimension, owner, dataKey, reload, refreshKey, holdingsRevision])
  useEffect(() => {
    let cancelled = false
    void fetchClassifications().then((rows) => {
      if (!cancelled) { setClassificationRows(rows); setClassificationError(null) }
    }).catch((err) => { if (!cancelled) setClassificationError(errorDetail(err)) })
    return () => { cancelled = true }
  }, [reload, refreshKey, holdingsRevision])
  useEffect(() => {
    let cancelled = false
    void fetchEmployerExposure(owner).then((data) => {
      if (!cancelled) { setEmployer({ owner, data }); setEmployerError(null) }
    }).catch((err) => { if (!cancelled) setEmployerError({ owner, message: errorDetail(err) }) })
    return () => { cancelled = true }
  }, [owner, reload, refreshKey, holdingsRevision])

  const data = result?.key === dataKey ? result.data : null
  const error = failure?.key === dataKey ? failure.message : null
  const option = useMemo(() => data ? exposureOption(data) : null, [data])
  const refresh = () => setReload((value) => value + 1)
  // The panel first (P2 review round 4): in overlay and reading mode the page beneath it is
  // `inert`, so focusing a select down there would be a no-op — the button would look dead. The
  // slice detail that hosted the click goes with it; the classifications card is the new subject.
  const classify = () => {
    detailPanel?.close()
    setSelection(null)
    classificationsCard.current?.focusUnclassified()
  }
  const unknownSlice = data?.slices.find((slice) => slice.is_unknown) ?? null
  // The classify path answers the asset-class question only (P2 review round 1): the Security
  // classifications card sets an asset class, so an Industry or Account catch-all has no fix here.
  const classifiable = data?.by === 'asset_class'
  const scopedSource = () => `/portfolio?section=holdings${owner === null ? '' : `&owner=${owner}`}`
  const sliceSelection = (slice: ExposureSlice): ChartSelection => ({
    kind: 'entity', id: `${dataKey}:${slice.key}`, label: displayLabel(slice.key, slice.label, data?.by ?? dimension), entityType: 'allocation', entityId: slice.key,
    scope: scopeLabel, values: [
      { label: 'Priced market value', value: slice.market_value, unit: 'USD' },
      { label: 'Share of priced holdings', value: slice.weight_pct, unit: 'ratio' },
      { label: 'Holdings', value: slice.holdings },
      { label: 'Oldest quote', value: data?.as_of ? formatDate(data.as_of) : null },
    ], source: { href: scopedSource(), label: 'Open holdings' },
    context: { dimension, owner, classification: slice.is_unknown ? displayLabel(slice.key, 'Unknown', data?.by ?? dimension) : 'Classified', pricedDenominator: data?.total_market_value ?? null },
  })
  return <div className="allocation-workspace">
    <div className="allocation-toolbar"><Segmented ariaLabel="Allocation dimension" variant="toggle" options={ALLOCATION_DIMENSIONS}
      value={dimension} onChange={(next) => { setSelection(null); setDimension(next) }} /></div>
    {error && <p className="error-banner" role="alert">Could not load allocation: {error}. <button className="button" onClick={refresh}>Retry</button></p>}
    {/* ONE card (W1): the ranked table is the donut's legend, riding the ChartCard aside, so
        there is no twin card to stretch to the canvas height. */}
    <ChartCard title={`Allocation by ${ALLOCATION_DIMENSIONS.find((d) => d.value === dimension)?.label.toLowerCase()}`}
      hint="Weights divide current priced value by the priced portfolio total. Unclassified holdings stay in the denominator. Select a category to inspect its holdings."
      ariaLabel={`Portfolio allocation by ${dimension.replace('_', ' ')}`} option={option}
      empty={data?.slices.some((s) => Number(s.market_value) < 0) ? 'Review negative positions in the table before using allocation weights.' : 'No priced holdings yet.'}
      exportName={`allocation-${dimension}`} csv={data ? () => exposureCsv(data) : undefined}
      height={330} busy={data === null && error === null} error={error}
      caption={data ? `${scopeLabel} · priced book ${formatCurrency(data.total_market_value)} · ${formatDate(data.as_of)}` : undefined}
      aside={data
        ? <AllocationAside data={data} onSelect={(slice) => setSelection(sliceSelection(slice))} onClassify={classify} onSelectTicker={onSelectTicker} />
        : error === null ? <AllocationAsideGhost /> : undefined}
      selection={selection} onSelectionChange={setSelection} selectionScopeKey={dataKey}
      selectionAdapter={(event) => {
        const key = (event as unknown as { data?: { allocationKey?: string } }).data?.allocationKey
        const slice = data?.slices.find((s) => s.key === key)
        return slice ? sliceSelection(slice) : null
      }} rowSelection={(_row, index) => data?.slices[index] ? sliceSelection(data.slices[index]) : null}
      renderSelection={(selected) => {
        const slice = data?.slices.find((s) => selected.kind === 'entity' && s.key === selected.entityId)
        return <><SelectionDetail selection={selected} chartTitle="Portfolio allocation" onClear={() => setSelection(null)} />
          {slice && <div className="allocation-members">
            {/* The classify action sits FIRST; the per-holding Open buttons stay (spec §13). */}
            {classifiable && slice.is_unknown && slice.members.length > 0 && <ClassifyButton count={slice.members.length} onClick={classify} />}
            <h3>Holdings in this category</h3>
            {slice.members.map((member) => <div key={`${member.security_id}:${member.account}`} className="allocation-member">
              <button className="button" onClick={() => onSelectTicker(member.ticker)}>Open {member.ticker}</button>
              <span>{formatCurrency(member.market_value)}{member.account ? ` · ${member.account}` : ''}</span>
              <small>{member.classification_source} · {member.classification_reviewed_at ? `reviewed ${formatDate(member.classification_reviewed_at)}` : 'not reviewed'}</small>
            </div>)}
          </div>}
        </>
      }} />
    {classificationError && <p className="error-banner">Classification records unavailable: {classificationError} <button className="button" onClick={refresh}>Retry</button></p>}
    {/* Directly after the allocation card, before the targets (spec §13). */}
    <ClassificationEditor ref={classificationsCard} classifications={classificationRows} onChanged={() => { refresh(); onClassificationsChanged?.() }} />
    {data && <AllocationTargetEditor key={dataKey} data={data} owner={owner} onChanged={refresh}
      onClassify={classify} unclassifiedCount={unknownSlice?.members.length ?? 0} />}
    {employer?.owner === owner ? <EmployerPanel value={employer.data} onSelectTicker={onSelectTicker} /> : employerError?.owner === owner
      ? <p className="error-banner">Employer exposure unavailable: {employerError.message} <button className="button" onClick={refresh}>Retry</button></p> : null}
  </div>
}

// The aside's own ghost (P2 review round 5). Without it the card's body went from one column to
// two the moment the payload landed — the donut jumped left under the reader. Bars only: the
// coverage sentence and the ranked rows are the answer, and a ghost never pretends to know it.
function AllocationAsideGhost() {
  return <div className="allocation-aside allocation-aside-ghost" aria-hidden="true">
    <div className="skeleton" style={{ height: 14, width: '85%' }} />
    <div className="skeleton" style={{ height: 12, width: '70%' }} />
    {[0, 1, 2, 3].map((row) => <div key={row} className="skeleton" style={{ height: 18 }} />)}
  </div>
}

// The donut's legend AND its table (spec §12 `aside`): coverage line, priced-book line, the
// ranked categories (each name a button that selects the slice), the coverage warnings and the
// Missing-quotes disclosure. The Unclassified row carries the classify action beneath it.
function AllocationAside({ data, onSelect, onClassify, onSelectTicker }: {
  data: AllocationData
  onSelect: (slice: ExposureSlice) => void
  onClassify: () => void
  onSelectTicker: (ticker: string) => void
}) {
  const { coverage } = data
  // The classify path belongs to the asset-class question alone (P2 review round 1).
  const classifiable = data.by === 'asset_class'
  return <div className="allocation-aside">
    <p className="allocation-coverage-line">
      <b>{coverage.priced_count} of {coverage.holding_count}</b> holdings priced ·{' '}
      {coverage.classified_weight_pct === null
        ? 'classified share unavailable'
        : <><b>{formatPct(coverage.classified_weight_pct, { signed: false })}</b> of priced value classified</>}
    </p>
    {/* The coverage-count caveat only where there ARE unpriced holdings (§14, C5). */}
    <p className="hint">
      Priced book {formatCurrency(data.total_market_value)} · quotes {formatDate(data.as_of)}
      {data.latest_quote_at !== data.as_of ? ` – ${formatDate(data.latest_quote_at)}` : ''}.
      {coverage.unpriced_count > 0 ? ' Missing-price value cannot be estimated from coverage counts.' : ''}
    </p>
    <table className="port-table allocation-ranked-table">
      <thead><tr><th scope="col">Category</th><th scope="col" className="num">Value</th><th scope="col" className="num">Weight</th></tr></thead>
      <tbody>{data.slices.map((slice, index) => <Fragment key={slice.key}>
        <tr className={slice.is_unknown ? 'allocation-unknown' : undefined}>
          <th scope="row"><button type="button" className="allocation-category-button" onClick={() => onSelect(slice)}>
            <span className="allocation-category-swatch" aria-hidden="true"
              style={{ backgroundColor: slice.is_unknown ? 'var(--other-series)' : `var(--chart-${index % 8 + 1})` }} />
            {displayLabel(slice.key, slice.label, data.by)}
          </button></th>
          <td className="num">{formatCurrency(slice.market_value)}</td>
          <td className="num">{formatPct(slice.weight_pct, { signed: false })}</td>
        </tr>
        {classifiable && slice.is_unknown && slice.members.length > 0 && <tr className="allocation-unknown allocation-classify-row">
          <td colSpan={3}><ClassifyButton count={slice.members.length} onClick={onClassify} /></td>
        </tr>}
      </Fragment>)}</tbody>
    </table>
    {coverage.warnings.map((warning) => <p className="hint" key={warning}>{warning}</p>)}
    {coverage.unpriced_holdings.length > 0 && <Disclosure summary={`Missing quotes (${coverage.unpriced_count})`} className="allocation-missing-quotes">
      {coverage.unpriced_holdings.map((h) => <p key={`${h.security_id}:${h.account}`}>
        <button type="button" className="button" onClick={() => onSelectTicker(h.ticker)}>{h.ticker}</button> · {formatShares(h.shares)} shares · value unavailable
      </p>)}
    </Disclosure>}
  </div>
}

function EmployerPanel({ value, onSelectTicker }: { value: EmployerExposure; onSelectTicker: (ticker: string) => void }) {
  return <section className="card allocation-employer" aria-label="Employer equity exposure">
    <h2 className="eyebrow">Employer equity · {value.ticker ?? 'Not configured'}</h2>
    <div className="allocation-employer-grid">
      <div><h3>Shares you hold</h3><strong>{formatCurrency(value.held_value)}</strong>
        <p>{formatShares(value.held_shares)} shares · {formatPct(value.held_weight_pct, { signed: false })} of the selected priced portfolio</p>
        {value.ticker && <button className="button" onClick={() => onSelectTicker(value.ticker!)}>Open Portfolio position</button>}
        <p className="hint">Source: Portfolio positions · selected owner scope</p>
      </div>
      <div><h3>Unvested awards</h3><strong>{formatCurrency(value.unvested_value)}</strong>
        <p>{formatShares(value.unvested_shares)} shares · {value.unvested_scope}</p>
        <a href="/comp?section=vesting">Open Comp vesting schedule</a>
        <p className="hint">Not included in allocation weights or added to net worth here.</p>
      </div>
    </div>
    <p className="hint">As of {formatDate(value.as_of)} · quote {formatDate(value.quoted_at)}. Held shares come from Portfolio; the separate ESPP lot ledger is not added.</p>
    {value.warnings.map((warning) => <p key={warning} className="hint">{warning}</p>)}
  </section>
}
