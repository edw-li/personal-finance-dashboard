import { Info } from 'lucide-react'
import './panels.css'

// The ⓘ beside titles and tile labels (2026-08-20 user request): a focusable button so
// keyboard and touch reach the bubble, aria-label so screen readers hear the same words
// the CSS ::after renders from data-tip. Click does nothing — hover/focus IS the
// affordance, and a button that navigated would make every title a mystery link.
export default function InfoHint({ text }: { text: string }) {
  return (
    <button type="button" className="info-hint" aria-label={text} data-tip={text}>
      <Info size={13} aria-hidden="true" />
    </button>
  )
}
