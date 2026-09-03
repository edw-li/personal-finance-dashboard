import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ThemeProvider from '../shell/ThemeProvider'
import AppearanceCard from './AppearanceCard'

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('AppearanceCard', () => {
  it('shows the current choices and writes them through the provider', () => {
    render(
      <ThemeProvider>
        <AppearanceCard />
      </ThemeProvider>,
    )
    expect(screen.getByRole('region', { name: 'Appearance' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Light' }))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('finance.theme')).toBe('light')
    fireEvent.click(screen.getByRole('button', { name: 'Compact' }))
    expect(document.documentElement.dataset.density).toBe('compact')
    expect(localStorage.getItem('finance.density')).toBe('compact')
    // The card must READ BACK from the provider, not just write to it: a hard-coded
    // `value` would still flip the html attributes above while leaving the pressed state
    // stuck on the defaults.
    expect(screen.getByRole('button', { name: 'Light' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'Compact' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
  })

  it('carries the anchor id the palette jumps to', () => {
    render(
      <ThemeProvider>
        <AppearanceCard />
      </ThemeProvider>,
    )
    expect(document.getElementById('appearance')).toBeTruthy()
  })
})
