import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WithholdingOut } from '../../types/api'
import { taxDriftItem, useTaxDrift } from './taxDrift'

vi.mock('../../api/taxes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/taxes')>()),
  fetchWithholding: vi.fn(),
}))
import { fetchWithholding } from '../../api/taxes'

/** Only what the Overview reads (contract §0.4(f)): the reconciliation's flag count. */
function withholding(flagged: number | null): WithholdingOut {
  return {
    reconciliation:
      flagged === null
        ? null
        : {
            rows: [],
            flagged_count: flagged,
            liability_if_matched: '0.00',
            balance_if_matched: '0.00',
            flag_above: '250.00',
            notes: [],
          },
  } as unknown as WithholdingOut
}

afterEach(() => vi.clearAllMocks())

describe('taxDriftItem (2026-09-23 spec §W4)', () => {
  it('names how many of the year’s inputs differ, and links to the card', () => {
    expect(taxDriftItem(withholding(5), 2026)).toEqual({
      key: 'tax-drift',
      text: '5 of 2026’s tax inputs differ from your records',
      to: '/taxes?section=summary',
    })
    expect(taxDriftItem(withholding(1), 2026)?.text).toBe(
      '1 of 2026’s tax inputs differs from your records',
    )
  })

  it('says nothing when nothing is flagged or there is nothing to compare', () => {
    expect(taxDriftItem(withholding(0), 2026)).toBeNull()
    expect(taxDriftItem(withholding(null), 2026)).toBeNull()
    expect(taxDriftItem(null, 2026)).toBeNull()
  })
})

describe('useTaxDrift', () => {
  it('asks for the year only once it is known to exist', async () => {
    vi.mocked(fetchWithholding).mockResolvedValue(withholding(3))
    const { result, rerender } = renderHook(({ exists }) => useTaxDrift(2026, exists), {
      initialProps: { exists: false },
    })
    expect(result.current).toBeNull()
    expect(vi.mocked(fetchWithholding)).not.toHaveBeenCalled()
    rerender({ exists: true })
    await waitFor(() => expect(result.current?.text).toBe('3 of 2026’s tax inputs differ from your records'))
    expect(vi.mocked(fetchWithholding)).toHaveBeenCalledWith(2026)
  })

  it('treats a failed read as silence, never an error line', async () => {
    vi.mocked(fetchWithholding).mockRejectedValue(new Error('down'))
    const { result } = renderHook(() => useTaxDrift(2026, true))
    await waitFor(() => expect(vi.mocked(fetchWithholding)).toHaveBeenCalledTimes(1))
    expect(result.current).toBeNull()
  })
})
