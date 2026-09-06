import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { fetchHousehold } from '../../api/household'
import { fetchProfiles } from '../../api/paycheck'
import { fetchAppSettings, putAppSettings } from '../../api/settings'
import type { AppSettingsOut, PaycheckProfileListItem, PersonOut } from '../../types/api'
import { isPlainDecimal, shiftPoint } from '../../utils/percent'
import InfoHint from '../InfoHint'
import { FeedBanner } from '../shell/Feed'
import '../panels.css'
import './settings.css'

// The boxes a payload seeds, as pure string math at MODULE scope (SettingsPage's old
// boxesFor, moved with the form): a component-scope helper would make `load` reactive and the
// mount effect would owe it a dependency.
function boxesFor(s: AppSettingsOut) {
  return {
    // Display percent: "0.045000" -> "4.5". Number() only trims the stored quantizer's
    // trailing zeros; the box round-trips through shiftPoint on save, so no float ever
    // reaches the wire.
    swr: String(Number(shiftPoint(s.swr_pct, 2))),
    ticker: s.espp_ticker ?? '',
    discount: String(Number(shiftPoint(s.espp_discount_pct, 2))),
  }
}

type Boxes = ReturnType<typeof boxesFor>

// Whole dollars: a match band is a round policy number, and cents on it read as precision the
// policy does not have.
const BAND = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const ratePct = (raw: string) => `${Number((Number(raw) * 100).toFixed(4))}%`

/** The profile form's own sentence (spec §2.3), so the two surfaces describe one policy in one
 *  voice. `?? '0'` covers a snapshot restored from before the columns existed. */
export function matchWords(p: PaycheckProfileListItem): string {
  const first =
    Number(p.match_rate_1 ?? '0') > 0 && Number(p.match_band_1 ?? '0') > 0
      ? `${ratePct(p.match_rate_1 ?? '0')} of the first ${BAND.format(Number(p.match_band_1))}`
      : ''
  const next =
    Number(p.match_rate_2 ?? '0') > 0 && Number(p.match_band_2 ?? '0') > 0
      ? `${ratePct(p.match_rate_2 ?? '0')} of the next ${BAND.format(Number(p.match_band_2))}`
      : ''
  if (first === '' && next === '') return 'no match entered'
  if (first === '' || next === '') return `${first}${next}`
  return `${first}, then ${next}`
}

/**
 * Plan assumptions (2026-09-06 spec §3.3), replacing the page's inline App settings form: the
 * three knobs the Projection, ESPP and Paycheck pages derive from, saved with a PARTIAL PUT so
 * this card never re-sends the cron or the reminder day it does not show, plus a READ-ONLY
 * per-person employer-match summary — the policy lives on the paycheck profile, and two places
 * to edit one number is how they drift.
 */
