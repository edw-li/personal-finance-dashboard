import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

// One answer exercising every construct, used to prove the renderer survives the state it
// spends most of its life in: a truncated prefix of this, re-parsed on every streamed token.
const STREAMED_DOC = [
  '## Totals',
  '',
  'Net worth is **$1,234** and *rising* — see `net_worth`.',
  '',
  '| Account | Value |',
  '| --- | ---: |',
  '| Brokerage | $1,000 |',
  '',
  '1. first',
  '2. second',
  '',
  '```ts',
  'const x = 1',
  '```',
  '',
  'More at [the docs](https://example.com).',
].join('\n')

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

  it('treats a space-flanked asterisk as arithmetic, not emphasis', () => {
    const math = mount('$5 * 12 = $60')
    expect(math.container.querySelector('em')).toBeNull()
    expect(math.container.textContent).toContain('$5 * 12 = $60')
    // The case that actually bites: finance prose multiplies more than once per paragraph,
    // and a permissive `\*[^*]+\*` pairs the two operators into one <em> spanning the middle
    // of the sentence — operators eaten, the rest italicised.
    const twice = mount('$5 * 12 = $60 and $3 * 4 = $12')
    expect(twice.container.querySelector('em')).toBeNull()
    expect(twice.container.textContent).toContain('$5 * 12 = $60 and $3 * 4 = $12')
    // …while real emphasis, which is flanked by non-space, keeps working.
    expect(mount('*August*').container.querySelector('em')?.textContent).toBe('August')
    expect(mount('**$1,234**').container.querySelector('strong')?.textContent).toBe('$1,234')
  })

  it('ends a table at the next structural line, even one carrying a pipe', () => {
    const { container } = mount('| a | b |\n| --- | --- |\n| 1 | 2 |\n## Cost | Rev')
    // The heading must not be swallowed as a fourth row just for containing a '|'.
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1)
    const heading = screen.getByText('Cost | Rev')
    expect(heading.tagName).toBe('STRONG')
    expect(heading.className).toBe('md-heading')
  })

  it('renders an unclosed fence as a <pre> (the stream has not reached the closer)', () => {
    const { container } = mount('```python\nx = 1\ny = 2')
    const pre = container.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre?.textContent).toContain('x = 1')
    expect(pre?.textContent).toContain('y = 2')
  })

  it('renders every prefix of a streaming answer without throwing', () => {
    for (let n = 0; n <= STREAMED_DOC.length; n += 1) {
      expect(() => renderMarkdown(STREAMED_DOC.slice(0, n)), `prefix length ${n}`).not.toThrow()
    }
  })

  it("keeps the model's start number on an ordered list", () => {
    expect(mount('3. third\n4. fourth').container.querySelector('ol')?.getAttribute('start')).toBe(
      '3',
    )
    // A plain 1-based list stays attribute-free — the common case renders clean markup.
    expect(
      mount('1. first\n2. second').container.querySelector('ol')?.getAttribute('start'),
    ).toBeNull()
  })
})
