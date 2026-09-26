import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ApiError, describeError, errorDetail } from '../../api/client'
import { undoBatch } from '../../api/lifecycle'
import {
  createCategory,
  deleteCategory,
  fetchCategories,
  reorderCategories,
  updateCategory,
  updateCategoryLogged,
} from '../../api/spending'
import type { CategoryKind, CategoryOut } from '../../types/api'
import InfoHint from '../InfoHint'
import BusyButton from '../feedback/BusyButton'
import { useDeleteWithUndo } from '../feedback/useDeleteWithUndo'
import { flashElement, revealEditor, revealRow, useEscapeCancel } from '../feedback/reveal'
import { useLatest } from '../reorder/useLatest'
import DragHandle from '../reorder/DragHandle'
import {
  ORDER_RESTORED,
  movedToast,
  orderSaveFailed,
  staleListText,
  undoFailureText,
} from '../reorder/orderCopy'
import { ReorderInstructions, ReorderLiveRegion } from '../reorder/ReorderStatus'
import { useReorder } from '../reorder/useReorder'
import type { UseReorder } from '../reorder/useReorder'
import { useRequestCount } from '../reorder/useRequestCount'
import { useToast } from '../ToastProvider'
import { FeedBanner } from '../shell/Feed'
import Segmented from '../shell/Segmented'
import { useScrollEdges } from '../useScrollEdges'
import '../panels.css'
import './settings.css'
import SettingsGhost from './SettingsGhost'
import { WARM, warmSource } from './settingsPrefetch'

interface CategoryFormState {
  name: string
}

const EMPTY_CATEGORY: CategoryFormState = { name: '' }

// Living · Tax · Transfer (2026-09-04 honest-numbers spec §1) on the house's ONE pick-one
// control, so a category's kind reads like every other three-way choice in the app.
const KINDS: { value: CategoryKind; label: string }[] = [
  { value: 'living', label: 'Living' },
  { value: 'tax', label: 'Tax' },
  { value: 'transfer', label: 'Transfer' },
]

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/**
 * The Settings Spending-categories card (2026-08-26 spec §6). The CRUD endpoints have
 * existed since Plan 3 with no caller at all (audit §3.1), so the category axis was fixed
 * by the workbook exactly like the account roster was.
 *
 * The order is the table's (2026-09-23 reorder spec §4.1): a row is dragged by its grip — or
 * lifted with Space and moved with the arrows — and the drop saves the WHOLE order in one PUT,
 * with the change log's Undo behind it.
 */
