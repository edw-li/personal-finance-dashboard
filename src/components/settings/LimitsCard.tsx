import { useEffect, useRef, useState } from 'react'
import { ApiError, describeError } from '../../api/client'
import { cloneLimits, fetchLimits, putLimits } from '../../api/limits'
import type { LimitsOut } from '../../types/api'
import AmountInput from '../AmountInput'
import InfoHint from '../InfoHint'
import { useToast } from '../ToastProvider'
import { FeedBanner } from '../shell/Feed'
import '../panels.css'
import './settings.css'

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

// The boxes a payload seeds, as pure string math at MODULE scope (SettingsPage's rule):
// the load chain, the PUT echo and the clone echo all apply it, and a component-scope
// helper would make `load` reactive and owe the effect a dependency.
function boxesFor(payload: LimitsOut): Record<string, string> {
  return Object.fromEntries(payload.items.map((item) => [item.key, item.value ?? '']))
}

/**
 * The Settings Contribution-limits card (2026-08-27 spec §5): the per-year registry the
 * pace strip on the Paycheck page measures against.
 *
 * The app ships NO values — the brackets philosophy (spec §2). The five DEFINITIONS come
 * from the server (labels and order are the code's), and every number is the user's. A
 * blank box is not a zero: it saves as an explicit null, which DELETES the row and puts
 * the key back to "not entered" — the state the pace strip renders a call-to-action for.
 */
export default function LimitsCard() {
  // Three years is the whole useful window: last year to clone from, this year to edit,
  // next year to enter in the autumn when the IRS publishes.
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [items, setItems] = useState<LimitsOut['items'] | null>(null)
  const [boxes, setBoxes] = useState<Record<string, string>>({})
  // Two slots, because they have two different answers (2026-09-05 motion spec §9): a load
  // failure is fixed by asking again; a refused save or a typo is not.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [savedNote, setSavedNote] = useState(false)
  const seqRef = useRef(0)
  const toast = useToast()

  // A plain function over stable setters, called from the effect and from Retry — a
  // useCallback here would trip preserve-manual-memoization (SettingsPage's wall).
  const load = (forYear: number) => {
    const seq = ++seqRef.current
    fetchLimits(forYear)
      .then((payload) => {
        if (seq !== seqRef.current) return
        setItems(payload.items)
        setBoxes(boxesFor(payload))
        setLoadError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        // The previous year's boxes are DROPPED with the items: this card's whole
        // content is about one year, and boxes left standing under a new year's heading
        // would offer to save last year's numbers into it.
        setItems(null)
        setLoadError(describeError(err, 'the contribution limits'))
      })
  }

  useEffect(() => {
    load(year)
    // `year` only: `load` is a plain function over stable setters (house idiom).
  }, [year])

  const pickYear = (next: number) => {
    if (next === year) return
    setSavedNote(false)
    setFormError(null)
    setLoadError(null)
    setYear(next)
  }

  const edit = (key: string) => (value: string) => {
    setBoxes((current) => ({ ...current, [key]: value }))
    // Every keystroke retires the sentence under the form: it describes the values that
    // WERE in the boxes (SettingsPage's rule).
    setSavedNote(false)
    setFormError(null)
  }

  const save = () => {
    if (items === null) return
    // ALL FIVE keys, every time — a cleared box must DELETE the row, and an omitted key
    // is "leave it alone" server-side. The text travels AS TYPED: the server quantizes
    // and 422s, and a client that pre-empted it would be a second opinion.
    const values = Object.fromEntries(
      items.map((item) => {
        const typed = (boxes[item.key] ?? '').trim()
        return [item.key, typed === '' ? null : typed]
      }),
    )
    setBusy(true)
    setFormError(null)
    setSavedNote(false)
    putLimits(year, { values })
      .then((payload) => {
        // Re-seeded from the RESPONSE: the server answers with what it stored (quantized
        // to cents), and boxes holding the typed text would read as unsaved work against
        // values that are already in the database.
        setItems(payload.items)
        setBoxes(boxesFor(payload))
        setSavedNote(true)
      })
      .catch((err: unknown) => setFormError(message(err, 'Could not save the limits.')))
      .finally(() => setBusy(false))
  }

  const clone = () => {
    setBusy(true)
    setFormError(null)
    setSavedNote(false)
    cloneLimits(year, year - 1)
      .then((payload) => {
        setItems(payload.items)
        setBoxes(boxesFor(payload))
      })
      // The 404/409 sentences are the server's and they are about the YEAR rather than
      // any one box, so they ride the toast layer (AccountsCard's delete posture).
      .catch((err: unknown) => toast.error(message(err, 'Clone failed')))
      .finally(() => setBusy(false))
  }

  return (
    <section className="card span-6" id="limits" role="region" aria-label="Contribution limits">
      <h2 className="eyebrow">
        Contribution limits
        <InfoHint text="Your own per-year caps. The dashboard ships none of its own — enter the year's published figures and the Paycheck page grades your contributions against them. A blank box means 'not entered', which the pace strip says out loud." />
      </h2>
      <div className="segmented" role="group" aria-label="Limit year">
        {/* Frozen while a write is in flight, exactly like the two buttons below. `save` and
            `clone` re-seed from their response with no sequence guard of their own, so a
            chip pressed mid-flight would land the OLD year's echo under the new year's
            heading — the failure the load-error path above refuses to allow. */}
        {[currentYear - 1, currentYear, currentYear + 1].map((option) => (
          <button
            key={option}
            type="button"
            className={option === year ? 'active' : ''}
            aria-pressed={option === year}
            disabled={busy}
            onClick={() => pickYear(option)}
          >
            {option}
          </button>
        ))}
      </div>
      <FeedBanner
        error={loadError}
        retry={() => load(year)}
        retryLabel="Retry loading the contribution limits"
      />
      {items === null && loadError === null && <p className="empty-note">Loading…</p>}
      {items !== null && (
        <form
          className="settings-card-form"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          {items.map((item) => (
            <label key={item.key}>
              {item.label}
              <AmountInput
                value={boxes[item.key] ?? ''}
                onValueChange={edit(item.key)}
                placeholder="not entered"
                disabled={busy}
                aria-label={item.label}
              />
            </label>
          ))}
          <p className="settings-note">
            The IRS publishes new figures every year, so the dashboard stores yours rather than
            shipping a table that would be wrong by January. Clearing a box deletes that
            year&apos;s value.
          </p>
          <div className="settings-card-actions">
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save limits'}
            </button>
            <button type="button" className="button" disabled={busy} onClick={clone}>
              {`Clone from ${year - 1}`}
            </button>
          </div>
          <FeedBanner error={formError} />
          {savedNote && (
            <p className="settings-note" role="status">
              Saved.
            </p>
          )}
        </form>
      )}
    </section>
  )
}
