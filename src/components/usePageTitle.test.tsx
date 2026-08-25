import { cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { usePageTitle } from './usePageTitle'

// The hook is pure routing→document.title; a null-rendering probe is its whole harness.
function Probe() {
  usePageTitle()
  return null
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Probe />
    </MemoryRouter>,
  )

afterEach(cleanup)

describe('usePageTitle', () => {
  it('titles a known destination "{label} · Finance"', () => {
    renderAt('/net-worth')
    expect(document.title).toBe('Net worth · Finance')
  })

  it('matches the root exactly, never as a prefix', () => {
    renderAt('/')
    expect(document.title).toBe('Overview · Finance')
  })

  it('titles a sub-path by its owning section', () => {
    renderAt('/portfolio/anything')
    expect(document.title).toBe('Portfolio · Finance')
  })

  it('falls back for an unknown path (the 404)', () => {
    renderAt('/no-such-page')
    expect(document.title).toBe('Finance Dashboard')
  })
})
