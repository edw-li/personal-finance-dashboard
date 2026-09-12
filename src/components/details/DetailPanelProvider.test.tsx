import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DetailPanelProvider, { panelGeometry, useDetailPanel } from './DetailPanelProvider'

function Harness() {
  const panel = useDetailPanel()!
  return <button type="button" onClick={() => panel.open({ id: 'chart', title: 'August spending', content: <>
    <p>Selected month retained</p>
    <button type="button" onClick={() => panel.open({ id: 'metric', title: 'Living spending', content: <p>Source receipt</p> })}>Open calculation</button>
  </> })}>Inspect month</button>
}
beforeEach(() => { Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true }) })
afterEach(cleanup)

describe('coordinated detail panels', () => {
  it('replaces a surface with its evidence and Back returns to the selection', () => {
    render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
    const trigger = screen.getByRole('button', { name: 'Inspect month' })
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: 'August spending' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open calculation' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByText('Source receipt')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Selected month retained')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
  it('resizes by keyboard and reserves page space only in dock mode', () => {
    render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Inspect month' }))
    const separator = screen.getByRole('separator', { name: 'Resize detail panel' })
    expect(separator.getAttribute('aria-valuenow')).toBe('440')
    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    expect(separator.getAttribute('aria-valuenow')).toBe('460')
    expect((document.querySelector('.detail-layout-content') as HTMLElement).style.marginInlineEnd).toBe('460px')
    fireEvent.click(screen.getByRole('button', { name: 'Overlay' }))
    expect((document.querySelector('.detail-layout-content') as HTMLElement).style.marginInlineEnd).toBe('0')
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Expand reading' }))
    expect(screen.getByRole('dialog').className).toContain('detail-panel-expanded')
    expect(screen.getByText('Selected month retained')).toBeTruthy()
  })
  it('falls back to overlay when a dock would crowd the main content', () => {
    expect(panelGeometry(1200, 440, 'dock')).toMatchObject({ canDock: false, mode: 'overlay', width: 440 })
    expect(panelGeometry(1600, 900, 'dock')).toMatchObject({ canDock: true, mode: 'dock', width: 670 })
  })
  it('restores focus only after an overlay releases the inert page', () => {
    render(<DetailPanelProvider><Harness /></DetailPanelProvider>)
    const trigger = screen.getByRole('button', { name: 'Inspect month' })
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Overlay' }))
    const content = document.querySelector('.detail-layout-content')!
    expect(content.hasAttribute('inert')).toBe(true)
    const focusedWhileInert: boolean[] = []
    const originalFocus = trigger.focus.bind(trigger)
    const focus = vi.spyOn(trigger, 'focus').mockImplementation((options) => {
      focusedWhileInert.push(content.hasAttribute('inert'))
      originalFocus(options)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    expect(focusedWhileInert).toEqual([false])
    expect(document.activeElement).toBe(trigger)
    focus.mockRestore()
  })
})
