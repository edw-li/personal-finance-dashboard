import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { DEFAULT_OVERVIEW_LAYOUT, OVERVIEW_CARDS, OVERVIEW_TILES } from '../../prefs/overviewLayout'
import type { OverviewCard, OverviewLayout, OverviewTile } from '../../prefs/overviewLayout'
import DragHandle from '../reorder/DragHandle'
import { ReorderInstructions, ReorderLiveRegion } from '../reorder/ReorderStatus'
import { useReorder } from '../reorder/useReorder'
import { usePopoverDismiss } from '../usePopoverDismiss'

type View = OverviewTile | OverviewCard

// Labels mirror the tile and card titles exactly (2026-09-13 polish spec §14): the spending
// card is titled "Recent spending", so its checkbox is too.
const LABELS: Record<View, string> = {
  net_worth: 'Net worth',
  portfolio: 'Portfolio',
  living_spending: 'Living spending',
  tax: 'Estimated tax',
  ytd: 'Year to date',
  performance: 'Portfolio performance',
  spending: 'Recent spending',
  money_flow: 'Money flow',
}

const labelOf = (id: View) => LABELS[id]

// One fieldset of the popover (2026-09-23 drag-to-reorder spec §6). The views that show come
// first, in the stored order — each a grip · box · label row the drag moves. Then, only when
// something is hidden, a quiet "Hidden" divider and the rest in default order: box · label, no
// grip. Ticking appends a view to the order; unticking takes it out; a drop is one onChange with
// the new order. The layout is a local preference that applies at once (Reset to defaults is its
// undo), so there is no busy state, no toast and no saved flash — on the other five lists the
// flash means "the server took it", and nothing here waits on a server. Mounted only while the
// popover is open: every opening starts with a fresh drag state, and a popover closed mid-lift
// takes the lift down with it.
function CustomizeGroup<K extends View>({
  legend,
  all,
  visible,
  keepOne,
  onChange,
}: {
  legend: string
  /** Every view of the group, in default order. */
  all: readonly K[]
  /** The views that show, in the stored order. */
  visible: readonly K[]
  /** The summary tiles never go empty: the last one's box is disabled. */
  keepOne: boolean
  onChange: (next: K[]) => void
}) {
  const fieldsetRef = useRef<HTMLFieldSetElement>(null)
  const reorder = useReorder<K>({
    items: visible.map((id) => ({ id })),
    labelOf,
    onCommit: (next) => onChange(next),
  })
  const hidden = all.filter((id) => !visible.includes(id))
  // A tick moves its row across the divider, and React mounts a new box for it there: commit the
  // change now and hand the caret to the new box, or a keyboard reader lands on <body>.
  const toggle = (id: K, show: boolean) => {
    flushSync(() => onChange(show ? [...visible, id] : visible.filter((item) => item !== id)))
    fieldsetRef.current?.querySelector<HTMLInputElement>(`input[value="${id}"]`)?.focus()
  }
  return (
    <fieldset ref={fieldsetRef}>
      <legend>{legend}</legend>
      {/* One pair per list (spec §8.2): this list's grips point at these instructions, and the
          list speaks in its own region. */}
      <ReorderInstructions id={reorder.instructionsId} />
      <ReorderLiveRegion text={reorder.announcement} />
      {visible.map((id) => (
        <div key={id} className="overview-customize-row" {...reorder.itemProps(id)}>
          <DragHandle name={LABELS[id]} {...reorder.handleProps(id)} />
          <label>
            <input type="checkbox" value={id} checked disabled={keepOne && visible.length === 1} onChange={() => toggle(id, false)} />
            {LABELS[id]}
          </label>
        </div>
      ))}
      {hidden.length > 0 && <div className="overview-customize-divider">Hidden</div>}
      {hidden.map((id) => (
        <div key={id} className="overview-customize-row is-off">
          <label>
            <input type="checkbox" value={id} checked={false} onChange={() => toggle(id, true)} />
            {LABELS[id]}
          </label>
        </div>
      ))}
    </fieldset>
  )
}

// A popover, not a <details> (spec §11): outside pointer and Escape close it, focus returns to
// the button, and it wears the shared .popover-surface (F2's tokens and pop-in motion). An Escape
// pressed while a row is lifted never reaches usePopoverDismiss: useReorder takes it on window in
// the capture phase and cancels only the drag (2026-09-23 drag spec §2.3).
export default function OverviewCustomize({ value, onChange }: { value: OverviewLayout; onChange: (value: OverviewLayout) => void }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  // Stable (useCallback): usePopoverDismiss re-subscribes its document listeners on every new
  // identity, and this component re-renders on every layout edit made inside the popover.
  const close = useCallback(() => setOpen(false), [])
  usePopoverDismiss(open, close, triggerRef, surfaceRef)
  // role="dialog" contract: opening moves focus INTO the surface — onto the first control that can
  // take it (a lone summary tile's grip and box are both disabled); Escape, an outside pointer and
  // Done all hand it back to the trigger.
  useEffect(() => {
    if (!open) return
    surfaceRef.current?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)')?.focus()
  }, [open])
  const done = () => { setOpen(false); triggerRef.current?.focus() }
  return <div className="overview-customize">
    <button ref={triggerRef} type="button" className="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((current) => !current)}>Customize</button>
    {open && <div ref={surfaceRef} className="popover-surface overview-customize-menu" role="dialog" aria-label="Customize overview">
      <CustomizeGroup legend="Summary tiles" all={OVERVIEW_TILES} visible={value.tiles} keepOne onChange={(tiles) => onChange({ ...value, tiles })} />
      <CustomizeGroup legend="Deeper views" all={OVERVIEW_CARDS} visible={value.cards} keepOne={false} onChange={(cards) => onChange({ ...value, cards })} />
      <div className="overview-customize-actions">
        <button type="button" className="button" onClick={() => onChange(DEFAULT_OVERVIEW_LAYOUT)}>Reset to defaults</button>
        <button type="button" className="button button-primary" onClick={done}>Done</button>
      </div>
    </div>}
  </div>
}
