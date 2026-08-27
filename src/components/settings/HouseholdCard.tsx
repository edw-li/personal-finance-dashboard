import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { createPerson, fetchHousehold, putMarriageDate, updatePerson } from '../../api/household'
import type { PersonOut } from '../../types/api'
import InfoHint from '../InfoHint'
import '../panels.css'
import './settings.css'

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/**
 * The Settings Household card (2026-08-26 spec §6): the people registry every owner column
 * points at, plus the marriage date. Its own fetch and error state (SystemCard's posture) —
 * a household hiccup must not dent the settings forms, nor the reverse.
 *
 * The people list is LIFTED to the page through onPeopleChange rather than re-fetched by
 * the Accounts card, so a partner added here is selectable as an owner there immediately.
 */
export default function HouseholdCard({
  onPeopleChange,
}: {
  onPeopleChange: (people: PersonOut[]) => void
}) {
  const [people, setPeople] = useState<PersonOut[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [dateBox, setDateBox] = useState('')
  const [savedNote, setSavedNote] = useState(false)
  const seqRef = useRef(0)

  const load = () => {
    const seq = ++seqRef.current
    fetchHousehold()
      .then((h) => {
        if (seq !== seqRef.current) return
        setPeople(h.people)
        onPeopleChange(h.people)
        setDateBox(h.marriage_date ?? '')
        setError(null)
        setLoaded(true)
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return
        setError(message(err, 'Could not load the household.'))
      })
  }

  useEffect(() => {
    load()
    // mount-only: a plain function over stable setters (house idiom). Unlike the sibling
    // cards, `load` also calls the onPeopleChange PROP, which the rule cannot see as
    // stable — silenced the same way CalendarPage's mount-only load is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addPerson = () => {
    const name = newName.trim()
    if (!name) {
      setError('Enter a name for the new household member.')
      return
    }
    setBusy(true)
    setError(null)
    createPerson(name)
      .then(() => {
        // Only a SUCCESS clears the box: retyping a name after a 409 would be a punishment
        // for the server's answer.
        setNewName('')
        load()
      })
      .catch((err: unknown) => setError(message(err, 'Could not add the member.')))
      .finally(() => setBusy(false))
  }

  const saveRename = () => {
    if (editingId === null) return
    const name = editName.trim()
    if (!name) {
      setError('Enter a name.')
      return
    }
    setBusy(true)
    setError(null)
    updatePerson(editingId, name)
      .then(() => {
        setEditingId(null)
        setEditName('')
        load()
      })
      .catch((err: unknown) => setError(message(err, 'Could not rename.')))
      .finally(() => setBusy(false))
  }

  const saveDate = () => {
    setBusy(true)
    setError(null)
    setSavedNote(false)
    // Explicit null, never undefined (the client module says why).
    putMarriageDate(dateBox.trim() === '' ? null : dateBox)
      .then((saved) => {
        // Re-seeded from the RESPONSE: the server echoes what it stored.
        setDateBox(saved.marriage_date ?? '')
        setSavedNote(true)
      })
      .catch((err: unknown) => setError(message(err, 'Could not save the marriage date.')))
      .finally(() => setBusy(false))
  }

  return (
    <section className="card span-6">
      <h2 className="eyebrow">
        Household
        <InfoHint text="Who this dashboard tracks. Accounts point at these people; an account with no owner is joint. The primary member can be renamed but never changed or removed." />
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
          <ul className="household-people">
            {people.map((person) => (
              <li key={person.id} className="household-person">
                {editingId === person.id ? (
                  <>
                    <input
                      className="field-input"
                      aria-label={`New name for ${person.name}`}
                      value={editName}
                      disabled={busy}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={busy}
                      onClick={saveRename}
                    >
                      Save name
                    </button>
                    <button
                      type="button"
                      className="button"
                      onClick={() => {
                        setEditingId(null)
                        setEditName('')
                      }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className="household-name">{person.name}</span>
                    {person.is_primary && <span className="badge">Primary</span>}
                    <button
                      type="button"
                      className="button"
                      aria-label={`Rename ${person.name}`}
                      disabled={busy}
                      onClick={() => {
                        setEditingId(person.id)
                        setEditName(person.name)
                      }}
                    >
                      Rename
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <form
            className="settings-card-form"
            onSubmit={(e) => {
              e.preventDefault()
              addPerson()
            }}
          >
            <label>
              Add a household member
              <input
                className="field-input"
                value={newName}
                disabled={busy}
                onChange={(e) => {
                  setNewName(e.target.value)
                  setError(null)
                }}
              />
            </label>
            <div className="settings-card-actions">
              <button type="submit" className="button" disabled={busy}>
                Add member
              </button>
            </div>
          </form>
          <form
            className="settings-card-form"
            onSubmit={(e) => {
              e.preventDefault()
              saveDate()
            }}
          >
            <label>
              Marriage date
              <input
                className="field-input"
                type="date"
                value={dateBox}
                disabled={busy}
                onChange={(e) => {
                  setDateBox(e.target.value)
                  setSavedNote(false)
                }}
              />
            </label>
            <p className="settings-note">
              Blank = not set. Nothing is backfilled — partner accounts and balances start
              when you enter them.
            </p>
            <div className="settings-card-actions">
              <button type="submit" className="button button-primary" disabled={busy}>
                Save marriage date
              </button>
            </div>
            {savedNote && (
              <p className="settings-note" role="status">
                Marriage date saved.
              </p>
            )}
          </form>
        </>
      )}
    </section>
  )
}
