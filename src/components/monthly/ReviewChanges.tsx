import type { AccountOut, CategoryOut, SpendingMatrix } from '../../types/api'
import { canonicalAmount } from '../../utils/amount'
import { balancesPartName } from './monthlyCopy'
import { committed } from './parts'
import { formatCurrency } from '../../utils/format'
import { typicalSpend } from '../../utils/spending'

interface Change { id: number; label: string; before: number; after: number }
const entered = (value: string | undefined) => {
  const canonical = canonicalAmount(value ?? '')
  return canonical !== '' && Number.isFinite(Number(canonical))
}
const changed = (before: string | undefined, after: string | undefined) => entered(before) !== entered(after) || committed(before) !== committed(after)
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

export default function ReviewChanges({ accounts, categories, balances, amounts, saved, month, matrix, monthExisted, recordedCategories, balanceStory }: {
  accounts: AccountOut[]; categories: CategoryOut[]; balances: Record<number, string>; amounts: Record<number, string>
  /** Each part as last loaded or saved (2026-09-23 spec §M1) — what "Changes since last save" counts
   *  against. Null before the month's first load has landed. */
  saved: { balances: Record<number, string>; amounts: Record<number, string> } | null
  month: string; matrix: SpendingMatrix | null; monthExisted: boolean
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
  const unsavedBalances = saved ? balanceRows.filter(a => changed(saved.balances[a.id], balances[a.id])).length : 0
  const unsavedCategories = saved ? categories.filter(c => changed(saved.amounts[c.id], amounts[c.id])).length : 0
  const unusual = largest(categories.flatMap(c => {
    const typical = matrix ? typicalSpend(matrix, month, c.id) : null
    return typical === null || !recordedCategories.has(c.id) || !entered(amounts[c.id]) ? [] : [{ id: c.id, label: c.name, before: typical, after: committed(amounts[c.id]) }]
  }))
  const balancesWord = unsavedBalances === 1 ? 'balance' : 'balances'
  const categoriesWord = unsavedCategories === 1 ? 'category' : 'categories'
  return <div className="review-changes">
    {/* T4 (2026-09-13 audit): the count is the eyebrow of the tables it summarises, the method
        note their footer — connective tissue attached to its subject instead of floating. */}
    <div className="review-changes-head">
      <h3 className="eyebrow">Changes since last save</h3>
      {/* A month with no snapshot has no balances to count: the Review never records the
          carried-forward ones nobody touched (2026-09-23 spec §M1; spec review G3) — its spending
          changes are still counted. */}
      <span className="review-changes-count" role="status">{monthExisted
        ? `${unsavedBalances} ${balancesWord} · ${unsavedCategories} ${categoriesWord}`
        : `${balancesPartName(month)} not recorded yet · ${unsavedCategories} ${categoriesWord}`}</span>
    </div>
    <div className="review-change-grid">
      <ChangeTable title={balanceStory.title} rows={story} empty={balanceStory.empty} columns={balanceStory.columns} />
      <ChangeTable title="Largest spending differences · recent median" rows={unusual} empty="No differences with an available recent reference." columns={['Reference', 'Entered']} />
    </div>
    <p className="drill-hint review-changes-footer">Spending references use up to three prior entered months. Differences are prompts to check your entries.</p>
  </div>
}
