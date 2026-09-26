import { describe, expect, it } from 'vitest'
import { CONFIRM_GAP_PX, CONFIRM_MARGIN_PX, placeConfirm } from './confirmPlacement'

const anchor = (top: number, right: number, height = 32) => ({ top, bottom: top + height, right })
const VIEW = { width: 1440, height: 900 }
const SIZE = { width: 300, height: 140 }

describe('placeConfirm', () => {
  it('opens below its anchor, right edges aligned', () => {
    expect(placeConfirm(anchor(200, 1000), SIZE, VIEW)).toEqual({
      top: 232 + CONFIRM_GAP_PX,
      left: 700,
      placement: 'below',
    })
  })

  it('flips above when there is no room below and more above', () => {
    // Below: 900 − 8 − (832 + 6) = 54px for a 140px popover; above: 800 − 6 − 8 = 786px.
    expect(placeConfirm(anchor(800, 1000), SIZE, VIEW)).toEqual({
      top: 800 - CONFIRM_GAP_PX - 140,
      left: 700,
      placement: 'above',
    })
  })

  it('stays below when it fits there, however much room there is above', () => {
    expect(placeConfirm(anchor(700, 1000), SIZE, VIEW).placement).toBe('below') // 900 − 8 − 738 = 154 ≥ 140
  })

  it('takes the roomier side when neither fits', () => {
    const short = { width: 1440, height: 200 }
    expect(placeConfirm(anchor(60, 1000), SIZE, short).placement).toBe('below') // 94 below, 46 above
    expect(placeConfirm(anchor(110, 1000), SIZE, short).placement).toBe('above') // 44 below, 96 above
  })

  it('keeps inside the window sideways', () => {
    expect(placeConfirm(anchor(200, 120), SIZE, VIEW).left).toBe(CONFIRM_MARGIN_PX)
    expect(placeConfirm(anchor(200, 1500), SIZE, VIEW).left).toBe(1440 - CONFIRM_MARGIN_PX - 300)
  })
})
