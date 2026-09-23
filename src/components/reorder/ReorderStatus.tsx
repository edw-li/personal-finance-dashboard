import '../panels.css'
import { REORDER_INSTRUCTIONS } from './reorderMath'

/** The grips' description (spec §8.2): how to reorder from the keyboard. Visually hidden; each list
 *  renders one and points every grip's aria-describedby at it. Outside the <table> — a <span> is not
 *  a valid child of one. */
export function ReorderInstructions({ id }: { id: string }) {
  return (
    <span id={id} className="visually-hidden">
      {REORDER_INSTRUCTIONS}
    </span>
  )
}

/** The list's live region: lift, move, drop and cancel are spoken as they happen (spec §2.4).
 *  Assertive, because each sentence answers a key the reader just pressed. */
export function ReorderLiveRegion({ text }: { text: string }) {
  return (
    <span className="visually-hidden" aria-live="assertive" aria-atomic="true">
      {text}
    </span>
  )
}
