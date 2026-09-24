import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearSnapshots, setSnapshot } from '../../api/snapshotCache'
import { flowsPart, timeStatus } from '../../testing/timeFixtures'
import type { CoverageOut } from '../../types/api'
import { COVERAGE_SNAPSHOT } from './ScopeBar'
import { useScopeCoverage } from './useScopeCoverage'

// The scope row's /coverage answer handed up to a page (2026-09-23 spec §T1, §T7, §T12; review
// minor 5): one hook for the Net worth and Spending pages instead of two copies.
function coverage(spending: 'partial' | 'missing'): CoverageOut {
  return {
    balances: ['2026-09-01', '2026-10-01'],
    spending: [],
    net_pay: [],
    time: timeStatus('2026-10-03', { flows_due: [flowsPart('2026-09-01', { spending })] }),
  }
}

beforeEach(() => clearSnapshots())
afterEach(cleanup)

describe('useScopeCoverage', () => {
  it('seeds from the scope row’s cached answer, so the first paint needs no request', () => {
    setSnapshot(COVERAGE_SNAPSHOT, coverage('partial'))
    const { result } = renderHook(() => useScopeCoverage())
    expect(result.current.flowsDue.map((part) => part.spending)).toEqual(['partial'])
  })

  it('starts empty without one, and takes each answer the row hands up', () => {
    const { result } = renderHook(() => useScopeCoverage())
    expect(result.current.coverage).toBeNull()
    expect(result.current.flowsDue).toEqual([])
    act(() => result.current.onCoverage(coverage('missing')))
    expect(result.current.flowsDue.map((part) => part.spending)).toEqual(['missing'])
  })

  it('keeps flowsDue’s identity when an identical answer lands — no chart option is rebuilt', () => {
    const { result } = renderHook(() => useScopeCoverage())
    act(() => result.current.onCoverage(coverage('partial')))
    const first = result.current.flowsDue
    act(() => result.current.onCoverage(coverage('partial')))
    expect(result.current.flowsDue).toBe(first)
    act(() => result.current.onCoverage(coverage('missing')))
    expect(result.current.flowsDue).not.toBe(first)
  })
})
