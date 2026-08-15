import type { AccountOut } from '../types/api'

// Components render directly under their aggregate parent (panels.css indents
// .component-row on that assumption), NOT at their sheet-column position — the sheet
// lists source buckets BEFORE their aggregate, which made them appear nested under
// whatever unrelated account happened to precede them. A component whose parent is
// absent from the input (unset link, or parent filtered out upstream) keeps its
// original position; relative API order is preserved everywhere else.
export function nestComponents(accounts: AccountOut[]): AccountOut[] {
  const present = new Set(accounts.map((a) => a.id))
  const childrenByParent = new Map<number, AccountOut[]>()
  for (const account of accounts) {
    if (account.parent_account_id !== null && present.has(account.parent_account_id)) {
      const siblings = childrenByParent.get(account.parent_account_id) ?? []
      siblings.push(account)
      childrenByParent.set(account.parent_account_id, siblings)
    }
  }
  const nested: AccountOut[] = []
  for (const account of accounts) {
    if (account.parent_account_id !== null && present.has(account.parent_account_id)) continue
    nested.push(account, ...(childrenByParent.get(account.id) ?? []))
  }
  return nested
}
