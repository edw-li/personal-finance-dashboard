import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { useCallback, useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePopoverDismiss } from '../usePopoverDismiss'
import { ConfirmProvider, useConfirm } from './confirm'
import type { ConfirmOptions } from './confirm'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** The answers the harness's questions got, in asking order. */
let answers: Promise<boolean>[] = []

/** A page with two controls that ask, inside the `.page` box the popover must escape. */
function Page({ options, showAnchor = true }: { options?: Partial<ConfirmOptions>; showAnchor?: boolean }) {
  const confirm = useConfirm()
  const ask = (anchor: HTMLElement, title: string) => {
    answers.push(confirm({ anchor, title, confirmLabel: 'Delete 2025', ...options }))
  }
  return (
    <div className="page">
      {showAnchor && (
        <button type="button" onClick={(event) => ask(event.currentTarget, 'Delete tax year 2025?')}>
          Delete 2025…
        </button>
      )}
      <button type="button" onClick={(event) => ask(event.currentTarget, 'Delete tax year 2024?')}>
        Delete 2024…
      </button>
      <p>Elsewhere</p>
    </div>
  )
}

function renderPage(props: { options?: Partial<ConfirmOptions>; showAnchor?: boolean } = {}) {
  answers = []
  return render(
    <ConfirmProvider>
      <Page {...props} />
    </ConfirmProvider>,
  )
}

const open = (name = 'Delete 2025…') => fireEvent.click(screen.getByRole('button', { name }))

