import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { SettingsMapTable } from './settingsMap'

describe('the "where to configure" map', () => {
  it('names every field of Plan assumptions, the plan-until year included (2026-09-24 review minor 12)', () => {
    render(
      <MemoryRouter>
        <SettingsMapTable />
      </MemoryRouter>,
    )
    const row = screen.getByText('Withdrawal rate, Plan until (year), ESPP ticker and discount').closest('tr')
    expect(row?.textContent).toContain('Planning → Plan assumptions')
  })
})
