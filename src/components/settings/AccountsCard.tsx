import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { createAccount, deleteAccount, fetchAccounts, updateAccount } from '../../api/netWorth'
import { fetchPortfolioAccounts, patchPortfolioAccount } from '../../api/portfolio'
import { GROUP_LABELS, GROUP_ORDER } from '../../charts/theme'
import type {
  AccountGroup,
  AccountOut,
  PersonOut,
  PortfolioAccountOut,
} from '../../types/api'
import InfoHint from '../InfoHint'
import { useToast } from '../ToastProvider'
import '../panels.css'
import './settings.css'

interface AccountFormState {
  name: string
  group: AccountGroup
  person_id: string
  sort_order: string
  parent_account_id: string
  is_component: boolean
}

const EMPTY_ACCOUNT: AccountFormState = {
  name: '',
  group: 'cash',
  person_id: '',
  sort_order: '0',
  parent_account_id: '',
  is_component: false,
}

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/**
 * The Settings Accounts card (2026-08-26 spec §6): the roster manager the app has never
 * had. The backend CRUD has existed since Plan 3 with no caller, which is exactly why
 * "net worth accounts are fixed by the workbook" was true (audit §3.1) — and why partner
 * accounts were unreachable without curl.
 *
 * `people` arrives as a prop from the page rather than from a second /household fetch, so
 * a partner added in the Household card is selectable here without a reload.
 */
