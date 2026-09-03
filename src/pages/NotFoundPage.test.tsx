import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import NotFoundPage from './NotFoundPage'

afterEach(cleanup)

describe('NotFoundPage', () => {
  it('names the missing path and links home', () => {
    render(
      <MemoryRouter initialEntries={['/no-such-page']}>
        <Routes>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </MemoryRouter>,
    )
    // Through the frame like every other page (2026-09-03 shell spec §5): same title row,
    // no bespoke header of its own.
    expect(screen.getByRole('heading', { level: 1, name: 'Not found' })).toBeTruthy()
    expect(screen.getByText('No page at /no-such-page.')).toBeTruthy()
    const home = screen.getByRole('link', { name: 'Back to the overview →' })
    expect(home.getAttribute('href')).toBe('/')
  })
})
