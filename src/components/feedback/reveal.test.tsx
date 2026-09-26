import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MOTION_MS } from '../../theme/motion'
import { flashElement, revealEditor, revealRow, useEscapeCancel } from './reveal'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

function rect(top: number, height: number): DOMRect {
  return { top, height, bottom: top + height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) } as DOMRect
}

/** jsdom lays nothing out: a box's scroll geometry is written on it by hand (reorderDom.test.ts's setBox). */
function setBox(element: HTMLElement, box: { scrollHeight?: number; clientHeight?: number; scrollTop?: number }) {
  for (const [key, value] of Object.entries(box)) {
    Object.defineProperty(element, key, { value, writable: true, configurable: true })
  }
}

function Editor({ margin }: { margin?: string }) {
  return (
    <form data-testid="form" style={margin === undefined ? undefined : { scrollMarginTop: margin }}>
      <input type="hidden" name="id" defaultValue="7" />
      <input aria-label="Name" defaultValue="Housing" />
      <select aria-label="Kind" defaultValue="living">
        <option value="living">living</option>
      </select>
    </form>
  )
}

describe('revealEditor', () => {
  it('scrolls the form to its nearest edge, smoothly, then focuses and selects its first field', () => {
    render(<Editor />)
    const form = screen.getByTestId('form')
    const scroll = vi.fn()
    form.scrollIntoView = scroll
    const name = screen.getByLabelText('Name') as HTMLInputElement
    const focus = vi.spyOn(name, 'focus')
    const select = vi.spyOn(name, 'select')
    revealEditor(form)
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' })
    // The hidden id input is skipped, and the caret lands without a second scroll.
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(select).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(name)
  })

  it('scrolls at once under reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    render(<Editor />)
    const form = screen.getByTestId('form')
    const scroll = vi.fn()
    form.scrollIntoView = scroll
    revealEditor(form)
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', behavior: 'instant' })
  })

  it('focuses the named field instead; a select takes the focus with nothing to select', () => {
    render(<Editor />)
    const form = screen.getByTestId('form')
    form.scrollIntoView = vi.fn()
    revealEditor(form, 'select')
    expect(document.activeElement).toBe(screen.getByLabelText('Kind'))
  })

  it('lends a margin-less form the sticky-row band for the one scroll, then hands it back', () => {
    render(<Editor />)
    const form = screen.getByTestId('form')
    let during = ''
    form.scrollIntoView = vi.fn(() => {
      during = form.style.scrollMarginTop
    })
    revealEditor(form)
    expect(during).toBe('calc(var(--sticky-inset, 0px) + 0.75rem)')
    expect(form.style.scrollMarginTop).toBe('')
  })

  it("keeps a form's own scroll margin", () => {
    render(<Editor margin="40px" />)
    const form = screen.getByTestId('form')
    let during = ''
    form.scrollIntoView = vi.fn(() => {
      during = form.style.scrollMarginTop
    })
    revealEditor(form)
    expect(during).toBe('40px')
  })

  it('asks nothing of a missing form, or of one with no field', () => {
    expect(() => revealEditor(null)).not.toThrow()
    render(<div data-testid="empty" />)
    const empty = screen.getByTestId('empty')
    empty.scrollIntoView = vi.fn()
    expect(() => revealEditor(empty)).not.toThrow()
  })
})

