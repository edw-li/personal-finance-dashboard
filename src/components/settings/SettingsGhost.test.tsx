import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import SettingsGhost, { SETTINGS_CARD_CHROME_PX } from './SettingsGhost'

afterEach(cleanup)

describe('SettingsGhost', () => {
  it('stands as tall as the loaded card minus the chrome already on screen, and announces once', () => {
    render(<SettingsGhost height={415} />)
    const ghost = document.querySelector('.settings-ghost') as HTMLElement
    expect(ghost.classList.contains('skeleton')).toBe(true)
    expect(ghost.getAttribute('aria-hidden')).toBe('true')
    expect(ghost.style.height).toBe(`${415 - SETTINGS_CARD_CHROME_PX}px`)
    expect(ghost.dataset.ghostHeight).toBe('415')
    expect(screen.getByRole('status').textContent).toBe('Loading…')
  })

  it('subtracts extra chrome a card already shows above its body', () => {
    render(<SettingsGhost height={415} chrome={SETTINGS_CARD_CHROME_PX + 42} label="Loading limits…" />)
    const ghost = document.querySelector('.settings-ghost') as HTMLElement
    expect(ghost.style.height).toBe(`${415 - SETTINGS_CARD_CHROME_PX - 42}px`)
    expect(screen.getByRole('status').textContent).toBe('Loading limits…')
  })
})
