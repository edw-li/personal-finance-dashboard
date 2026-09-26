import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { ApiError, errorDetail } from '../../api/client'
import {
  createRewardCategory,
  deleteRewardCategory,
  reorderRewardCategories,
  updateRewardCategory,
  updateRewardCategoryLogged,
} from '../../api/creditCards'
import { undoBatch } from '../../api/lifecycle'
import BusyButton from '../feedback/BusyButton'
import { SaveButton } from '../feedback/SaveButton'
import { SaveStatus } from '../feedback/SaveStatus'
import { useSaveState } from '../feedback/useSaveState'
import { useDeleteWithUndo } from '../feedback/useDeleteWithUndo'
import { flashElement, revealEditor, revealRow, useEscapeCancel } from '../feedback/reveal'
import AmountInput from '../AmountInput'
import InfoHint from '../InfoHint'
import DragHandle from '../reorder/DragHandle'
import {
  ORDER_RESTORED,
  movedToast,
  orderSaveFailed,
  staleListText,
  undoFailureText,
} from '../reorder/orderCopy'
import { ReorderInstructions, ReorderLiveRegion } from '../reorder/ReorderStatus'
import { useLatest } from '../reorder/useLatest'
import { useReorder } from '../reorder/useReorder'
import { useRequestCount } from '../reorder/useRequestCount'
import { useToast } from '../ToastProvider'
import type { CategoryOut, CreditCardOut, RewardCategoryOut } from '../../types/api'
import { canonicalAmount, isAmount } from '../../utils/amount'
import { formatCurrency } from '../../utils/format'
import { autoWeightSharers } from './rewardsMath'
import { FeedBanner } from '../shell/Feed'
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
 * Matrix rows: name, annual-spend weight (manual override; blank = auto from the mapped
 * spending category's spend over its ENTERED trailing-12 months), mapping, pin.
 * Deactivate keeps the row out of the matrix without losing its cells.
 */
export default function CategoriesPanel({
  categories,
  cards,
  spendingCategories,
  suggested,
  enteredMonths,
  onChanged,
}: {
  categories: RewardCategoryOut[]
  cards: CreditCardOut[]
  spendingCategories: CategoryOut[]
  suggested: Map<number, number>
  /** Per spending category, how many trailing-12 months are entered — the denominator
   *  behind `suggested`, named in the weight caption (rewardsMath.enteredMonthCounts). */
  enteredMonths: Map<number, number>
  onChanged: () => void | Promise<void>
}) {
  const [form, setForm] = useState<CategoryFormState>(EMPTY_CATEGORY)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [baseline, setBaseline] = useState(EMPTY_CATEGORY)
  const saveState = useSaveState({ dirty: JSON.stringify(form) !== JSON.stringify(baseline) })
  const formRef = useRef<HTMLFormElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const editingRef = useLatest(editingId)
  const deleteWithUndo = useDeleteWithUndo()
  const [rowBusy, setRowBusy] = useState<Set<number>>(new Set())
  const [activeOverrides, setActiveOverrides] = useState<Map<number, boolean>>(new Map())
  const rowFor = (id: number) => document.getElementById(`reward-category-row-${id}`)
  const focusRow = (id: number, flash = false) => {
    const row = rowFor(id)
    if (!row) { formRef.current?.querySelector<HTMLInputElement>('input')?.focus(); return }
    revealRow(row)
    if (flash) flashElement(row)
    row.querySelector<HTMLElement>('[data-row-edit]')?.focus({ preventScroll: true })
  }
  const resetForm = () => {
    // Blur an AmountInput before resetting: its blur commit belongs to the old draft.
    formRef.current?.querySelector<HTMLInputElement>('input')?.focus()
    setEditingId(null)
    setForm(EMPTY_CATEGORY)
    setBaseline(EMPTY_CATEGORY)
    setError(null)
    saveState.clearError()
  }
  const cancelEdit = () => {
    const id = editingRef.current
    resetForm()
    if (id !== null) focusRow(id)
  }
  useEscapeCancel(formRef, cancelEdit, editingId !== null)

  // Requests in flight — counted, never flagged (lane R3 review): a toast's Undo clicked while
  // a later drop's PUT is out settles on its own, and whichever answers first must not wake
  // the grips while the other is still out. Every request runs through `track`, its whole
  // chain inside.
  const { busy, track } = useRequestCount()
  // The page's onChanged as of the LATEST render: a save or an Undo answers long after the
  // render that sent it — a toast stands for 6 s — and must reload through the page as it is
  // now, never as it was at the drop.
  const onChangedRef = useLatest(onChanged)
  const reload = () => onChangedRef.current()
  // Drag to reorder (2026-09-23 drag-to-reorder spec §7). Two layers sit over the page's
  // `categories`, and only a reorder sets either:
  //   pendingOrder — the dropped order, from the moment the grip lets go until the PUT
  //                  answers (optimistic), cleared either way when it does;
  //   savedOrder   — the server's answer, until the page's next fetch replaces `categories`
  //                  (retired during render — the adjust-during-render pattern below, not an
  //                  effect, so react-hooks/set-state-in-effect stays clean).
  // A reload that lands mid-save never flashes a row back to where it came from, and a
  // second move before the reload diffs against the rows on screen, never the stale props
  // (the live-check find the page test pins).
  const [pendingOrder, setPendingOrder] = useState<RewardCategoryOut[] | null>(null)
  const [savedOrder, setSavedOrder] = useState<RewardCategoryOut[] | null>(null)
  const [lastCategories, setLastCategories] = useState(categories)
  const toast = useToast()

  if (lastCategories !== categories) {
    setLastCategories(categories)
    setSavedOrder(null)
  }
  const ordered = (pendingOrder ?? savedOrder ?? categories).map((row) =>
    activeOverrides.has(row.id) ? { ...row, is_active: activeOverrides.get(row.id)! } : row,
  )
  const orderedRef = useLatest(ordered)
  const categoryById = new Map(ordered.map((category) => [category.id, category]))

  const activeCards = cards.filter((c) => c.is_active)
  const spendingName = new Map(spendingCategories.map((c) => [c.id, c.name]))
  const cardName = new Map(cards.map((c) => [c.id, c.name]))

  const set = (field: keyof CategoryFormState) => (value: string) => {
    setError(null)
    saveState.clearError()
    setForm((f) => ({ ...f, [field]: value }))
  }

  const startEdit = (category: RewardCategoryOut) => {
    const next = {
      name: category.name, annual_spend: category.annual_spend ?? '',
      spending_category_id: category.spending_category_id === null ? '' : String(category.spending_category_id),
      pinned_card_id: category.pinned_card_id === null ? '' : String(category.pinned_card_id),
    }
    flushSync(() => {
      setEditingId(category.id)
      setForm(next)
      setBaseline(next)
      setError(null)
      saveState.clearError()
    })
    revealEditor(formRef.current, '#reward-category-name')
  }

  const submit = () => {
    if (busy || saveState.status === 'clean' || saveState.status === 'saved' || saveState.status === 'saving') return
    const name = form.name.trim()
    if (!name) {
      setError('Category name is required')
      revealEditor(formRef.current, '#reward-category-name')
      return
    }
    const spend = form.annual_spend.trim()
    if (
      spend !== '' &&
      (!isAmount(spend, { expressions: false }) ||
        Number(canonicalAmount(spend, { expressions: false })) < 0)
    ) {
      setError('annual_spend must be non-negative')
      revealEditor(formRef.current, '#reward-category-spend')
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
    setError(null)
    void saveState.run(() => track(async () => {
      const saved = await (editingId !== null ? updateRewardCategory(editingId, body) : createRewardCategory(body))
      resetForm()
      await reload()
      requestAnimationFrame(() => focusRow(saved.id, true))
    }))
  }

  const lockRow = (id: number, locked: boolean) => setRowBusy((current) => {
    const next = new Set(current)
    if (locked) next.add(id)
    else next.delete(id)
    return next
  })
  const clearOverride = (id: number) => setActiveOverrides((current) => {
    const next = new Map(current)
    next.delete(id)
    return next
  })

  const toggleActive = (category: RewardCategoryOut) => {
    if (rowBusy.has(category.id)) return
    lockRow(category.id, true)
    setActiveOverrides((current) => new Map(current).set(category.id, !category.is_active))
    void updateRewardCategoryLogged(category.id, { is_active: !category.is_active }).then(async ({ batchId }) => {
      await reload()
      toast.success(`${category.is_active ? 'Hid' : 'Showed'} ${category.name}`, batchId === null ? undefined : {
        action: { label: 'Undo', onAction: () => {
          lockRow(category.id, true)
          void undoBatch(batchId).then(async () => {
            await reload()
            requestAnimationFrame(() => focusRow(category.id, true))
            toast.success(`Restored ${category.name}`)
          }).catch((err: unknown) => { toast.error(errorDetail(err)); focusRow(category.id) })
            .finally(() => lockRow(category.id, false))
        } },
      })
    }).catch((err: unknown) => toast.error(errorDetail(err))).finally(() => {
      clearOverride(category.id)
      lockRow(category.id, false)
    })
  }

  const remove = (category: RewardCategoryOut) => {
    const rows = orderedRef.current
    const at = rows.findIndex((row) => row.id === category.id)
    const neighbour = rows[at + 1] ?? rows[at - 1]
    void track(() => deleteWithUndo({
      name: `${category.name} and its multipliers`,
      row: rowFor(category.id),
      request: () => deleteRewardCategory(category.id),
      onDeleted: async () => {
        if (editingRef.current === category.id) resetForm()
        await reload()
      },
      focusAfter: () => (neighbour ? rowFor(neighbour.id)?.querySelector<HTMLElement>('[data-row-edit]') : null)
        ?? formRef.current?.querySelector<HTMLElement>('input') ?? null,
      onRestored: () => track(async () => { await reload() }),
      restoredRow: () => rowFor(category.id),
    }))
  }

  // A failed save puts the rows back (spec §7, as §4.1). Moving them can blur the grip a
  // keyboard drop left focus on — reverting an upward move moves that grip's own row — so
  // focus is handed back once the DOM has moved (flushSync: the move has happened by the next
  // line). Lane R3's dropPendingOrder.
  const dropPendingOrder = () => {
    const focused = document.activeElement
    flushSync(() => setPendingOrder(null))
    if (
      focused instanceof HTMLElement &&
      focused.isConnected &&
      document.activeElement !== focused
    ) {
      focused.focus()
    }
  }

  // Undo re-sends the order that stood before the drop (spec §7): the route is not
  // change-logged, so the client holds the previous order. The server's answer shows at once,
  // as the saved order — it replaces the drop's, so the rows on screen are the restored ones
  // even when the page's reload hands down nothing new (lane R3's browser find: an Undo's
  // reload can match what the page already holds). A list that changed since answers 409, and
  // the page's reload shows what is there now; any refusal is the server's own sentence (§8.1).
  // Two-argument `then` (lane R3 review): only the request's own failure takes the failure
  // branch — a throw in the success branch is a bug for the console, never "Couldn't undo the
  // move".
  const restoreOrder = (ids: number[]) => {
    void track(() =>
      reorderRewardCategories(ids).then(
        (restored) => {
          setSavedOrder(restored)
          reload()
          toast.info(ORDER_RESTORED)
        },
        (err: unknown) => {
          toast.error(undoFailureText(err))
          if (err instanceof ApiError && err.status === 409) reload()
        },
      ),
    )
  }

  // One drop, one PUT (spec §7): every reward category, hidden ones included, in its new
  // order. The server renumbers them in ONE transaction, so a failure can no longer leave a
  // half-saved order (the per-row PATCH chain this replaces could). The matrix rows follow
  // once the page reloads. `reorder` is read only when the PUT answers, long after the render
  // that declares it below has returned. Two-argument `then`, as restoreOrder's: a throw in
  // the success branch must never print "The list is back to how it was." over the saved order.
  const saveOrder = (next: number[], moved: number) => {
    const category = categoryById.get(moved)
    if (category === undefined) return // the hook commits only ids it was handed
    const previous = ordered.map((row) => row.id)
    // Synchronously: the hook calls onCommit inside flushSync, so the new DOM order and the
    // cleared drag transforms land in one frame (lane R0 consumer rule 3).
    setPendingOrder(
      next.flatMap((id) => {
        const row = categoryById.get(id)
        return row === undefined ? [] : [row]
      }),
    )
    void track(() =>
      reorderRewardCategories(next).then(
        (saved) => {
          setPendingOrder(null)
          setSavedOrder(saved)
          reload()
          reorder.markSaved(moved)
          toast.success(movedToast(category.name), {
            action: { label: 'Undo', onAction: () => restoreOrder(previous) },
          })
        },
        (err: unknown) => {
          dropPendingOrder()
          if (err instanceof ApiError && err.status === 409) {
            // The server's sentence says what happened; the reload shows the rows it means.
            toast.error(staleListText(err))
            reload()
            return
          }
          // The toast layer, never the form's banner: the table is not the form (spec §4.1).
          toast.error(orderSaveFailed(errorDetail(err)))
        },
      ),
    )
  }

  const reorder = useReorder({
    items: ordered.map((category) => ({ id: category.id })),
    labelOf: (id) => categoryById.get(id)?.name ?? 'this category',
    // Any request of the panel in flight — a save, a hide, a delete, the seed, a reorder —
    // leaves the grips focusable but inert (lane R0 consumer rule 4), so a drop never races
    // a save.
    disabled: busy || rowBusy.size > 0,
    onCommit: saveOrder,
  })

  const seed = () => {
    setError(null)
    void track(() =>
      SEED_CATEGORIES.reduce(
        (chain, name, index) =>
          chain.then(() => createRewardCategory({ name, sort_order: index }).then(() => undefined)),
        Promise.resolve<undefined>(undefined),
      )
        .then(() => reload())
        .catch((err: unknown) => setError(message(err, 'Seeding failed'))),
    )
  }

  // The page's weight rule, applied to the column so it never disagrees with the matrix:
  // rows that share one spending category split its figure (rewardsMath.autoWeightSharers).
  const sharers = autoWeightSharers(categories)
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
      if (auto !== undefined) {
        const pool = category.is_active ? (sharers.get(category.spending_category_id) ?? 1) : 1
        // Both maps are one pass over one matrix, so a figure always has its count.
        const entered = enteredMonths.get(category.spending_category_id) ?? 0
        return (
          <>
            {formatCurrency(auto / pool)}
            <span className="sub">
              {' '}
              auto · {pool > 1 ? `1/${pool} share · ` : ''}from {entered} entered month
              {entered === 1 ? '' : 's'}
            </span>
          </>
        )
      }
    }
    return <span className="sub">— excluded from $ math</span>
  }

  return (
    <section className="card span-12" ref={panelRef}>
      <h2 className="eyebrow">
        Categories &amp; weights
        <InfoHint text="Matrix rows. Weight = estimated annual spend: blank uses the mapped spending category's trailing-12-month figure; a typed amount overrides it. Pin forces the 'use which card' answer for a row." />
      </h2>
      {/* The rows on screen decide, as in CardsPanel: the empty note and the table read
          `ordered` — the list a reorder layer may be showing — never the props beneath it. */}
      {ordered.length === 0 && (
        <p className="empty-note">
          No categories yet.{' '}
          <button type="button" className="button" disabled={busy} onClick={seed}>
            Start with the spreadsheet's categories
          </button>
        </p>
      )}
      <form
        ref={formRef}
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
            id="reward-category-spend"
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
          <FeedBanner error={error} />
          <SaveButton type="submit" className="button button-primary" state={saveState} aria-disabled={busy || undefined}>
            {editingId !== null ? 'Save category' : 'Add category'}
          </SaveButton>
          {error === null && <SaveStatus state={saveState} />}
          {editingId !== null && (
            <button
              type="button"
              className="button"
              aria-label="Cancel the category edit"
              onClick={cancelEdit}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
      {ordered.length > 0 && (
        <>
          {/* Once per list and outside the table — a <span> is not a valid child of one (lane
              R0 consumer rule 6). Every grip points its aria-describedby at the instructions. */}
          <ReorderInstructions id={reorder.instructionsId} />
          <ReorderLiveRegion text={reorder.announcement} />
          {/* Capped + scrollable past ~10 rows (sticky header): the row list grows with every
              niche MCC category, and the rest of the page must stay reachable (wherever this
              panel sits — the 2026-08-31 reorder moved it below the matrix). A drag near its
              edge scrolls the box; a keyboard move keeps the landing row in view (lane R0). */}
          <div className="categories-scroll">
            <table className="data-table categories-table reorder-table">
              <thead>
                <tr>
                  <th className="reorder-grip-cell" aria-hidden="true" />
                  <th>Category</th>
                  <th className="num">Weight ($/yr est.)</th>
                  <th>Mapped spending category</th>
                  <th>Pinned card</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ordered.map((category) => (
                  <tr
                    key={category.id}
                    id={`reward-category-row-${category.id}`}
                    aria-current={category.id === editingId ? true : undefined}
                    {...reorder.itemProps(category.id)}
                    className={category.id === editingId ? 'is-editing' : undefined}
                  >
                    {/* Every row, hidden ones included, keeps its place and moves (spec §9). */}
                    <td className="reorder-grip-cell">
                      <DragHandle name={category.name} {...reorder.handleProps(category.id)} />
                    </td>
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
                    {/* Shut while a row is lifted, as during a save (lane R0 consumer rule 5): a
                        click mid-drag would act on a row that is about to move. */}
                    <td className="row-actions">
                      <BusyButton
                        type="button"
                        className="button"
                        data-row-edit
                        aria-label={`Edit ${category.name}`}
                        inert={busy || rowBusy.has(category.id) || reorder.active}
                        onClick={() => startEdit(category)}
                      >
                        Edit
                      </BusyButton>
                      <BusyButton
                        type="button"
                        className="button"
                        aria-label={
                          category.is_active ? `Hide ${category.name}` : `Show ${category.name}`
                        }
                        busy={rowBusy.has(category.id)}
                        inert={busy || reorder.active}
                        onClick={() => toggleActive(category)}
                      >
                        {category.is_active ? 'Hide' : 'Show'}
                      </BusyButton>
                      <BusyButton
                        type="button"
                        className="button"
                        aria-label={`Delete ${category.name}`}
                        inert={busy || rowBusy.has(category.id) || reorder.active}
                        onClick={() => remove(category)}
                      >
                        Delete
                      </BusyButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
