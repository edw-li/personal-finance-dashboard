import { useEffect, type RefObject } from 'react'

// One dismissal contract for every anchored popover (2026-09-13 polish §11 — the pattern
// ChartExportMenu hand-rolled): a pointerdown outside BOTH the surface and its trigger closes,
// Escape closes and hands focus back to the trigger, and nothing is listening while the popover is
// shut. Escape is caught in the CAPTURE phase on document: DetailPanelProvider's own Escape handler
// is a bubble-phase document listener registered long before any page popover mounts, and it yields
// only to an event that is already defaultPrevented — capture is what puts this handler in front of
// it regardless of mount order. The trigger is exempt from "outside" so a click on it while open
// runs the caller's own toggle once, instead of a close here and a re-open there.
export function usePopoverDismiss(
  open: boolean,
  onClose: () => void,
  triggerRef: RefObject<HTMLElement | null>,
  surfaceRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: Event) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (surfaceRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      onClose()
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open, onClose, triggerRef, surfaceRef])
}