describe('ConfirmProvider', () => {
  it('portals the question out of the page, labelled by its title and described by its body', () => {
    renderPage({ options: { body: 'Its inputs and brackets go with it.' } })
    open()
    const dialog = screen.getByRole('alertdialog', { name: 'Delete tax year 2025?' })
    // .page is a containing block for fixed descendants: the popover has to live outside it.
    expect(dialog.closest('.page')).toBeNull()
    expect(dialog.parentElement).toBe(document.body)
    const body = document.getElementById(dialog.getAttribute('aria-describedby') ?? '')
    expect(body?.textContent).toBe('Its inputs and brackets go with it.')
    expect(dialog.className).toBe('popover-surface confirm-popover') // the house pop-in
  })

  it('puts the caret on Cancel first', () => {
    renderPage()
    open()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  })

  it('wraps Tab inside the popover, both ways', () => {
    renderPage()
    open()
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const confirm = screen.getByRole('button', { name: 'Delete 2025' })
    confirm.focus()
    expect(fireEvent.keyDown(confirm, { key: 'Tab' })).toBe(false)
    expect(document.activeElement).toBe(cancel)
    expect(fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true })).toBe(false)
    expect(document.activeElement).toBe(confirm)
  })

  it('answers yes on Confirm, and hands the focus back to the control that asked', async () => {
    renderPage()
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2025' }))
    await expect(answers[0]).resolves.toBe(true)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete 2025…' }))
  })

  it('answers no on Cancel, on Escape and on a pointerdown outside — focus back on the asker each time', async () => {
    renderPage()
    const asker = screen.getByRole('button', { name: 'Delete 2025…' })
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(document.activeElement).toBe(asker)
    open()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(document.activeElement).toBe(asker)
    open()
    fireEvent.pointerDown(screen.getByText('Elsewhere'))
    expect(document.activeElement).toBe(asker)
    expect(await Promise.all(answers)).toEqual([false, false, false])
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('asks one question at a time: a second one answers the first "no"', async () => {
    renderPage()
    open('Delete 2025…')
    open('Delete 2024…')
    await expect(answers[0]).resolves.toBe(false)
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1)
    expect(screen.getByRole('alertdialog', { name: 'Delete tax year 2024?' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  })

  it('leaves the focus alone when the control that asked has gone', async () => {
    const view = renderPage()
    open()
    view.rerender(
      <ConfirmProvider>
        <Page showAnchor={false} />
      </ConfirmProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await expect(answers[0]).resolves.toBe(false)
    expect(document.activeElement).toBe(document.body)
  })

  it('keeps Confirm quiet until the typed arm matches (Restore)', async () => {
    renderPage({ options: { typedArm: { expected: '2026-09-04', prompt: "Type the snapshot's date to confirm" } } })
    open()
    const confirm = screen.getByRole('button', { name: 'Delete 2025' })
    expect(confirm.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(confirm) // swallowed: still open, still unanswered
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    const typed = screen.getByLabelText("Type the snapshot's date to confirm")
    fireEvent.change(typed, { target: { value: '2026-09-0' } })
    expect(confirm.getAttribute('aria-disabled')).toBe('true')
    fireEvent.change(typed, { target: { value: ' 2026-09-04 ' } })
    expect(confirm.hasAttribute('aria-disabled')).toBe(false)
    fireEvent.click(confirm)
    await expect(answers[0]).resolves.toBe(true)
  })

  it('confirms from the typed arm with Enter once it matches, and not before', async () => {
    renderPage({ options: { typedArm: { expected: '2026-09-04', prompt: 'Type the date' } } })
    open()
    const typed = screen.getByLabelText('Type the date')
    fireEvent.keyDown(typed, { key: 'Enter' })
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    fireEvent.change(typed, { target: { value: '2026-09-04' } })
    fireEvent.keyDown(typed, { key: 'Enter' })
    await expect(answers[0]).resolves.toBe(true)
  })

  it('draws a danger Confirm by default, a primary one on request, and a custom Cancel', () => {
    renderPage()
    open()
    expect(screen.getByRole('button', { name: 'Delete 2025' }).className).toBe('button danger-button busy-button')
    cleanup()
    renderPage({ options: { tone: 'default', confirmLabel: 'Apply 3 overrides', cancelLabel: 'Keep editing' } })
    open()
    expect(screen.getByRole('button', { name: 'Apply 3 overrides' }).className).toBe('button button-primary busy-button')
    expect(screen.getByRole('button', { name: 'Keep editing' })).toBeTruthy()
  })

  it('stands beside its anchor, follows it on scroll and resize, and lets go of an anchor that left', async () => {
    const view = renderPage()
    const anchor = screen.getByRole('button', { name: 'Delete 2025…' })
    let top = 200
    anchor.getBoundingClientRect = () =>
      ({ top, bottom: top + 32, left: 600, right: 700, width: 100, height: 32, x: 600, y: top, toJSON: () => ({}) }) as DOMRect
    open()
    const dialog = screen.getByRole('alertdialog')
    // jsdom sizes the popover 0 × 0: below the anchor by the gap, right edges aligned.
    expect(dialog.style.top).toBe('238px')
    expect(dialog.style.left).toBe('700px')
    expect(dialog.getAttribute('data-placement')).toBe('below')
    top = 120
    fireEvent.scroll(window)
    expect(dialog.style.top).toBe('158px')
    top = 150
    fireEvent(window, new Event('resize'))
    expect(dialog.style.top).toBe('188px')
    view.rerender(
      <ConfirmProvider>
        <Page showAnchor={false} />
      </ConfirmProvider>,
    )
    fireEvent.scroll(window)
    await expect(answers[0]).resolves.toBe(false)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('answers "no" to a question it can no longer show (the provider unmounted)', async () => {
    const view = renderPage()
    open()
    view.unmount()
    await expect(answers[0]).resolves.toBe(false)
  })
})

describe('useConfirm', () => {
  it('renders without a provider, and throws only when asked — a question nobody can see must not answer', () => {
    const { result } = renderHook(() => useConfirm())
    const anchor = document.createElement('button')
    expect(() => result.current({ anchor, title: 'Delete?', confirmLabel: 'Delete' })).toThrow(/ConfirmProvider/)
  })
})

describe('the popover keeps the caret and says only what it has (review fixes)', () => {
  it('holds the caret: the surface takes a stray click, and Tab wraps over a link in the body too', () => {
    renderPage({ options: { body: <>Read <a href="/help">what goes</a> first.</> } })
    open()
    const dialog = screen.getByRole('alertdialog')
    // A click on the popover's own text lands the caret on the popover, never on <body>.
    expect(dialog.getAttribute('tabindex')).toBe('-1')
    const link = screen.getByRole('link', { name: 'what goes' })
    const confirm = screen.getByRole('button', { name: 'Delete 2025' })
    confirm.focus()
    expect(fireEvent.keyDown(confirm, { key: 'Tab' })).toBe(false)
    expect(document.activeElement).toBe(link)
    expect(fireEvent.keyDown(link, { key: 'Tab', shiftKey: true })).toBe(false)
    expect(document.activeElement).toBe(confirm)
    // From the surface itself both ways out are edges: Shift+Tab wraps to the end, Tab to the start.
    dialog.focus()
    expect(document.activeElement).toBe(dialog)
    expect(fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })).toBe(false)
    expect(document.activeElement).toBe(confirm)
    dialog.focus()
    expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(false)
    expect(document.activeElement).toBe(link)
  })

  it('is described only by a body that says something', () => {
    for (const body of ['', null, false]) {
      renderPage({ options: { body } })
      open()
      const dialog = screen.getByRole('alertdialog')
      expect(dialog.hasAttribute('aria-describedby'), String(body)).toBe(false)
      expect(dialog.querySelector('.confirm-popover-body'), String(body)).toBeNull()
      cleanup()
    }
  })
})

/** A menu the way TaxYearMenu, FilingStatusMenu and the wizard's kebab are one — its own
 *  usePopoverDismiss, listening on the document — holding the control that asks. */
function MenuPage() {
  const [open, setOpen] = useState(true)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  usePopoverDismiss(open, close, triggerRef, surfaceRef)
  const confirm = useConfirm()
  return (
    <div className="page">
      <button ref={triggerRef} type="button" onClick={() => setOpen((value) => !value)}>
        Tax year
      </button>
      {open && (
        <div ref={surfaceRef} role="dialog" aria-label="Tax year menu">
          <button
            type="button"
            onClick={(event) => {
              answers.push(confirm({ anchor: event.currentTarget, title: 'Delete tax year 2025?', confirmLabel: 'Delete 2025' }))
            }}
          >
            Delete 2025…
          </button>
        </div>
      )}
      <p>Elsewhere</p>
    </div>
  )
}

describe('asked from inside another popover (TaxYearMenu, FilingStatusMenu, the wizard kebab)', () => {
  const renderMenu = () => {
    answers = []
    render(
      <ConfirmProvider>
        <MenuPage />
      </ConfirmProvider>,
    )
    const asker = screen.getByRole('button', { name: 'Delete 2025…' })
    fireEvent.click(asker)
    return asker
  }
  const menu = () => screen.queryByRole('dialog', { name: 'Tax year menu' })

  it('takes Escape first: the question answers no, the menu stays open, the caret goes back to the asker', async () => {
    const asker = renderMenu()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(menu()).not.toBeNull()
    expect(document.activeElement).toBe(asker)
    await expect(answers[0]).resolves.toBe(false)
  })

  it('a press inside the question is not "outside" the menu: Cancel answers no, the caret back on the asker', async () => {
    const asker = renderMenu()
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    fireEvent.pointerDown(cancel)
    fireEvent.click(cancel)
    expect(menu()).not.toBeNull()
    expect(document.activeElement).toBe(asker)
    await expect(answers[0]).resolves.toBe(false)
  })

  it('…and Confirm answers yes, the caret back on the asker', async () => {
    const asker = renderMenu()
    const confirm = screen.getByRole('button', { name: 'Delete 2025' })
    fireEvent.pointerDown(confirm)
    fireEvent.click(confirm)
    expect(menu()).not.toBeNull()
    expect(document.activeElement).toBe(asker)
    await expect(answers[0]).resolves.toBe(true)
  })
})

describe('an orphaned question never answers yes', () => {
  // A bare button outside React, so a test can take it off the page without a render — the way a
  // menu closing or a list reloading takes an anchor away, with no scroll and no resize.
  let loose: HTMLButtonElement
  function Asker() {
    const confirm = useConfirm()
    return (
      <button
        type="button"
        onClick={() => {
          answers.push(confirm({ anchor: loose, title: 'Delete it?', confirmLabel: 'Delete' }))
        }}
      >
        Ask about the loose one
      </button>
    )
  }
  const ask = () => {
    answers = []
    render(
      <ConfirmProvider>
        <Asker />
      </ConfirmProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Ask about the loose one' }))
    expect(screen.getByRole('alertdialog')).toBeTruthy()
  }

  beforeEach(() => {
    loose = document.createElement('button')
    loose.textContent = 'Loose'
    document.body.append(loose)
  })
  afterEach(() => loose.remove())

  it('answers no, and closes, once its anchor leaves the page — scroll or no scroll', async () => {
    ask()
    await act(async () => {
      loose.remove()
    })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await expect(answers[0]).resolves.toBe(false)
  })

  it('answers no to a Confirm pressed after the anchor went, before anything else noticed', async () => {
    ask()
    const confirm = screen.getByRole('button', { name: 'Delete' })
    loose.remove()
    fireEvent.click(confirm) // synchronously: the tree watcher's microtask has not run yet
    await expect(answers[0]).resolves.toBe(false)
  })
})
