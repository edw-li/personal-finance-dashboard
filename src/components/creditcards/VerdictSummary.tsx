import { VERDICT_LABEL, type CardVerdictKind } from './rewardsMath'
import { perYear } from './verdictCopy'
import './verdicts.css'

/** One card's line in the Rewards footer. */
export interface VerdictEntry {
  cardId: number
  name: string
  kind: CardVerdictKind
  net: number
  /** `tieWords` for a $0-marginal card that only ties another card's rate; else null. */
  ties: string | null
}

// Worst first: the one group that asks for action leads.
const ORDER: CardVerdictKind[] = ['costs', 'free', 'earns']

const TAIL: Record<CardVerdictKind, string> = {
  costs: ' — the fee is more than the card adds.',
  free: ' — closing saves nothing and shrinks your available credit.',
  earns: '.',
}

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
  const describe = (entry: VerdictEntry) =>
    entry.kind === 'free'
      ? entry.ties === null
        ? entry.name
        : `${entry.name} (${entry.ties})`
      : `${entry.name} (${perYear(entry.net)})`
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