export default function AccountsCard({ people }: { people: PersonOut[] }) {
  const [accounts, setAccounts] = useState<AccountOut[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<AccountFormState>(EMPTY_ACCOUNT)
  const seqRef = useRef(0)
  // The portfolio labels get their OWN fetch, error slot, busy flag and seq guard —
  // deliberately not folded into the roster's above. Two tables from two routers, and one
  // being down must not empty the other (SystemCard's per-card posture).
  const [portfolioAccounts, setPortfolioAccounts] = useState<PortfolioAccountOut[]>([])
  const [portfolioLoaded, setPortfolioLoaded] = useState(false)
  const [portfolioError, setPortfolioError] = useState<string | null>(null)
  const [portfolioBusy, setPortfolioBusy] = useState(false)
  const portfolioSeqRef = useRef(0)
  const toast = useToast()

  const load = () => {
    const seq = ++seqRef.current
    fetchAccounts()
      .then((rows) => {
        if (seq !== seqRef.current) return
        setAccounts(rows)
        setError(null)
        setLoaded(true)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(message(err, 'Could not load accounts.'))
      })
  }

  const loadPortfolio = () => {
    const seq = ++portfolioSeqRef.current
    fetchPortfolioAccounts()
      .then((rows) => {
        if (seq !== portfolioSeqRef.current) return
        setPortfolioAccounts(rows)
        setPortfolioError(null)
        setPortfolioLoaded(true)
      })
      .catch((err: unknown) => {
        if (seq !== portfolioSeqRef.current) return
        setPortfolioError(message(err, 'Could not load portfolio accounts.'))
      })
  }

  // ON CHANGE, one field on the wire — the card's toggleActive idiom. person_id is the only
  // column this control owns (labels are immutable server-side this batch), and the value
  // travels EXPLICITLY: an omitted key means "leave the owner alone", so clearing the
  // select has to send null on purpose.
  const retagPortfolioAccount = (account: PortfolioAccountOut, value: string) => {
    setPortfolioBusy(true)
    setPortfolioError(null)
    patchPortfolioAccount(account.id, { person_id: value === '' ? null : Number(value) })
      .then(() => loadPortfolio())
      .catch((err: unknown) => setPortfolioError(message(err, 'Could not retag the account.')))
      .finally(() => setPortfolioBusy(false))
  }

  useEffect(() => {
    load()
    loadPortfolio()
    // mount-only: two plain functions over stable setters (house idiom)
  }, [])

  const setText =
    (field: 'name' | 'person_id' | 'sort_order' | 'parent_account_id') => (value: string) => {
      setForm((f) => ({ ...f, [field]: value }))
      setError(null)
    }

  const startEdit = (account: AccountOut) => {
    setEditingId(account.id)
    setError(null)
    setForm({
      name: account.name,
      group: account.group,
      person_id: account.person_id === null ? '' : String(account.person_id),
      sort_order: String(account.sort_order),
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
      setError('Account name is required.')
      return
    }
    // ALL SIX keys, every time: a blank owner or parent must CLEAR the column, and PATCH
    // treats an omitted key as "leave it alone" — only an explicit null retags an account
    // to joint or unlinks a component.
    const body = {
      name,
      group: form.group,
      sort_order: Number(form.sort_order) || 0,
      is_component: form.is_component,
      person_id: form.person_id === '' ? null : Number(form.person_id),
      parent_account_id: form.parent_account_id === '' ? null : Number(form.parent_account_id),
    }
    setBusy(true)
    setError(null)
    const request = editingId !== null ? updateAccount(editingId, body) : createAccount(body)
    request
      .then(() => {
        cancelEdit()
        load()
      })
      .catch((err: unknown) => setError(message(err, 'Save failed')))
      .finally(() => setBusy(false))
  }

  // ONLY is_active on the wire: every other column is untouched here, and sending the
  // whole row back would let a stale render overwrite a concurrent edit (CardsPanel's rule).
  const toggleActive = (account: AccountOut) => {
    setBusy(true)
    setError(null)
    updateAccount(account.id, { is_active: !account.is_active })
      .then(() => load())
      .catch((err: unknown) => setError(message(err, 'Update failed')))
      .finally(() => setBusy(false))
  }

  const remove = (account: AccountOut) => {
    setBusy(true)
    // The guard sentence belongs to the SERVER ("account has N balance rows — deactivate it
    // instead") and it is about a row far down the table, so it rides the toast layer
    // rather than the form-level banner above the form.
    deleteAccount(account.id)
      .then(() => {
        if (account.id === editingId) cancelEdit()
        load()
      })
      .catch((err: unknown) => toast.error(message(err, 'Delete failed')))
      .finally(() => setBusy(false))
  }

  const ownerName = new Map(people.map((p) => [p.id, p.name]))
  const accountName = new Map(accounts.map((a) => [a.id, a.name]))
  // An account may not parent itself (the server 422s it); leaving it out of the select
  // means the UI never offers the mistake.
  const parentOptions = accounts.filter((a) => a.id !== editingId)
  // Named in the hint below: the get-or-create on a new transaction label owns it to the
  // primary person, and this table is the only place that can be undone.
  const primaryName = people.find((p) => p.is_primary)?.name ?? 'the primary person'

  return (
    <section className="card span-12">
      <h2 className="eyebrow">
        Accounts
        <InfoHint text="The net-worth roster. Owner blank = joint. Retire keeps an account out of the wizard and the charts without losing its history; delete only works while an account has no balances. The slug never changes — it is the workbook importer's key." />
      </h2>
      {error && (
        <div className="error-banner" role="alert">
          {error}{' '}
          <button className="button" onClick={load}>
            Retry
          </button>
        </div>
      )}
      {!loaded && error === null && <p className="empty-note">Loading…</p>}
      {loaded && (
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
              Sort order
              <input
                className="field-input"
                inputMode="numeric"
                value={form.sort_order}
                onChange={(e) => setText('sort_order')(e.target.value)}
              />
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
                onChange={(e) => setForm((f) => ({ ...f, is_component: e.target.checked }))}
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
          </form>
          {accounts.length === 0 ? (
            <p className="empty-note">No accounts yet — add the first one above.</p>
          ) : (
            <div className="settings-scroll">
              {/* Named because the card now carries TWO tables (screen readers and the
                  role queries both need to tell them apart). */}
              <table className="data-table accounts-table" aria-label="Net-worth accounts">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Group</th>
                    <th>Owner</th>
                    <th className="num">Sort</th>
                    <th>Parent</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account) => (
                    <tr
                      key={account.id}
                      className={account.id === editingId ? 'is-editing' : undefined}
                    >
                      <td>
                        {account.name}
                        {account.is_component && <span className="badge">Component</span>}
                      </td>
                      <td>{GROUP_LABELS[account.group]}</td>
                      {/* NULL is JOINT, never "unknown": the migration backfilled every
                          pre-existing account to the primary person. */}
                      <td>
                        {account.person_id === null
                          ? 'Joint'
                          : (ownerName.get(account.person_id) ?? '—')}
                      </td>
                      <td className="num">{account.sort_order}</td>
                      <td>
                        {account.parent_account_id === null
                          ? '—'
                          : (accountName.get(account.parent_account_id) ?? '—')}
                      </td>
                      <td>
                        <span className="badge">{account.is_active ? 'Active' : 'Retired'}</span>
                      </td>
                      <td className="row-actions">
                        <button
                          type="button"
                          className="button"
                          aria-label={`Edit ${account.name}`}
                          disabled={busy}
                          onClick={() => startEdit(account)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="button"
                          aria-label={
                            account.is_active
                              ? `Retire ${account.name}`
                              : `Restore ${account.name}`
                          }
                          disabled={busy}
                          onClick={() => toggleActive(account)}
                        >
                          {account.is_active ? 'Retire' : 'Restore'}
                        </button>
                        <button
                          type="button"
                          className="button"
                          aria-label={`Delete ${account.name}`}
                          disabled={busy}
                          onClick={() => remove(account)}
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
        </>
      )}

      {/* Portfolio accounts (2026-08-28 spec §5): the labels behind the positions ledger,
          and the ONE place their ownership is edited. Rendered OUTSIDE the roster's
          `loaded` gate on purpose — a net-worth GET that failed says nothing about the
          portfolio router. */}
      <h3 className="eyebrow portfolio-accounts-heading">
        Portfolio accounts
        <InfoHint text="The account labels your transactions and dividends are filed under. Owner blank = joint; a person's Portfolio view is their own labels plus the joint ones. Labels are fixed here — they are the positions' identity." />
      </h3>
      {portfolioError && (
        <div className="error-banner" role="alert">
          {portfolioError}{' '}
          <button className="button" onClick={loadPortfolio}>
            Retry
          </button>
        </div>
      )}
      {!portfolioLoaded && portfolioError === null && (
        <p className="empty-note">Loading portfolio accounts…</p>
      )}
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
            <p className="settings-note">
              A new account label typed on a transaction or dividend is created owned by{' '}
              {primaryName} — re-tag it here. The labels themselves are fixed: they identify
              the positions.
            </p>
          </>
        ))}
    </section>
  )
}
