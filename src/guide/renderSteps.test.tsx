import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderSteps } from './renderSteps'

afterEach(cleanup)

describe('renderSteps', () => {
  it('turns **Label** spans into bold on-screen labels and leaves the rest as text', () => {
    const { container } = render(<p>{renderSteps('Open **Manage**, then press **Add card**.')}</p>)
    const labels = Array.from(container.querySelectorAll('b.guide-label')).map((b) => b.textContent)
    expect(labels).toEqual(['Manage', 'Add card'])
    expect(container.textContent).toBe('Open Manage, then press Add card.')
  })

  it('recognises no other markup — asterisks, backticks and brackets render literally', () => {
    const { container } = render(<p>{renderSteps('Type *5* for `5 %` and see [the chart](x).')}</p>)
    expect(container.querySelector('b')).toBeNull()
    expect(container.textContent).toBe('Type *5* for `5 %` and see [the chart](x).')
  })

  it('escapes angle brackets as text, never markup', () => {
    const { container } = render(<p>{renderSteps('Pick **Start <Month>** when it appears.')}</p>)
    expect(container.querySelector('b.guide-label')?.textContent).toBe('Start <Month>')
    expect(container.querySelector('month')).toBeNull()
  })
})
