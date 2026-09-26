import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { describeError } from '../../api/client'
import { createPerson, fetchHousehold, putMarriageDate, updatePerson } from '../../api/household'
import type { PersonOut } from '../../types/api'
import InfoHint from '../InfoHint'
import { SaveButton } from '../feedback/SaveButton'
import { SaveStatus } from '../feedback/SaveStatus'
import { useSaveState } from '../feedback/useSaveState'
import { revealEditor, useEscapeCancel } from '../feedback/reveal'
import BusyButton from '../feedback/BusyButton'
import { FeedBanner } from '../shell/Feed'
import SettingsGhost from './SettingsGhost'
import { WARM, warmSource } from './settingsPrefetch'
import '../panels.css'
import './settings.css'

export default function HouseholdCard({ onPeopleChange }: { onPeopleChange: (people: PersonOut[]) => void }) {
  const [people, setPeople] = useState<PersonOut[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [dateBox, setDateBox] = useState('')
  const [savedDate, setSavedDate] = useState('')
  const seqRef = useRef(0)
  const renameRef = useRef<HTMLFormElement>(null)
  const focusPerson = useRef<number | null>(null)
  const addState = useSaveState({ dirty: newName.trim() !== '' })
  const dateState = useSaveState({ dirty: dateBox !== savedDate })
  const renameState = useSaveState({ dirty: editName.trim() !== (people.find((person) => person.id === editingId)?.name ?? '') })
  const renameBusy = renameState.status === 'saving'

  // A roster refresh must not replace a marriage date the other form is still editing.
  const load = (initial = false, seedDate = true) => {
    const seq = ++seqRef.current
    return warmSource(initial)(WARM.household, fetchHousehold)
      .then((household) => {
        if (seq !== seqRef.current) return
        setPeople(household.people)
        onPeopleChange(household.people)
        if (seedDate) {
          setDateBox(household.marriage_date ?? '')
          setSavedDate(household.marriage_date ?? '')
        }
        setLoadError(null)
        setLoaded(true)
      })
      .catch((err: unknown) => {
        if (seq === seqRef.current) setLoadError(describeError(err, 'the household'))
      })
  }
  useEffect(() => {
    load(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useLayoutEffect(() => {
    if (editingId !== null) revealEditor(renameRef.current, 'input')
    else if (focusPerson.current !== null) {
      document.querySelector<HTMLButtonElement>(`#household [data-person="${focusPerson.current}"] button`)?.focus()
      focusPerson.current = null
    }
  }, [editingId, people])
  const cancelRename = () => {
    focusPerson.current = editingId
    setEditingId(null)
    setEditName('')
    renameState.clearError()
  }
  useEscapeCancel(renameRef, cancelRename, editingId !== null && !renameBusy)

  const addPerson = () => void addState.run(async () => {
    const name = newName.trim()
    if (!name) throw new Error('Enter a name for the new household member.')
    await createPerson(name)
    setNewName('')
    await load(false, false)
  })
  const saveRename = () => void renameState.run(async () => {
    if (editingId === null) return
    const name = editName.trim()
    if (!name) throw new Error('Enter a name.')
    await updatePerson(editingId, name)
    await load(false, false)
    focusPerson.current = editingId
    setEditingId(null)
    setEditName('')
  })
  const saveDate = () => void dateState.run(async () => {
    const saved = await putMarriageDate(dateBox.trim() === '' ? null : dateBox)
    setDateBox(saved.marriage_date ?? '')
    setSavedDate(saved.marriage_date ?? '')
  })

  return (
    <section className="card span-4" id="household">
      <h2 className="eyebrow">Household<InfoHint text="Who this dashboard tracks. Accounts point at these people; an account with no owner is joint. The primary member can be renamed but never changed or removed." /></h2>
      <FeedBanner error={loadError} retry={() => load()} retryLabel="Retry loading the household" />
      {!loaded && loadError === null && <SettingsGhost height={420} />}
      {loaded && <>
        <ul className="household-people">
          {people.map((person) => <li key={person.id} className="household-person" data-person={person.id}>
            {editingId === person.id ? (
              <form key="rename" ref={renameRef} className="household-rename" onSubmit={(event) => { event.preventDefault(); saveRename() }}>
                <input className="field-input" aria-label={`New name for ${person.name}`} value={editName} readOnly={renameBusy} onChange={(event) => { setEditName(event.target.value); renameState.clearError() }} />
                <div className="settings-card-actions">
                  <SaveButton type="submit" className="button button-primary" state={renameState}>Save name</SaveButton>
                  <BusyButton type="button" className="button" inert={renameBusy} onClick={cancelRename}>Cancel</BusyButton>
                </div>
                <SaveStatus state={renameState} />
              </form>
            ) : (
              <div key="name" className="household-person">
                <span className="household-name">{person.name}</span>
                {person.is_primary && <span className="badge">Primary</span>}
                <button type="button" className="button" aria-label={`Rename ${person.name}`} onClick={() => { setEditingId(person.id); setEditName(person.name); renameState.clearError() }}>Rename</button>
              </div>
            )}
          </li>)}
        </ul>
        <form className="settings-card-form" onSubmit={(event) => { event.preventDefault(); addPerson() }}>
          <label>Add a household member<input className="field-input" value={newName} readOnly={addState.status === 'saving'} onChange={(event) => { setNewName(event.target.value); addState.clearError() }} /></label>
          <div className="settings-card-actions">
            <SaveButton type="submit" className="button" state={addState}>Add member</SaveButton>
            <SaveStatus state={addState} />
          </div>
        </form>
        <form className="settings-card-form" onSubmit={(event) => { event.preventDefault(); saveDate() }}>
          <label>Marriage date<input className="field-input" type="date" value={dateBox} readOnly={dateState.status === 'saving'} onChange={(event) => { setDateBox(event.target.value); dateState.clearError() }} /></label>
          <p className="settings-note">Blank = not set. Nothing is backfilled — partner accounts and balances start when you enter them.</p>
          <div className="settings-card-actions">
            <SaveButton type="submit" className="button button-primary" state={dateState}>Save marriage date</SaveButton>
            <SaveStatus state={dateState} />
          </div>
        </form>
      </>}
    </section>
  )
}
