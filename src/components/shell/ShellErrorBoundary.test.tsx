import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ShellErrorBoundary, { classifyError } from './ShellErrorBoundary'

afterEach(cleanup)

function Boom({ message }: { message: string }): never {
  throw new Error(message)
}

describe('ShellErrorBoundary', () => {
  it('classifies chunk-load failures apart from real errors', () => {
    expect(classifyError(new Error('Failed to fetch dynamically imported module: /assets/x.js'))).toBe('chunk')
    expect(classifyError(new Error('Loading chunk 12 failed'))).toBe('chunk')
    expect(classifyError(new Error('Importing a module script failed.'))).toBe('chunk')
    expect(classifyError(new Error('x is not a function'))).toBe('error')
  })

  it('renders the update message for a chunk failure', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ShellErrorBoundary buildHash="abc123" getDiagnostics={() => ''}><Boom message="Loading chunk 3 failed" /></ShellErrorBoundary>)
    expect(screen.getByRole('alert').textContent).toMatch(/app was updated/i)
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
  })

  it('renders Reload and Copy details with the payload for a real error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
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
    vi.unstubAllGlobals()
  })

  it('passes children through when nothing throws', () => {
    render(<ShellErrorBoundary buildHash="x" getDiagnostics={() => ''}><p>fine</p></ShellErrorBoundary>)
    expect(screen.getByText('fine')).toBeTruthy()
  })
})
