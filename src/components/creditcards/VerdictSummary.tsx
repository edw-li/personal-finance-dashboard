import { formatCurrency } from '../../utils/format'
import { VERDICT_LABEL, type CardVerdictKind } from './rewardsMath'
import { perYear } from './verdictCopy'
import './verdicts.css'

/** One card's line in the Rewards footer. */
export interface VerdictEntry {
  cardId: number
  name: string
  kind: CardVerdictKind
  net: number
  /** The card's marginal rewards — below zero only when a pin sends spend to it. */
  marginal: number
  /** `tieWords` for a $0-marginal card that only ties another card's rate; else null. */
  ties: string | null
}

// Worst first: the one group that asks for action leads.
const ORDER: CardVerdictKind[] = ['costs', 'free', 'earns']

// "Free to keep" says what keeping holds on to — the spec's available credit AND credit
// history — and makes no "closing saves nothing" claim a pinned card would contradict.
const TAIL: Record<CardVerdictKind, string> = {
  costs: ' — the fee is more than the card adds.',
  free: ' — keeping them open holds on to your available credit and your credit history.',
  earns: '.',
}

const HALF_CENT = 0.005

/**
 * The Rewards view's verdict footer (2026-09-23 spec §B6), replacing "Droppable on these
 * numbers": three groups, each only when it has a card. A free card that ties another says so,
 * because a one-at-a-time marginal prices BOTH tied cards at $0 — dropping one is free, dropping
 * both is not. The tag's tone is backed by its words (never colour alone).
 */
export default function VerdictSummary({
  entries,
  unweightedCount,
}: {
  entries: VerdictEntry[]
  unweightedCount: number
}) {
  const describe = (entry: VerdictEntry) => {
    if (entry.kind === 'free') {
      // A no-fee card whose pin costs rewards: the fix is the pin, not the card.
      if (entry.marginal <= -HALF_CENT)
        return `${entry.name} (a pin costs ${formatCurrency(-entry.marginal)}/yr — unpin it)`
      return entry.ties === null ? entry.name : `${entry.name} (${entry.ties})`
    }
    // A fee card that only ties another card names the partner too: of two fee cards that tie
    // each other, closing ONE saves its fee — closing both loses the spend.
    const ties = entry.kind === 'costs' && entry.ties !== null ? `; ${entry.ties}` : ''
    return `${entry.name} (${perYear(entry.net)}${ties})`
  }
  return (
    <div className="card-verdicts">
      <ul className="card-verdict-list" aria-label="Card verdicts">
        {ORDER.map((kind) => {
          const group = entries.filter((entry) => entry.kind === kind)
          if (group.length === 0) return null
          return (
            <li key={kind}>
              <span className={`verdict-tag verdict-tag-${kind}`}>{VERDICT_LABEL[kind]}</span>{' '}
              {group.map(describe).join(', ')}
              {TAIL[kind]}
            </li>
          )
        })}
      </ul>
      {unweightedCount > 0 && (
        <p className="drill-hint">
          Excludes {unweightedCount} unweighted {unweightedCount === 1 ? 'category' : 'categories'}.
        </p>
      )}
    </div>
  )
}
