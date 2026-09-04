import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import {
  createCategory,
  deleteCategory,
  fetchCategories,
  updateCategory,
} from '../../api/spending'
import type { CategoryKind, CategoryOut } from '../../types/api'
import InfoHint from '../InfoHint'
import { useToast } from '../ToastProvider'
import { FeedBanner } from '../shell/Feed'
import Segmented from '../shell/Segmented'
import '../panels.css'
import './settings.css'

interface CategoryFormState {
  name: string
  sort_order: string
}

const EMPTY_CATEGORY: CategoryFormState = { name: '', sort_order: '0' }

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
 */
export default function CategoriesCard() {
  const [categories, setCategories] = useState<CategoryOut[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<CategoryFormState>(EMPTY_CATEGORY)
  const seqRef = useRef(0)
  const toast = useToast()

  const load = () => {
    const seq = ++seqRef.current
    fetchCategories()
      .then((rows) => {
        if (seq !== seqRef.current) return
        setCategories(rows)
        setError(null)
        setLoaded(true)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(message(err, 'Could not load categories.'))
      })
  }

  useEffect(() => {
    load()
    // mount-only: a plain function over stable setters (house idiom)
  }, [])

  const setText = (field: keyof CategoryFormState) => (value: string) => {
    setForm((f) => ({ ...f, [field]: value }))
    setError(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setForm(EMPTY_CATEGORY)
  }

  const submit = () => {
    const name = form.name.trim()
    if (!name) {
      setError('Category name is required.')
      return
    }
    const body = { name, sort_order: Number(form.sort_order) || 0 }
    setBusy(true)
    setError(null)
    const request = editingId !== null ? updateCategory(editingId, body) : createCategory(body)
    request
      .then(() => {
        cancelEdit()
        load()
      })
      .catch((err: unknown) => setError(message(err, 'Save failed')))
      .finally(() => setBusy(false))
  }

  // ONLY is_active on the wire: the name and position are untouched columns here.
  const toggleActive = (category: CategoryOut) => {
    setBusy(true)
    setError(null)
    updateCategory(category.id, { is_active: !category.is_active })
      .then(() => load())
      .catch((err: unknown) => setError(message(err, 'Update failed')))
      .finally(() => setBusy(false))
  }

  // ONLY kind on the wire — toggleActive's rule: the name and position are untouched columns
  // here. Clicking the kind a row already has is a no-op: Segmented reports every click,
  // including one on the active button, and a PATCH that changed nothing would still write a
  // change-log batch offering to "undo" it (L2 hooks cover PATCH /categories, spec §6).
  const setKind = (category: CategoryOut, next: CategoryKind) => {
    if (next === category.kind) return
    setBusy(true)
    setError(null)
    updateCategory(category.id, { kind: next })
      .then(() => load())
      .catch((err: unknown) => setError(message(err, 'Update failed')))
      .finally(() => setBusy(false))
  }

  const remove = (category: CategoryOut) => {
    setBusy(true)
    // The server's guard sentence names the monthly-row count; it is about a table row,
    // so it rides the toast layer rather than the form banner (AccountsCard's rule).
    deleteCategory(category.id)
      .then(() => {
        if (category.id === editingId) cancelEdit()
        load()
      })
      .catch((err: unknown) => toast.error(message(err, 'Delete failed')))
      .finally(() => setBusy(false))
  }

  return (
    <section className="card span-6" id="categories">
      <h2 className="eyebrow">
        Spending categories
        <InfoHint text="The spending matrix's rows. Retire keeps a category out of the wizard without losing its history; delete only works while a category has no monthly rows. The slug never changes — it is the workbook importer's key." />
      </h2>
      <FeedBanner error={error} retry={load} />
      {!loaded && error === null && <p className="empty-note">Loading…</p>}
      {loaded && (
        <>
          <form
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
            <label>
              Sort order
              <input
                className="field-input"
                inputMode="numeric"
                value={form.sort_order}
                onChange={(e) => setText('sort_order')(e.target.value)}
              />
            </label>
            <div className="settings-card-actions">
              <button type="submit" className="button button-primary" disabled={busy}>
                {editingId !== null ? 'Save category' : 'Add category'}
              </button>
              {editingId !== null && (
                <button type="button" className="button" onClick={cancelEdit}>
                  Cancel
                </button>
              )}
            </div>
          </form>
          {categories.length === 0 ? (
            <p className="empty-note">No categories yet — add the first one above.</p>
          ) : (
            <>
              <div className="settings-scroll">
                <table className="data-table category-table">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Kind</th>
                      <th className="num">Sort</th>
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
                        <td>
                          <Segmented
                            variant="toggle"
                            size="sm"
                            ariaLabel={`Kind for ${category.name}`}
                            // disabled while a request is in flight, like the row's other
                            // controls: a second PATCH would race the reload that follows the
                            // first and the picker would flicker back.
                            options={KINDS.map((k) => ({ ...k, disabled: busy }))}
                            value={category.kind}
                            onChange={(next) => setKind(category, next)}
                          />
                        </td>
                        <td className="num">{category.sort_order}</td>
                        <td>
                          <span className="badge">
                            {category.is_active ? 'Active' : 'Retired'}
                          </span>
                        </td>
                        <td className="row-actions">
                          <button
                            type="button"
                            className="button"
                            aria-label={`Edit ${category.name}`}
                            disabled={busy}
                            onClick={() => {
                              setEditingId(category.id)
                              setError(null)
                              setForm({
                                name: category.name,
                                sort_order: String(category.sort_order),
                              })
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="button"
                            aria-label={
                              category.is_active
                                ? `Retire ${category.name}`
                                : `Restore ${category.name}`
                            }
                            disabled={busy}
                            onClick={() => toggleActive(category)}
                          >
                            {category.is_active ? 'Retire' : 'Restore'}
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
