import type { AccountOut, CategoryOut, SpendingMatrix } from '../../types/api'
import { canonicalAmount } from '../../utils/amount'
import { committed } from './parts'
import { formatCurrency } from '../../utils/format'
import { typicalSpend } from '../../utils/spending'
import PendingChanges, { type PendingChangesProps } from './PendingChanges'

interface Change { id: number; label: string; before: number; after: number }
const entered = (value: string | undefined) => {
  const canonical = canonicalAmount(value ?? '')
  return canonical !== '' && Number.isFinite(Number(canonical))
}
const largest = (rows: Change[]) => rows.filter(row => Math.round((row.after - row.before) * 100) !== 0)
  .sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before)).slice(0, 3)

function ChangeTable({ title, rows, empty, columns }: { title: string; rows: Change[]; empty: string; columns: [string, string] }) {
  return <section className="review-change-group">
    <h4 className="eyebrow">{title}</h4>
    {rows.length === 0 ? <p className="drill-hint">{empty}</p> : <table className="data-table">
      <thead><tr><th>Item</th><th>{columns[0]}</th><th>{columns[1]}</th><th>Change</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>
        <th scope="row">{row.label}</th><td className="numeric">{formatCurrency(row.before)}</td>
        <td className="numeric">{formatCurrency(row.after)}</td>
        <td className="numeric">{row.after >= row.before ? '+' : '−'}{formatCurrency(Math.abs(row.after - row.before))}</td>
      </tr>)}</tbody>
    </table>}
  </section>
}

/** The month's story as the balance section tells it (2026-09-23 spec §M5): the SAVED balances on
 *  this 1st → the saved balances on the next 1st, under dated columns — or, when there is no next
 *  1st to compare with, the sentence that says why. */
export interface BalanceStory {
  title: string
  columns: [string, string]
  from: Record<number, string>
  to: Record<number, string> | null
  empty: string
}

export default function ReviewChanges({ accounts, categories, amounts, pending, month, matrix, recordedCategories, balanceStory }: {
  accounts: AccountOut[]; categories: CategoryOut[]; amounts: Record<number, string>
  pending: PendingChangesProps | null
  month: string; matrix: SpendingMatrix | null
  /** The category ids the month records a spending row for — the page's `sentCategories` with
   *  `spendingPresent` folded in (empty for a month with no spending at all). A category outside
   *  it is an untouched "0.00" seed, and a seed is not a figure to check against a median (bug F2). */
  recordedCategories: ReadonlySet<number>
  balanceStory: BalanceStory
}) {
  const balanceRows = accounts.filter(a => !a.is_component)
  const { from, to } = balanceStory
  // The saved snapshots only: the typed figures on the Balances step are this 1st's part, not the
  // change the month produced (spec §M5 — "the story uses saved figures").
  const story = to === null ? [] : largest(balanceRows.filter(a => entered(from[a.id]) && entered(to[a.id]))
    .map(a => ({ id: a.id, label: a.name, before: committed(from[a.id]), after: committed(to[a.id]) })))
  const unusual = largest(categories.flatMap(c => {
    const typical = matrix ? typicalSpend(matrix, month, c.id) : null
    return typical === null || !recordedCategories.has(c.id) || !entered(amounts[c.id]) ? [] : [{ id: c.id, label: c.name, before: typical, after: committed(amounts[c.id]) }]
  }))
  return <div className="review-changes">
    {pending && <PendingChanges {...pending} />}
    <h3 className="eyebrow review-insights-heading">Month-to-month insights</h3>
    <div className="review-change-grid">
      <ChangeTable title={balanceStory.title} rows={story} empty={balanceStory.empty} columns={balanceStory.columns} />
      <ChangeTable title="Largest spending differences · recent median" rows={unusual} empty="No differences with an available recent reference." columns={['Reference', 'Entered']} />
    </div>
    <p className="drill-hint review-changes-footer">Spending references use up to three prior entered months. Differences are prompts to check your entries.</p>
  </div>
}
