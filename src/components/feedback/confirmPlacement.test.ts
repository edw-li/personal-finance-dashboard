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

  it('keeps inside the window top to bottom when neither side fits — a short window', () => {
    const short = { width: 1440, height: 200 }
    // Below wins (94px against 46px) but a 140px popover from 98 would cross the foot at 238: it rises
    // to 200 − 8 − 140 = 52, as low as it can stand whole.
    expect(placeConfirm(anchor(60, 1000), SIZE, short)).toEqual({ top: 52, left: 700, placement: 'below' })
    // Above wins (96px against 44px), and from 110 − 6 − 140 = −36 it drops to the top margin.
    expect(placeConfirm(anchor(110, 1000), SIZE, short).top).toBe(CONFIRM_MARGIN_PX)
    // A window shorter than the popover: pinned to the top margin, its foot the part that overflows.
    expect(placeConfirm(anchor(40, 1000), SIZE, { width: 1440, height: 100 }).top).toBe(CONFIRM_MARGIN_PX)
  })

  it('keeps inside the window sideways', () => {
    expect(placeConfirm(anchor(200, 120), SIZE, VIEW).left).toBe(CONFIRM_MARGIN_PX)
    expect(placeConfirm(anchor(200, 1500), SIZE, VIEW).left).toBe(1440 - CONFIRM_MARGIN_PX - 300)
  })
})
