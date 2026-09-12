import { useEffect, useMemo, useState } from 'react'
import { ALLOCATION_DIMENSIONS, fetchAllocationData, fetchClassifications, fetchEmployerExposure } from '../../api/allocation'
import type { AllocationData, AllocationDimension, EmployerExposure, ExposureSlice, SecurityClassification } from '../../api/allocation'
import type { OwnerScope } from '../../api/netWorth'
import { errorDetail } from '../../api/client'
import { getSnapshot } from '../../api/snapshotCache'
import type { AllocationResponse, HoldingOut, HouseholdOut } from '../../types/api'
import type { ChartSelection } from '../../types/metrics'
import { formatCurrency, formatDate, formatPct, formatShares } from '../../utils/format'
import ChartCard from '../ChartCard'
import Segmented from '../shell/Segmented'
import { HOUSEHOLD_SNAPSHOT } from '../shell/ScopeBar'
import SelectionDetail from '../details/SelectionDetail'
import AllocationTargetEditor from './AllocationTargetEditor'
import ClassificationEditor from './ClassificationEditor'
import { HEAT_METRICS, exposureCsv, exposureOption, heatTreemapCsv, heatTreemapOption } from './allocationChartOptions'
import type { HeatMetric } from './allocationChartOptions'
import './portfolio.css'
import './allocation.css'

interface Props {
  holdings: HoldingOut[]
  byType?: AllocationResponse | null
  byAccount?: AllocationResponse | null
  owner?: OwnerScope
  refreshKey?: number
  onSelectTicker: (ticker: string) => void
}

