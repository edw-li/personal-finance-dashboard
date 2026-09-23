import { VERDICT_LABEL, type CardVerdictKind } from './rewardsMath'
import { perYear, verdictNote } from './verdictCopy'
import './verdicts.css'

/** One card's line in the Rewards footer. */
export interface VerdictEntry {
  cardId: number
  name: string
  kind: CardVerdictKind
  net: number
  /** The card's marginal rewards — below zero only when a pin sends spend to it. */
  marginal: number
  /** `tieReason`'s answer: the tie behind a $0 marginal, else null. */
  ties: string | null
}

// Worst first: the one group that asks for action leads.
const ORDER: CardVerdictKind[] = ['costs', 'free', 'earns']

/** The group's closing words, agreeing with how many cards it names. "Free to keep" says what
 *  keeping holds on to — the spec's available credit AND credit history — and makes no
 *  "closing saves nothing" claim a pinned card would contradict. */
function tail(kind: CardVerdictKind, count: number): string {
  const one = count === 1
  switch (kind) {
    case 'costs':
      return one ? ' — the fee is more than the card adds.' : ' — each fee is more than its card adds.'
    case 'free':
      return ` — keeping ${one ? 'it' : 'them'} open holds on to your available credit and your credit history.`
    case 'earns':
      return '.'
  }
}

/**
 * The Rewards view's verdict footer (2026-09-23 spec §B6), replacing "Droppable on these
 * numbers": three groups, each only when it has a card. Beside each name, `verdictNote`'s why —
 * a pin that costs rewards, or the tie behind a $0 marginal (a one-at-a-time marginal prices
 * BOTH tied cards at $0: dropping one is free, dropping both is not). The tag's tone is backed
 * by its words (never colour alone).
 */
export default function VerdictSummary({
  entries,
  unweightedCount,
}: {
  entries: VerdictEntry[]
  unweightedCount: number
}) {
  const describe = (entry: VerdictEntry) => {
    const note = verdictNote(entry, entry.ties)
    if (entry.kind === 'free') return note === null ? entry.name : `${entry.name} (${note})`
    return `${entry.name} (${perYear(entry.net)}${note === null ? '' : `; ${note}`})`
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
              {tail(kind, group.length)}
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
