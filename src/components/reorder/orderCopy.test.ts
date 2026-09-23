import { describe, expect, it } from 'vitest'
import { ApiError } from '../../api/client'
import {
  ORDER_RESTORED,
  clause,
  movedToast,
  orderSaveFailed,
  undoFailed,
  undoFailureText,
} from './orderCopy'

describe('orderCopy (spec §8.1)', () => {
  it('speaks the §8.1 sentences', () => {
    expect(movedToast('Housing')).toBe('Moved Housing')
    expect(ORDER_RESTORED).toBe('Order restored')
    expect(orderSaveFailed('Network is down.')).toBe(
      "Couldn't save the new order — Network is down. The list is back to how it was.",
    )
    expect(undoFailed('Network is down.')).toBe("Couldn't undo the move — Network is down.")
  })

  it('a sentence placed inside ours loses only its trailing stop', () => {
    expect(clause('Later changes touched these rows — undo those first.')).toBe(
      'Later changes touched these rows — undo those first',
    )
    expect(clause('no stop')).toBe('no stop')
    expect(clause('trailing space. ')).toBe('trailing space')
  })

  it('an Undo refused by the server (any 4xx) shows the server sentence verbatim; anything else is ours', () => {
    const overlap = new ApiError('Later changes touched these rows — undo those first', 409)
    expect(undoFailureText(overlap)).toBe('Later changes touched these rows — undo those first')
    const stale = new ApiError('The cards changed since this list was loaded — nothing was moved.', 409)
    expect(undoFailureText(stale)).toBe('The cards changed since this list was loaded — nothing was moved.')
    // Every 4xx, not only the 409s — its own stop kept, since it stands alone.
    expect(undoFailureText(new ApiError('ids lists 3 more than once.', 422))).toBe(
      'ids lists 3 more than once.',
    )
    expect(undoFailureText(new ApiError('Bad request', 400))).toBe('Bad request')
    // Anything else is ours, around the house's reason (errorDetail).
    expect(undoFailureText(new ApiError('Internal Server Error', 500))).toBe(
      "Couldn't undo the move — the server had a problem (HTTP 500).",
    )
    expect(undoFailureText(new ApiError('Request timed out', 0))).toBe(
      "Couldn't undo the move — the request timed out.",
    )
    expect(undoFailureText(new TypeError('Failed to fetch'))).toBe(
      "Couldn't undo the move — Failed to fetch.",
    )
    expect(undoFailureText('not an error')).toBe("Couldn't undo the move — something went wrong.")
  })

  it('a refusal that brought no sentence names its status rather than showing nothing', () => {
    expect(undoFailureText(new ApiError('', 409))).toBe('HTTP 409')
  })
})
