import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, X } from 'lucide-react'
import { usePopoverDismiss } from '../usePopoverDismiss'
import { useReducedMotion } from '../useReducedMotion'
import { MOTION_MS } from '../../theme/motion'

/** A portal keeps the condition above the scrolling matrix without sizing any table cell. */
export default function RewardCondition({ text, card, category }: { text: string; card: string; category: string }) {
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [phase, setPhase] = useState<'open' | 'closing' | null>(null)
  const reduced = useReducedMotion()
  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }, [])
  const close = useCallback(() => {
    cancelClose()
    if (reduced) { setPhase(null); return }
    setPhase('closing')
    closeTimer.current = setTimeout(() => { setPhase(null); closeTimer.current = null }, MOTION_MS.xfade)
  }, [cancelClose, reduced])
  useEffect(() => cancelClose, [cancelClose])
  usePopoverDismiss(phase === 'open', close, triggerRef, surfaceRef)

  useLayoutEffect(() => {
    if (phase !== 'open') return
    const trigger = triggerRef.current
    const surface = surfaceRef.current
    if (trigger === null || surface === null) return
    const place = () => {
      const anchor = trigger.getBoundingClientRect()
      const box = trigger.closest('.table-scroll')?.getBoundingClientRect()
      if (anchor.bottom < 0 || anchor.top > innerHeight || box && (anchor.right < box.left || anchor.left > box.right || anchor.bottom < box.top || anchor.top > box.bottom)) {
        close()
        return
      }
      const gap = 8
      const width = surface.offsetWidth
      const height = surface.offsetHeight
      const left = Math.max(gap, Math.min(anchor.left - width / 2 + anchor.width / 2, innerWidth - width - gap))
      const below = anchor.bottom + gap + height <= innerHeight - gap || anchor.top < height + gap
      const top = below ? anchor.bottom + gap : anchor.top - height - gap
      surface.style.left = `${left}px`
      surface.style.top = `${Math.max(gap, Math.min(top, innerHeight - height - gap))}px`
      surface.style.transformOrigin = below ? 'top center' : 'bottom center'
    }
    place()
    surface.focus({ preventScroll: true })
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [phase, close, text])

  return <>
    <button ref={triggerRef} type="button" className="reward-condition-trigger"
      aria-label={`Reward condition for ${card} — ${category}`}
      aria-haspopup="dialog" aria-expanded={phase === 'open'} aria-controls={phase === 'open' ? id : undefined}
      onClick={() => {
        if (phase === 'open') close()
        else { cancelClose(); setPhase('open') }
      }}><Plus size={11} aria-hidden="true" /></button>
    {phase !== null && createPortal(
      <div ref={surfaceRef} id={id} className={`reward-condition-popover${phase === 'closing' ? ' is-closing' : ''}`}
        role="dialog" aria-label={`${card} — ${category} reward condition`} aria-describedby={`${id}-text`}
        aria-hidden={phase === 'closing' || undefined} inert={phase === 'closing'} tabIndex={-1}>
        <p id={`${id}-text`}>{text}</p>
        <button type="button" className="reward-condition-close" aria-label="Dismiss reward condition"
          onClick={() => { close(); triggerRef.current?.focus() }}><X size={14} aria-hidden="true" /></button>
      </div>, document.body,
    )}
  </>
}
