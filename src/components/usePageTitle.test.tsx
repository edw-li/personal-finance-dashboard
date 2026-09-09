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
  // ONE product name everywhere (audit item 60): the sidebar wordmark, the splash, the
  // login heading and every tab title say "Personal finance".
  it('titles a known destination "{label} · Personal finance"', () => {
    renderAt('/net-worth')
    expect(document.title).toBe('Net worth · Personal finance')
  })

  it('matches the root exactly, never as a prefix', () => {
    renderAt('/')
    expect(document.title).toBe('Overview · Personal finance')
  })

  it('titles a sub-path by its owning section', () => {
    renderAt('/portfolio/anything')
    expect(document.title).toBe('Portfolio · Personal finance')
  })

  it('falls back for an unknown path (the 404)', () => {
    // The hook cannot know it is the 404 — it only knows no destination claims the path —
    // so the fallback IS the 404's title, and it wears the product name like its siblings.
    renderAt('/no-such-page')
    expect(document.title).toBe('Not found · Personal finance')
  })
})
