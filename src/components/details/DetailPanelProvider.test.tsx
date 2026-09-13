import { act, cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DetailPanelProvider, { defaultPanelWidth, MODE_STORAGE_KEY, panelGeometry, useDetailPanel, WIDTH_STORAGE_KEY } from './DetailPanelProvider'
import { MOTION_MS } from '../../theme/motion'

function Harness() {
  const panel = useDetailPanel()!
  return <button type="button" onClick={() => panel.open({ id: 'chart', title: 'August spending', content: <>
    <p>Selected month retained</p>
    <button type="button" onClick={() => panel.open({ id: 'metric', title: 'Living spending', content: <p>Source receipt</p> })}>Open calculation</button>
  </> })}>Inspect month</button>
}

/** The assistant's shape (spec §4): a request that must not take the page hostage in overlay mode. */
function NonModalHarness() {
  const panel = useDetailPanel()!
  return <button type="button" onClick={() => panel.open({ id: 'assistant', title: 'Assistant', content: <p>Chat</p>, modal: false })}>Open assistant</button>
}

const setViewport = (width: number) => Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })

type PointerHost = { PointerEvent?: typeof PointerEvent }
/** jsdom ships no PointerEvent, and Testing Library then falls back to a bare Event that carries no
 *  clientX/button — the resizer reads both. A MouseEvent subclass on the DOCUMENT's window (the
 *  constructor Testing Library resolves through node.ownerDocument.defaultView) is enough. */
function withPointerEvents(run: () => void) {
  const view = document.defaultView as unknown as PointerHost
  const original = view.PointerEvent
  view.PointerEvent = class FakePointerEvent extends MouseEvent { pointerId = 1 } as unknown as typeof PointerEvent
  try {
    run()
  } finally {
    if (original === undefined) delete view.PointerEvent
    else view.PointerEvent = original
  }
}

/** jsdom has no Web Animations; the provider reads `typeof el.animate` as "this engine runs CSS
 *  animations" and only then keeps an exit ghost. Stubbing it opts a test in. */
function withAnimations(run: () => void) {
  Object.defineProperty(HTMLElement.prototype, 'animate', { value: () => ({}), configurable: true, writable: true })
  try {
    run()
  } finally {
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate
  }
}

beforeEach(() => setViewport(1600))
// The provider persists mode and width; a test that switched to overlay must not leak into the next.
afterEach(() => { cleanup(); localStorage.clear() })

