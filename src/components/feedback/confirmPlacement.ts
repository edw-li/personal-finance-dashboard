/** Viewport px between the popover and its anchor, and the least room kept to the window's edges. */
export const CONFIRM_GAP_PX = 6
export const CONFIRM_MARGIN_PX = 8

export interface ConfirmSpot {
  top: number
  left: number
  placement: 'below' | 'above'
}

/**
 * Where the confirm popover stands (2026-09-25 polish spec §6.3; contract C3), in viewport px for
 * `position: fixed`: below its anchor with the right edges aligned — it opens toward the page, as a
 * control at the page's right edge must (panels.css's popover note) — flipped above when it would
 * cross the window's foot and there is more room above, and kept inside the window both ways: in a
 * window too short for either side it rises (or drops) until it stands whole, and a window shorter
 * than the popover pins it to the top margin. Pure, so the rule is tested without a layout engine.
 */
export function placeConfirm(
  anchor: Pick<DOMRect, 'top' | 'bottom' | 'right'>,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): ConfirmSpot {
  const roomBelow = viewport.height - CONFIRM_MARGIN_PX - (anchor.bottom + CONFIRM_GAP_PX)
  const roomAbove = anchor.top - CONFIRM_GAP_PX - CONFIRM_MARGIN_PX
  const placement = size.height <= roomBelow || roomBelow >= roomAbove ? 'below' : 'above'
  const beside = placement === 'below' ? anchor.bottom + CONFIRM_GAP_PX : anchor.top - CONFIRM_GAP_PX - size.height
  const top = Math.max(
    CONFIRM_MARGIN_PX,
    Math.min(beside, viewport.height - CONFIRM_MARGIN_PX - size.height),
  )
  const left = Math.max(
    CONFIRM_MARGIN_PX,
    Math.min(anchor.right - size.width, viewport.width - CONFIRM_MARGIN_PX - size.width),
  )
  return { top, left, placement }
}