describe('revealRow', () => {
  it('scrolls a row with no scrolling ancestor to the nearest edge of the page', () => {
    document.body.innerHTML = '<ul><li id="row">x</li></ul>'
    const row = document.getElementById('row') as HTMLElement
    row.scrollIntoView = vi.fn()
    revealRow(row)
    expect(row.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('scrolls a capped TableScroll box — never the page — to show the row under its pinned header', () => {
    document.body.innerHTML =
      '<div id="box" class="table-scroll" style="overflow-y: auto"><table><thead><tr><th>Name</th></tr></thead>' +
      '<tbody><tr id="row"><td>x</td></tr></tbody></table></div>'
    const box = document.getElementById('box') as HTMLElement
    const row = document.getElementById('row') as HTMLElement
    box.style.setProperty('--table-head-h', '30px')
    setBox(box, { scrollHeight: 1000, clientHeight: 300, scrollTop: 0 })
    box.getBoundingClientRect = () => rect(100, 300)
    row.getBoundingClientRect = () => rect(450, 30) // 80px past the box's foot at 400
    row.scrollIntoView = vi.fn()
    revealRow(row)
    expect(box.scrollTop).toBe(80)
    expect(row.scrollIntoView).not.toHaveBeenCalled()
  })

  it('scrolls an older cap (.settings-scroll) just clear of its edge', () => {
    document.body.innerHTML =
      '<div id="box" class="settings-scroll" style="overflow-y: auto"><table><tbody><tr id="row"><td>x</td></tr></tbody></table></div>'
    const box = document.getElementById('box') as HTMLElement
    const row = document.getElementById('row') as HTMLElement
    setBox(box, { scrollHeight: 900, clientHeight: 400, scrollTop: 0 })
    box.getBoundingClientRect = () => rect(100, 400)
    row.getBoundingClientRect = () => rect(560, 30) // list y 460..490, past 400 − the 4px margin
    revealRow(row)
    expect(box.scrollTop).toBe(94)
  })

  it('leaves alone a row that has left the tree, and a missing one', () => {
    const row = document.createElement('li')
    row.scrollIntoView = vi.fn()
    revealRow(row)
    revealRow(null)
    expect(row.scrollIntoView).not.toHaveBeenCalled()
  })
})

describe('flashElement', () => {
  it('marks the element for MOTION_MS.flash — the wash and its timer read one token', () => {
    vi.useFakeTimers()
    const el = document.createElement('tr')
    flashElement(el)
    expect(el.hasAttribute('data-flash')).toBe(true)
    vi.advanceTimersByTime(MOTION_MS.flash - 1)
    expect(el.hasAttribute('data-flash')).toBe(true)
    vi.advanceTimersByTime(1)
    expect(el.hasAttribute('data-flash')).toBe(false)
  })

  it('restarts on a second flash rather than ending with the first', () => {
    vi.useFakeTimers()
    const el = document.createElement('li')
    flashElement(el)
    vi.advanceTimersByTime(MOTION_MS.flash - 100)
    flashElement(el)
    vi.advanceTimersByTime(100)
    expect(el.hasAttribute('data-flash')).toBe(true) // the first timer no longer ends it
    vi.advanceTimersByTime(MOTION_MS.flash - 100)
    expect(el.hasAttribute('data-flash')).toBe(false)
  })

  it('ignores a missing element', () => {
    expect(() => flashElement(null)).not.toThrow()
  })
})

describe('useEscapeCancel', () => {
  function Form({ onCancel, enabled }: { onCancel: () => void; enabled?: boolean }) {
    const ref = useRef<HTMLFormElement>(null)
    useEscapeCancel(ref, onCancel, enabled)
    return (
      <>
        <form ref={ref}>
          <input aria-label="Amount" />
        </form>
        <input aria-label="Elsewhere" />
      </>
    )
  }

  it('cancels on an Escape inside the form, and claims the key', () => {
    const onCancel = vi.fn()
    render(<Form onCancel={onCancel} />)
    // fireEvent answers false when a listener called preventDefault — what the detail panel's own
    // Escape handler yields to.
    expect(fireEvent.keyDown(screen.getByLabelText('Amount'), { key: 'Escape' })).toBe(false)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('leaves an Escape outside the form alone, and every other key', () => {
    const onCancel = vi.fn()
    render(<Form onCancel={onCancel} />)
    fireEvent.keyDown(screen.getByLabelText('Elsewhere'), { key: 'Escape' })
    fireEvent.keyDown(screen.getByLabelText('Amount'), { key: 'Enter' })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('yields to an inner popover that already claimed the Escape', () => {
    const onCancel = vi.fn()
    render(<Form onCancel={onCancel} />)
    // usePopoverDismiss's capture-phase listener, as a popover open inside the form registers it.
    document.addEventListener('keydown', (event) => event.preventDefault(), { capture: true, once: true })
    fireEvent.keyDown(screen.getByLabelText('Amount'), { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('stays quiet while disabled, and while an IME composes', () => {
    const onCancel = vi.fn()
    const { rerender } = render(<Form onCancel={onCancel} enabled={false} />)
    fireEvent.keyDown(screen.getByLabelText('Amount'), { key: 'Escape' })
    rerender(<Form onCancel={onCancel} />)
    fireEvent.keyDown(screen.getByLabelText('Amount'), { key: 'Escape', isComposing: true })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('calls the latest onCancel, not the one it first saw', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<Form onCancel={first} />)
    rerender(<Form onCancel={second} />)
    fireEvent.keyDown(screen.getByLabelText('Amount'), { key: 'Escape' })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
