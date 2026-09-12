import { useState } from 'react'
import { allocationLabel, ASSET_CLASSES, GEOGRAPHIES, saveAllocationTargets, UNKNOWN_CLASSIFICATION } from '../../api/allocation'
import type { AllocationData, AllocationTarget } from '../../api/allocation'
import type { OwnerScope } from '../../api/netWorth'
import { errorDetail } from '../../api/client'
import { undoBatch } from '../../api/lifecycle'
import { formatCurrency, formatDate, formatPct } from '../../utils/format'
import { useToast } from '../ToastProvider'

function percentageUnits(raw: string): number | null {
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(raw.trim())) return null
  const [whole, decimal = ''] = raw.trim().split('.')
  const units = Number(whole) * 10_000 + Number(decimal.padEnd(4, '0'))
  return units <= 1_000_000 ? units : null
}

export default function AllocationTargetEditor({ data, owner, onChanged }: {
  data: AllocationData; owner: OwnerScope; onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const saved = data.draft_target_set ?? data.target_set
  return <section className="panel allocation-targets" aria-label="Allocation targets">
    <div className="panel-title-row">
      <h2 className="panel-title">Your allocation targets</h2>
      <button className="button" onClick={() => setEditing((v) => !v)}>
        {editing ? 'Close editor' : saved ? 'Edit targets' : 'Set targets'}
      </button>
    </div>
    <p className="hint">Targets are your planning choices. Drift uses {formatCurrency(data.total_market_value)} in priced holdings
      {data.as_of ? ` · quotes from ${formatDate(data.as_of)}` : ''}. Positive drift means above target.</p>
    {data.draft_target_set && <p className="hint">An unfinished draft is saved. Current drift still uses your active targets.</p>}
    {editing && <TargetForm key={`${data.by}:${data.scope_key}:${saved?.updated_at ?? ''}`}
      data={data} owner={owner} onSaved={() => { onChanged(); setEditing(false) }} />}
    {data.target_set ? <div className="holdings-scroll"><table className="port-table">
      <thead><tr><th scope="col">Category</th><th scope="col" className="num">Current</th><th scope="col" className="num">Target</th>
        <th scope="col" className="num">Tolerance (pp)</th><th scope="col" className="num">Drift (pp)</th><th scope="col" className="num">Dollar drift</th><th scope="col">Status</th></tr></thead>
      <tbody>{data.drift.map((row) => <tr key={row.key}>
        <th scope="row">{row.label}</th><td className="num">{formatPct(row.weight_pct, { signed: false })}</td>
        <td className="num">{Number(row.target_pct).toLocaleString()}%</td><td className="num">±{Number(row.tolerance_pp).toLocaleString()}</td>
        <td className="num">{row.drift_pp === null ? '—' : `${Number(row.drift_pp) > 0 ? '+' : ''}${Number(row.drift_pp).toFixed(2)}`}</td>
        <td className="num">{formatCurrency(row.drift_amount)}</td>
        <td>{row.has_unpriced ? 'Missing quote' : row.outside_tolerance === null ? 'Unavailable' : row.outside_tolerance ? 'Outside tolerance' : 'Within tolerance'}</td>
      </tr>)}</tbody>
    </table></div> : !editing && <p className="empty-note">No active targets for this dimension and owner. Set your own weights when you are ready.</p>}
    {data.coverage.unpriced_count > 0 && <p className="hint">Missing quotes are excluded from the priced book. Dollar drift is unavailable for a category with an unpriced holding.</p>}
  </section>
}

function TargetForm({ data, owner, onSaved }: { data: AllocationData; owner: OwnerScope; onSaved: () => void }) {
  const saved = data.draft_target_set ?? data.target_set
  const [rows, setRows] = useState<AllocationTarget[]>(() => {
    const initial = [...(saved?.targets ?? [])]
    for (const slice of data.slices) if (!initial.some((row) => row.key === slice.key)) {
      initial.push({ key: slice.key, target_pct: '0', tolerance_pp: '0' })
    }
    return initial
  })
  const [category, setCategory] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  const totalUnits = rows.reduce((sum, row) => sum + (percentageUnits(row.target_pct) ?? 0), 0)
  const valid = rows.every((row) => percentageUnits(row.target_pct) !== null && percentageUnits(row.tolerance_pp) !== null)
  const choices = data.by === 'asset_class' ? ASSET_CLASSES : data.by === 'geography' ? GEOGRAPHIES
    : data.by === 'type' ? { etf: 'ETF', mutual_fund: 'Mutual fund', stock: 'Stock', private: 'Private' } : null
  const patch = (key: string, field: 'target_pct' | 'tolerance_pp', value: string) => {
    setRows((current) => current.map((row) => row.key === key ? { ...row, [field]: value } : row))
  }
  async function save(state: 'draft' | 'active') {
    if (!valid || (state === 'active' && totalUnits !== 1_000_000)) return
    setBusy(true); setError(null)
    try {
      const result = await saveAllocationTargets(data.by, owner, state, rows)
      const batchId = result.headers.get('X-Change-Batch')
      toast.success(state === 'active' ? 'Allocation targets activated' : 'Target draft saved', batchId ? {
        action: { label: 'Undo', onAction: () => {
          void undoBatch(batchId).then(onSaved).catch((err) => toast.error(errorDetail(err)))
        } },
      } : undefined)
      onSaved()
    } catch (err) { setError(errorDetail(err)) } finally { setBusy(false) }
  }
  return <div className="allocation-target-form">
    <p className="hint">Save an unfinished draft at any total. Activate at exactly 100%. Tolerance is in percentage points: a 40% target with 5 pp tolerance allows 35–45%.</p>
    <div className="holdings-scroll"><table className="port-table">
      <thead><tr><th scope="col">Category</th><th scope="col">Target (%)</th><th scope="col">Tolerance (pp)</th><th /></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.key}>
        <th scope="row">{allocationLabel(row.key, data.by)}</th>
        <td><input className="field-input" inputMode="decimal" aria-label={`${allocationLabel(row.key, data.by)} target percent`}
          value={row.target_pct} onChange={(event) => patch(row.key, 'target_pct', event.target.value)} /></td>
        <td><input className="field-input" inputMode="decimal" aria-label={`${allocationLabel(row.key, data.by)} tolerance percentage points`}
          value={row.tolerance_pp} onChange={(event) => patch(row.key, 'tolerance_pp', event.target.value)} /></td>
        <td><button className="button" aria-label={`Remove ${allocationLabel(row.key, data.by)} target`} disabled={busy}
          onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}>Remove</button></td>
      </tr>)}</tbody>
    </table></div>
    <div className="allocation-add-target">
      <label>Add category {choices ? <select className="field-input" value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="">Choose a category</option>
        {Object.entries({ ...choices, [UNKNOWN_CLASSIFICATION]: 'Unknown' }).filter(([key]) => !rows.some((r) => r.key === key))
          .map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select> : <input className="field-input" value={category} maxLength={100} onChange={(e) => setCategory(e.target.value)} />}</label>
      <button className="button" disabled={!category.trim() || rows.some((r) => r.key === category.trim()) || rows.length >= 100 || busy}
        onClick={() => { setRows((current) => [...current, { key: category.trim(), target_pct: '0', tolerance_pp: '0' }]); setCategory('') }}>Add</button>
    </div>
    <p aria-live="polite">Total: <strong>{(totalUnits / 10_000).toLocaleString(undefined, { maximumFractionDigits: 4 })}%</strong>
      {totalUnits !== 1_000_000 ? ' · Needs 100% to activate' : ' · Ready to activate'}</p>
    {!valid && <p role="alert" className="error-banner">Use numbers from 0 to 100 with up to four decimal places.</p>}
    {error && <p role="alert" className="error-banner">{error}</p>}
    <div className="form-actions">
      <button disabled={busy || !valid} onClick={() => void save('draft')}>Save draft</button>
      <button disabled={busy || !valid || totalUnits !== 1_000_000} onClick={() => void save('active')}>{busy ? 'Saving…' : 'Activate targets'}</button>
    </div>
  </div>
}
