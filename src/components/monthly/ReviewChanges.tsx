import type { AccountOut, CategoryOut, SpendingMatrix } from '../../types/api'
import { canonicalAmount } from '../../utils/amount'
import { formatCurrency } from '../../utils/format'
import { typicalSpend } from '../../utils/spending'

interface Change { id: number; label: string; before: number; after: number }
const amount = (value: string | undefined) => Number(canonicalAmount(value ?? '')) || 0
const entered = (value: string | undefined) => {
  const canonical = canonicalAmount(value ?? '')
  return canonical !== '' && Number.isFinite(Number(canonical))
}
const changed = (before: string | undefined, after: string | undefined) => entered(before) !== entered(after) || amount(before) !== amount(after)
const largest = (rows: Change[]) => rows.filter(row => Math.round((row.after - row.before) * 100) !== 0)
  .sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before)).slice(0, 3)

function ChangeTable({ title, rows, empty }: { title: string; rows: Change[]; empty: string }) {
  return <section className="review-change-group">
    <h3 className="eyebrow">{title}</h3>
    {rows.length === 0 ? <p className="drill-hint">{empty}</p> : <table className="data-table">
      <thead><tr><th>Item</th><th>Reference</th><th>Entered</th><th>Change</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>
        <th scope="row">{row.label}</th><td className="numeric">{formatCurrency(row.before)}</td>
        <td className="numeric">{formatCurrency(row.after)}</td>
        <td className="numeric">{row.after >= row.before ? '+' : '−'}{formatCurrency(Math.abs(row.after - row.before))}</td>
      </tr>)}</tbody>
    </table>}
  </section>
}

export default function ReviewChanges({ accounts, categories, balances, amounts, priorBalances, baseline, month, matrix, monthExisted }: {
  accounts: AccountOut[]; categories: CategoryOut[]; balances: Record<number, string>; amounts: Record<number, string>
  priorBalances: Record<number, string>; baseline: string | null; month: string; matrix: SpendingMatrix | null; monthExisted: boolean
}) {
  const saved = baseline ? JSON.parse(baseline) as { balances: Record<number, string>; amounts: Record<number, string>; netPay: string } : null
  const balanceRows = accounts.filter(a => !a.is_component)
  const prior = largest(balanceRows.filter(a => entered(priorBalances[a.id]) && entered(balances[a.id])).map(a => ({ id: a.id, label: a.name, before: amount(priorBalances[a.id]), after: amount(balances[a.id]) })))
  const unsavedBalances = saved ? balanceRows.filter(a => changed(saved.balances[a.id], balances[a.id])).length : 0
  const unsavedCategories = saved ? categories.filter(c => changed(saved.amounts[c.id], amounts[c.id])).length : 0
  const unusual = largest(categories.flatMap(c => {
    const typical = matrix ? typicalSpend(matrix, month, c.id) : null
    return typical === null || !entered(amounts[c.id]) ? [] : [{ id: c.id, label: c.name, before: typical, after: amount(amounts[c.id]) }]
  }))
  return <div className="review-changes">
    <p className="review-save-summary" role="status">{monthExisted
      ? `${unsavedBalances} account balances and ${unsavedCategories} categories changed since the last save.`
      : 'New balance snapshot. Review carried-forward balances before confirming.'}</p>
    <div className="review-change-grid">
      <ChangeTable title="Largest balance changes · prior month" rows={prior} empty="No changed balances with a prior-month reference." />
      <ChangeTable title="Largest spending differences · recent median" rows={unusual} empty="No differences with an available recent reference." />
    </div>
    <p className="drill-hint">Spending references use up to three prior entered months. Differences are prompts to check your entries.</p>
  </div>
}
