import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PresetRow from './PresetRow'

afterEach(cleanup)

describe('PresetRow', () => {
  it('renders chips that apply, and disabled chips that name the missing datum', () => {
    const apply = vi.fn()
    render(
      <PresetRow
        presets={[
          { id: 'max401k', label: 'Max 401(k)', apply },
          {
            id: 'maxhsa',
            label: 'Max HSA',
            apply: vi.fn(),
            disabled: true,
            title: "Enter this year's HSA limit in Settings › Limits",
          },
        ]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Max 401(k)' }))
    expect(apply).toHaveBeenCalledTimes(1)
    const hsa = screen.getByRole('button', { name: 'Max HSA' }) as HTMLButtonElement
    expect(hsa.disabled).toBe(true)
    expect(hsa.title).toBe("Enter this year's HSA limit in Settings › Limits")
    expect(screen.getByRole('group', { name: 'Presets' })).toBeTruthy()
  })
})
