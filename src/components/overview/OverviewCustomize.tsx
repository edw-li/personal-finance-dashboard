import { useRef, useState } from 'react'
import { DEFAULT_OVERVIEW_LAYOUT, OVERVIEW_CARDS, OVERVIEW_TILES } from '../../prefs/overviewLayout'
import type { OverviewLayout } from '../../prefs/overviewLayout'
import { usePopoverDismiss } from '../usePopoverDismiss'

// Labels mirror the tile and card titles exactly (2026-09-13 polish spec §14): the spending
// card is titled "Recent spending", so its checkbox is too.
const LABELS = { net_worth: 'Net worth', portfolio: 'Portfolio', living_spending: 'Living spending', tax: 'Estimated tax', ytd: 'Year to date', performance: 'Portfolio performance', spending: 'Recent spending', money_flow: 'Money flow' }

// A popover, not a <details> (spec §11): outside pointer and Escape close it, focus returns to
// the button, and it wears the shared .popover-surface (F2's tokens and pop-in motion).
export default function OverviewCustomize({ value, onChange }: { value: OverviewLayout; onChange: (value: OverviewLayout) => void }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const close = () => setOpen(false)
  usePopoverDismiss(open, close, triggerRef, surfaceRef)
  const done = () => { setOpen(false); triggerRef.current?.focus() }
  return <div className="overview-customize">
    <button ref={triggerRef} type="button" className="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((current) => !current)}>Customize</button>
    {open && <div ref={surfaceRef} className="popover-surface overview-customize-menu" role="dialog" aria-label="Customize overview">
      {(['tiles', 'cards'] as const).map(group => <fieldset key={group}><legend>{group === 'tiles' ? 'Summary tiles' : 'Deeper views'}</legend>
        {(group === 'tiles' ? OVERVIEW_TILES : OVERVIEW_CARDS).map(id => {
          const items = value[group] as string[]
          const index = items.indexOf(id)
          const move = (direction: number) => { const next = [...items]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; onChange({ ...value, [group]: next }) }
          return <div className="overview-customize-row" key={id}><label><input type="checkbox" checked={index >= 0} disabled={group === 'tiles' && index >= 0 && items.length === 1}
            onChange={e => onChange({ ...value, [group]: e.target.checked ? [...items, id] : items.filter(item => item !== id) })} />{LABELS[id]}</label>
            <span>{index >= 0 ? index + 1 : 'Hidden'}</span>
            <button type="button" className="button" aria-label={`Move ${LABELS[id]} earlier`} disabled={index <= 0} onClick={() => move(-1)}>↑</button>
            <button type="button" className="button" aria-label={`Move ${LABELS[id]} later`} disabled={index < 0 || index === items.length - 1} onClick={() => move(1)}>↓</button>
          </div>
        })}
      </fieldset>)}
      <div className="overview-customize-actions">
        <button type="button" className="button" onClick={() => onChange(DEFAULT_OVERVIEW_LAYOUT)}>Reset to defaults</button>
        <button type="button" className="button button-primary" onClick={done}>Done</button>
      </div>
    </div>}
  </div>
}
