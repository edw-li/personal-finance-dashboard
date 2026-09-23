import { Fragment, useEffect, useRef, useState } from 'react'
import { ApiError, describeError, errorDetail } from '../../api/client'
import { undoBatch } from '../../api/lifecycle'
import {
  createAccount,
  deleteAccount,
  fetchAccounts,
  reorderAccounts,
  updateAccount,
} from '../../api/netWorth'
import { fetchPortfolioAccounts, patchPortfolioAccount } from '../../api/portfolio'
import { GROUP_LABELS, GROUP_ORDER } from '../../charts/theme'
import type {
  AccountGroup,
  AccountOut,
  PersonOut,
  PortfolioAccountOut,
} from '../../types/api'
import { nestComponents } from '../../utils/accounts'
import InfoHint from '../InfoHint'
import DragHandle from '../reorder/DragHandle'
import { ReorderInstructions, ReorderLiveRegion } from '../reorder/ReorderStatus'
import type { ReorderItem } from '../reorder/reorderMath'
import { useReorder } from '../reorder/useReorder'
import { useToast } from '../ToastProvider'
import { FeedBanner } from '../shell/Feed'
import '../panels.css'
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

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

// errorDetail's reason with any closing stop folded away: the two sentences below end on their
// own (describeLoadFailures' rule in client.ts).
function reason(err: unknown): string {
  return errorDetail(err).replace(/[.\s]+$/, '')
}

/** A drop the server did not take (2026-09-23 reorder spec §8.1), said once the rows have
 *  already snapped back. A 409 never reaches this: its own sentence is shown verbatim. */
function orderSaveFailed(err: unknown): string {
  return `Couldn't save the new order — ${reason(err)}. The list is back to how it was.`
}

/** A refused Undo is the server's own sentence ("Later changes touched these rows — undo those
 *  first", spec §9); a request that got no answer at all says what failed and why. */
function undoFailed(err: unknown): string {
  return err instanceof ApiError && err.status >= 400 && err.status < 500
    ? err.message
    : `Couldn't undo the move — ${reason(err)}.`
}

/** One drag unit of the roster (2026-09-23 reorder spec §4.2): a top-level account and the
 *  components nested under it, which travel with it and move only among themselves. */
interface RosterUnit {
  account: AccountOut
  components: AccountOut[]
  /** nestComponents could not place it — its parent is itself nested (a chain) or the link
   *  loops back (a cycle). Kept at the END of its group with a grip that has nowhere to go:
   *  the roster is where that link gets fixed, and the order PUT must name every account. */
  unplaced: boolean
}

interface RosterGroup {
  group: AccountGroup
  units: RosterUnit[]
}

/**
 * The roster the way the Monthly update walks it (spec §4.2): one block per non-empty group in
 * GROUP_ORDER, API order inside it, components nested under their parent by nestComponents run
 * PER GROUP — so a component whose parent sits in another group stays top-level in its own
 * (nestComponents' contract for an absent parent), and one whose parent is retired stays
 * nested, because a retired parent is still listed here.
 */
