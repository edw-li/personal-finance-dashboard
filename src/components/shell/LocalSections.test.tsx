import { readFileSync } from 'node:fs'
import path from 'node:path'
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EASE_OUT, MOTION_MS } from '../../theme/motion'
import { LocalSectionNav, LocalSectionPanel, useLocalSections } from './LocalSections'
// The hold loop is holdPosition's own unit (holdPosition.test.ts); here only WHEN a landing asks.
const release = vi.hoisted(() => vi.fn())
vi.mock('./holdPosition', () => ({ holdPosition: vi.fn(() => release) }))
import { holdPosition } from './holdPosition'

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

describe("keeping the reader's place (2026-09-23 spec §C10)", () => {
  // The scope row is sticky precisely so a chip can be changed while reading lower cards; a
  // chip, the month ribbon or a chart drill writes only search params, and used to land the
  // reader at the top (600 → 0 measured on Spending, Net worth and Portfolio).
  function ScrollHarness() {
    const state = useLocalSections(SECTIONS, 'summary')
    const location = useLocation()
    const navigate = useNavigate()
    return <>
      <LocalSectionNav state={state} label="Page views" />
      <span data-testid="key">{location.key}</span>
      <button type="button" onClick={() => { const params = new URLSearchParams(location.search); params.set('range', 'ytd'); navigate({ search: params.toString() }) }}>Pick YTD</button>
      <button type="button" onClick={() => navigate(-1)}>Browser back</button>
      <button type="button" onClick={() => navigate(1)}>Browser forward</button>
    </>
  }
  // The restore runs in a requestAnimationFrame after the commit.
  const frame = () => act(() => new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()) }))
  const at = (y: number) => Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true })
  let scrollTo: ReturnType<typeof vi.fn>
  beforeEach(() => { scrollTo = vi.fn(); vi.stubGlobal('scrollTo', scrollTo); sessionStorage.clear(); at(0) })
  afterEach(() => { vi.unstubAllGlobals(); at(0); sessionStorage.clear() })

  it('a search-param write on the same section leaves the scroll alone', async () => {
    render(<MemoryRouter initialEntries={['/spending']}><ScrollHarness /></MemoryRouter>)
    at(600)
    fireEvent.click(screen.getByRole('button', { name: 'Pick YTD' }))
    await frame()
    await frame()
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it("a section change restores that section's remembered depth — the top on a first visit", async () => {
    render(<MemoryRouter initialEntries={['/taxes']}><ScrollHarness /></MemoryRouter>)
    at(600)
    fireEvent.click(screen.getByRole('tab', { name: 'Inputs' }))
    await frame()
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' })
    at(250)
    fireEvent.click(screen.getByRole('tab', { name: 'Summary' }))
    await frame()
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 600, behavior: 'instant' })
  })

  it('Back restores the depth recorded for the entry it returns to; with none recorded, the place holds', async () => {
    render(<MemoryRouter initialEntries={['/spending']}><ScrollHarness /></MemoryRouter>)
    // Layout records every entry's depth under scroll:<key> as the reader scrolls.
    sessionStorage.setItem(`scroll:${screen.getByTestId('key').textContent}`, '600')
    at(600)
    fireEvent.click(screen.getByRole('button', { name: 'Pick YTD' }))
    await frame()
    at(900)
    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }))
    await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith({ top: 600, behavior: 'instant' }))
    scrollTo.mockClear()
    // Forward onto the YTD entry, which was never scrolled in: same section, nothing recorded —
    // the reader stays where they are rather than being thrown to the top.
    fireEvent.click(screen.getByRole('button', { name: 'Browser forward' }))
    await frame()
    await frame()
    expect(scrollTo).not.toHaveBeenCalled()
  })
})

