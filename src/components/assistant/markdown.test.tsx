import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

// vitest runs without `globals`, so RTL never registers its own auto-cleanup — without this
// every render stacks up in one document and the `md` testid / short cell texts collide.
afterEach(cleanup)

function mount(text: string) {
  return render(<div data-testid="md">{renderMarkdown(text)}</div>)
}

describe('renderMarkdown', () => {
  it('renders bold, italic and inline code', () => {
    mount('a **b** *c* `d`')
    expect(screen.getByText('b').tagName).toBe('STRONG')
    expect(screen.getByText('c').tagName).toBe('EM')
    expect(screen.getByText('d').tagName).toBe('CODE')
  })

  it('renders unordered and ordered lists', () => {
    mount('- one\n- two\n\n1. first\n2. second')
    expect(screen.getByText('one').closest('ul')).not.toBeNull()
    expect(screen.getByText('first').closest('ol')).not.toBeNull()
  })

  it('renders pipe tables with header cells', () => {
    mount('| a | b |\n| --- | --- |\n| 1 | 2 |')
    expect(screen.getByText('a').tagName).toBe('TH')
    expect(screen.getByText('2').tagName).toBe('TD')
  })

  it('renders fenced code blocks verbatim', () => {
    mount('```\nconst x = 1\n```')
    expect(screen.getByText('const x = 1').closest('pre')).not.toBeNull()
  })

  it('renders headings as styled strongs, not h-tags (page owns the outline)', () => {
    mount('## Totals')
    const node = screen.getByText('Totals')
    expect(node.tagName).toBe('STRONG')
    expect(node.className).toBe('md-heading')
  })

  it('never injects HTML — tags arrive as literal text', () => {
    mount('<script>alert(1)</script> and <b>bold?</b>')
    expect(document.querySelector('script')).toBeNull()
    expect(screen.getByTestId('md').textContent).toContain('<script>alert(1)</script>')
  })

  it('renders markdown links as plain text (no model-driven navigation)', () => {
    mount('[click me](https://example.com)')
    expect(document.querySelector('a')).toBeNull()
    expect(screen.getByTestId('md').textContent).toContain('click me (https://example.com)')
  })
})
