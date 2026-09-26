import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { createSnapshot, fetchHealth, undoBatch } from '../../api/lifecycle'
import { deleteSpendingMonth } from '../../api/spending'
import type { HealthCheck } from '../../types/api'
import { formatMonth } from '../../utils/format'
import InfoHint from '../InfoHint'
import { useConfirm } from '../feedback/confirm'
import BusyButton from '../feedback/BusyButton'
import { FeedBanner } from '../shell/Feed'
import { useToast } from '../ToastProvider'
import '../panels.css'
import './settings.css'
import SettingsGhost from './SettingsGhost'
import { WARM, warmSource } from './settingsPrefetch'

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
  const seqRef = useRef(0)
  const toast = useToast()
  const ask = useConfirm()
  const cardRef = useRef<HTMLElement>(null)

  const load = (initial = false) => {
    const seq = ++seqRef.current
    return warmSource(initial)(WARM.health, fetchHealth)
      .then((out) => {
        if (seq !== seqRef.current) return
        setChecks(out.checks.filter((check) => check.severity !== 'ok'))
        setError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(message(err, 'Could not load the health checks.'))
      })
  }

  useEffect(() => {
    load(true)
    // mount-only (house idiom)
  }, [])

  const repairMonth = async (month: string, anchor: HTMLElement) => {
    if (!await ask({
      anchor,
      title: `Delete ${formatMonth(month)}'s zero-filled rows?`,
      body: 'Removes the empty spending and take-home rows for this month. You can Undo this repair.',
      confirmLabel: `Delete ${formatMonth(month)}`,
    })) return
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
                        void load().then(() => cardRef.current?.focus())
                      })
                      .catch((err: unknown) => toast.error(message(err, 'Undo failed'))),
                },
              },
        )
        void load().then(() => cardRef.current?.focus())
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
        void load().then(() => cardRef.current?.focus())
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
        return (
          <BusyButton
            key={month}
            type="button"
            className="button danger-button"
            disabled={busy}
            onClick={(event) => void repairMonth(month, event.currentTarget)}
          >
            {`Delete ${formatMonth(month)}`}
          </BusyButton>
        )
      })
    }
    if (fix.action === 'snapshot_now') {
      return (
        <BusyButton type="button" className="button" disabled={busy} onClick={snapshotNow}>
          {fix.label}
        </BusyButton>
      )
    }
    return null
  }

  return (
    <section ref={cardRef} tabIndex={-1} className="card span-12" id="health" role="region" aria-label="Data health">
      <h2 className="eyebrow">
        Data health
        {/* The §199A check went with the stored itemized total (2026-09-11 spec §1.4): a
            computed line cannot go stale, so there is nothing left to name or repair. */}
        <InfoHint text="Checks the server runs on every visit: zero-filled spending months, balances or spending entered without the other, stale quotes, two identical months, the backup marker, the stored snapshots and balances filed more than a month ahead. Each names its fix; the repair is logged and undoable." />
      </h2>
      <FeedBanner error={error} retry={() => load()} retryLabel="Retry the health checks" />
      {checks === null && error === null && <SettingsGhost height={313} />}
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
