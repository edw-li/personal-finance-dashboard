import { useState } from 'react'
import { ApiError } from '../../api/client'
import {
  createRewardCategory,
  deleteRewardCategory,
  updateRewardCategory,
} from '../../api/creditCards'
import AmountInput from '../AmountInput'
import InfoHint from '../InfoHint'
import { useToast } from '../ToastProvider'
import type { CategoryOut, CreditCardOut, RewardCategoryOut } from '../../types/api'
import { canonicalAmount, isAmount } from '../../utils/amount'
import { formatCurrency } from '../../utils/format'
import './categories.css'

// The workbook's Credit Card Matrix rows — the empty-state seed (spec §4).
export const SEED_CATEGORIES = [
  'Rent/Utilities',
  'Travel: Flights',
  'Travel: Hotels',
  'Travel: Rental Cars',
  'Ground Transportation',
  'Gas',
  'Groceries',
  'Dining/Restaurants',
  'Entertainment',
  'Streaming',
  'Shopping',
  'Amazon',
  'Pets',
  'Gifts',
]

interface CategoryFormState {
  name: string
  annual_spend: string
  spending_category_id: string
  pinned_card_id: string
}

const EMPTY_CATEGORY: CategoryFormState = {
  name: '',
  annual_spend: '',
  spending_category_id: '',
  pinned_card_id: '',
}

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/**
 * Matrix rows: name, annual-spend weight (manual override; blank = auto from the
 * mapped spending category's trailing-12 suggestion), mapping, pin. Deactivate keeps
 * the row out of the matrix without losing its cells.
 */
