import { useState } from 'react'
import AmountInput from '../AmountInput'
import InfoHint from '../InfoHint'
import type {
  CreditCardOut,
  RewardCategoryOut,
  RewardRateOut,
  RewardRatePut,
} from '../../types/api'
import { formatCurrency, formatCurrencyCompact, formatPct } from '../../utils/format'
import { canonicalAmount, isAmount } from '../../utils/amount'
import { effectiveRate, type OptimizerResult } from './rewardsMath'
import './matrix.css'

type View = 'multiplier' | 'effective'

interface CellDraft {
  multiplier: string
  note: string
  monthly_cap: string
}

const EMPTY_DRAFT: CellDraft = { multiplier: '', note: '', monthly_cap: '' }

function cellKey(cardId: number, categoryId: number): string {
  return `${cardId}:${categoryId}`
}

/** "2x", "2.5x" — trailing zeros trimmed so the sheet's familiar figures survive. */
function multiplierLabel(multiplier: string): string {
  return `${Number(multiplier)}x`
}

/**
 * The matrix: categories × cards, green = best EFFECTIVE return in both views
 * (spec: toggle changes the number you read, never the winner). Column headers are
 * buttons → drill-in. "Edit multipliers" swaps cells for draft buttons + one inspector
 * form (BracketsEditor's grid-edit spirit without 3 inputs per cell).
 */
