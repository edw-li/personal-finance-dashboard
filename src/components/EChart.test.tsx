import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// House law keeps real echarts out of jsdom (no canvas). The component's DOM facade —
// the aria contract this batch adds — is testable with the ENGINE stubbed at the module
// boundary; the stub offers exactly what EChart's effects call.
vi.mock('../charts/echarts', () => ({
  echarts: {
    init: vi.fn(() => ({
      on: vi.fn(),
      setOption: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
    })),
  },
}))
import EChart from './EChart'

beforeAll(() => {
  // jsdom has no ResizeObserver; EChart observes its container on mount.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(cleanup)

describe('EChart aria facade', () => {
  it('renders role="img" + the label when ariaLabel is given', () => {
    const { container } = render(
      <EChart option={{}} ariaLabel="Line chart of net worth at every monthly snapshot" />,
    )
    const div = container.firstElementChild as HTMLElement
    expect(div.getAttribute('role')).toBe('img')
    expect(div.getAttribute('aria-label')).toBe(
      'Line chart of net worth at every monthly snapshot',
    )
  })

  it('renders NO role and no label when the prop is absent', () => {
    const { container } = render(<EChart option={{}} />)
    const div = container.firstElementChild as HTMLElement
    expect(div.getAttribute('role')).toBeNull()
    expect(div.getAttribute('aria-label')).toBeNull()
  })
})
