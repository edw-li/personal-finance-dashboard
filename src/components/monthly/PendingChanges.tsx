import type { AccountOut, CategoryOut, PersonOut } from '../../types/api'
import { canonicalAmount, isAmount } from '../../utils/amount'
import { formatCurrency } from '../../utils/format'
import { amountKey, type BalancesPart, type FlowsPart } from './parts'

export interface PendingChangesProps {
  accounts: AccountOut[]
  people: PersonOut[]
  /** Exactly the editable rows and categories the save builder will send. */
  balanceRows: AccountOut[]
  categoryRows: CategoryOut[]
  saved: BalancesPart & FlowsPart
  current: BalancesPart & FlowsPart
  /** Stored rows, before the entry form fills missing cells with carry-forwards or zero. */
  storedBalances: Record<number, string>
  storedCategories: ReadonlySet<number>
  send: { balances: boolean; spending: boolean }
}

interface PendingRow {
  key: string
  label: string
  context: string
  before: string
  after: string
  delta?: number
}

const money = (value: string | undefined, empty: string) =>
  value === undefined ? 'Not recorded' : value.trim() === '' ? empty
    : isAmount(value) ? formatCurrency(Number(canonicalAmount(value))) : 'Needs a valid amount'

function amountRow(key: string, label: string, context: string, before: string | undefined, after: string, clearable = false): PendingRow {
  return {
    key, label, context,
    before: money(before, 'Not recorded'),
    after: money(after, clearable ? 'Removed' : 'Needs an amount'),
    // A missing figure is not a measured zero. Only two entered figures have a dollar delta.
    delta: before !== undefined && isAmount(before) && isAmount(after)
      ? Number(canonicalAmount(after)) - Number(canonicalAmount(before)) : undefined,
  }
}

/** The changes this save will write, kept separate from the month's financial movements. */
export default function PendingChanges({ accounts, people, balanceRows, categoryRows, saved, current, storedBalances, storedCategories, send }: PendingChangesProps) {
  const rows: PendingRow[] = []
  const ownerName = (account: AccountOut) => account.person_id === null ? 'Joint'
    : people.find(person => person.id === account.person_id)?.name ?? 'Account balance'
  if (send.balances) {
    for (const account of balanceRows) {
      const before = storedBalances[account.id]
      const after = current.balances[account.id] ?? ''
      if (amountKey(before) === amountKey(after)) continue
      const parent = accounts.find(row => row.id === account.parent_account_id)
      rows.push(amountRow(`balance-${account.id}`, account.name,
        [ownerName(account), parent?.name, 'Balance'].filter(Boolean).join(' · '), before, after))
    }
    // Switching a legacy hand-typed total to components can leave the total unchanged.
    // Name the mode change so a save never appears empty just because the dollars match.
    for (const account of accounts) {
      const before = saved.typedParents.includes(account.id)
      const after = current.typedParents.includes(account.id)
      if (before !== after) rows.push({ key: `mode-${account.id}`, label: account.name,
        context: `${ownerName(account)} · Balance calculation`,
        before: before ? 'Hand-entered total' : 'Sum of components',
        after: after ? 'Hand-entered total' : 'Sum of components' })
    }
    const before = saved.notes.trim() === '' ? '' : saved.notes
    const after = current.notes.trim() === '' ? '' : current.notes
    if (before !== after) rows.push({ key: 'notes', label: 'Balance notes', context: 'Notes',
      before: before || 'None', after: after || 'Removed' })
  }
  if (send.spending) {
    for (const category of categoryRows) {
      const before = storedCategories.has(category.id) ? saved.amounts[category.id] : undefined
      const after = current.amounts[category.id] ?? ''
      if (amountKey(before) !== amountKey(after)) {
        rows.push(amountRow(`category-${category.id}`, category.name, 'Spending, tax & transfers', before, after))
      }
    }
    if (amountKey(saved.netPay) !== amountKey(current.netPay)) {
      rows.push(amountRow('take-home', 'Household take-home', 'Income', saved.netPay || undefined, current.netPay, true))
    }
    if (current.recordZero && !saved.recordZero) rows.push({ key: 'zero', label: 'Record $0 spending',
      context: 'Confirmation', before: 'Not confirmed', after: 'Confirmed for this month' })
  }

  return <section className="review-pending" aria-label="Changes since last save">
    <div className="review-changes-head">
      <h3 className="eyebrow">Changes since last save</h3>
      <span className="review-changes-count" role="status">{rows.length === 0 ? 'No entry changes to save' : `${rows.length} ${rows.length === 1 ? 'change' : 'changes'} to save`}</span>
    </div>
    {rows.length > 0 ? <details className="review-pending-details" open>
      <summary>Will be saved <span className="muted">· {rows.length} {rows.length === 1 ? 'change' : 'changes'}</span></summary>
      <div className="table-scroll">
        <table className="data-table" aria-label="Entries that will be saved">
          <thead><tr><th>Entry</th><th>Last saved</th><th>Will save</th><th>Change</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.key}>
            <th scope="row">{row.label}<small>{row.context}</small></th>
            <td>{row.before}</td><td>{row.after}</td>
            <td className="numeric">{row.delta === undefined ? '—' : `${row.delta < 0 ? '−' : '+'}${formatCurrency(Math.abs(row.delta))}`}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details> : <p className="drill-hint">Only edited parts are saved. Completion confirmations are below.</p>}
  </section>
}