export default function CategoriesCard() {
  const [categories, setCategories] = useState<CategoryOut[]>([])
  const [loaded, setLoaded] = useState(false)
  // Two slots, because they have two different answers (2026-09-05 motion spec §9): a load
  // failure is fixed by asking again; a refused save or a typo is not.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  // Every write goes through `track`, its reload chained inside it: the card is busy from the
  // request until the rows it changed are back on screen — counted, since an Undo from an older
  // toast can run beside a save. The chains end in their own catch, so none of them rejects.
  const { busy, track } = useRequestCount()
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<CategoryFormState>(EMPTY_CATEGORY)
  // A drop renders its order AT ONCE; the order is retired the moment the server's rows land —
  // CategoriesPanel's adjust-during-render recipe, not an effect (spec §4.1).
  const [pendingOrder, setPendingOrder] = useState<CategoryOut[] | null>(null)
  const [lastCategories, setLastCategories] = useState(categories)
  const seqRef = useRef(0)
  const toast = useToast()
  const formRef = useRef<HTMLFormElement>(null)
  const landingId = useRef<number | null>(null)
  const [rowUpdates, setRowUpdates] = useState<Record<number, Partial<CategoryOut>>>({})
  const deleteWithUndo = useDeleteWithUndo()
  const findRow = (id: number) => document.querySelector<HTMLElement>(`#categories [data-settings-row="${id}"]`)

  useLayoutEffect(() => {
    if (editingId !== null) revealEditor(formRef.current, 'input')
  }, [editingId])
  useLayoutEffect(() => {
    if (busy || landingId.current === null) return
    const row = findRow(landingId.current)
    if (row === null) return
    landingId.current = null
    revealRow(row)
    flashElement(row)
    row.querySelector<HTMLButtonElement>('[data-edit]')?.focus({ preventScroll: true })
  }, [categories, busy])


  if (lastCategories !== categories) {
    setLastCategories(categories)
    setPendingOrder(null)
  }
  // What the table draws: the dropped order while its save is in flight, else the server's.
  const shown = (pendingOrder ?? categories).map((row) => ({ ...row, ...rowUpdates[row.id] }))
  const nameOf = new Map(shown.map((category) => [category.id, category.name]))

  // Returns its promise: every write RETURNS the reload it starts, so the card stays busy — grips
  // parked — until the list it changed is back on screen. Released any earlier, a drop could
  // diff against rows the write has already moved past (after an Undo: PUT the undone move back).
  const load = (initial = false) => {
    const seq = ++seqRef.current
    return warmSource(initial)(WARM.categories, fetchCategories)
      .then((rows) => {
        if (seq !== seqRef.current) return
        setCategories(rows)
        setLoadError(null)
        setLoaded(true)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setLoadError(describeError(err, 'the categories'))
      })
  }

  useEffect(() => {
    load(true)
    // mount-only: a plain function over stable setters (house idiom)
  }, [])

  const setText = (field: keyof CategoryFormState) => (value: string) => {
    setForm((f) => ({ ...f, [field]: value }))
    setFormError(null)
  }

  const cancelEdit = () => {
    if (editingId !== null) findRow(editingId)?.querySelector<HTMLButtonElement>('[data-edit]')?.focus()
    setEditingId(null)
    setForm(EMPTY_CATEGORY)
    setFormError(null)
  }
  useEscapeCancel(formRef, cancelEdit, editingId !== null)
  const latest = useLatest({ editingId, cancelEdit, load, rows: categories })

  const submit = () => {
    const name = form.name.trim()
    if (!name) {
      setFormError('Category name is required.')
      return
    }
    // The name alone: the position is the table's now — a new category lands at the end and
    // is dragged into place (2026-09-23 reorder spec §3.3, §4.1).
    const body = { name }
    setFormError(null)
    const request = editingId !== null ? updateCategory(editingId, body) : createCategory(body)
    void track(() =>
      request
        .then((saved) => {
          landingId.current = saved.id
          setEditingId(null)
          setForm(EMPTY_CATEGORY)
          return load()
        })
        .catch((err: unknown) => setFormError(message(err, 'Save failed'))),
    )
  }

  // One-click changes draw at once. Grips wait for the reload; only this row's controls wait.
  const changeRow = (category: CategoryOut, patch: Partial<CategoryOut>, label: string) => {
    if (rowUpdates[category.id] !== undefined) return
    setRowUpdates((current) => ({ ...current, [category.id]: patch }))
    void track(async () => {
      try {
        const { batchId } = await updateCategoryLogged(category.id, patch)
        await latest.current.load()
        toast.success(label, batchId === null ? undefined : { action: { label: 'Undo', onAction: () => {
          void track(async () => {
            try {
              await undoBatch(batchId)
              landingId.current = category.id
              await latest.current.load()
              toast.success(`Restored ${category.name}`)
            } catch (err) {
              toast.error(errorDetail(err))
              findRow(category.id)?.querySelector<HTMLButtonElement>('[data-edit]')?.focus()
            }
          })
        } } })
      } catch (err) {
        toast.error(errorDetail(err))
      } finally {
        setRowUpdates((current) => { const next = { ...current }; delete next[category.id]; return next })
      }
    })
  }

  const toggleActive = (category: CategoryOut) => changeRow(
    category, { is_active: !category.is_active }, `${category.is_active ? 'Retired' : 'Restored'} ${category.name}`,
  )

  const setKind = (category: CategoryOut, next: CategoryKind) => {
    if (next === category.kind) return
    changeRow(category, { kind: next }, `${category.name} is now ${KINDS.find((kind) => kind.value === next)?.label} ? every month recalculated`)
  }

  const remove = (category: CategoryOut) => {
    const rows = [...document.querySelectorAll<HTMLElement>('#categories [data-settings-row]')]
    const index = rows.findIndex((row) => row === findRow(category.id))
    const neighbour = rows[index + 1] ?? rows[index - 1]
    void track(() => deleteWithUndo({
      name: `category ${category.name}`,
      row: findRow(category.id),
      request: () => deleteCategory(category.id),
      onDeleted: async () => {
        if (latest.current.editingId === category.id) latest.current.cancelEdit()
        await latest.current.load()
      },
      focusAfter: () => neighbour?.isConnected
        ? neighbour.querySelector<HTMLButtonElement>('[data-delete]')
        : formRef.current?.querySelector<HTMLInputElement>('input') ?? null,
      onRestored: () => latest.current.load(),
      restoredRow: () => findRow(category.id),
    }))
  }

  // The reorder route logs its batch (spec §3.2), so Undo is the change log's: the server
  // writes every renumbered row back, then the list is read again — and the grips wait for it.
  // A refusal ("Later changes touched these rows — undo those first", spec §9) is the server's
  // own sentence (§8.1).
  const undoOrder = (batchId: string) => {
    void track(() =>
      undoBatch(batchId)
        .then(() => {
          toast.info(ORDER_RESTORED)
          return load()
        })
        .catch((err: unknown) => toast.error(undoFailureText(err))),
    )
  }

  // One PUT with every category — active and retired — in the dropped order (spec §4.1). Its
  // outcome is about a row far down the table, so it rides the toast layer, never the form
  // banner (the delete guard's rule above).
  const saveOrder = (ids: number[], moved: number) => {
    const name = nameOf.get(moved) ?? 'the category'
    // The save takes a turn in load's sequence, so an older answer never lands last: its rows are
    // drawn only if nothing was asked for after it. Something that was — the reload after an
    // older toast's Undo — may have read the list BEFORE this save committed, so an overtaken
    // save reads the list once more instead of drawing its own answer.
    const seq = ++seqRef.current
    void track(() =>
      reorderCategories(ids)
        .then(({ data, batchId }) => {
          toast.success(
            movedToast(name),
            // No batch = nothing was logged, so there is nothing to undo (the wizard's contract).
            batchId === null
              ? undefined
              : { action: { label: 'Undo', onAction: () => undoOrder(batchId) } },
          )
          if (seq !== seqRef.current) return load()
          setCategories(data)
          reorder.markSaved(moved)
        })
        .catch((err: unknown) => {
          setPendingOrder(null) // back to the last order the server confirmed…
          // …then read again, whatever the failure: a 409 means the list changed under this one
          // (another tab — the server's own sentence, spec §8.3), and a 5xx can arrive after the
          // write committed. Either way the rows drawn next are the server's.
          toast.error(
            err instanceof ApiError && err.status === 409
              ? staleListText(err)
              : orderSaveFailed(errorDetail(err)),
          )
          return load()
        }),
    )
  }

  const reorder = useReorder({
    items: shown.map((category) => ({ id: category.id })),
    labelOf: (id) => nameOf.get(id) ?? String(id),
    // Every request of the card parks the grips — a drop cannot race a save (spec §9) — and so
    // does a list that failed to reload: the rows on screen may be behind the server's.
    disabled: busy || loadError !== null,
    onCommit: (next, moved) => {
      const byId = new Map(shown.map((category) => [category.id, category]))
      setPendingOrder(
        next.flatMap((id) => {
          const category = byId.get(id)
          return category === undefined ? [] : [category]
        }),
      )
      saveOrder(next, moved)
    },
  })

  return (
    <section className="card span-12" id="categories">
      <h2 className="eyebrow">
        Spending categories
        <InfoHint text="The spending matrix's rows. Retire keeps a category out of the wizard without losing its history; delete only works while a category has no monthly rows. The slug never changes — it is the workbook importer's key. Drag a row by its grip to change the order the app lists categories in." />
      </h2>
      <FeedBanner error={loadError} retry={() => load()} retryLabel="Retry loading the categories" />
      {!loaded && loadError === null && <SettingsGhost height={695} />}
      {loaded && (
        <>
          <form
            ref={formRef}
            className="category-form"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <label>
              Category name
              <input
                className="field-input"
                value={form.name}
                onChange={(e) => setText('name')(e.target.value)}
              />
            </label>
            <div className="settings-card-actions">
              <BusyButton type="submit" className="button button-primary" busy={busy && Object.keys(rowUpdates).length === 0} inert={busy}>
                {editingId !== null ? 'Save category' : 'Add category'}
              </BusyButton>
              {editingId !== null && (
                <button type="button" className="button" onClick={cancelEdit}>
                  Cancel
                </button>
              )}
              {formError && <span role="alert" className="save-status is-error">{formError}</span>}
            </div>
          </form>
          {categories.length === 0 ? (
            <p className="empty-note">No categories yet — add the first one above.</p>
          ) : (
            <>
              <CategoriesTable
                categories={shown}
                busy={busy && Object.keys(rowUpdates).length === 0}
                pendingIds={Object.keys(rowUpdates).map(Number)}
                editingId={editingId}
                reorder={reorder}
                onEdit={(category) => {
                  setEditingId(category.id)
                  setFormError(null)
                  setForm({ name: category.name })
                }}
                onToggleActive={toggleActive}
                onKind={setKind}
                onRemove={remove}
              />
              {/* Once per card and OUTSIDE the table (a <span> is not a table child): the grips'
                  aria-describedby target and the lift/move/drop announcements (spec §2.4). */}
              <ReorderInstructions id={reorder.instructionsId} />
              <ReorderLiveRegion text={reorder.announcement} />
              {/* What the order is FOR (2026-09-23 reorder spec §8.1): the wizard walks it, and a
                  positional paste fills it — so moving a row here moves where a pasted value lands. */}
              <p className="settings-note">
                The Monthly update lists categories in this order — a spreadsheet column pasted
                there fills them in this order too.
              </p>
              {/* ONE line per kind (spec §1): the three definitions are read while deciding
                  a single row's picker, so they have to be scannable side by side, not
                  buried in a paragraph the reader has to parse to find their case. */}
              <ul className="settings-note">
                <li>
                  Living: money that left the household — food, housing, a loan payment you
                  must fund each month.
                </li>
                <li>
                  Tax: an income-tax payment made from take-home — the April bill, estimated
                  payments; payroll withholding is not here, it never reaches net pay.
                </li>
                <li>
                  Transfer: money that stayed yours — a brokerage or savings deposit, extra
                  principal — part of net worth, not spend.
                </li>
              </ul>
              <p className="settings-note">
                Changing a kind recomputes ALL history: every month, chart and projection
                that reads it moves, not just this one. The change is recorded in Activity.
              </p>
            </>
          )}
        </>
      )}
    </section>
  )
}

