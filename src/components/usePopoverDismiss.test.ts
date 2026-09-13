import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement, useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePopoverDismiss } from './usePopoverDismiss'

const onClose = vi.fn()
afterEach(() => { cleanup(); onClose.mockClear() })

// The shape every caller has: a trigger that toggles, a surface with controls, and page content
// beside them. jsdom has no PointerEvent, so fireEvent.pointerDown falls back to a plain Event
// named `pointerdown` — which is exactly what the document listener hears in a browser too.
function Harness({ initiallyOpen = true }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  usePopoverDismiss(open, () => { onClose(); setOpen(false) }, triggerRef, surfaceRef)
  return createElement(
    'div',
    null,
    // react-hooks/refs reads `createElement(type, props)` as "a ref handed to a function"; the
    // JSX form the rule allows is not available in a .ts harness, and nothing reads the refs
    // during render — React attaches them after the commit, as always.
    // eslint-disable-next-line react-hooks/refs
    createElement('button', { ref: triggerRef, type: 'button', 'aria-expanded': open, onClick: () => setOpen((v) => !v) }, 'Customize'),
    // eslint-disable-next-line react-hooks/refs
    open ? createElement('div', { ref: surfaceRef, role: 'dialog', 'aria-label': 'Customize overview' }, createElement('button', { type: 'button' }, 'Done')) : null,
    createElement('p', null, 'elsewhere'),
  )
}

describe('usePopoverDismiss', () => {
  it('closes on a pointerdown outside the surface and its trigger', () => {
    render(createElement(Harness))
    fireEvent.pointerDown(screen.getByText('elsewhere'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('ignores pointerdowns inside the surface and on the trigger', () => {
    render(createElement(Harness))
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Done' }))
    // The trigger runs its own toggle on click; a close here would make that click re-open.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Customize' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('closes on Escape, refocuses the trigger and marks the event handled', () => {
    render(createElement(Harness))
    const trigger = screen.getByRole('button', { name: 'Customize' })
    // fireEvent returns false when a listener called preventDefault — the signal
    // DetailPanelProvider's own Escape handler yields to.
    expect(fireEvent.keyDown(document.body, { key: 'Escape' })).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(trigger)
  })

  it('leaves an Escape a nearer handler already claimed alone', () => {
    render(createElement(Harness))
    window.addEventListener('keydown', (event) => event.preventDefault(), { capture: true, once: true })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('listens only while open', () => {
    render(createElement(Harness, { initiallyOpen: false }))
    fireEvent.pointerDown(screen.getByText('elsewhere'))
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
})