export default function PlanAssumptionsCard() {
  const [settings, setSettings] = useState<AppSettingsOut | null>(null)
  const [people, setPeople] = useState<PersonOut[]>([])
  const [profiles, setProfiles] = useState<PaycheckProfileListItem[]>([])
  const [boxes, setBoxes] = useState<Boxes>({ swr: '', ticker: '', discount: '' })
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState(false)
  const seqRef = useRef(0)

  // A plain function over stable setters, called from the effect and from Retry (the
  // LimitsCard idiom — a useCallback here trips preserve-manual-memoization). All-or-nothing,
  // the SystemCard contract: this card is ONE reading of the plan, and a match summary
  // standing on a profile read that failed beside a fresh settings read would be a card of two
  // instants.
  const load = () => {
    const seq = ++seqRef.current
    Promise.all([fetchAppSettings(), fetchProfiles(), fetchHousehold()])
      .then(([stored, rows, household]) => {
        if (seq !== seqRef.current) return
        setSettings(stored)
        setBoxes(boxesFor(stored))
        setProfiles(rows)
        setPeople(household.people)
        setLoadError(null)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setLoadError(err instanceof ApiError ? err.message : 'Could not load the plan assumptions.')
      })
  }

  useEffect(() => {
    load()
    // mount-only: a plain function over stable setters (house idiom)
  }, [])

  // Every keystroke retires both sentences under the form: they describe the values that WERE
  // in the boxes.
  const edit = (key: keyof Boxes) => (value: string) => {
    setBoxes((current) => ({ ...current, [key]: value }))
    setSavedNote(false)
    setFormError(null)
  }

  const save = () => {
    // BEFORE Number(): shiftPoint hands "1e-3" back untouched and Decimal("1e-3") is a
    // perfectly legal 0.001 server-side, so the box would silently store a rate 100x off with
    // no 422 anywhere on the round trip (src/utils/percent.ts).
    if (!isPlainDecimal(boxes.swr) || !isPlainDecimal(boxes.discount)) {
      setFormError('Enter a plain decimal (no exponents).')
      return
    }
    const rate = Number(boxes.swr)
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      // Worded in the BOX's vocabulary. The server says "must be a fraction between 0 and 1",
      // which is the stored value's — quoted here it would call a 4.5 too big.
      setFormError('Must be between 0 and 100.')
      return
    }
    const discount = Number(boxes.discount)
    if (!Number.isFinite(discount) || discount < 0 || discount > 15) {
      setFormError('Must be between 0 and 15 — the §423 maximum.')
      return
    }
    // Explicitly null, never undefined: JSON.stringify drops an undefined value, and under the
    // partial PUT a dropped key means "keep" — so "clear the ticker" and "I forgot to send it"
    // would arrive as the same request. The non-empty value travels AS TYPED.
    const ticker = boxes.ticker.trim() === '' ? null : boxes.ticker
    setSaving(true)
    setFormError(null)
    setSavedNote(false)
    // ONLY this card's three fields (spec §3.5). The cron and the reminder day belong to other
    // cards; sending them — even as nulls — would revert or clear what those cards saved.
    putAppSettings({
      swr_pct: shiftPoint(boxes.swr, -2),
      espp_ticker: ticker,
      espp_discount_pct: shiftPoint(boxes.discount, -2),
    })
      .then((saved) => {
        // Re-seeded from the RESPONSE, not from what was typed: the server answers with what
        // it stored (quantized rate, uppercased ticker), and boxes left holding the typed text
        // would read as unsaved work against values already in the database.
        setSettings(saved)
        setBoxes(boxesFor(saved))
        setSavedNote(true)
      })
      .catch((err: unknown) => {
        // Verbatim: the ticker 422 is NOT field-prefixed, so the slot is form-level.
        setFormError(err instanceof ApiError ? err.message : 'Could not save the assumptions.')
      })
      .finally(() => setSaving(false))
  }

  return (
    <section className="card span-6" id="plan-assumptions" role="region" aria-label="Plan assumptions">
      <h2 className="eyebrow">
        Plan assumptions
        <InfoHint text="The knobs the Projection, ESPP and Paycheck pages derive from. The employer match is set per person on the Paycheck page." />
      </h2>
      <FeedBanner error={loadError} retry={load} retryLabel="Retry loading the plan assumptions" />
      {settings === null && loadError === null && <p className="empty-note">Loading…</p>}
      {settings !== null && (
        <form
          className="settings-card-form"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          {/* All three boxes go read-only for the in-flight window, because the PUT response
              RE-SEEDS them: text typed while saving would be overwritten by the echo of the
              older values, next to a fresh "Saved". */}
          <label>
            Withdrawal rate (% / year)
            <input
              className="field-input"
              inputMode="decimal"
              value={boxes.swr}
              disabled={saving}
              onChange={(e) => edit('swr')(e.target.value)}
            />
          </label>
          <label>
            ESPP ticker
            <input
              className="field-input"
              value={boxes.ticker}
              disabled={saving}
              onChange={(e) => edit('ticker')(e.target.value)}
            />
          </label>
          <label>
            ESPP discount (%)
            <input
              className="field-input"
              inputMode="decimal"
              value={boxes.discount}
              disabled={saving}
              onChange={(e) => edit('discount')(e.target.value)}
            />
          </label>
          <p className="settings-note">
            Blank ticker = ESPP page shows &apos;no ticker configured&apos;. The discount prices
            the ESPP modeler, the paycheck pace tick and the tax what-if; 15 % is the §423
            maximum.
          </p>
          <div className="settings-card-actions">
            <button type="submit" className="button button-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save assumptions'}
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
      <div className="settings-field">
        <span className="eyebrow">Employer 401(k) match</span>
        <ul className="plan-match-list">
          {people.map((person) => {
            const profile = profiles.find((p) => p.in_force && p.person_id === person.id)
            return (
              <li key={person.id} className="settings-note">
                {person.name}:{' '}
                {profile === undefined ? 'no paycheck profile yet' : matchWords(profile)}
              </li>
            )
          })}
        </ul>
        <p className="settings-note">
          Read-only here — the policy is effective-dated on each person&apos;s paycheck profile.{' '}
          <Link to="/paycheck">Set it on the Paycheck page</Link>
        </p>
      </div>
    </section>
  )
}
