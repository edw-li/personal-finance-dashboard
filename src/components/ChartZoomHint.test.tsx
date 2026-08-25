import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import ChartZoomHint from './ChartZoomHint'

afterEach(cleanup)

it('states the inside-zoom gesture in the one shared wording', () => {
  render(<ChartZoomHint />)
  const hint = screen.getByText('ctrl+scroll to zoom · drag to pan')
  expect(hint.className).toBe('chart-zoom-hint')
})
