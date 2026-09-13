import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EASE_OUT, MOTION_MS } from '../../theme/motion'
import { LocalSectionNav, LocalSectionPanel, useLocalSections } from './LocalSections'

const SECTIONS = [{ id: 'summary', label: 'Summary' }, { id: 'inputs', label: 'Inputs' }] as const
const mounted = vi.fn()
function Editor() { useEffect(() => { mounted() }, []); return <label>Draft amount<input defaultValue="10" /></label> }
function Harness() {
  const state = useLocalSections(SECTIONS, 'summary', { resolveLegacy: ({ searchParams }) => searchParams.has('edit') ? 'inputs' : null })
  const location = useLocation()
  const navigate = useNavigate()
  return <>
    <LocalSectionNav state={state} label="Page views" />
    <LocalSectionPanel state={state} section="summary"><p>Summary content</p></LocalSectionPanel>
    <LocalSectionPanel state={state} section="inputs"><Editor /></LocalSectionPanel>
    <output>{location.search}</output><span data-testid="pathname">{location.pathname}</span><button type="button" onClick={() => navigate(-1)}>Browser back</button>
    <button type="button" onClick={() => { const params = new URLSearchParams(location.search); params.delete('edit'); navigate({ search: params.toString() }, { replace: true }) }}>Consume arrival</button>
    <button type="button" onClick={() => navigate('/taxes')}>Open bare page</button>
  </>
}
function Trailing({ trailing, onChange }: { trailing?: ReactNode; onChange?: (section: 'summary' | 'inputs', options?: { replace?: boolean }) => void }) {
  const state = useLocalSections(SECTIONS, 'summary')
  return <LocalSectionNav state={state} label="Page views" trailing={trailing} onChange={onChange} />
}
afterEach(() => { cleanup(); mounted.mockClear() })
describe('task-oriented local sections', () => {
  it('mounts editors only when visited and preserves drafts and scope between views', () => {
    render(<MemoryRouter initialEntries={['/taxes?owner=2&year=2026&view=list']}><Harness /></MemoryRouter>)
    expect(mounted).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: 'Inputs' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Draft amount' }), { target: { value: '425' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Summary' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Inputs' }))
    expect((screen.getByRole('textbox', { name: 'Draft amount' }) as HTMLInputElement).value).toBe('425')
    expect(mounted).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status').textContent).toBe('?owner=2&year=2026&view=list&section=inputs')
  })
  it('opens legacy editor links and allows an explicit section to override carried params', async () => {
    render(<MemoryRouter initialEntries={['/taxes?edit=income&year=2026']}><Harness /></MemoryRouter>)
    expect(screen.getByRole('tab', { name: 'Inputs' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: 'Summary' }))
    expect(screen.getByRole('tab', { name: 'Summary' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Inputs' }).getAttribute('aria-selected')).toBe('true'))
  })
  it('supports keyboard tab navigation with the same panels and scope', () => {
    render(<MemoryRouter><Harness /></MemoryRouter>)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Summary' }), { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Inputs' }).getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Inputs' }))
  })
  it('retains an inferred editor after its arrival parameter is consumed, without making the next bare address sticky', () => {
    render(<MemoryRouter initialEntries={['/taxes?edit=income&year=2026']}><Harness /></MemoryRouter>)
    fireEvent.change(screen.getByRole('textbox', { name: 'Draft amount' }), { target: { value: '720' } })
    fireEvent.click(screen.getByRole('button', { name: 'Consume arrival' }))
    expect(screen.getByRole('tab', { name: 'Inputs' }).getAttribute('aria-selected')).toBe('true')
    expect((screen.getByRole('textbox', { name: 'Draft amount' }) as HTMLInputElement).value).toBe('720')
    expect(screen.getByRole('status').textContent).toBe('?year=2026')
    fireEvent.click(screen.getByRole('button', { name: 'Open bare page' }))
    expect(screen.getByRole('tab', { name: 'Summary' }).getAttribute('aria-selected')).toBe('true')
  })
})

describe('LocalSectionNav indicator, trailing slot and history (2026-09-13 polish §2.4, §3)', () => {
  // jsdom lays nothing out: each tab reports its index × 100 as offsetLeft and 80 as offsetWidth,
  // so the indicator's travel is a number the test can predict.
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('role') !== 'tab') return 0
      return Array.from(this.parentElement?.querySelectorAll('[role="tab"]') ?? []).indexOf(this) * 100
    })
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'tab' ? 80 : 0
    })
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('places the indicator under the selected tab instantly, then transitions later moves', () => {
    render(<MemoryRouter><Harness /></MemoryRouter>)
    const bar = document.querySelector('.local-section-nav [role="tablist"] > .local-section-indicator') as HTMLElement
    expect(bar.getAttribute('aria-hidden')).toBe('true')
    expect(bar.style.width).toBe('80px')
    expect(bar.style.transform).toBe('translate(0px, 0px)')
    // First placement is where the bar LIVES, not a move: no transition attribute yet.
    expect(bar.hasAttribute('data-placed')).toBe(false)
    fireEvent.click(screen.getByRole('tab', { name: 'Inputs' }))
    expect(bar.style.transform).toBe('translate(100px, 0px)')
    expect(bar.hasAttribute('data-placed')).toBe(true)
  })

  it('renders a trailing control on the strip’s own line, only when one is given', () => {
    const { rerender } = render(<MemoryRouter><Trailing trailing={<button type="button">Quarterly</button>} /></MemoryRouter>)
    const nav = screen.getByRole('navigation', { name: 'Page views' })
    expect(nav.querySelector(':scope > .local-section-trailing')?.textContent).toBe('Quarterly')
    expect(nav.children[0].getAttribute('role')).toBe('tablist')
    rerender(<MemoryRouter><Trailing /></MemoryRouter>)
    expect(document.querySelector('.local-section-trailing')).toBeNull()
  })

  it('keyboard activation replaces the history entry; a click pushes one', async () => {
    render(<MemoryRouter initialEntries={['/elsewhere', '/taxes']} initialIndex={1}><Harness /></MemoryRouter>)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Summary' }), { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Inputs' }).getAttribute('aria-selected')).toBe('true')
    // Back leaves /taxes entirely: the arrow sweep left no entry of its own.
    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }))
    await waitFor(() => expect(screen.getByTestId('pathname').textContent).toBe('/elsewhere'))
    cleanup()
    render(<MemoryRouter initialEntries={['/elsewhere', '/taxes']} initialIndex={1}><Harness /></MemoryRouter>)
    fireEvent.click(screen.getByRole('tab', { name: 'Inputs' }))
    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }))
    // Back returns to /taxes on Summary: the click was its own entry.
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Summary' }).getAttribute('aria-selected')).toBe('true'))
    expect(screen.getByTestId('pathname').textContent).toBe('/taxes')
  })

  it('hands onChange the activation options, so a page can add its own params', () => {
    const onChange = vi.fn()
    render(<MemoryRouter><Trailing onChange={onChange} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('tab', { name: 'Inputs' }))
    expect(onChange).toHaveBeenLastCalledWith('inputs', undefined)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Summary' }), { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith('inputs', { replace: true })
  })
})