/** The scrolling table, its own component so `useScrollEdges` sees a scroller that EXISTS on its
 *  first commit: the card mounts before its rows land, and a hook bound to a ref that is still null
 *  then would never observe the element. The scroller flags `data-scroll-more` (panels.css masks
 *  the clipped edge) and the last column is sticky, so Delete is never hidden behind a scrollbar
 *  that only appears on hover (2026-09-13 spec §7, audit S-3).
 *
 *  The first column is the grip (2026-09-23 reorder spec §4.1): every category, retired ones
 *  included, is a row of ONE list that moves among the others. `.reorder-table` gives each cell
 *  its own hairline so a moving row takes its border with it (reorder.css). */
function CategoriesTable({
  categories,
  busy,
  pendingIds,
  editingId,
  reorder,
  onEdit,
  onToggleActive,
  onKind,
  onRemove,
}: {
  categories: CategoryOut[]
  busy: boolean
  pendingIds: number[]
  editingId: number | null
  reorder: UseReorder<number>
  onEdit: (category: CategoryOut) => void
  onToggleActive: (category: CategoryOut) => void
  onKind: (category: CategoryOut, next: CategoryKind) => void
  onRemove: (category: CategoryOut) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useScrollEdges(scrollRef)
  // A lifted row holds the list: the row buttons wait for the drop, as they wait for a request
  // (spec §2.3) — an Edit or a Delete must not land on a row that is in the air.
  const locked = busy || reorder.active
  return (
    <div className="settings-scroll" ref={scrollRef}>
      <table className="data-table category-table reorder-table">
        <thead>
          <tr>
            <th className="reorder-grip-cell" aria-hidden="true" />
            <th>Category</th>
            <th>Kind</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {categories.map((category) => {
            const rowLocked = locked || pendingIds.includes(category.id)
            return (
            <tr
              key={category.id}
              data-settings-row={category.id}
              aria-current={category.id === editingId ? true : undefined}
              className={category.id === editingId ? 'is-editing' : undefined}
              {...reorder.itemProps(category.id)}
            >
              <td className="reorder-grip-cell">
                <DragHandle name={category.name} {...reorder.handleProps(category.id)} />
              </td>
              <td>{category.name}</td>
              <td>
                <Segmented
                  variant="toggle"
                  size="sm"
                  ariaLabel={`Kind for ${category.name}`}
                  // disabled while a request is in flight, like the row's other controls: a second
                  // PATCH would race the reload that follows the first and the picker would flicker back.
                  options={KINDS.map((k) => ({ ...k, disabled: rowLocked }))}
                  value={category.kind}
                  onChange={(next) => onKind(category, next)}
                />
              </td>
              <td>
                <span className="badge">{category.is_active ? 'Active' : 'Retired'}</span>
              </td>
              <td className="row-actions">
                <BusyButton data-edit type="button" className="button" aria-label={`Edit ${category.name}`} inert={rowLocked} onClick={() => onEdit(category)}>
                  Edit
                </BusyButton>
                <BusyButton
                  type="button"
                  className="button"
                  aria-label={category.is_active ? `Retire ${category.name}` : `Restore ${category.name}`}
                  inert={rowLocked}
                  onClick={() => onToggleActive(category)}
                >
                  {category.is_active ? 'Retire' : 'Restore'}
                </BusyButton>
                <BusyButton data-delete type="button" className="button" aria-label={`Delete ${category.name}`} inert={rowLocked} onClick={() => onRemove(category)}>
                  Delete
                </BusyButton>
              </td>
            </tr>
          )})}
        </tbody>
      </table>
    </div>
  )
}
