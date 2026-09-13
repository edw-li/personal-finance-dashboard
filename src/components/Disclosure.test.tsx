import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Disclosure from './Disclosure'

afterEach(cleanup)

// No cached `details()` helper on purpose: the element is re-rendered between assertions and a
// held reference is the classic stale-node bug — every test queries the element afresh.
/** The `toggle` event is a queued task in jsdom and in browsers alike; let it land. */
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

describe('Disclosure', () => {
  it('renders a closed <details> with a chevron summary and a body wrapper', () => {
    render(<Disclosure summary="Employer match (advanced)"><p>body</p></Disclosure>)
    const el = document.querySelector('details.disclosure') as HTMLDetailsElement
    expect(el.open).toBe(false)
    const summary = el.querySelector('summary') as HTMLElement
    expect(summary.textContent).toBe('Employer match (advanced)')
    expect(summary.querySelector('svg.disclosure-chevron')?.getAttribute('aria-hidden')).toBe('true')
    expect(el.querySelector(':scope > .disclosure-body')?.textContent).toBe('body')
  })

  it('opens and closes on the summary (uncontrolled), reporting each toggle once', async () => {
    const onToggle = vi.fn()
    render(<Disclosure summary="Table" onToggle={onToggle}><p>rows</p></Disclosure>)
    const el = document.querySelector('details.disclosure') as HTMLDetailsElement
    fireEvent.click(screen.getByText('Table'))
    await settle()
    expect(el.open).toBe(true)
    expect(onToggle).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByText('Table'))
    await settle()
    expect(el.open).toBe(false)
    expect(onToggle).toHaveBeenLastCalledWith(false)
    expect(onToggle).toHaveBeenCalledTimes(2)
  })

  it('fires onOpen exactly once, on the first open only', async () => {
    const onOpen = vi.fn()
    render(<Disclosure summary="Review historical months" onOpen={onOpen}><p>list</p></Disclosure>)
    expect(onOpen).not.toHaveBeenCalled()
    for (let i = 0; i < 3; i += 1) {
      fireEvent.click(screen.getByText('Review historical months'))
      await settle()
    }
    expect((document.querySelector('details.disclosure') as HTMLDetailsElement).open).toBe(true)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('starts open with defaultOpen, counts that as the first open, and reports no toggle for it', async () => {
    const onOpen = vi.fn()
    const onToggle = vi.fn()
    render(<Disclosure summary="Table" defaultOpen onOpen={onOpen} onToggle={onToggle}><p>rows</p></Disclosure>)
    expect((document.querySelector('details.disclosure') as HTMLDetailsElement).open).toBe(true)
    expect(onOpen).toHaveBeenCalledTimes(1)
    // The mount's own attribute write fires a toggle event; it is not a user toggle.
    await settle()
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('controlled: the parent owns open and the summary only asks', async () => {
    function Parent() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <Disclosure summary="Calculation" open={open} onToggle={setOpen}><p>math</p></Disclosure>
          <button type="button" onClick={() => setOpen(false)}>Force closed</button>
        </>
      )
    }
    render(<Parent />)
    const el = document.querySelector('details.disclosure') as HTMLDetailsElement
    expect(el.open).toBe(false)
    fireEvent.click(screen.getByText('Calculation'))
    await settle()
    expect(el.open).toBe(true)
    fireEvent.click(screen.getByText('Force closed'))
    await settle()
    expect(el.open).toBe(false)
  })

  it('controlled: a parent that refuses keeps the details shut', async () => {
    const onToggle = vi.fn()
    render(<Disclosure summary="Calculation" open={false} onToggle={onToggle}><p>math</p></Disclosure>)
    fireEvent.click(screen.getByText('Calculation'))
    await settle()
    expect(onToggle).toHaveBeenCalledWith(true)
    expect((document.querySelector('details.disclosure') as HTMLDetailsElement).open).toBe(false)
  })

  it('passes id, name and className through to the details element', () => {
    render(<Disclosure summary="x" id="notes" name="taxes-notes" className="wide"><p>y</p></Disclosure>)
    const el = document.querySelector('details.disclosure') as HTMLDetailsElement
    expect(el.id).toBe('notes')
    expect(el.getAttribute('name')).toBe('taxes-notes')
    expect(el.className).toBe('disclosure wide')
  })
})