// 2026-09-23 spec §C11: a deep link lands while the page is still making its entrance, and
// scrollIntoView measures the target's TRANSFORMED box — so on /guide#routine-monthly the card
// landed 87px down (clear of the top scrim), then rose 22px with the entrance and came to rest
// under the scrim. Held from the landing, it stays where the landing put it.
describe('holding a deep link where it lands (2026-09-23 spec §C11)', () => {
  function TargetHarness() {
    const state = useLocalSections(SECTIONS, 'summary', {
      resolveLegacy: ({ hash }) => (hash === '#deep' ? { section: 'inputs', targetId: 'deep' } : null),
    })
    // PageFrame's shape: the sticky scope row, then the body the target lives in.
    return <div>
      <div className="page-frame-scope"><LocalSectionNav state={state} label="Page views" /></div>
      <div className="page-frame-body">
        <LocalSectionPanel state={state} section="summary"><p>Summary content</p></LocalSectionPanel>
        <LocalSectionPanel state={state} section="inputs"><section id="deep">Deep card</section></LocalSectionPanel>
      </div>
    </div>
  }
  let scrollIntoView: ReturnType<typeof vi.fn>
  let scrollTo: ReturnType<typeof vi.fn>
  // Where the landing left things: the row's top (0 = stuck) and the target's top, on screen.
  const landing = ({ scrollY, rowTop, targetTop }: { scrollY: number; rowTop: number; targetTop: number }) => {
    Object.defineProperty(window, 'scrollY', { value: scrollY, configurable: true, writable: true })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const top = this.classList.contains('page-frame-scope') ? rowTop : this.id === 'deep' ? targetTop : 0
      return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect
    })
  }
  beforeEach(() => {
    vi.mocked(holdPosition).mockClear()
    release.mockClear()
    // jsdom implements no scrollIntoView (SettingsPage.test carries the same note).
    scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true, writable: true })
    scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)
  })
  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true })
  })

  it('holds the target from the moment it lands, and lets go when the page goes away', async () => {
    const { unmount } = render(<MemoryRouter initialEntries={['/guide#deep']}><TargetHarness /></MemoryRouter>)
    await waitFor(() => expect(holdPosition).toHaveBeenCalledWith(screen.getByText('Deep card')))
    // Measured AFTER the landing: a hold taken before it would pin the card to its old place.
    expect(scrollIntoView.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(holdPosition).mock.invocationCallOrder[0])
    expect(release).not.toHaveBeenCalled()
    unmount()
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('a page without a deep link holds nothing', async () => {
    render(<MemoryRouter initialEntries={['/guide']}><TargetHarness /></MemoryRouter>)
    await act(() => new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()) }))
    expect(holdPosition).not.toHaveBeenCalled()
  })

  // The first card of a page cannot reach the snap line: the landing stops before the scope row
  // sticks (/guide#routine-monthly: 44px down, the row still 28px from the top), and there the
  // arrived scrim lies on the body's first 32px — across the very card the link named.
  it('a target in the opening screen lands at the top of the page, where no scrim has arrived', async () => {
    landing({ scrollY: 44, rowTop: 28, targetTop: 87 })
    render(<MemoryRouter initialEntries={['/guide#deep']}><TargetHarness /></MemoryRouter>)
    await waitFor(() => expect(holdPosition).toHaveBeenCalled())
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' })
    // The hold measures the FINAL landing, so it comes after the move to the top.
    expect(scrollTo.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(holdPosition).mock.invocationCallOrder[0])
  })

  it('a target the landing brought under a stuck row stays where it landed', async () => {
    // Only just deep enough for the row to stick: still in the opening screen's upper half, so
    // the stuck row is the one thing that says the landing reached the snap line.
    landing({ scrollY: 88, rowTop: 0, targetTop: 87 })
    render(<MemoryRouter initialEntries={['/guide#deep']}><TargetHarness /></MemoryRouter>)
    await waitFor(() => expect(holdPosition).toHaveBeenCalled())
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('a target far down a short page stays where it landed — the top would hide it', async () => {
    // Max scroll reached before the row could stick; from the top the card would be off screen.
    landing({ scrollY: 60, rowTop: 12, targetTop: 700 })
    render(<MemoryRouter initialEntries={['/guide#deep']}><TargetHarness /></MemoryRouter>)
    await waitFor(() => expect(holdPosition).toHaveBeenCalled())
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('under reduced motion there are no scrims, so the landing stands', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    landing({ scrollY: 44, rowTop: 28, targetTop: 87 })
    render(<MemoryRouter initialEntries={['/guide#deep']}><TargetHarness /></MemoryRouter>)
    await waitFor(() => expect(holdPosition).toHaveBeenCalled())
    expect(scrollTo).not.toHaveBeenCalled()
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

// 2026-09-23 spec §C11: a local-section deep link lands its target under the sticky row by the
// row's MEASURED height (--sticky-inset, the house rule settings and the guide already use) — a
// hard-coded 7rem left it under the row on a taller strip and under the top scrim on every page.
it('lands a local-section deep link under the sticky row, by its measured height', () => {
  const css = readFileSync(path.join(__dirname, 'localSections.css'), 'utf8')
  expect(css).toContain('.local-section-panel [id] { scroll-margin-top: calc(var(--sticky-inset, 0px) + 0.75rem); }')
  expect(css).not.toContain('scroll-margin-top: 7rem')
})
