import { beforeEach, describe, expect, it } from 'vitest'
import { PIN_LIMIT, newPin, pinsKey, readPins, writePins } from './pins'

beforeEach(() => localStorage.clear())

const acceptAll = () => true

describe('pins store', () => {
  it('names the key per page and starts empty', () => {
    expect(pinsKey('taxes')).toBe('finance.sandbox.taxes')
    expect(readPins('taxes', acceptAll)).toEqual([])
    expect(PIN_LIMIT).toBe(3)
  })

  it('round-trips pins and drops the ones the decoder rejects', () => {
    const a = newPin('Sell 40 VTI', ['sale:7:40'])
    const b = newPin('Garbage', ['nope'])
    writePins('taxes', [a, b])
    expect(readPins('taxes', acceptAll)).toEqual([a, b])
    expect(readPins('taxes', (entries) => entries[0] !== 'nope')).toEqual([a])
    expect(a.id).not.toBe(b.id)
    expect(a.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('reads a corrupt or foreign blob as empty', () => {
    localStorage.setItem(pinsKey('paycheck'), '{not json')
    expect(readPins('paycheck', acceptAll)).toEqual([])
    localStorage.setItem(pinsKey('paycheck'), JSON.stringify({ version: 99, pins: [] }))
    expect(readPins('paycheck', acceptAll)).toEqual([])
    localStorage.setItem(
      pinsKey('paycheck'),
      JSON.stringify({
        version: 1,
        pins: [
          { id: 1, label: 'x', entries: 'a:1' },
          { id: 'ok', label: 'y', createdAt: 't', entries: ['a:1'] },
        ],
      }),
    )
    expect(readPins('paycheck', acceptAll)).toEqual([{ id: 'ok', label: 'y', createdAt: 't', entries: ['a:1'] }])
  })
})
