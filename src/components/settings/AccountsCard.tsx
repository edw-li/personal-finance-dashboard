import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ApiError, describeError, errorDetail } from '../../api/client'
import { undoBatch } from '../../api/lifecycle'
import {
  createAccount,
  deleteAccount,
  fetchAccounts,
  reorderAccounts,
  updateAccount,
  updateAccountLogged,
} from '../../api/netWorth'
import { GROUP_LABELS, GROUP_ORDER } from '../../charts/theme'
import type {
  AccountGroup,
  AccountOut,
  PersonOut,
} from '../../types/api'
import InfoHint from '../InfoHint'
import BusyButton from '../feedback/BusyButton'
import { SaveButton } from '../feedback/SaveButton'
import { SaveStatus } from '../feedback/SaveStatus'
import { useSaveState } from '../feedback/useSaveState'
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
import { useRequestCount } from '../reorder/useRequestCount'
import { useToast } from '../ToastProvider'
import { FeedBanner } from '../shell/Feed'
import '../panels.css'
import { rosterGroups, rosterItems } from './accountsRoster'
import './settings.css'
import SettingsGhost from './SettingsGhost'
import { WARM, warmSource } from './settingsPrefetch'

interface AccountFormState {
  name: string
  group: AccountGroup
  person_id: string
  parent_account_id: string
  is_component: boolean
}

const EMPTY_ACCOUNT: AccountFormState = {
  name: '',
  group: 'cash',
  person_id: '',
  parent_account_id: '',
  is_component: false,
}

// The two sentences lane B's 422 returns for a half-set pair (2026-09-04 honest-numbers spec
// §5), spelled here so the client refusal and the server refusal are ONE sentence rather than
// two paraphrases. `is_component` is the rollup key and `parent_account_id` the link: a row
// carrying one without the other counts in no total, so each message names the missing half.
const COMPONENT_NEEDS_PARENT =
  'is_component needs parent_account_id — name the account it folds into'
const PARENT_NEEDS_COMPONENT =
  'parent_account_id needs is_component — a linked account must be a component'

// grip · Account · Owner · Roll-up · Status · actions — a group heading spans all six.
const ROSTER_COLUMNS = 6

/**
 * The Settings Accounts card (2026-08-26 spec §6): the roster manager the app has never
 * had. The backend CRUD has existed since Plan 3 with no caller, which is exactly why
 * "net worth accounts are fixed by the workbook" was true (audit §3.1) — and why partner
 * accounts were unreachable without curl.
 *
 * `people` arrives as a prop from the page rather than from a second /household fetch, so
 * a partner added in the Household card is selectable here without a reload.
 *
 * The roster is grouped and its order is the table's (2026-09-23 reorder spec §4.2): a row is
 * dragged by its grip within its group, a parent brings its components, and the drop saves the
 * WHOLE order in one PUT with the change log's Undo behind it.
 */
