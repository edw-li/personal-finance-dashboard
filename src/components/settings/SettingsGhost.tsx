import '../panels.css'
import './settings.css'

/** What a settings card is tall before its body lands, at comfortable density: the card's padding
 *  (1.1rem + 1.25rem) plus the eyebrow row with its (i) and 0.75rem margin — about 68px. A card
 *  that shows more above its body (the Limits year chips) adds that to `chrome`. */
export const SETTINGS_CARD_CHROME_PX = 68

// The loading state of a lazily loaded settings card (2026-09-13 polish spec §9): one pulsing
// block as tall as the card's LOADED body, in the slot the centred "Loading…" sentence used to
// hold, so a tab click lands on a stable layout instead of cards that grow by 200–1100px as their
// fetches answer (audit S-5). Appears at once — no .loading-fallback delay: a 350px void inside a
// card reads as broken, and the acceptance walk wants the ghost within 100ms of the click.
// Screen readers get the same sentence the old fallback carried; the block itself is decoration.
export default function SettingsGhost({
  height,
  chrome = SETTINGS_CARD_CHROME_PX,
  label = 'Loading…',
}: {
  /** The card's height once loaded (spec §9's per-card figures), NOT the block's. */
  height: number
  /** Card chrome already on screen above the body; subtracted so the card stands at `height`. */
  chrome?: number
  label?: string
}) {
  return (
    <>
      <p className="visually-hidden" role="status">
        {label}
      </p>
      <div
        className="skeleton settings-ghost"
        aria-hidden="true"
        data-ghost-height={height}
        style={{ height: Math.max(48, height - chrome) }}
      />
    </>
  )
}
