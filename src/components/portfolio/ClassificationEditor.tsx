import { useState } from 'react'
import { ASSET_CLASSES, GEOGRAPHIES, saveClassification } from '../../api/allocation'
import type { ClassificationInput, SecurityClassification } from '../../api/allocation'
import { errorDetail } from '../../api/client'
import { undoBatch } from '../../api/lifecycle'
import { formatDate } from '../../utils/format'
import { useToast } from '../ToastProvider'

export default function ClassificationEditor({ classifications, onChanged }: {
  classifications: SecurityClassification[]; onChanged: () => void
}) {
  const [editing, setEditing] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const rows = classifications.filter((row) => `${row.ticker} ${row.name}`.toLowerCase().includes(search.toLowerCase()))
  const selected = classifications.find((row) => row.security_id === editing)
  return <details className="panel allocation-classifications">
    <summary>Review security classifications</summary>
    <p className="hint">These classifications apply to the security across all owners. Your reviewed values survive price refreshes and imports. Fund industry stays unknown until constituent data is available.</p>
    <label className="allocation-search">Find a security <input className="field-input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
    {selected && <ClassificationForm key={selected.security_id} value={selected} onCancel={() => setEditing(null)}
      onSaved={() => { setEditing(null); onChanged() }} />}
    <div className="holdings-scroll"><table className="port-table">
      <thead><tr><th scope="col">Security</th><th scope="col">Asset class</th><th scope="col">Industry</th><th scope="col">Geography</th><th scope="col">Source / reviewed</th><th /></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.security_id}>
        <th scope="row" title={row.name}>{row.ticker}</th><td>{ASSET_CLASSES[row.asset_class ?? ''] ?? 'Unknown'}</td>
        <td>{row.industry ?? (row.industry_available ? 'Unknown' : 'Fund holdings not loaded')}</td>
        <td>{GEOGRAPHIES[row.geography ?? ''] ?? 'Unknown'}</td>
        <td>{row.source}<span className="sub"> · {row.reviewed_at ? formatDate(row.reviewed_at) : 'Not reviewed'}</span></td>
        <td><button className="button" onClick={() => setEditing(row.security_id)} aria-label={`Review ${row.ticker} classification`}>Review</button></td>
      </tr>)}</tbody>
    </table></div>
  </details>
}

function ClassificationForm({ value, onCancel, onSaved }: {
  value: SecurityClassification; onCancel: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState<ClassificationInput>({
    asset_class: value.asset_class, industry: value.industry, geography: value.geography, note: value.note,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  const set = (key: keyof ClassificationInput, input: string) => setForm((state) => ({ ...state, [key]: input || null }))
  async function save() {
    setBusy(true); setError(null)
    try {
      const result = await saveClassification(value.security_id, form)
      const id = result.headers.get('X-Change-Batch')
      toast.success(`${value.ticker} classification reviewed`, id ? { action: { label: 'Undo', onAction: () => {
        void undoBatch(id).then(onSaved).catch((err) => toast.error(errorDetail(err)))
      } } } : undefined)
      onSaved()
    } catch (err) { setError(errorDetail(err)) } finally { setBusy(false) }
  }
  return <form className="allocation-classification-form" onSubmit={(event) => { event.preventDefault(); void save() }}>
    <h3>Review {value.ticker} · {value.name}</h3>
    <div className="entry-form">
      <label>Asset class<select value={form.asset_class ?? ''} onChange={(e) => set('asset_class', e.target.value)}>
        <option value="">Unknown</option>{Object.entries(ASSET_CLASSES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <label>Industry<input className="field-input" value={form.industry ?? ''} maxLength={80} disabled={!value.industry_available}
        placeholder={value.industry_available ? 'Unknown' : 'Fund holdings not loaded'} onChange={(e) => set('industry', e.target.value)} /></label>
      <label>Geography<select value={form.geography ?? ''} onChange={(e) => set('geography', e.target.value)}>
        <option value="">Unknown</option>{Object.entries(GEOGRAPHIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <label>Source / review note<input className="field-input" value={form.note ?? ''} maxLength={500}
        placeholder="For example: fund fact sheet, reviewed today" onChange={(e) => set('note', e.target.value)} /></label>
    </div>
    {error && <p role="alert" className="error-banner">{error}</p>}
    <div className="form-actions"><button disabled={busy} type="submit">{busy ? 'Saving…' : 'Save reviewed classification'}</button>
      <button disabled={busy} type="button" onClick={onCancel}>Cancel</button></div>
  </form>
}