describe('coordinated detail panels', () => {
  it('replaces a surface with its evidence; Back returns to the selection; Escape pops one level, then closes', () => {
    render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
    const trigger = screen.getByRole('button', { name: 'Inspect month' })
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: 'August spending' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open calculation' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByText('Source receipt')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to August spending' }))
    expect(screen.getByText('Selected month retained')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open calculation' }))
    // Design §5.1: Escape dismisses the TOPMOST surface. The old assertion pinned whole-stack close
    // (audit F1: a reader who opened evidence from a conversation lost the conversation).
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'August spending' })).toBeTruthy()
    expect(screen.getByText('Selected month retained')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('resizes by keyboard and reserves page space only in dock mode', () => {
    render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Inspect month' }))
    const separator = screen.getByRole('separator', { name: 'Resize detail panel' })
    // clamp(400px, 26vw, 560px) at 1600 → 416 (spec §4), no longer a fixed 440.
    expect(separator.getAttribute('aria-valuenow')).toBe('416')
    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    expect(separator.getAttribute('aria-valuenow')).toBe('436')
    expect((document.querySelector('.detail-layout-content') as HTMLElement).style.marginInlineEnd).toBe('436px')
    fireEvent.click(screen.getByRole('button', { name: 'Over the page' }))
    expect((document.querySelector('.detail-layout-content') as HTMLElement).style.marginInlineEnd).toBe('0')
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Reading mode' }))
    expect(screen.getByRole('dialog').className).toContain('detail-panel-expanded')
    expect(screen.getByText('Selected month retained')).toBeTruthy()
    // Reading mode is a toggle: pressed again it returns to the mode it came from, and relabels.
    expect(screen.getByRole('button', { name: 'Exit reading mode' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Exit reading mode' }))
    expect(screen.getByRole('dialog').className).toContain('detail-panel-overlay')
  })

  it('falls back to overlay when a dock would crowd the main content; the default width follows the viewport', () => {
    expect(panelGeometry(1200, 440, 'dock')).toMatchObject({ canDock: false, mode: 'overlay', width: 440 })
    expect(panelGeometry(1600, 900, 'dock')).toMatchObject({ canDock: true, mode: 'dock', width: 670 })
    expect(defaultPanelWidth(1200)).toBe(400) // 26vw = 312 → the 400px floor
    expect(defaultPanelWidth(1600)).toBe(416)
    expect(defaultPanelWidth(2400)).toBe(560) // 26vw = 624 → the 560px ceiling
  })

  it('restores focus only after an overlay releases the inert page', () => {
    render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
    const trigger = screen.getByRole('button', { name: 'Inspect month' })
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Over the page' }))
    const content = document.querySelector('.detail-layout-content')!
    expect(content.hasAttribute('inert')).toBe(true)
    const focusedWhileInert: boolean[] = []
    const originalFocus = trigger.focus.bind(trigger)
    const focus = vi.spyOn(trigger, 'focus').mockImplementation((options) => {
      focusedWhileInert.push(content.hasAttribute('inert'))
      originalFocus(options)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    expect(focusedWhileInert).toEqual([false])
    expect(document.activeElement).toBe(trigger)
    focus.mockRestore()
  })

  it('one chrome row: icon Back/Close, an icon mode control with tooltips, content before controls in the tab order', () => {
    render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Inspect month' }))
    const dialog = screen.getByRole('dialog', { name: 'August spending' })
    expect(dialog.querySelector('.detail-panel-toolbar')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Dock' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Expand reading' })).toBeNull()
    const layout = screen.getByRole('group', { name: 'Detail panel layout' })
    expect(within(layout).getAllByRole('button').map((button) => button.getAttribute('title'))).toEqual(['Beside the page', 'Over the page', 'Reading mode'])
    expect(screen.getByRole('button', { name: 'Beside the page' }).getAttribute('aria-pressed')).toBe('true')
    const close = screen.getByRole('button', { name: 'Close details' })
    expect(close.className).toBe('detail-panel-icon-button')
    expect(close.textContent).toBe('') // an icon, not the word
    // DOM order IS focus order (audit F2 measured five chrome stops before the content).
    const stops = Array.from(dialog.querySelectorAll<HTMLElement>('button, [tabindex="0"]'))
      .map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim())
    expect(stops).toEqual(['Open calculation', 'Beside the page', 'Over the page', 'Reading mode', 'Close details', 'Resize detail panel'])
    fireEvent.click(screen.getByRole('button', { name: 'Open calculation' }))
    const back = screen.getByRole('button', { name: 'Back to August spending' })
    expect(back.className).toBe('detail-panel-icon-button')
    expect(back.getAttribute('title')).toBe('Back to August spending')
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })

  it('a non-modal request leaves the page live: no backdrop, no aria-modal, no inert, no Tab trap; Escape still closes', () => {
    setViewport(1200) // no room to dock → overlay, where a modal request would take the page hostage
    render(<DetailPanelProvider><NonModalHarness /></DetailPanelProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Open assistant' }))
    const dialog = screen.getByRole('dialog', { name: 'Assistant' })
    expect(dialog.className).toContain('detail-panel-overlay')
    expect(dialog.getAttribute('aria-modal')).toBeNull()
    expect(document.querySelector('.detail-panel-backdrop')).toBeNull()
    expect(document.querySelector('.detail-layout-content')!.hasAttribute('inert')).toBe(false)
    // The disabled Dock option explains itself.
    const dock = screen.getByRole('button', { name: 'Beside the page' })
    expect(dock.hasAttribute('disabled')).toBe(true)
    expect(dock.getAttribute('title')).toBe('Widen the window to keep at least 720 pixels of page content beside details.')
    // Tab from the panel's last stop is NOT wrapped back into it.
    screen.getByRole('separator', { name: 'Resize detail panel' }).focus()
    const tab = createEvent.keyDown(document, { key: 'Tab' })
    fireEvent(document, tab)
    expect(tab.defaultPrevented).toBe(false)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a modal overlay still traps Tab inside the panel', () => {
    setViewport(1200)
    render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Inspect month' }))
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true')
    screen.getByRole('separator', { name: 'Resize detail panel' }).focus()
    const tab = createEvent.keyDown(document, { key: 'Tab' })
    fireEvent(document, tab)
    expect(tab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open calculation' }))
  })

  it('remembers the layout mode and the dragged width across mounts — localStorage, not the server', () => {
    const first = render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Inspect month' }))
    // Untouched controls persist nothing: the default keeps following the viewport.
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(WIDTH_STORAGE_KEY)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Over the page' }))
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize detail panel' }), { key: 'ArrowLeft' })
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('overlay')
    expect(localStorage.getItem(WIDTH_STORAGE_KEY)).toBe('436')
    first.unmount()
    render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Inspect month' }))
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true')
    expect(screen.getByRole('button', { name: 'Over the page' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('separator', { name: 'Resize detail panel' }).getAttribute('aria-valuenow')).toBe('436')
  })

  it('publishes the dock width on <html> for the assistant launcher, and 0px away from the dock', () => {
    render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
    expect(document.documentElement.style.getPropertyValue('--dock-width')).toBe('0px')
    fireEvent.click(screen.getByRole('button', { name: 'Inspect month' }))
    expect(document.documentElement.style.getPropertyValue('--dock-width')).toBe('416px')
    fireEvent.click(screen.getByRole('button', { name: 'Over the page' }))
    expect(document.documentElement.style.getPropertyValue('--dock-width')).toBe('0px')
    fireEvent.click(screen.getByRole('button', { name: 'Beside the page' }))
    expect(document.documentElement.style.getPropertyValue('--dock-width')).toBe('416px')
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    expect(document.documentElement.style.getPropertyValue('--dock-width')).toBe('0px')
  })

  it('flags the layout while the resizer has the pointer, tracks the drag, and stores the result', () => {
    withPointerEvents(() => {
      render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
      fireEvent.click(screen.getByRole('button', { name: 'Inspect month' }))
      const separator = screen.getByRole('separator', { name: 'Resize detail panel' })
      const content = document.querySelector('.detail-layout-content') as HTMLElement
      fireEvent.pointerDown(separator, { button: 0, clientX: 800 })
      expect(content.classList.contains('is-dragging')).toBe(true)
      expect(document.querySelector('.detail-panel-layer')?.classList.contains('is-dragging')).toBe(true)
      fireEvent.pointerMove(separator, { clientX: 780 })
      expect(separator.getAttribute('aria-valuenow')).toBe('436')
      fireEvent.pointerUp(separator, {})
      expect(content.classList.contains('is-dragging')).toBe(false)
      expect(document.querySelector('.detail-panel-layer')?.classList.contains('is-dragging')).toBe(false)
      expect(localStorage.getItem(WIDTH_STORAGE_KEY)).toBe('436')
    })
  })
  it('keeps the closing panel painted as an inert ghost until its exit animation ends', () => {
    withAnimations(() => {
      render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
      const trigger = screen.getByRole('button', { name: 'Inspect month' })
      trigger.focus()
      fireEvent.click(trigger)
      fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
      // For assistive tech, focus and the launcher the surface is already gone…
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(document.activeElement).toBe(trigger)
      expect(document.documentElement.style.getPropertyValue('--dock-width')).toBe('0px')
      // …while the ghost fades out with the last content still in it (spec §2.2).
      const ghost = document.querySelector('.detail-panel.is-leaving') as HTMLElement
      expect(ghost).toBeTruthy()
      expect(ghost.className).toContain('detail-panel-dock')
      expect(ghost.hasAttribute('inert')).toBe(true)
      expect(ghost.getAttribute('role')).toBeNull()
      expect(ghost.closest('.detail-panel-layer')?.getAttribute('aria-hidden')).toBe('true')
      expect(ghost.textContent).toContain('Selected month retained')
      fireEvent.animationEnd(ghost)
      expect(document.querySelector('.detail-panel')).toBeNull()
    })
  })

  it('unmounts the ghost on the fallback timer when no animationend ever arrives (reduced motion)', () => {
    vi.useFakeTimers()
    try {
      withAnimations(() => {
        render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
        fireEvent.click(screen.getByRole('button', { name: 'Inspect month' }))
        fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
        expect(document.querySelector('.detail-panel.is-leaving')).toBeTruthy()
        act(() => { vi.advanceTimersByTime(MOTION_MS.fast + 49) })
        expect(document.querySelector('.detail-panel.is-leaving')).toBeTruthy()
        act(() => { vi.advanceTimersByTime(1) })
        expect(document.querySelector('.detail-panel')).toBeNull()
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('a surface opened during the exit beat replaces the ghost instead of stacking under it', () => {
    withAnimations(() => {
      render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
      fireEvent.click(screen.getByRole('button', { name: 'Inspect month' }))
      fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
      expect(document.querySelector('.detail-panel.is-leaving')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Inspect month' }))
      expect(document.querySelectorAll('.detail-panel')).toHaveLength(1)
      expect(document.querySelector('.detail-panel.is-leaving')).toBeNull()
      expect(screen.getByRole('dialog', { name: 'August spending' })).toBeTruthy()
    })
  })

  it('the ghost keeps the box model it was closed from', () => {
    withAnimations(() => {
      render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
      fireEvent.click(screen.getByRole('button', { name: 'Inspect month' }))
      fireEvent.click(screen.getByRole('button', { name: 'Reading mode' }))
      fireEvent.keyDown(document, { key: 'Escape' })
      const ghost = document.querySelector('.detail-panel.is-leaving') as HTMLElement
      expect(ghost.className).toContain('detail-panel-expanded')
      // No backdrop lingers behind a ghost: the page is live the moment the stack empties.
      expect(document.querySelector('.detail-panel-backdrop')).toBeNull()
      expect(document.querySelector('.detail-layout-content')!.hasAttribute('inert')).toBe(false)
      fireEvent.animationEnd(ghost)
      expect(document.querySelector('.detail-panel')).toBeNull()
    })
  })
  it('closes instantly under reduce — no opaque ghost over the reflowed page', () => {
    // The motion block is gated on no-preference, so under reduce there is no detail-panel-out to
    // fade: an inert ghost would just sit there opaque for the fallback timer's ~170ms.
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    try {
      withAnimations(() => {
        render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
        fireEvent.click(screen.getByRole('button', { name: 'Inspect month' }))
        fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
        expect(document.querySelector('.detail-panel')).toBeNull()
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