export default function RewardsMatrix({
  cards,
  categories,
  rates,
  result,
  weights,
  ownerNames,
  busy,
  onCardClick,
  onSaveRates,
}: {
  cards: CreditCardOut[] // ACTIVE cards, page-sorted
  categories: RewardCategoryOut[] // ACTIVE categories, page-sorted
  rates: RewardRateOut[]
  result: OptimizerResult
  weights: Map<number, number | null>
  /** id -> name for the whole roster. SIZE is the gate: a one-person household has nobody
   *  to tell apart, so no badge is drawn at all. */
  ownerNames: Map<number, string>
  busy: boolean
  onCardClick: (card: CreditCardOut) => void
  onSaveRates: (puts: RewardRatePut[]) => Promise<void>
}) {
  const [view, setView] = useState<View>('multiplier') // spreadsheet parity by default
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState<Map<string, CellDraft>>(new Map())
  const [selected, setSelected] = useState<{ cardId: number; categoryId: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const rateByKey = new Map(rates.map((r) => [cellKey(r.card_id, r.category_id), r]))

  const startEditing = () => {
    const seeded = new Map<string, CellDraft>()
    for (const rate of rates)
      seeded.set(cellKey(rate.card_id, rate.category_id), {
        multiplier: rate.multiplier,
        note: rate.note ?? '',
        monthly_cap: rate.monthly_cap ?? '',
      })
    setDrafts(seeded)
    setSelected(null)
    setError(null)
    setEditing(true)
  }

  const stopEditing = () => {
    setEditing(false)
    setSelected(null)
    setError(null)
  }

  const draftFor = (cardId: number, categoryId: number): CellDraft =>
    drafts.get(cellKey(cardId, categoryId)) ?? EMPTY_DRAFT

  const setDraft = (cardId: number, categoryId: number, patch: Partial<CellDraft>) =>
    setDrafts((current) => {
      const key = cellKey(cardId, categoryId)
      const next = new Map(current)
      // Merge off `current`, not the closed-over `drafts`: two patches batched into one
      // tick would otherwise drop the first.
      next.set(key, { ...(current.get(key) ?? EMPTY_DRAFT), ...patch })
      return next
    })

  const save = () => {
    const puts: RewardRatePut[] = []
    for (const category of categories)
      for (const card of cards) {
        const key = cellKey(card.id, category.id)
        const draft = drafts.get(key)
        const stored = rateByKey.get(key)
        if (draft === undefined) continue
        const multiplier = draft.multiplier.trim()
        const note = draft.note.trim()
        const cap = draft.monthly_cap.trim()
        if (multiplier === '') {
          if (stored)
            puts.push({
              card_id: card.id,
              category_id: category.id,
              multiplier: null,
              note: null,
              monthly_cap: null,
            })
          continue
        }
        if (
          !isAmount(multiplier, { expressions: false }) ||
          Number(canonicalAmount(multiplier, { expressions: false })) <= 0
        ) {
          setError(`${category.name} × ${card.name}: multiplier must be a positive number`)
          return
        }
        if (
          cap !== '' &&
          (!isAmount(cap, { expressions: false }) ||
            Number(canonicalAmount(cap, { expressions: false })) <= 0)
        ) {
          setError(`${category.name} × ${card.name}: monthly cap must be a positive amount`)
          return
        }
        const body: RewardRatePut = {
          card_id: card.id,
          category_id: category.id,
          multiplier: canonicalAmount(multiplier, { expressions: false }),
          note: note || null,
          monthly_cap: cap === '' ? null : canonicalAmount(cap, { expressions: false }),
        }
        const unchanged =
          stored !== undefined &&
          Number(stored.multiplier) === Number(body.multiplier) &&
          (stored.note ?? null) === body.note &&
          (stored.monthly_cap === null ? null : Number(stored.monthly_cap)) ===
            (body.monthly_cap === null ? null : Number(body.monthly_cap))
        if (!unchanged) puts.push(body)
      }
    setError(null)
    onSaveRates(puts)
      .then(() => stopEditing())
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Save failed'))
  }

  const conditionText = (rate: RewardRateOut): string | null => {
    const parts: string[] = []
    if (rate.note) parts.push(rate.note)
    if (rate.monthly_cap !== null)
      parts.push(`bonus capped at ${formatCurrency(rate.monthly_cap)}/mo`)
    return parts.length ? parts.join(' · ') : null
  }

  const selectedDraft = selected ? draftFor(selected.cardId, selected.categoryId) : null
  const selectedCard = selected ? cards.find((c) => c.id === selected.cardId) : null
  const selectedCategory = selected ? categories.find((c) => c.id === selected.categoryId) : null

  return (
    <div className="card span-12">
      <div className="matrix-header">
        <h2 className="eyebrow">
          Rewards matrix — best card per category
          <InfoHint text="Green = best effective return (multiplier × point value), whichever view is showing. Dollar figures are estimates from your category spend weights — actual card usage isn't tracked." />
        </h2>
        <div className="segmented" role="group" aria-label="Matrix view">
          {(['multiplier', 'effective'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={view === mode ? 'active' : ''}
              aria-pressed={view === mode}
              onClick={() => setView(mode)}
            >
              {mode === 'multiplier' ? 'Multiplier' : 'Effective %'}
            </button>
          ))}
        </div>
        {editing ? (
          <>
            <button type="button" className="button button-primary" disabled={busy} onClick={save}>
              Save multipliers
            </button>
            <button type="button" className="button" disabled={busy} onClick={stopEditing}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="button" disabled={busy} onClick={startEditing}>
            Edit multipliers
          </button>
        )}
      </div>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      <div className="matrix-scroll">
        <table className="data-table rewards-matrix">
          <thead>
            <tr>
              <th>Category · $/yr weight</th>
              {cards.map((card) => (
                <th key={card.id} className="num">
                  <button
                    type="button"
                    id={`card-col-${card.id}`}
                    className="matrix-card-btn"
                    aria-label={`Open ${card.name} details`}
                    onClick={() => onCardClick(card)}
                  >
                    {card.name}
                    <span className="sub">
                      {formatCurrency(card.annual_fee)} · {card.rewards_currency}
                      {Number(card.point_value_cents) !== 1 &&
                        ` ${Number(card.point_value_cents)}¢`}
                    </span>
                    {ownerNames.size > 1 && (
                      <span className="sub">
                        {card.person_id === null
                          ? 'Joint'
                          : (ownerNames.get(card.person_id) ?? '—')}
                      </span>
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => {
              const verdict = result.verdicts.get(category.id)
              const weight = weights.get(category.id) ?? null
              return (
                <tr key={category.id}>
                  <td>
                    {category.name}
                    <span className="sub">
                      {' '}
                      {weight === null ? '· no weight' : `· ${formatCurrencyCompact(weight)}/yr`}
                    </span>
                  </td>
                  {cards.map((card) => {
                    const rate = rateByKey.get(cellKey(card.id, category.id))
                    if (editing) {
                      const draft = draftFor(card.id, category.id)
                      const isSelected =
                        selected?.cardId === card.id && selected?.categoryId === category.id
                      return (
                        <td key={card.id} className="num">
                          <button
                            type="button"
                            className={`mx-cell-btn${isSelected ? ' is-editing' : ''}`}
                            aria-label={`Edit ${category.name} on ${card.name}`}
                            onClick={() => setSelected({ cardId: card.id, categoryId: category.id })}
                          >
                            {draft.multiplier.trim() === '' ? '—' : `${draft.multiplier}x`}
                          </button>
                        </td>
                      )
                    }
                    if (!rate)
                      return (
                        <td key={card.id} className="num mx-na">
                          —
                        </td>
                      )
                    const best = verdict?.bestCardIds.includes(card.id) ?? false
                    const tie = best && (verdict?.tie ?? false)
                    const condition = conditionText(rate)
                    const shown =
                      view === 'multiplier'
                        ? multiplierLabel(rate.multiplier)
                        : formatPct(
                            effectiveRate(
                              Number(rate.multiplier),
                              Number(card.point_value_cents),
                            ),
                            { signed: false },
                          )
                    return (
                      <td
                        key={card.id}
                        className={`num mx-cell${best ? ' is-best' : ''}`}
                        data-best={best || undefined}
                        data-tie={tie || undefined}
                      >
                        {shown}
                        {condition && (
                          <sup className="mx-note" title={condition} aria-label={condition}>
                            ⁺
                          </sup>
                        )}
                        {tie && <span className="mx-tie">tie</span>}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Est. $/yr won</td>
              {cards.map((card) => {
                const earnings = result.cardEarnings.get(card.id) ?? 0
                return (
                  <td key={card.id} className="num" data-earnings={card.slug}>
                    {earnings === 0 ? '—' : formatCurrency(earnings)}
                  </td>
                )
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      {editing && (
        <div className="mx-inspector">
          {selected && selectedDraft && selectedCard && selectedCategory ? (
            <>
              <span className="mx-inspector-label">
                {selectedCategory.name} × {selectedCard.name}
              </span>
              <label>
                Multiplier
                <AmountInput
                  kind="plain"
                  id="mx-mult"
                  value={selectedDraft.multiplier}
                  onValueChange={(v) =>
                    setDraft(selected.cardId, selected.categoryId, { multiplier: v })
                  }
                  placeholder="blank = N/A"
                />
              </label>
              <label>
                Condition note
                <input
                  className="field-input"
                  value={selectedDraft.note}
                  maxLength={120}
                  placeholder="portal, Uber only…"
                  onChange={(e) =>
                    setDraft(selected.cardId, selected.categoryId, { note: e.target.value })
                  }
                />
              </label>
              <label>
                Monthly bonus cap
                <AmountInput
                  kind="money"
                  value={selectedDraft.monthly_cap}
                  onValueChange={(v) =>
                    setDraft(selected.cardId, selected.categoryId, { monthly_cap: v })
                  }
                  placeholder="none"
                />
              </label>
              <button
                type="button"
                className="button"
                onClick={() => setDraft(selected.cardId, selected.categoryId, EMPTY_DRAFT)}
              >
                Clear cell
              </button>
            </>
          ) : (
            <span className="mx-inspector-label">Click a cell above to edit it.</span>
          )}
        </div>
      )}

      <p className="drill-hint">
        {editing
          ? 'Blank multiplier = N/A (the card is unusable for that category). Save applies every change at once.'
          : 'Click a card’s column header for its details. ⁺ marks a condition — hover it. Green follows effective return even in multiplier view, so a green 2x can honestly beat a plain 3x.'}
      </p>
    </div>
  )
}
