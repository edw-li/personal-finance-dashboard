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
    <h4 className="eyebrow">{title}</h4>
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

export default function ReviewChanges({ accounts, categories, balances, amounts, priorBalances, baseline, month, matrix, monthExisted, recordedCategories }: {
  accounts: AccountOut[]; categories: CategoryOut[]; balances: Record<number, string>; amounts: Record<number, string>
  priorBalances: Record<number, string>; baseline: string | null; month: string; matrix: SpendingMatrix | null; monthExisted: boolean
  /** The category ids this save will write a spending row for — the page's `sentCategories`
   *  with `willWriteSpending` folded in (empty when the leg is skipped). A category outside it
   *  is an untouched "0.00" seed, and a seed is not a figure to check against a median (bug F2). */
  recordedCategories: ReadonlySet<number>
}) {
  const saved = baseline ? JSON.parse(baseline) as { balances: Record<number, string>; amounts: Record<number, string>; netPay: string } : null
  const balanceRows = accounts.filter(a => !a.is_component)
  const prior = largest(balanceRows.filter(a => entered(priorBalances[a.id]) && entered(balances[a.id])).map(a => ({ id: a.id, label: a.name, before: amount(priorBalances[a.id]), after: amount(balances[a.id]) })))
  const unsavedBalances = saved ? balanceRows.filter(a => changed(saved.balances[a.id], balances[a.id])).length : 0
  const unsavedCategories = saved ? categories.filter(c => changed(saved.amounts[c.id], amounts[c.id])).length : 0
  const unusual = largest(categories.flatMap(c => {
    const typical = matrix ? typicalSpend(matrix, month, c.id) : null
    return typical === null || !recordedCategories.has(c.id) || !entered(amounts[c.id]) ? [] : [{ id: c.id, label: c.name, before: typical, after: amount(amounts[c.id]) }]
  }))
  const balancesWord = unsavedBalances === 1 ? 'balance' : 'balances'
  const categoriesWord = unsavedCategories === 1 ? 'category' : 'categories'
  return <div className="review-changes">
    {/* T4 (2026-09-13 audit): the count is the eyebrow of the tables it summarises, the method
        note their footer — connective tissue attached to its subject instead of floating. */}
    <div className="review-changes-head">
      <h3 className="eyebrow">Changes since last save</h3>
      <span className="review-changes-count" role="status">{monthExisted
        ? `${unsavedBalances} ${balancesWord} · ${unsavedCategories} ${categoriesWord}`
        : 'New balance snapshot — review the carried-forward balances before confirming.'}</span>
    </div>
    <div className="review-change-grid">
      <ChangeTable title="Largest balance changes · prior month" rows={prior} empty="No changed balances with a prior-month reference." />
      <ChangeTable title="Largest spending differences · recent median" rows={unusual} empty="No differences with an available recent reference." />
    </div>
    <p className="drill-hint review-changes-footer">Spending references use up to three prior entered months. Differences are prompts to check your entries.</p>
  </div>
}
