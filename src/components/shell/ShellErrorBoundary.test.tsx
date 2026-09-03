import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ShellErrorBoundary, { classifyError } from './ShellErrorBoundary'

afterEach(() => {
  cleanup()
  // Both, every time: this file both spies (console.error) and stubs (navigator, location),
  // and a leaked navigator stub is invisible until the NEXT test asks for the clipboard.
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function Boom({ message }: { message: string }): never {
  throw new Error(message)
}

function BoomRaw({ thrown }: { thrown: unknown }): never {
  throw thrown
}

// React logs every caught error itself; the boundary tests are not about that noise.
function silence() {
  vi.spyOn(console, 'error').mockImplementation(() => {})
}

describe('ShellErrorBoundary', () => {
  it('classifies chunk-load failures apart from real errors', () => {
    expect(classifyError(new Error('Failed to fetch dynamically imported module: /assets/x.js'))).toBe('chunk')
    expect(classifyError(new Error('Loading chunk 12 failed'))).toBe('chunk')
    expect(classifyError(new Error('Importing a module script failed.'))).toBe('chunk')
    // Firefox's wording, and Vite's CSS preloader — same stale deploy, same reload cure.
    expect(classifyError(new Error('error loading dynamically imported module: /assets/x.js'))).toBe('chunk')
    expect(classifyError(new Error('Unable to preload CSS for /assets/x.css'))).toBe('chunk')
    expect(classifyError(new Error('x is not a function'))).toBe('error')
  })

  it('renders the update message for a chunk failure', () => {
    silence()
    render(<ShellErrorBoundary buildHash="abc123" getDiagnostics={() => ''}><Boom message="Loading chunk 3 failed" /></ShellErrorBoundary>)
    expect(screen.getByRole('alert').textContent).toMatch(/app was updated/i)
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
  })

  it('renders Reload and Copy details with the payload for a real error', async () => {
    silence()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    render(<ShellErrorBoundary buildHash="abc123" getDiagnostics={() => 'env=prod alembic=f7d3b2a91c40'}><Boom message="kaboom" /></ShellErrorBoundary>)
    expect(screen.getByRole('alert').textContent).toMatch(/something went wrong/i)
    fireEvent.click(screen.getByRole('button', { name: 'Copy details' }))
    expect(writeText).toHaveBeenCalledTimes(1)
    const payload = writeText.mock.calls[0][0] as string
    expect(payload).toContain('kaboom')
    expect(payload).toContain('build abc123')
    expect(payload).toContain('env=prod')
    // React's component stack names WHICH child threw — the half a JS stack rarely gives.
    expect(payload).toContain('Boom')
    // The click's own outcome, said out loud: a silent button is indistinguishable from a
    // button that did nothing.
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Error details' })).toBeNull()
  })

  it('says Copy failed and offers the payload for manual selection when the clipboard rejects', async () => {
    silence()
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    render(<ShellErrorBoundary buildHash="abc123" getDiagnostics={() => 'env=prod alembic=f7d3b2a91c40'}><Boom message="kaboom" /></ShellErrorBoundary>)
    fireEvent.click(screen.getByRole('button', { name: 'Copy details' }))
    expect(await screen.findByRole('button', { name: 'Copy failed' })).toBeTruthy()
    // A denied clipboard must still hand the reader something to select; the rejection is
    // handled (a second throw inside the boundary would take the fallback down with it).
    const details = screen.getByRole('textbox', { name: 'Error details' }) as HTMLTextAreaElement
    expect(details.readOnly).toBe(true)
    expect(details.value).toContain('kaboom')
    expect(details.value).toContain('build abc123')
  })

  it('shows the payload up front when there is no clipboard at all (plain HTTP)', () => {
    silence()
    // jsdom has no navigator.clipboard: the button could only ever fail, so the textarea is
    // the actual affordance and must not hide behind it.
    expect(navigator.clipboard).toBeUndefined()
    render(<ShellErrorBoundary buildHash="abc123" getDiagnostics={() => ''}><Boom message="kaboom" /></ShellErrorBoundary>)
    expect((screen.getByRole('textbox', { name: 'Error details' }) as HTMLTextAreaElement).value).toContain('kaboom')
  })

  it('clears the fallback when resetKey changes — a navigation is a fresh attempt', () => {
    silence()
    const { rerender } = render(
      <ShellErrorBoundary buildHash="x" getDiagnostics={() => ''} resetKey="key-a"><Boom message="kaboom" /></ShellErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toBeTruthy()
    rerender(
      <ShellErrorBoundary buildHash="x" getDiagnostics={() => ''} resetKey="key-b"><p>fine</p></ShellErrorBoundary>,
    )
    expect(screen.getByText('fine')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('holds the fallback while resetKey is unchanged', () => {
    silence()
    const { rerender } = render(
      <ShellErrorBoundary buildHash="x" getDiagnostics={() => ''} resetKey="key-a"><Boom message="kaboom" /></ShellErrorBoundary>,
    )
    rerender(
      <ShellErrorBoundary buildHash="x" getDiagnostics={() => ''} resetKey="key-a"><p>fine</p></ShellErrorBoundary>,
    )
    expect(screen.queryByText('fine')).toBeNull()
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('focuses Reload when the fallback appears', () => {
    silence()
    render(<ShellErrorBoundary buildHash="x" getDiagnostics={() => ''}><Boom message="kaboom" /></ShellErrorBoundary>)
    // The throw took the reader's focus down with the app; the recovery button is where a
    // keyboard user must land, not after a blind Tab hunt.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reload' }))
  })

  it('gives both fallback buttons type=button', () => {
    silence()
    // The shell has no form today, but a bare <button> inside one submits it — the fallback
    // must not be one refactor away from navigating instead of reloading.
    render(<ShellErrorBoundary buildHash="x" getDiagnostics={() => ''}><Boom message="kaboom" /></ShellErrorBoundary>)
    for (const button of screen.getAllByRole('button')) expect(button.getAttribute('type')).toBe('button')
  })

  it('survives a non-Error throw — a thrown null must not read as "no error"', () => {
    silence()
    // `throw null` reaches boundaries unchanged, and null is also the empty state's sentinel:
    // without normalisation the boundary would render its children straight back into it.
    render(<ShellErrorBoundary buildHash="x" getDiagnostics={() => ''}><BoomRaw thrown={null} /></ShellErrorBoundary>)
    expect(screen.getByRole('alert').textContent).toMatch(/something went wrong/i)
    expect((screen.getByRole('textbox', { name: 'Error details' }) as HTMLTextAreaElement).value).toContain('null')
  })

  it('reloads the document on Reload', () => {
    silence()
    const reload = vi.fn()
    // RouteBoundary.test.tsx's idiom: the component calls bare `location.reload()`, so the
    // stubbed global IS the object it resolves — jsdom's own window.location is unforgeable.
    vi.stubGlobal('location', { ...window.location, reload })
    render(<ShellErrorBoundary buildHash="x" getDiagnostics={() => ''}><Boom message="Loading chunk 3 failed" /></ShellErrorBoundary>)
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('passes children through when nothing throws', () => {
    render(<ShellErrorBoundary buildHash="x" getDiagnostics={() => ''}><p>fine</p></ShellErrorBoundary>)
    expect(screen.getByText('fine')).toBeTruthy()
  })
})