describe('LocalSectionPanel fade (2026-09-13 polish §2.4)', () => {
  // jsdom has no Element.animate; the component guards on its presence, so the tests install one.
  const animate = vi.fn()
  beforeEach(() => { Object.defineProperty(HTMLElement.prototype, 'animate', { value: animate, configurable: true, writable: true }) })
  afterEach(() => { Reflect.deleteProperty(HTMLElement.prototype, 'animate'); animate.mockClear(); vi.unstubAllGlobals() })

  it('does not animate the section the page arrived on, fades every later activation and revisit', () => {
    render(<MemoryRouter><Harness /></MemoryRouter>)
    expect(animate).not.toHaveBeenCalled() // the page body's own entrance covers arrival
    fireEvent.click(screen.getByRole('tab', { name: 'Inputs' }))
    expect(animate).toHaveBeenCalledTimes(1)
    const [frames, options] = animate.mock.calls[0] as [Keyframe[], KeyframeAnimationOptions]
    expect(frames).toEqual([{ opacity: 0, translate: '0 6px' }, { opacity: 1, translate: 'none' }])
    expect(options).toEqual({ duration: MOTION_MS.xfade, easing: EASE_OUT, fill: 'backwards' })
    // The panel that animated is the one that just became visible.
    expect((animate.mock.contexts[0] as HTMLElement).id).toBe(screen.getByRole('tabpanel').id)
    fireEvent.click(screen.getByRole('tab', { name: 'Summary' })) // a kept-mounted revisit fades too
    expect(animate).toHaveBeenCalledTimes(2)
  })

  it('is skipped under prefers-reduced-motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    render(<MemoryRouter><Harness /></MemoryRouter>)
    fireEvent.click(screen.getByRole('tab', { name: 'Inputs' }))
    expect(animate).not.toHaveBeenCalled()
  })
})