function rosterGroups(accounts: AccountOut[]): RosterGroup[] {
  return GROUP_ORDER.flatMap((group) => {
    const members = accounts.filter((account) => account.group === group)
    if (members.length === 0) return []
    const present = new Set(members.map((account) => account.id))
    const units: RosterUnit[] = []
    for (const account of nestComponents(members)) {
      // nestComponents emits each parent followed by its nested components, so a nested row
      // always belongs to the unit opened just before it.
      const nested = account.parent_account_id !== null && present.has(account.parent_account_id)
      const carrier = units.at(-1)
      if (nested && carrier !== undefined) carrier.components.push(account)
      else units.push({ account, components: [], unplaced: false })
    }
    const placed = new Set(
      units.flatMap((unit) => [unit.account.id, ...unit.components.map((c) => c.id)]),
    )
    for (const account of members) {
      if (!placed.has(account.id)) units.push({ account, components: [], unplaced: true })
    }
    return [{ group, units }]
  })
}

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
  const [settled, setSettled] = useState(false) // both mount fetches answered, either way
  // Two slots, because they have two different answers (2026-09-05 motion spec §9): a load
  // failure is fixed by asking again; a refused save or a typo is not.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  // How many of the roster's requests are still out. A count, not a flag: an Undo from an older
  // toast can run beside a save, and a flag would hand the grips back when the FIRST one settled.
  const [pending, setPending] = useState(0)
  const busy = pending > 0
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<AccountFormState>(EMPTY_ACCOUNT)
  // A drop renders its order AT ONCE; the order is retired the moment the server's rows land —
  // CategoriesPanel's adjust-during-render recipe, not an effect (spec §4.2).
  const [pendingOrder, setPendingOrder] = useState<AccountOut[] | null>(null)
  const [lastAccounts, setLastAccounts] = useState(accounts)
  const seqRef = useRef(0)
  // The portfolio labels get their OWN fetch, error slot, busy flag and seq guard —
  // deliberately not folded into the roster's above. Two tables from two routers, and one
  // being down must not empty the other (SystemCard's per-card posture).
  const [portfolioAccounts, setPortfolioAccounts] = useState<PortfolioAccountOut[]>([])
  const [portfolioLoaded, setPortfolioLoaded] = useState(false)
  const [portfolioError, setPortfolioError] = useState<string | null>(null)
  // The roster's loadError/formError split, for the second feed: a retag the server
  // REFUSED is not fixed by asking for the labels again (2026-09-05 motion spec §9).
  const [portfolioFormError, setPortfolioFormError] = useState<string | null>(null)
  const [portfolioBusy, setPortfolioBusy] = useState(false)
  const portfolioSeqRef = useRef(0)
  const toast = useToast()

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

  const loadPortfolio = (initial = false) => {
    const seq = ++portfolioSeqRef.current
    return warmSource(initial)(WARM.portfolioAccounts, fetchPortfolioAccounts)
      .then((rows) => {
        if (seq !== portfolioSeqRef.current) return
        setPortfolioAccounts(rows)
        setPortfolioError(null)
        setPortfolioLoaded(true)
      })
      .catch((err: unknown) => {
        if (seq !== portfolioSeqRef.current) return
        setPortfolioError(describeError(err, 'the portfolio accounts'))
      })
  }

  // ON CHANGE, one field on the wire — the card's toggleActive idiom. person_id is the only
  // column this control owns (labels are immutable server-side this batch), and the value
  // travels EXPLICITLY: an omitted key means "leave the owner alone", so clearing the
  // select has to send null on purpose.
  const retagPortfolioAccount = (account: PortfolioAccountOut, value: string) => {
    setPortfolioBusy(true)
    setPortfolioFormError(null)
    patchPortfolioAccount(account.id, { person_id: value === '' ? null : Number(value) })
      .then(() => loadPortfolio())
      .catch((err: unknown) => setPortfolioFormError(message(err, 'Could not retag the account.')))
      .finally(() => setPortfolioBusy(false))
  }

  useEffect(() => {
    // ONE render when both feeds have SETTLED (2026-09-13 spec §9): the card used to grow twice —
    // the roster landing 76ms before the portfolio labels pushed the second table 1118px down the
    // page (audit S-5). Settled, not fulfilled: a feed that failed still lets the other render.
    void Promise.allSettled([load(true), loadPortfolio(true)]).then(() => setSettled(true))
    // mount-only: two plain functions over stable setters (house idiom)
  }, [])

  // Every roster write goes through here, its reload chained inside it: the card is busy from the
  // request until the rows it changed are back on screen. The chains end in their own catch, so
  // `request` never rejects — the second handler is belt and braces.
  const track = (request: Promise<unknown>) => {
    setPending((count) => count + 1)
    const settle = () => setPending((count) => count - 1)
    void request.then(settle, settle)
  }

  const setText =
    (field: 'name' | 'person_id' | 'parent_account_id') => (value: string) => {
      setForm((f) => ({ ...f, [field]: value }))
      setFormError(null)
    }

  const startEdit = (account: AccountOut) => {
    setEditingId(account.id)
    setFormError(null)
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
    setEditingId(null)
    setForm(EMPTY_ACCOUNT)
  }

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
    const request = editingId !== null ? updateAccount(editingId, body) : createAccount(body)
    track(
      request
        .then(() => {
          cancelEdit()
          return load()
        })
        .catch((err: unknown) => setFormError(message(err, 'Save failed'))),
    )
  }

  // ONLY is_active on the wire: every other column is untouched here, and sending the
  // whole row back would let a stale render overwrite a concurrent edit (CardsPanel's rule).
  const toggleActive = (account: AccountOut) => {
    setFormError(null)
    track(
      updateAccount(account.id, { is_active: !account.is_active })
        .then(() => load())
        .catch((err: unknown) => setFormError(message(err, 'Update failed'))),
    )
  }

  const remove = (account: AccountOut) => {
    // The guard sentence belongs to the SERVER ("account has N balance rows — deactivate it
    // instead") and it is about a row far down the table, so it rides the toast layer
    // rather than the form-level banner above the form.
    track(
      deleteAccount(account.id)
        .then(() => {
          if (account.id === editingId) cancelEdit()
          return load()
        })
        .catch((err: unknown) => toast.error(message(err, 'Delete failed'))),
    )
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
  // Named in the hint below: the get-or-create on a new transaction label owns it to the
  // primary person, and this table is the only place that can be undone.
  const primaryName = people.find((p) => p.is_primary)?.name ?? 'the primary person'

  // What the table draws: the dropped order while its save is in flight, else the server's.
  const shown = pendingOrder ?? accounts
  const groups = rosterGroups(shown)
  // The hook's items, in DISPLAY order (reorder spec §2.2): a top-level account ranges over its
  // group and carries its components; a component ranges over its siblings only.
  const items: ReorderItem<number>[] = groups.flatMap(({ group, units }) =>
    units.flatMap(({ account, components, unplaced }) => [
      {
        id: account.id,
        range: unplaced ? `unplaced:${account.id}` : group,
        carries: components.map((component) => component.id),
      },
      ...components.map((component) => ({ id: component.id, range: `parent:${account.id}` })),
    ]),
  )

  // The reorder route logs its batch (spec §3.2), so Undo is the change log's: the server
  // writes every renumbered row back, then the roster is read again — and the grips wait for it.
  const undoOrder = (batchId: string) => {
    track(
      undoBatch(batchId)
        .then(() => {
          toast.info('Order restored')
          return load()
        })
        .catch((err: unknown) => toast.error(undoFailed(err))),
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
    track(
      reorderAccounts(ids)
        .then(({ data, batchId }) => {
          toast.success(
            `Moved ${name}`,
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
            err instanceof ApiError && err.status === 409 ? err.message : orderSaveFailed(err),
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
  const locked = busy || reorder.active

  /** One roster row. `nested` rows are components drawn under their parent: panels.css's
   *  `.component-row` register, with the indent moved to the Account cell (settings.css). */
  const rosterRow = (account: AccountOut, nested: boolean) => {
    const classes = [nested ? 'component-row' : null, account.id === editingId ? 'is-editing' : null]
      .filter((name) => name !== null)
      .join(' ')
    return (
      <tr
        key={account.id}
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
          <button
            type="button"
            className="button"
            aria-label={`Edit ${account.name}`}
            disabled={locked}
            onClick={() => startEdit(account)}
          >
            Edit
          </button>
          <button
            type="button"
            className="button"
            aria-label={account.is_active ? `Retire ${account.name}` : `Restore ${account.name}`}
            disabled={locked}
            onClick={() => toggleActive(account)}
          >
            {account.is_active ? 'Retire' : 'Restore'}
          </button>
          <button
            type="button"
            className="button"
            aria-label={`Delete ${account.name}`}
            disabled={locked}
            onClick={() => remove(account)}
          >
            Delete
          </button>
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
      {!settled && <SettingsGhost height={1114} />}
      {settled && loaded && (
        <>
          <form
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
                onChange={(e) =>
                  setForm((f) => ({ ...f, group: e.target.value as AccountGroup }))
                }
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
                }}
              />
              Component of the parent
            </label>
            <div className="settings-card-actions">
              <button type="submit" className="button button-primary" disabled={busy}>
                {editingId !== null ? 'Save account' : 'Add account'}
              </button>
              {editingId !== null && (
                <button type="button" className="button" onClick={cancelEdit}>
                  Cancel
                </button>
              )}
            </div>
            <FeedBanner error={formError} />
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
                  <tbody>
                    {groups.map(({ group, units }) => (
                      <Fragment key={group}>
                        <tr className="accounts-group-row">
                          <th scope="colgroup" colSpan={ROSTER_COLUMNS}>
                            {GROUP_LABELS[group]}
                          </th>
                        </tr>
                        {units.flatMap(({ account, components }) => [
                          rosterRow(account, false),
                          ...components.map((component) => rosterRow(component, true)),
                        ])}
                      </Fragment>
                    ))}
                  </tbody>
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

      {settled && (
        <>
        {/* Portfolio accounts (2026-08-28 spec §5): the labels behind the positions ledger,
            and the ONE place their ownership is edited. Gated on `settled`, never on the roster's
            `loaded` — a net-worth GET that failed says nothing about the portfolio router, and
            both tables arrive in the same render (2026-09-13 spec §9). */}
        <h3 className="eyebrow portfolio-accounts-heading">
          Portfolio accounts
          <InfoHint text="The account labels your transactions and dividends are filed under. Owner blank = joint; a person's Portfolio view is their own labels plus the joint ones. Labels are fixed here — they are the positions' identity." />
        </h3>
        <FeedBanner
          error={portfolioError}
          retry={() => loadPortfolio()}
          retryLabel="Retry loading the portfolio accounts"
        />
        {portfolioLoaded &&
          (portfolioAccounts.length === 0 ? (
            <p className="empty-note">
              No portfolio accounts yet — one appears the first time a transaction or dividend
              names an account.
            </p>
          ) : (
            <>
              <div className="settings-scroll">
                <table
                  className="data-table portfolio-accounts-table"
                  aria-label="Portfolio accounts"
                >
                  <thead>
                    <tr>
                      <th>Label</th>
                      <th>Owner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolioAccounts.map((account) => (
                      <tr key={account.id}>
                        {/* Read-only text, not an input: renaming a label would orphan every
                            position filed under it, and the server refuses it. */}
                        <td>{account.label}</td>
                        <td>
                          <select
                            className="field-input"
                            aria-label={`Owner for ${account.label}`}
                            value={account.person_id === null ? '' : String(account.person_id)}
                            disabled={portfolioBusy}
                            onChange={(e) => retagPortfolioAccount(account, e.target.value)}
                          >
                            <option value="">Joint</option>
                            {people.map((person) => (
                              <option key={person.id} value={String(person.id)}>
                                {person.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Inline under the table the select lives in, and with NO Retry: the failure is a
                  write the server refused, which asking for the labels again cannot fix. */}
              <FeedBanner error={portfolioFormError} />
              <p className="settings-note">
                A new account label typed on a transaction or dividend is created owned by{' '}
                {primaryName} — re-tag it here. The labels themselves are fixed: they identify
                the positions.
              </p>
            </>
          ))}
        </>
      )}
    </section>
  )
}
