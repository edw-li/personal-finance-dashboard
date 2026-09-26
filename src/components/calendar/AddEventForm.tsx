import { useRef, type RefObject } from 'react'
import { SaveButton } from '../feedback/SaveButton'
import { SaveStatus } from '../feedback/SaveStatus'
import type { SaveState } from '../feedback/useSaveState'
import { useEscapeCancel } from '../feedback/reveal'
import type { CalendarDirection, CalendarRecurrence, PersonOut } from '../../types/api'
import AmountInput from '../AmountInput'
import { FeedBanner } from '../shell/Feed'

/** The custom-event form's boxes. The form IS the body a save sends, so every field the PATCH
 *  replaces has a box here even when the form does not show it (a one-off's `until`). '' = unset. */
export interface EventFields {
  date: string
  label: string
  detail: string
  person: string // '' = Household; a tag is always deliberate
  amount: string
  direction: CalendarDirection
  recurrence: CalendarRecurrence
  until: string
}

export interface AddEventFormProps {
  mode: 'add' | 'edit'
  fields: EventFields
  onField: <K extends keyof EventFields>(key: K) => (value: EventFields[K]) => void
  /** Primary first, then by id — the page orders them. One person → no picker. */
  people: PersonOut[]
  error: string | null
  saveState: SaveState
  onSave: () => void
  onCancel: () => void
  /** The date box, so the page can land the caret in it when the form opens. */
  dateRef: RefObject<HTMLInputElement | null>
  titleRef: RefObject<HTMLInputElement | null>
  /** Where the form stands: the shell's detail panel (fluid two-up columns) or the page's card. */
  hosted: 'panel' | 'card'
}

// The add/edit form (2026-09-03 calendar spec §8), lifted out of the page so the SAME element can
// stand in the shared detail panel or in the fallback card (2026-09-13 polish spec §12). It owns no
// state: the fields, the error and every verb are the page's; this is the boxes and two buttons.
export default function AddEventForm({
  mode,
  fields,
  onField,
  people,
  error,
  saveState,
  onSave,
  onCancel,
  dateRef,
  titleRef,
  hosted,
}: AddEventFormProps) {
  const formRef = useRef<HTMLFormElement>(null)
  useEscapeCancel(formRef, onCancel)
  return (
      <form ref={formRef} className={`cal-form${hosted === 'panel' ? ' cal-form-panel' : ''}`} onSubmit={(event) => { event.preventDefault(); onSave() }}>
        <label className="cal-form-field">
          Date
          <input
            type="date"
            ref={dateRef}
            id="cal-event-date"
            className="field-input cal-form-input"
            value={fields.date}
            onChange={(e) => onField('date')(e.target.value)}
          />
        </label>
        <label className="cal-form-field">
          Title
          <input
            className="field-input cal-form-input"
            ref={titleRef}
            id="cal-event-title"
            value={fields.label}
            maxLength={120}
            onChange={(e) => onField('label')(e.target.value)}
          />
        </label>
        <label className="cal-form-field cal-form-note">
          Note (optional)
          <input
            className="field-input cal-form-input"
            value={fields.detail}
            maxLength={300}
            onChange={(e) => onField('detail')(e.target.value)}
          />
        </label>
        {people.length > 1 && (
          <label className="cal-form-field">
            Person
            <select
              className="field-input cal-form-input"
              value={fields.person}
              onChange={(e) => onField('person')(e.target.value)}
            >
              <option value="">Household</option>
              {people.map((person) => (
                <option key={person.id} value={String(person.id)}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="cal-form-field">
          Amount (optional)
          <AmountInput
            kind="money"
            className="cal-form-input"
            value={fields.amount}
            onValueChange={onField('amount')}
            aria-label="Amount (optional)"
            placeholder="$0.00"
          />
        </label>
        <label className="cal-form-field">
          Direction
          <select
            className="field-input cal-form-input"
            value={fields.direction}
            onChange={(e) => onField('direction')(e.target.value as CalendarDirection)}
          >
            <option value="neutral">No direction</option>
            <option value="in">Money in</option>
            <option value="out">Money out</option>
          </select>
        </label>
        <label className="cal-form-field">
          Repeats
          <select
            className="field-input cal-form-input"
            value={fields.recurrence}
            onChange={(e) => onField('recurrence')(e.target.value as CalendarRecurrence)}
          >
            <option value="none">Never</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </label>
        {fields.recurrence !== 'none' && (
          <label className="cal-form-field">
            Until (optional)
            <input
              type="date"
              className="field-input cal-form-input"
              value={fields.until}
              onChange={(e) => onField('until')(e.target.value)}
            />
          </label>
        )}
        <div className="cal-form-actions">
        <FeedBanner error={error} />
        <SaveButton type="submit" className="button button-primary" state={saveState}
          aria-disabled={fields.label.trim() === '' || fields.date === '' || undefined}>
          {mode === 'add' ? 'Save event' : 'Save changes'}
        </SaveButton>
        {error === null && <SaveStatus state={saveState} />}
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
        </div>
      </form>
  )
}
