import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { createSnapshot, fetchHealth, undoBatch } from '../../api/lifecycle'
import { deleteSpendingMonth } from '../../api/spending'
import { fetchTaxInputs, putTaxInputsForRepair } from '../../api/taxes'
import type { HealthCheck } from '../../types/api'
import { formatMonth } from '../../utils/format'
import InfoHint from '../InfoHint'
import { FeedBanner } from '../shell/Feed'
import { useToast } from '../ToastProvider'
import '../panels.css'
import './settings.css'

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/**
 * Data health (2026-09-03 data-lifecycle spec §11): the server's checks, non-ok ones only,
 * each with its fix — a link into the app, or an action run from here. The zero-month repair
 * is the spending DELETE sent as a repair (logged, undoable): arm on click, run, toast with
 * Undo, refetch. Production's phantom September becomes two clicks.
 */
export default function HealthCard() {
  const [checks, setChecks] = useState<HealthCheck[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState<string | null>(null) // `${check.id}:${month}` awaiting its second click
  const seqRef = useRef(0)
  const toast = useToast()

  const load = () => {
    const seq = ++seqRef.current
    fetchHealth()
      .then((out) => {
        if (seq !== seqRef.current) return
        setChecks(out.checks.filter((check) => check.severity !== 'ok'))
        setError(null)
        setArmed(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(message(err, 'Could not load the health checks.'))
      })
  }

  useEffect(() => {
    load()
    // mount-only (house idiom)
  }, [])

  const repairMonth = (check: HealthCheck, month: string) => {
    const key = `${check.id}:${month}`
    if (armed !== key) {
      setArmed(key)
      return
    }
    setBusy(true)
    setError(null)
    deleteSpendingMonth(month, { source: 'repair' })
      .then(({ batchId }) => {
        toast.success(
          `Deleted ${formatMonth(month)}'s zero-filled rows`,
          batchId === null
            ? undefined
            : {
                action: {
                  label: 'Undo',
                  onAction: () =>
                    void undoBatch(batchId)
                      .then(() => {
                        toast.success(`Undone — ${formatMonth(month)}'s rows are back`)
                        load()
                      })
                      .catch((err: unknown) => toast.error(message(err, 'Undo failed'))),
                },
              },
        )
        load()
      })
      .catch((err: unknown) => setError(message(err, 'Repair failed.')))
      .finally(() => setBusy(false))
  }

  /**
   * The §199A repair (taxes spec 4h): rewrite one year's itemized total to the CURRENT
   * suggestion, which is the same figure without the §199A line the engine now deducts on
   * its own. The number comes from the server's own suggestion rather than being computed
   * here — one definition of the itemized formula, and it is already on the payload this
   * fetch returns. The write is the ordinary inputs PUT, logged as a repair, so the toast
   * can offer Undo exactly like the zero-month delete above.
   */
  const repairItemized = (check: HealthCheck, year: number) => {
    const key = `${check.id}:${year}`
    if (armed !== key) {
      setArmed(key)
      return
    }
    setBusy(true)
    setError(null)
    fetchTaxInputs(year)
      .then((inputs) => {
        const item = inputs.sections
          .flatMap((section) => section.items)
          .find((entry) => entry.key === 'itemized_deduction')
        if (item?.suggested == null) {
          // Named, not guessed at: the card writes the server's figure or nothing.
          setError(`No itemized suggestion for ${year} — open the year and check it.`)
          return null
        }
        return putTaxInputsForRepair(year, { values: { itemized_deduction: item.suggested } })
      })
      .then((written) => {
        if (written === null) return
        const { batchId } = written
        toast.success(
          `Rewrote ${year}'s itemized deduction without the §199A line`,
          batchId === null
            ? undefined
            : {
                action: {
                  label: 'Undo',
                  onAction: () =>
                    void undoBatch(batchId)
                      .then(() => {
                        toast.success(`Undone — ${year}'s itemized total is back`)
                        load()
                      })
                      .catch((err: unknown) => toast.error(message(err, 'Undo failed'))),
                },
              },
        )
        load()
      })
      .catch((err: unknown) => setError(message(err, 'Repair failed.')))
      .finally(() => setBusy(false))
  }

  const snapshotNow = () => {
    setBusy(true)
    setError(null)
    createSnapshot()
      .then((entry) => {
        toast.success(`Snapshot written — ${entry.name}`)
        load()
      })
      .catch((err: unknown) => setError(message(err, 'Snapshot failed.')))
      .finally(() => setBusy(false))
  }

  const fixFor = (check: HealthCheck) => {
    const fix = check.fix
    if (fix === null) return null
    if (fix.kind === 'link' && fix.to) {
      return (
        <Link className="button" to={fix.to}>
          {fix.label}
        </Link>
      )
    }
    if (fix.action === 'delete_spending_month') {
      return check.months.map((month) => {
        const key = `${check.id}:${month}`
        return (
          <button
            key={month}
            type="button"
            className={`button${armed === key ? ' danger-button' : ''}`}
            disabled={busy}
            onClick={() => repairMonth(check, month)}
          >
            {armed === key ? `Delete ${formatMonth(month)}?` : `Delete ${formatMonth(month)}`}
          </button>
        )
      })
    }
    if (fix.action === 'rewrite_itemized_deduction') {
      return check.years.map((year) => {
        const key = `${check.id}:${year}`
        return (
          <button
            key={year}
            type="button"
            className={`button${armed === key ? ' danger-button' : ''}`}
            disabled={busy}
            onClick={() => repairItemized(check, year)}
          >
            {armed === key ? `Rewrite ${year}?` : `Rewrite ${year}`}
          </button>
        )
      })
    }
    if (fix.action === 'snapshot_now') {
      return (
        <button type="button" className="button" disabled={busy} onClick={snapshotNow}>
          {fix.label}
        </button>
      )
    }
    return null
  }

  return (
    <section className="card span-6" id="health" role="region" aria-label="Data health">
      <h2 className="eyebrow">
        Data health
        <InfoHint text="Checks the server runs on every visit: zero-filled spending months, balances or spending entered without the other, an itemized total that still carries the §199A line, stale quotes, two identical months, the backup marker and the stored snapshots. Each names its fix; the two repairs are logged and undoable." />
      </h2>
      <FeedBanner error={error} retry={load} retryLabel="Retry the health checks" />
      {checks === null && error === null && <p className="empty-note">Loading…</p>}
      {checks !== null && checks.length === 0 && <p className="empty-note">All checks pass.</p>}
      {checks !== null && checks.length > 0 && (
        <ul className="health-list">
          {checks.map((check) => (
            <li key={check.id} className="health-row">
              <span className={`badge health-severity-${check.severity}`}>{check.severity}</span>
              <span className="health-title">{check.title}</span>
              {fixFor(check)}
              <p className="settings-note health-detail">{check.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
