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