export default function AccountsCard({ people }: { people: PersonOut[] }) {
  const [accounts, setAccounts] = useState<AccountOut[]>([])
  const [loaded, setLoaded] = useState(false)
  // Two slots, because they have two different answers (2026-09-05 motion spec §9): a load
  // failure is fixed by asking again; a refused save or a typo is not.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  // Every roster write goes through `track`, its reload chained inside it: the card is busy from
  // the request until the rows it changed are back on screen — counted, since an Undo from an
  // older toast can run beside a save. The chains end in their own catch, so none of them rejects.
  const { busy, track } = useRequestCount()
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<AccountFormState>(EMPTY_ACCOUNT)
  // A drop renders its order AT ONCE; the order is retired the moment the server's rows land —
  // CategoriesPanel's adjust-during-render recipe, not an effect (spec §4.2).
  const [pendingOrder, setPendingOrder] = useState<AccountOut[] | null>(null)
  const [lastAccounts, setLastAccounts] = useState(accounts)
  const seqRef = useRef(0)
  const storedAccount = accounts.find((row) => row.id === editingId)
  const savedForm = storedAccount === undefined ? EMPTY_ACCOUNT : {
    name: storedAccount.name,
    group: storedAccount.group,
    person_id: storedAccount.person_id === null ? '' : String(storedAccount.person_id),
    parent_account_id: storedAccount.parent_account_id === null ? '' : String(storedAccount.parent_account_id),
    is_component: storedAccount.is_component,
  }
  const saveState = useSaveState({ dirty: JSON.stringify(form) !== JSON.stringify(savedForm) })
  const toast = useToast()
  const formRef = useRef<HTMLFormElement>(null)
  const revealRequested = useRef(false)
  const landingId = useRef<number | null>(null)
  const [rowUpdates, setRowUpdates] = useState<Record<number, Partial<AccountOut>>>({})
  const deleteWithUndo = useDeleteWithUndo()
  const findRow = (id: number) => document.querySelector<HTMLElement>(`#accounts [data-settings-row="${id}"]`)

  useLayoutEffect(() => {
    if (!revealRequested.current) return
    revealRequested.current = false
    revealEditor(formRef.current, 'input')
  })
  useLayoutEffect(() => {
    if (busy || landingId.current === null) return
    const row = findRow(landingId.current)
    if (row === null) return
    landingId.current = null
    revealRow(row)
    flashElement(row)
    // Single-add lists hand focus to the row; the page follows if its inner scroller is offscreen.
    row.querySelector<HTMLButtonElement>('[data-edit]')?.focus()
  }, [accounts, busy])


  if (lastAccounts !== accounts) {
    setLastAccounts(accounts)
    setPendingOrder(null)
  }

  // Returns its promise: every write RETURNS the reload it starts, so the card stays busy — grips
  // parked — until the roster it changed is back on screen. Released any earlier, a drop could
  // diff against rows the write has already moved past (after an Undo: PUT the undone move back).
  const load = (initial = false) => {
    const seq = ++seqRef.current
    return warmSource(initial)(WARM.accounts, fetchAccounts)
      .then((rows) => {
        if (seq !== seqRef.current) return
        setAccounts(rows)
        setLoadError(null)
        setLoaded(true)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setLoadError(describeError(err, 'the accounts'))
      })
  }

  useEffect(() => {
    load(true)
  }, [])

  const setText =
    (field: 'name' | 'person_id' | 'parent_account_id') => (value: string) => {
      setForm((f) => ({ ...f, [field]: value }))
      setFormError(null)
      saveState.clearError()
    }

  const startEdit = (account: AccountOut) => {
    revealRequested.current = true
    setEditingId(account.id)
    setFormError(null)
    saveState.clearError()
    setForm({
      name: account.name,
      group: account.group,
      person_id: account.person_id === null ? '' : String(account.person_id),
      parent_account_id:
        account.parent_account_id === null ? '' : String(account.parent_account_id),
      is_component: account.is_component,
    })
  }

  const cancelEdit = () => {
    if (editingId !== null) findRow(editingId)?.querySelector<HTMLButtonElement>('[data-edit]')?.focus()
    setEditingId(null)
    setForm(EMPTY_ACCOUNT)
    setFormError(null)
    saveState.clearError()
  }
  useEscapeCancel(formRef, cancelEdit, editingId !== null)
  const latest = useLatest({ editingId, cancelEdit, load, rows: accounts })

  const submit = () => {
    const name = form.name.trim()
    if (!name) {
      setFormError('Account name is required.')
      return
    }
    if (form.is_component && form.parent_account_id === '') {
      setFormError(COMPONENT_NEEDS_PARENT)
      return
    }
    if (!form.is_component && form.parent_account_id !== '') {
      setFormError(PARENT_NEEDS_COMPONENT)
      return
    }
    // ALL FIVE keys, every time: a blank owner or parent must CLEAR the column, and PATCH
    // treats an omitted key as "leave it alone" — only an explicit null retags an account
    // to joint or unlinks a component. Never sort_order (2026-09-23 reorder spec §3.3, §4.2):
    // the order is the table's, a new account lands at the end of its group, and an edit that
    // moves an account to another group lands it at the end of that one — the server's call.
    const body = {
      name,
      group: form.group,
      is_component: form.is_component,
      person_id: form.person_id === '' ? null : Number(form.person_id),
      parent_account_id: form.parent_account_id === '' ? null : Number(form.parent_account_id),
    }
    setFormError(null)
    saveState.clearError()
    void saveState.run(() => track(async () => {
      const saved = await (editingId !== null ? updateAccount(editingId, body) : createAccount(body))
      landingId.current = saved.id
      setEditingId(null)
      setForm(EMPTY_ACCOUNT)
      await load()
    }))
  }

  // One-click changes draw at once. Grips wait for the reload; only this row's controls wait.
  const changeRow = (account: AccountOut, patch: Partial<AccountOut>, label: string) => {
    if (rowUpdates[account.id] !== undefined) return
    setRowUpdates((current) => ({ ...current, [account.id]: patch }))
    void track(async () => {
      try {
        const { batchId } = await updateAccountLogged(account.id, patch)
        await latest.current.load()
        toast.success(label, batchId === null ? undefined : { action: { label: 'Undo', onAction: () => {
          void track(async () => {
            try {
              await undoBatch(batchId)
              landingId.current = account.id
              await latest.current.load()
              toast.success(`Restored ${account.name}`)
            } catch (err) {
              toast.error(errorDetail(err))
              findRow(account.id)?.querySelector<HTMLButtonElement>('[data-edit]')?.focus()
            }
          })
        } } })
      } catch (err) {
        toast.error(errorDetail(err))
      } finally {
        setRowUpdates((current) => { const next = { ...current }; delete next[account.id]; return next })
      }
    })
  }

  const toggleActive = (account: AccountOut) => changeRow(
    account, { is_active: !account.is_active }, `${account.is_active ? 'Retired' : 'Restored'} ${account.name}`,
  )

  const remove = (account: AccountOut) => {
    const rows = [...document.querySelectorAll<HTMLElement>('#accounts [data-settings-row]')]
    const index = rows.findIndex((row) => row === findRow(account.id))
    const neighbour = rows[index + 1] ?? rows[index - 1]
    void track(() => deleteWithUndo({
      name: `account ${account.name}`,
      row: findRow(account.id),
      request: () => deleteAccount(account.id),
      onDeleted: async () => {
        if (latest.current.editingId === account.id) latest.current.cancelEdit()
        await latest.current.load()
      },
      focusAfter: () => neighbour?.isConnected
        ? neighbour.querySelector<HTMLButtonElement>('[data-delete]')
        : formRef.current?.querySelector<HTMLInputElement>('input') ?? null,
      onRestored: () => latest.current.load(),
      restoredRow: () => findRow(account.id),
    }))
  }

  const ownerName = new Map(people.map((p) => [p.id, p.name]))
  const byId = new Map(accounts.map((a) => [a.id, a]))
  // How many rows roll UP into each account, by the SERVER's rule rather than a looser one:
  // `derived_parent_balances` (backend/app/services/derived_accounts.py) sums a child only
  // when it is flagged `is_component` AND linked, so a legacy row carrying the link alone is
  // derived by nobody. Counting that row here would tell the reader a parent is summed while
  // the balances PUT still expects it typed by hand and the wizard still renders it as an
  // input — the roster must not promise a roll-up nothing performs (spec §5).
  const componentCounts = new Map<number, number>()
  for (const a of accounts) {
    if (a.parent_account_id === null || !a.is_component) continue
    componentCounts.set(a.parent_account_id, (componentCounts.get(a.parent_account_id) ?? 0) + 1)
  }

  /**
   * What the roster says about a row's place in the roll-up (2026-09-04 honest-numbers spec
   * §5). A parent with components has no balance of its own — the wizard derives it — so the
   * table has to say which rows are typed and which are summed, rather than printing a bare
   * parent name that reads the same either way.
   */
  const rollUpNote = (account: AccountOut) => {
    const parent =
      account.parent_account_id === null ? undefined : byId.get(account.parent_account_id)
    if (account.is_component) {
      // Net worth sums the NON-component rows, so a component reaches a total only through a
      // parent that is present and active; with the parent gone or retired its balance lands
      // in no figure at all — hence "counts nowhere", literally. Advisory amber (--warn, the
      // .draft-note register) and the sentence together: colour is never the only channel.
      if (parent === undefined || !parent.is_active) {
        return (
          <span className="accounts-link-note is-unlinked">
            unlinked component — counts nowhere
          </span>
        )
      }
      return <span className="accounts-link-note">component of {parent.name}</span>
    }
    const n = componentCounts.get(account.id) ?? 0
    if (n > 0) {
      return (
        <span className="accounts-link-note">
          derived: {n} component{n === 1 ? '' : 's'}
        </span>
      )
    }
    // A link without the flag is the half-set pair Task 4 refuses. Keep naming the parent —
    // the roster must not hide a link it can see — but claim nothing about the roll-up: the
    // two halves disagree about where this balance belongs, and that is the whole point.
    if (parent !== undefined) {
      return <span className="accounts-link-note">parent: {parent.name}</span>
    }
    return '—'
  }
  // An account may not parent itself (the server 422s it); leaving it out of the select
  // means the UI never offers the mistake.
  const parentOptions = accounts.filter((a) => a.id !== editingId)
  // What the table draws: the dropped order while its save is in flight, else the server's —
  // grouped the way the Monthly update walks it, and the hook's items derived from exactly those
  // rows every render (./accountsRoster.ts).
  const shown = (pendingOrder ?? accounts).map((row) => ({ ...row, ...rowUpdates[row.id] }))
  const groups = rosterGroups(shown)
  const items = rosterItems(groups)

  // The reorder route logs its batch (spec §3.2), so Undo is the change log's: the server
  // writes every renumbered row back, then the roster is read again — and the grips wait for it.
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

  // One PUT with EVERY account — active and retired, every group — in the new display order
  // (spec §4.2). Its outcome is about a row far down the table, so it rides the toast layer,
  // never the form banner (remove's rule above).
  const saveOrder = (ids: number[], moved: number) => {
    const name = byId.get(moved)?.name ?? 'the account'
    // The save takes a turn in load's sequence, so an older answer never lands last: its rows are
    // drawn only if nothing was asked for after it. Something that was — the reload after an
    // older toast's Undo — may have read the roster BEFORE this save committed, so an overtaken
    // save reads the roster once more instead of drawing its own answer.
    const seq = ++seqRef.current
    void track(() =>
      reorderAccounts(ids)
        .then(({ data, batchId }) => {
          toast.success(
            movedToast(name),
            // No batch = nothing was logged, so there is nothing to undo (the wizard's contract).
            batchId === null
              ? undefined
              : { action: { label: 'Undo', onAction: () => undoOrder(batchId) } },
          )
          if (seq !== seqRef.current) return load()
          setAccounts(data)
          reorder.markSaved(moved)
        })
        .catch((err: unknown) => {
          setPendingOrder(null) // back to the last order the server confirmed…
          // …then read again, whatever the failure: a 409 means the roster changed under this
          // one (another tab — the server's own sentence, spec §8.3), and a 5xx can arrive after
          // the write committed. Either way the rows drawn next are the server's.
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
    items,
    labelOf: (id) => byId.get(id)?.name ?? String(id),
    // "…Position 2 of 3 in Pre-tax." / "…in Fidelity Traditional 401(k)'s components." (§8.2)
    rangeLabelOf: (range) => {
      if (range.startsWith('parent:')) {
        const parent = byId.get(Number(range.slice('parent:'.length)))
        return parent === undefined ? undefined : `${parent.name}'s components`
      }
      const group = GROUP_ORDER.find((candidate) => candidate === range)
      return group === undefined ? undefined : GROUP_LABELS[group]
    },
    // Every request of the roster parks the grips — a drop cannot race a save (spec §9) — and
    // so does a roster that failed to reload: the rows on screen may be behind the server's.
    disabled: busy || loadError !== null,
    onCommit: (next, moved) => {
      // `next` is the whole roster flattened group by group, each parent followed by its
      // components — exactly the order the PUT sends.
      const rowsById = new Map(shown.map((account) => [account.id, account]))
      setPendingOrder(
        next.flatMap((id) => {
          const account = rowsById.get(id)
          return account === undefined ? [] : [account]
        }),
      )
      saveOrder(next, moved)
    },
  })

  // A lifted row holds the roster: the row buttons wait for the drop, as they wait for a request
  // (spec §2.3) — an Edit or a Delete must not land on a row that is in the air.
  const locked = (busy && Object.keys(rowUpdates).length === 0) || reorder.active

  /** One roster row. `nested` rows are components drawn under their parent: panels.css's
   *  `.component-row` register, with the indent moved to the Account cell (settings.css). */
  const rosterRow = (account: AccountOut, nested: boolean) => {
    const rowLocked = locked || rowUpdates[account.id] !== undefined
    const classes = [nested ? 'component-row' : null, account.id === editingId ? 'is-editing' : null]
      .filter((name) => name !== null)
      .join(' ')
    return (
      <tr
        key={account.id}
        data-settings-row={account.id}
        aria-current={account.id === editingId ? true : undefined}
        className={classes === '' ? undefined : classes}
        {...reorder.itemProps(account.id)}
      >
        <td className="reorder-grip-cell">
          <DragHandle name={account.name} {...reorder.handleProps(account.id)} />
        </td>
        <td className="accounts-name-cell">
          {account.name}
          {account.is_component && <span className="badge">Component</span>}
        </td>
        {/* NULL is JOINT, never "unknown": the migration backfilled every pre-existing
            account to the primary person. */}
        <td>
          {account.person_id === null ? 'Joint' : (ownerName.get(account.person_id) ?? '—')}
        </td>
        <td>{rollUpNote(account)}</td>
        <td>
          <span className="badge">{account.is_active ? 'Active' : 'Retired'}</span>
        </td>
        <td className="row-actions">
          <BusyButton
            type="button"
            className="button"
            data-edit
            aria-label={`Edit ${account.name}`}
            inert={rowLocked}
            onClick={() => startEdit(account)}
          >
            Edit
          </BusyButton>
          <BusyButton
            type="button"
            className="button"
            aria-label={account.is_active ? `Retire ${account.name}` : `Restore ${account.name}`}
            inert={rowLocked}
            onClick={() => toggleActive(account)}
          >
            {account.is_active ? 'Retire' : 'Restore'}
          </BusyButton>
          <BusyButton
            type="button"
            className="button"
            data-delete
            aria-label={`Delete ${account.name}`}
            inert={rowLocked}
            onClick={() => remove(account)}
          >
            Delete
          </BusyButton>
        </td>
      </tr>
    )
  }

  return (
    <section className="card span-12" id="accounts">
      <h2 className="eyebrow">
        Accounts
        <InfoHint text="The net-worth roster. Owner blank = joint. Retire keeps an account out of the wizard and the charts without losing its history; delete only works while an account has no balances. The slug never changes — it is the workbook importer's key. Drag a row by its grip to reorder accounts within their group; a parent brings its components with it." />
      </h2>
      <FeedBanner error={loadError} retry={() => load()} retryLabel="Retry loading the accounts" />
      {!loaded && loadError === null && <SettingsGhost height={1114} />}
      {loaded && (
        <>
          <form
            ref={formRef}
            className="accounts-form"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <label>
              Account name
              <input
                className="field-input"
                value={form.name}
                onChange={(e) => setText('name')(e.target.value)}
              />
            </label>
            <label>
              Group
              <select
                className="field-input"
                value={form.group}
                onChange={(e) => {
                  setForm((f) => ({ ...f, group: e.target.value as AccountGroup }))
                  setFormError(null)
                  saveState.clearError()
                }}
              >
                {GROUP_ORDER.map((group) => (
                  <option key={group} value={group}>
                    {GROUP_LABELS[group]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Owner
              <select
                className="field-input"
                value={form.person_id}
                onChange={(e) => setText('person_id')(e.target.value)}
              >
                <option value="">Joint</option>
                {people.map((person) => (
                  <option key={person.id} value={String(person.id)}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Parent account
              <select
                className="field-input"
                value={form.parent_account_id}
                onChange={(e) => setText('parent_account_id')(e.target.value)}
              >
                <option value="">— none —</option>
                {parentOptions.map((account) => (
                  <option key={account.id} value={String(account.id)}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="accounts-check">
              <input
                type="checkbox"
                checked={form.is_component}
                onChange={(e) => {
                  setForm((f) => ({ ...f, is_component: e.target.checked }))
                  setFormError(null)
                  saveState.clearError()
                }}
              />
              Component of the parent
            </label>
            <div className="settings-card-actions">
              <SaveButton type="submit" className="button button-primary" state={saveState} aria-disabled={busy}>
                {editingId !== null ? 'Save account' : 'Add account'}
              </SaveButton>
              {editingId !== null && (
                <button type="button" className="button" onClick={cancelEdit}>
                  Cancel
                </button>
              )}
              {formError ? <span role="alert" className="save-status save-status-error">{formError}</span> : <SaveStatus state={saveState} />}
            </div>
          </form>
          {accounts.length === 0 ? (
            <p className="empty-note">No accounts yet — add the first one above.</p>
          ) : (
            <>
              <div className="settings-scroll">
                {/* Named because the card now carries TWO tables (screen readers and the
                    role queries both need to tell them apart). Grouped (reorder spec §4.2):
                    the heading row carries what the Group column used to say, and
                    `.reorder-table` gives each cell its own hairline so a moving row takes
                    its border with it (reorder.css). */}
                <table
                  className="data-table accounts-table reorder-table"
                  aria-label="Net-worth accounts"
                >
                  <thead>
                    <tr>
                      <th className="reorder-grip-cell" aria-hidden="true" />
                      <th>Account</th>
                      <th>Owner</th>
                      <th>Roll-up</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  {/* One row group per account group, its heading the first row: a row-group
                      header, since the table has no <colgroup> for a colgroup scope to name. Rows
                      move only within their group (reorder spec §4.2), so a drag never crosses
                      a <tbody>. */}
                  {groups.map(({ group, units }) => (
                    <tbody key={group}>
                      <tr className="accounts-group-row">
                        <th scope="rowgroup" colSpan={ROSTER_COLUMNS}>
                          {GROUP_LABELS[group]}
                        </th>
                      </tr>
                      {units.flatMap(({ account, components }) => [
                        rosterRow(account, false),
                        ...components.map((component) => rosterRow(component, true)),
                      ])}
                    </tbody>
                  ))}
                </table>
              </div>
              {/* Once per card and OUTSIDE the table (a <span> is not a table child): the
                  grips' aria-describedby target and the lift/move/drop announcements. */}
              <ReorderInstructions id={reorder.instructionsId} />
              <ReorderLiveRegion text={reorder.announcement} />
              {/* What the order is FOR (2026-09-23 reorder spec §8.1): the wizard walks it inside
                  each person's section, and a positional paste fills it — so moving a row here
                  moves where a pasted value lands. */}
              <p className="settings-note">
                The Monthly update lists accounts in this order within each person and group — a
                spreadsheet column pasted there fills them in this order too.
              </p>
            </>
          )}
        </>
      )}

    </section>
  )
}