export default function AllocationPanel({ holdings, owner = null, refreshKey = 0, onSelectTicker }: Props) {
  const [dimension, setDimension] = useState<AllocationDimension>('asset_class')
  const [metric, setMetric] = useState<HeatMetric>('unrealized')
  const [reload, setReload] = useState(0)
  const [result, setResult] = useState<{ key: string; data: AllocationData } | null>(null)
  const [classificationRows, setClassificationRows] = useState<SecurityClassification[]>([])
  const [employer, setEmployer] = useState<{ owner: OwnerScope; data: EmployerExposure } | null>(null)
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)
  const [classificationError, setClassificationError] = useState<string | null>(null)
  const [employerError, setEmployerError] = useState<{ owner: OwnerScope; message: string } | null>(null)
  const [selection, setSelection] = useState<ChartSelection | null>(null)
  const dataKey = `${owner ?? 'household'}:${dimension}`
  const scopeLabel = owner === null ? 'Household' : owner === 'joint' ? 'Joint'
    : getSnapshot<HouseholdOut>(HOUSEHOLD_SNAPSHOT)?.people.find(person => person.id === owner)?.name ?? 'Selected owner'
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
  const industryHoldings = useMemo(() => {
    const byId = new Map(classificationRows.map((row) => [row.security_id, row]))
    return holdings.map((holding) => ({ ...holding, industry: byId.get(holding.security_id)?.industry ?? null }))
  }, [holdings, classificationRows])
  const heat = useMemo(() => heatTreemapOption(industryHoldings, metric), [industryHoldings, metric])
  const refresh = () => setReload((value) => value + 1)
  const scopedSource = (ticker?: string) => `/portfolio?section=holdings${owner === null ? '' : `&owner=${owner}`}${ticker ? `&ticker=${encodeURIComponent(ticker)}` : ''}`
  const sliceSelection = (slice: ExposureSlice): ChartSelection => ({
    kind: 'entity', id: `${dataKey}:${slice.key}`, label: slice.label, entityType: 'allocation', entityId: slice.key,
    scope: scopeLabel, values: [
      { label: 'Priced market value', value: slice.market_value, unit: 'USD' },
      { label: 'Share of priced holdings', value: slice.weight_pct, unit: 'ratio' },
      { label: 'Holdings', value: slice.holdings },
      { label: 'Oldest quote', value: data?.as_of ? formatDate(data.as_of) : null },
    ], source: { href: scopedSource(), label: 'Open holdings' },
    context: { dimension, owner, classification: slice.is_unknown ? 'Unknown' : 'Classified', pricedDenominator: data?.total_market_value ?? null },
  })
  const holdingSelection = (ticker: string): ChartSelection | null => {
    const holding = holdings.find((h) => h.ticker === ticker)
    if (!holding) return null
    return { kind: 'entity', id: `${owner}:${ticker}`, label: ticker, entityType: 'security', entityId: holding.security_id,
      scope: scopeLabel, context: { owner }, source: { href: scopedSource(ticker), label: `Open ${ticker} holding` },
      values: [{ label: 'Market value', value: holding.market_value, unit: 'USD' },
        { label: 'Shares', value: holding.shares }, { label: 'Quoted', value: formatDate(holding.quoted_at) }],
    }
  }
  return <div className="allocation-workspace">
    <div className="allocation-toolbar"><Segmented ariaLabel="Allocation dimension" variant="toggle" options={ALLOCATION_DIMENSIONS}
      value={dimension} onChange={(next) => { setSelection(null); setDimension(next) }} /></div>
    {error && <p className="error-banner" role="alert">Could not load allocation: {error}. <button className="button" onClick={refresh}>Retry</button></p>}
    <div className="allocation-overview-grid">
      <ChartCard title={`Allocation by ${ALLOCATION_DIMENSIONS.find((d) => d.value === dimension)?.label.toLowerCase()}`}
        hint="Weights divide current priced value by the priced portfolio total. Unknown classifications stay in the denominator. Select a category to inspect its holdings."
        ariaLabel={`Portfolio allocation by ${dimension.replace('_', ' ')}`} option={option}
        empty={data?.slices.some((s) => Number(s.market_value) < 0) ? 'Review negative positions in the table before using allocation weights.' : 'No priced holdings yet.'}
        exportName={`allocation-${dimension}`} csv={data ? () => exposureCsv(data) : undefined}
        height={330} busy={data === null && error === null} error={error}
        caption={data ? `${scopeLabel} · priced book ${formatCurrency(data.total_market_value)} · ${formatDate(data.as_of)}` : undefined}
        selection={selection} onSelectionChange={setSelection} selectionScopeKey={dataKey}
        selectionAdapter={(event) => {
          const key = (event as unknown as { data?: { allocationKey?: string } }).data?.allocationKey
          const slice = data?.slices.find((s) => s.key === key)
          return slice ? sliceSelection(slice) : null
        }} rowSelection={(_row, index) => data?.slices[index] ? sliceSelection(data.slices[index]) : null}
        renderSelection={(selected) => {
          const slice = data?.slices.find((s) => selected.kind === 'entity' && s.key === selected.entityId)
          return <><SelectionDetail selection={selected} chartTitle="Portfolio allocation" onClear={() => setSelection(null)} />
            {slice && <div className="allocation-members"><h3>Holdings in this category</h3>
              {slice.members.map((member) => <div key={`${member.security_id}:${member.account}`} className="allocation-member">
                <button className="button" onClick={() => onSelectTicker(member.ticker)}>Open {member.ticker}</button>
                <span>{formatCurrency(member.market_value)}{member.account ? ` · ${member.account}` : ''}</span>
                <small>{member.classification_source} · {member.classification_reviewed_at ? `reviewed ${formatDate(member.classification_reviewed_at)}` : 'not reviewed'}</small>
              </div>)}
            </div>}
          </>
        }} />
      <section className="panel allocation-ranked" aria-label="Allocation amounts and coverage">
        <h2 className="panel-title">Current priced book</h2>
        <p className="allocation-book-value">{data ? formatCurrency(data.total_market_value) : '—'}</p>
        {data && <>
          <div className="allocation-coverage">
            <span><strong>{data.coverage.priced_count} / {data.coverage.holding_count}</strong> holdings priced</span>
            <span><strong>{formatPct(data.coverage.classified_weight_pct, { signed: false })}</strong> of priced value classified</span>
          </div>
          <p className="hint">Quotes: {formatDate(data.as_of)}{data.latest_quote_at !== data.as_of ? ` – ${formatDate(data.latest_quote_at)}` : ''}.
            Missing-price value cannot be estimated from coverage counts.</p>
          <table className="port-table"><thead><tr><th scope="col">Category</th><th scope="col" className="num">Value</th><th scope="col" className="num">Weight</th></tr></thead>
            <tbody>{data.slices.map((slice, index) => <tr key={slice.key} className={slice.is_unknown ? 'allocation-unknown' : ''}>
              <th scope="row"><button className="allocation-category-button" onClick={() => setSelection(sliceSelection(slice))}>
                <span className="allocation-category-swatch" aria-hidden="true" style={{ backgroundColor: slice.is_unknown ? 'var(--other-series)' : `var(--chart-${index % 8 + 1})` }} />{slice.label}
              </button></th>
              <td className="num">{formatCurrency(slice.market_value)}</td><td className="num">{formatPct(slice.weight_pct, { signed: false })}</td>
            </tr>)}</tbody>
          </table>
          {data.coverage.warnings.map((warning) => <p className="hint" key={warning}>{warning}</p>)}
          {data.coverage.unpriced_holdings.length > 0 && <details><summary>Missing quotes ({data.coverage.unpriced_count})</summary>
            {data.coverage.unpriced_holdings.map((h) => <p key={`${h.security_id}:${h.account}`}><button className="button" onClick={() => onSelectTicker(h.ticker)}>{h.ticker}</button> · {formatShares(h.shares)} shares · value unavailable</p>)}
          </details>}
        </>}
      </section>
    </div>
    {data && <AllocationTargetEditor key={dataKey} data={data} owner={owner} onChanged={refresh} />}
    {employer?.owner === owner ? <EmployerPanel value={employer.data} onSelectTicker={onSelectTicker} /> : employerError?.owner === owner
      ? <p className="error-banner">Employer exposure unavailable: {employerError.message} <button className="button" onClick={refresh}>Retry</button></p> : null}
    <details className="allocation-heat"><summary>Explore holding performance by industry</summary>
      <ChartCard title="Holding performance · industry coverage" hint="Area is priced market value; color is performance. Fund industries remain unknown. Select a ticker to inspect it."
        ariaLabel="Holdings grouped by known industry and unknown exposure" option={heat} empty="No priced holdings yet."
        exportName="holdings-industry-performance" csv={() => heatTreemapCsv(industryHoldings)} height={360}
        controls={<Segmented variant="toggle" size="sm" ariaLabel="Heat metric" options={HEAT_METRICS} value={metric} onChange={setMetric} />}
        selectionScopeKey={String(owner ?? 'household')}
        selectionAdapter={(event) => {
          const ticker = (event as unknown as { data?: { ticker?: string } }).data?.ticker
          return ticker ? holdingSelection(ticker) : null
        }} rowSelection={(row) => holdingSelection(String(row[1]))}
        footer={heat !== null ? <p className="hint">Orange = loss, blue = gain, with color capped at ±50%. Unknown industries remain visible.</p> : undefined} />
    </details>
    {classificationError && <p className="error-banner">Classification records unavailable: {classificationError} <button className="button" onClick={refresh}>Retry</button></p>}
    <ClassificationEditor classifications={classificationRows} onChanged={refresh} />
  </div>
}

function EmployerPanel({ value, onSelectTicker }: { value: EmployerExposure; onSelectTicker: (ticker: string) => void }) {
  return <section className="panel allocation-employer" aria-label="Employer equity exposure">
    <h2 className="panel-title">Employer equity · {value.ticker ?? 'Not configured'}</h2>
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
