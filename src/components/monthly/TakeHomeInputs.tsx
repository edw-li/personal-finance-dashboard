import { useId } from 'react'
import type { PersonOut } from '../../types/api'
import AmountInput from '../AmountInput'
import { canonicalAmount, isAmount } from '../../utils/amount'
import { formatCurrency } from '../../utils/format'
import { takeHomeStatus, type TakeHomeAmounts } from './takeHome'

export default function TakeHomeInputs({ people, amounts, total, disabled, onChange, onClearLegacy }: {
  people: PersonOut[]
  amounts: TakeHomeAmounts | undefined
  total: string
  disabled: boolean
  onChange: (amounts: TakeHomeAmounts) => void
  onClearLegacy: () => void
}) {
  const id = useId()
  const legacy = amounts === undefined && total.trim() !== ''
  const state = takeHomeStatus(amounts ?? {}, people.map(person => person.id))
  return <section className="entry-take-home" aria-label="Household take-home">
    <div className="entry-take-home-members">
      {people.map((person, index) => {
        const value = amounts?.[person.id] ?? ''
        const invalid = value.trim() !== '' && (!isAmount(value) || Number(canonicalAmount(value)) < 0)
        return <label key={person.id}>
          {person.name} take-home
          <AmountInput data-paste-ignore value={value} disabled={disabled} autoFocus={index === 0}
            aria-describedby={`${id}-hint`} aria-invalid={invalid || undefined}
            className={invalid ? 'invalid' : undefined}
            placeholder="Enter amount, or 0"
            onValueChange={next => onChange({
              ...Object.fromEntries(people.map(member => [member.id, amounts?.[member.id] ?? ''])),
              [person.id]: next,
            })} />
        </label>
      })}
    </div>
    <div className="entry-take-home-total">
      <span>{legacy ? 'Saved household take-home' : 'Household take-home'}</span>
      <output aria-label="Household take-home total">{total.trim() === '' ? '—' : formatCurrency(total)}</output>
      <small>{legacy ? 'Breakdown not recorded' : 'Calculated from the amounts above'}</small>
    </div>
    <p id={`${id}-hint`} className="drill-hint">
      {legacy ? 'This month has a saved household total. Enter each person’s amount to replace it with a calculated total.'
        : !state.valid ? 'Enter a non-negative amount for each person, including 0 for no take-home, before saving.'
        : 'Enter the take-home each person received this month. Leave everyone blank to skip, or enter 0 for no take-home.'}
      {legacy && <button type="button" className="button" disabled={disabled} onClick={onClearLegacy}>Clear saved take-home</button>}
    </p>
  </section>
}