export default function CategoriesPanel({
  categories,
  cards,
  spendingCategories,
  suggested,
  onChanged,
}: {
  categories: RewardCategoryOut[]
  cards: CreditCardOut[]
  spendingCategories: CategoryOut[]
  suggested: Map<number, number>
  onChanged: () => void
}) {
  const [form, setForm] = useState<CategoryFormState>(EMPTY_CATEGORY)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const activeCards = cards.filter((c) => c.is_active)
  const spendingName = new Map(spendingCategories.map((c) => [c.id, c.name]))
  const cardName = new Map(cards.map((c) => [c.id, c.name]))

  const set = (field: keyof CategoryFormState) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }))

  const startEdit = (category: RewardCategoryOut) => {
    setEditingId(category.id)
    setForm({
      name: category.name,
      annual_spend: category.annual_spend ?? '',
      spending_category_id:
        category.spending_category_id === null ? '' : String(category.spending_category_id),
      pinned_card_id: category.pinned_card_id === null ? '' : String(category.pinned_card_id),
    })
  }

  const submit = () => {
    const name = form.name.trim()
    if (!name) {
      setError('Category name is required')
      return
    }
    const spend = form.annual_spend.trim()
    if (
      spend !== '' &&
      (!isAmount(spend, { expressions: false }) ||
        Number(canonicalAmount(spend, { expressions: false })) < 0)
    ) {
      setError('annual_spend must be non-negative')
      return
    }
    // ALL FOUR keys, every time: a blank box must CLEAR the column, and PATCH treats an
    // omitted key as "leave it alone" — only an explicit null erases (spec §4).
    const body = {
      name,
      annual_spend: spend === '' ? null : canonicalAmount(spend, { expressions: false }),
      spending_category_id:
        form.spending_category_id === '' ? null : Number(form.spending_category_id),
      pinned_card_id: form.pinned_card_id === '' ? null : Number(form.pinned_card_id),
    }
    setBusy(true)
    setError(null)
    const request =
      editingId !== null
        ? updateRewardCategory(editingId, body)
        : // Append, don't default to 0: a new row would otherwise tie the first seeded
          // row's sort_order and id-break to the top of the matrix (final review M3).
          createRewardCategory({
            ...body,
            sort_order: categories.reduce((acc, c) => Math.max(acc, c.sort_order + 1), 0),
          })
    request
      .then(() => {
        document.getElementById('reward-category-name')?.focus()
        setForm(EMPTY_CATEGORY)
        setEditingId(null)
        onChanged()
      })
      .catch((err: unknown) => setError(message(err, 'Save failed')))
      .finally(() => setBusy(false))
  }

  // ONLY is_active on the wire: the row's weight, mapping and pin are untouched columns
  // here, and sending them back would let a stale render overwrite a concurrent edit.
  const toggleActive = (category: RewardCategoryOut) => {
    setBusy(true)
    setError(null)
    updateRewardCategory(category.id, { is_active: !category.is_active })
      .then(() => onChanged())
      .catch((err: unknown) => setError(message(err, 'Update failed')))
      .finally(() => setBusy(false))
  }

  const remove = (category: RewardCategoryOut) => {
    setBusy(true)
    setError(null)
    deleteRewardCategory(category.id)
      .then(() => {
        if (category.id === editingId) {
          setEditingId(null)
          setForm(EMPTY_CATEGORY)
        }
        onChanged()
        toast.success(`Deleted ${category.name} and its multipliers`, {
          action: {
            label: 'Undo',
            onAction: () => {
              // The row only — its cells cascaded away and are not restorable here.
              createRewardCategory({
                name: category.name,
                sort_order: category.sort_order,
                annual_spend: category.annual_spend,
                spending_category_id: category.spending_category_id,
                pinned_card_id: category.pinned_card_id,
              })
                .then(() => {
                  onChanged()
                  toast.info(`Restored ${category.name} — multipliers were not restored`)
                })
                .catch(() => toast.error(`Could not restore ${category.name}`))
            },
          },
        })
      })
      .catch((err: unknown) => setError(message(err, 'Delete failed')))
      .finally(() => setBusy(false))
  }

  const seed = () => {
    setBusy(true)
    setError(null)
    SEED_CATEGORIES.reduce(
      (chain, name, index) =>
        chain.then(() => createRewardCategory({ name, sort_order: index }).then(() => undefined)),
      Promise.resolve<undefined>(undefined),
    )
      .then(() => onChanged())
      .catch((err: unknown) => setError(message(err, 'Seeding failed')))
      .finally(() => setBusy(false))
  }

  const weightCell = (category: RewardCategoryOut) => {
    if (category.annual_spend !== null)
      return (
        <>
          {formatCurrency(category.annual_spend)}
          <span className="sub"> override</span>
        </>
      )
    if (category.spending_category_id !== null) {
      const auto = suggested.get(category.spending_category_id)
      if (auto !== undefined)
        return (
          <>
            {formatCurrency(auto)}
            <span className="sub"> auto · trailing 12 mo</span>
          </>
        )
    }
    return <span className="sub">— excluded from $ math</span>
  }

  return (
    <section className="card span-12">
      <h2 className="eyebrow">
        Categories &amp; weights
        <InfoHint text="Matrix rows. Weight = estimated annual spend: blank uses the mapped spending category's trailing-12-month figure; a typed amount overrides it. Pin forces the 'use which card' answer for a row." />
      </h2>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {categories.length === 0 && (
        <p className="empty-note">
          No categories yet.{' '}
          <button type="button" className="button" disabled={busy} onClick={seed}>
            Start with the spreadsheet's categories
          </button>
        </p>
      )}
      <form
        className="categories-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label>
          Category name
          <input
            id="reward-category-name"
            className="field-input"
            value={form.name}
            onChange={(e) => set('name')(e.target.value)}
          />
        </label>
        <label>
          Annual spend override
          <AmountInput
            kind="money"
            value={form.annual_spend}
            onValueChange={set('annual_spend')}
            placeholder="blank = auto"
          />
        </label>
        <label>
          Spending category (for auto weight)
          <select
            className="field-input"
            value={form.spending_category_id}
            onChange={(e) => set('spending_category_id')(e.target.value)}
          >
            <option value="">— none —</option>
            {spendingCategories.map((category) => (
              <option key={category.id} value={String(category.id)}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Pin to card
          <select
            className="field-input"
            value={form.pinned_card_id}
            onChange={(e) => set('pinned_card_id')(e.target.value)}
          >
            <option value="">— best card wins —</option>
            {activeCards.map((card) => (
              <option key={card.id} value={String(card.id)}>
                {card.name}
              </option>
            ))}
          </select>
        </label>
        <div className="categories-form-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {editingId !== null ? 'Save category' : 'Add category'}
          </button>
          {editingId !== null && (
            <button
              type="button"
              className="button"
              aria-label="Cancel the category edit"
              onClick={() => {
                setEditingId(null)
                setForm(EMPTY_CATEGORY)
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
      {categories.length > 0 && (
        // Capped + scrollable past ~10 rows (sticky header): the row list grows with
        // every niche MCC category, and the matrix below must stay reachable.
        <div className="categories-scroll">
          <table className="data-table categories-table">
            <thead>
              <tr>
                <th>Category</th>
                <th className="num">Weight ($/yr est.)</th>
                <th>Mapped spending category</th>
                <th>Pinned card</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <tr
                  key={category.id}
                  className={category.id === editingId ? 'is-editing' : undefined}
                >
                  <td>{category.name}</td>
                  <td className="num">{weightCell(category)}</td>
                  <td>
                    {category.spending_category_id === null
                      ? '—'
                      : (spendingName.get(category.spending_category_id) ?? '—')}
                  </td>
                  <td>
                    {category.pinned_card_id === null
                      ? '—'
                      : (cardName.get(category.pinned_card_id) ?? '—')}
                  </td>
                  <td>
                    <span className="badge">{category.is_active ? 'Active' : 'Hidden'}</span>
                  </td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="button"
                      aria-label={`Edit ${category.name}`}
                      disabled={busy}
                      onClick={() => startEdit(category)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="button"
                      aria-label={
                        category.is_active ? `Hide ${category.name}` : `Show ${category.name}`
                      }
                      disabled={busy}
                      onClick={() => toggleActive(category)}
                    >
                      {category.is_active ? 'Hide' : 'Show'}
                    </button>
                    <button
                      type="button"
                      className="button"
                      aria-label={`Delete ${category.name}`}
                      disabled={busy}
                      onClick={() => remove(category)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
