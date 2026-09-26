import { afterEach, describe, expect, it } from 'vitest'
import { FOCUSABLE, focusablesIn } from './focusable'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('focusablesIn', () => {
  it('lists what can take the caret, in document order — links and quiet buttons included', () => {
    document.body.innerHTML =
      '<div id="root"><a href="/help">help</a><a>no href</a><button id="quiet" aria-disabled="true">Save</button>' +
      '<button disabled>Off</button><input type="hidden"><input id="field"><select disabled></select>' +
      '<textarea id="notes"></textarea><details><summary id="more">More</summary></details>' +
      '<span tabindex="0" id="chip">chip</span><span tabindex="-1">not a stop</span></div>'
    const root = document.getElementById('root') as HTMLElement
    expect(focusablesIn(root).map((el) => el.id || el.textContent)).toEqual([
      'help',
      'quiet',
      'field',
      'notes',
      'more',
      'chip',
    ])
  })

  it('skips anything inside a hidden subtree', () => {
    document.body.innerHTML = '<div id="root"><div hidden><button>Gone</button></div><button>Here</button></div>'
    expect(focusablesIn(document.getElementById('root') as HTMLElement).map((el) => el.textContent)).toEqual(['Here'])
  })

  it('is one selector an element can be matched against', () => {
    const link = document.createElement('a')
    link.href = '/x'
    expect(link.matches(FOCUSABLE)).toBe(true)
    expect(document.createElement('li').matches(FOCUSABLE)).toBe(false)
  })
})
