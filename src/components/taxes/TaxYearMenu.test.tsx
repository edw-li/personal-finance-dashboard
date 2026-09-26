import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ConfirmProvider } from '../feedback/confirm'
import TaxYearMenu from './TaxYearMenu'

afterEach(cleanup)

function props() {
  return {
    newYear: '2027', onNewYearChange: vi.fn(), onCreate: vi.fn().mockResolvedValue(true),
    creating: false, createError: null, yearMin: 1900, yearMax: 2100,
    createHint: 'Copies tables.', selectedYear: 2026, onDelete: vi.fn(),
  }
}

it('Cancel and Escape keep the year menu open and return focus to its Delete control', async () => {
  const callbacks = props()
  render(<ConfirmProvider><TaxYearMenu {...callbacks} /></ConfirmProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'New tax year…' }))
  const anchor = screen.getByRole('button', { name: 'Delete 2026…' })
  fireEvent.click(anchor)
  const question = await screen.findByRole('alertdialog')
  expect(document.activeElement).toBe(within(question).getByRole('button', { name: 'Cancel' }))
  fireEvent.click(within(question).getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(document.activeElement).toBe(anchor)
  expect(screen.getByRole('dialog', { name: 'New tax year' })).toBeTruthy()
  fireEvent.click(anchor)
  await screen.findByRole('alertdialog')
  fireEvent.keyDown(window, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(document.activeElement).toBe(anchor)
  expect(callbacks.onDelete).not.toHaveBeenCalled()
})

it('deletes only after acceptance and hands focus back to the year menu trigger', async () => {
  const callbacks = props()
  render(<ConfirmProvider><TaxYearMenu {...callbacks} /></ConfirmProvider>)
  const trigger = screen.getByRole('button', { name: 'New tax year…' })
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('button', { name: 'Delete 2026…' }))
  const question = await screen.findByRole('alertdialog')
  fireEvent.click(within(question).getByRole('button', { name: 'Delete 2026' }))
  await waitFor(() => expect(callbacks.onDelete).toHaveBeenCalledOnce())
  expect(screen.queryByRole('dialog', { name: 'New tax year' })).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

it('a selection change while the question is open cannot delete either year', async () => {
  const callbacks = props()
  const tree = (selectedYear: number) => <ConfirmProvider><TaxYearMenu {...callbacks} selectedYear={selectedYear} /></ConfirmProvider>
  const view = render(tree(2026))
  fireEvent.click(screen.getByRole('button', { name: 'New tax year…' }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete 2026…' }))
  const question = await screen.findByRole('alertdialog')
  view.rerender(tree(2025))
  fireEvent.click(within(question).getByRole('button', { name: 'Delete 2026' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(callbacks.onDelete).not.toHaveBeenCalled()
})
