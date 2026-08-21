import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import InfoHint from './InfoHint'

afterEach(cleanup)

// The hint's whole contract is that the authored text rides TWICE: `aria-label` is what a
// screen reader announces, `data-tip` is what the CSS `::after` bubble renders. The bubble
// itself is untestable in jsdom (no ::after, no :hover), so what is pinned here is the pair
// staying in sync — a hint that lost `data-tip` would look fine to axe and show nothing to
// a sighted user, and one that lost `aria-label` would be a nameless button.
const TEXT = 'Assets minus liabilities from the latest monthly snapshot.'

describe('InfoHint', () => {
  it('names the button with the text and hands the same text to the CSS bubble', () => {
    render(<InfoHint text={TEXT} />)
    const button = screen.getByRole('button', { name: TEXT })
    expect(button.getAttribute('aria-label')).toBe(TEXT)
    expect(button.getAttribute('data-tip')).toBe(TEXT)
    expect(button.className).toContain('info-hint')
  })

  it('is type="button" so it never submits a form it sits inside', () => {
    // Hints live in headings and tile labels, but ESPP/Update pages put tiles beside forms;
    // the HTML default (type="submit") would turn a hover affordance into a submit.
    render(<InfoHint text={TEXT} />)
    expect(screen.getByRole('button').getAttribute('type')).toBe('button')
  })

  it('hides the icon from assistive tech and adds no text node to its heading', () => {
    render(<InfoHint text={TEXT} />)
    const button = screen.getByRole('button')
    const icon = button.querySelector('svg')
    // The lucide glyph is decoration — the aria-label already says everything.
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    // …and because the words live in ATTRIBUTES, the icon contributes no text. This is what
    // lets ~78 hints land in existing headings without breaking a single getByText query.
    expect(button.textContent).toBe('')
  })
})
