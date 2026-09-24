import type { BalancesDraft, FlowsDraft } from './drafts'
import { balancesKey, flowsKey, type BalancesPart, type FlowsPart } from './parts'

// Restoring unsaved work when a month loads (2026-09-23 spec §M6): each part's stored draft is laid
// over its server seed when it differs from it, and dropped when it matches — a leftover with
// nothing to say. The two parts are decided apart, so one never drags the other with it.

export interface RestoreInput {
  /** Each part as the server holds it — the seed a draft is compared with. */
  balancesSeed: BalancesPart
  flowsSeed: FlowsPart
  balancesDraft: BalancesDraft | null
  flowsDraft: FlowsDraft | null
  /** The rows on screen: a draft is restored per field, keyed by id, so an account or a category
   *  added since the draft was written still seeds. */
  accountIds: number[]
  categoryIds: number[]
  /** The page's derived-parents rule: every parent not in `typed` becomes the sum of its components. */
  derive: (typed: Set<number>, record: Record<number, string>) => Record<number, string>
}

export interface RestoredParts {
  /** What goes on screen: the restored draft, or the seed. */
  balances: BalancesPart
  flows: Pick<FlowsPart, 'amounts' | 'netPay'>
  /** A draft was laid over the part — its banner shows. */
  restored: { balances: boolean; flows: boolean }
  /** A stored draft to forget: it matched its seed. */
  drop: { balances: boolean; flows: boolean }
}

export function restoreParts(input: RestoreInput): RestoredParts {
  const { balancesSeed, flowsSeed, balancesDraft, flowsDraft } = input
  // A draft may only REMOVE parents from the load-time hand-typed set — that is all a handover
  // does. The SERVER decides which parents still have no component rows, so an older draft can
  // never resurrect a hand-typed row for a month that has since gained them.
  const typed =
    balancesDraft?.typedParents === undefined
      ? balancesSeed.typedParents
      : balancesSeed.typedParents.filter((id) => balancesDraft.typedParents?.includes(id))
  const draftBalances =
    balancesDraft === null
      ? null
      : {
          balances: input.derive(
            new Set(typed),
            Object.fromEntries(
              input.accountIds.map((id) => [id, balancesDraft.balances?.[String(id)] ?? balancesSeed.balances[id]]),
            ),
          ),
          notes: balancesDraft.notes ?? balancesSeed.notes,
          typedParents: typed,
        }
  const draftFlows =
    flowsDraft === null
      ? null
      : {
          amounts: Object.fromEntries(
            input.categoryIds.map((id) => [id, flowsDraft.amounts?.[String(id)] ?? flowsSeed.amounts[id]]),
          ),
          netPay: flowsDraft.netPay ?? flowsSeed.netPay,
        }
  const restoreBalances = draftBalances !== null && balancesKey(draftBalances) !== balancesKey(balancesSeed)
  const restoreFlows = draftFlows !== null && flowsKey(draftFlows) !== flowsKey(flowsSeed)
  return {
    balances: restoreBalances && draftBalances !== null ? draftBalances : balancesSeed,
    flows: restoreFlows && draftFlows !== null ? draftFlows : { amounts: flowsSeed.amounts, netPay: flowsSeed.netPay },
    restored: { balances: restoreBalances, flows: restoreFlows },
    drop: { balances: balancesDraft !== null && !restoreBalances, flows: flowsDraft !== null && !restoreFlows },
  }
}
