import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import type { FormEvent } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BusyButton from './BusyButton'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** jsdom lays nothing out: the button stands `idle` px wide at rest and `busy` px wide with its spinner in. */
function widths(idle: number, busy: number): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const width = this.getAttribute('aria-busy') === 'true' ? busy : idle
    return { width, height: 32, top: 0, bottom: 32, left: 0, right: width, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  })
}

/** A `.button`'s row and its 0.9rem sides, as jsdom hands inline longhands back through getComputedStyle. */
const PADDING = { display: 'inline-flex', paddingLeft: '14px', paddingRight: '14px' }

describe('BusyButton', () => {
  it('never sets the native disabled attribute — busy, inert, aria-disabled and disabled all go quiet instead', () => {
    for (const props of [{ busy: true }, { inert: true }, { 'aria-disabled': true }, { disabled: true }]) {
      const { unmount } = render(<BusyButton {...props}>Save</BusyButton>)
      const button = screen.getByRole('button', { name: 'Save' })
      expect(button.hasAttribute('disabled')).toBe(false)
      expect(button.getAttribute('aria-disabled')).toBe('true')
      unmount()
    }
  })

  it('is plain when nothing is in flight: no aria-disabled, no aria-busy, no spinner', () => {
    render(<BusyButton className="button">Save</BusyButton>)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button.hasAttribute('aria-disabled')).toBe(false)
    expect(button.hasAttribute('aria-busy')).toBe(false)
    expect(button.querySelector('.busy-spinner')).toBeNull()
    expect(button.className).toBe('button busy-button')
  })

  it('busy: a spinner before the unchanged label, aria-busy, and the busy label when one is given', () => {
    const { rerender } = render(<BusyButton busy>Save</BusyButton>)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button.getAttribute('aria-busy')).toBe('true')
    const spinner = button.firstElementChild as HTMLElement
    expect(spinner.className).toBe('busy-spinner')
    expect(spinner.getAttribute('aria-hidden')).toBe('true')
    rerender(
      <BusyButton busy busyLabel="Saving…">
        Save
      </BusyButton>,
    )
    expect(button.textContent).toBe('Saving…')
    rerender(<BusyButton busyLabel="Saving…">Save</BusyButton>)
    expect(button.textContent).toBe('Save')
  })

  it('inert: quiet with its label unchanged — and never the HTML inert attribute, which would drop focus', () => {
    render(<BusyButton inert>Delete</BusyButton>)
    const button = screen.getByRole('button', { name: 'Delete' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.hasAttribute('aria-busy')).toBe(false)
    expect(button.hasAttribute('inert')).toBe(false)
    expect(button.textContent).toBe('Delete')
  })

  it('swallows a click while quiet: no handler, no default action, no bubbling to a clickable row', () => {
    const onClick = vi.fn()
    const onRow = vi.fn()
    render(
      <div onClick={onRow}>
        <BusyButton busy onClick={onClick}>
          Save
        </BusyButton>
      </div>,
    )
    expect(fireEvent.click(screen.getByRole('button', { name: 'Save' }))).toBe(false)
    expect(onClick).not.toHaveBeenCalled()
    expect(onRow).not.toHaveBeenCalled()
  })

  it('swallows a submit while quiet, and submits once it is not', () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault())
    const { rerender } = render(
      <form onSubmit={onSubmit}>
        <BusyButton type="submit" inert>
          Save
        </BusyButton>
      </form>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).not.toHaveBeenCalled()
    rerender(
      <form onSubmit={onSubmit}>
        <BusyButton type="submit">Save</BusyButton>
      </form>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('passes a click through when it is not quiet', () => {
    const onClick = vi.fn()
    render(<BusyButton onClick={onClick}>Save</BusyButton>)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('keeps the focus through a busy cycle — it is never disabled out from under the caret', () => {
    const { rerender } = render(<BusyButton>Save</BusyButton>)
    const button = screen.getByRole('button', { name: 'Save' })
    button.focus()
    rerender(
      <BusyButton busy busyLabel="Saving…">
        Save
      </BusyButton>,
    )
    expect(document.activeElement).toBe(button)
    rerender(<BusyButton>Save</BusyButton>)
    expect(document.activeElement).toBe(button)
  })

  it('locks min-width to the idle width while busy, and lets go after', () => {
    widths(88, 88)
    const { rerender } = render(<BusyButton>Save progress</BusyButton>)
    const button = screen.getByRole('button', { name: 'Save progress' })
    expect(button.style.minWidth).toBe('')
    rerender(
      <BusyButton busy busyLabel="Saving…">
        Save progress
      </BusyButton>,
    )
    expect(button.style.minWidth).toBe('88px')
    rerender(<BusyButton>Save progress</BusyButton>)
    expect(button.style.minWidth).toBe('')
  })

  it("holds the idle width to the pixel when the spinner fits the button's padding", () => {
    widths(59, 76) // the spinner and its gap add 17px: 8.5px a side, inside 14px paddings
    const { rerender } = render(<BusyButton style={PADDING}>Save</BusyButton>)
    const button = screen.getByRole('button', { name: 'Save' })
    rerender(
      <BusyButton style={PADDING} busy>
        Save
      </BusyButton>,
    )
    expect(button.style.minWidth).toBe('59px')
    expect(button.style.maxWidth).toBe('59px')
    rerender(<BusyButton style={PADDING}>Save</BusyButton>)
    expect(button.style.maxWidth).toBe('')
  })

  it('holds only the min-width on a button that is not a flex row — its spill could not be centred', () => {
    widths(59, 76)
    const plain = { paddingLeft: '14px', paddingRight: '14px' } // a bare <button>: inline-block
    const { rerender } = render(<BusyButton style={plain}>Save</BusyButton>)
    const button = screen.getByRole('button', { name: 'Save' })
    rerender(
      <BusyButton style={plain} busy>
        Save
      </BusyButton>,
    )
    expect(button.style.minWidth).toBe('59px')
    expect(button.style.maxWidth).toBe('')
  })

  it('grows rather than clip when the busy content will not fit the padding', () => {
    widths(59, 100) // a longer busy label: 20.5px a side
    const { rerender } = render(<BusyButton style={PADDING}>Save</BusyButton>)
    const button = screen.getByRole('button', { name: 'Save' })
    rerender(
      <BusyButton style={PADDING} busy busyLabel="Saving changes…">
        Save
      </BusyButton>,
    )
    expect(button.style.minWidth).toBe('59px')
    expect(button.style.maxWidth).toBe('')
  })

  it("hands a caller's own min-width back when the lock lets go", () => {
    widths(88, 88)
    const { rerender } = render(<BusyButton style={{ minWidth: '6rem' }}>Save</BusyButton>)
    const button = screen.getByRole('button', { name: 'Save' })
    rerender(
      <BusyButton style={{ minWidth: '6rem' }} busy>
        Save
      </BusyButton>,
    )
    expect(button.style.minWidth).toBe('88px')
    rerender(<BusyButton style={{ minWidth: '6rem' }}>Save</BusyButton>)
    expect(button.style.minWidth).toBe('6rem')
  })

  it('hands its button to a ref', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<BusyButton ref={ref}>Save</BusyButton>)
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Save' }))
  })
})
