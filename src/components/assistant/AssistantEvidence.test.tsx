import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { deleteFinding, fetchFindings } from '../../api/assistantFindings'
import { ConfirmProvider } from '../feedback/confirm'
import { SavedFindings } from './AssistantEvidence'

vi.mock('../../api/assistantFindings', () => ({ fetchFindings: vi.fn(), deleteFinding: vi.fn(), saveFinding: vi.fn() }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('confirms irreversible removal, cancels without writing and keeps focus after removal', async () => {
  vi.mocked(fetchFindings).mockResolvedValue([{
    id: 8, title: 'Spending review', content: 'Original figures', evidence: [], context: {}, model_used: null,
    evidence_as_of: '2026-09-25T00:00:00Z', created_at: '2026-09-25T00:00:00Z',
  }])
  vi.mocked(deleteFinding).mockResolvedValue(undefined)
  render(<ConfirmProvider><SavedFindings revision={0} /></ConfirmProvider>)
  const title = await screen.findByText('Spending review')
  fireEvent.click(title.closest('summary')!)
  fireEvent.click(await screen.findByRole('button', { name: 'Remove saved finding' }))
  const question = screen.getByRole('alertdialog', { name: 'Remove Spending review?' })
  expect(within(question).getByText("This can't be undone.")).toBeTruthy()
  fireEvent.click(within(question).getByRole('button', { name: 'Cancel' }))
  expect(deleteFinding).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Remove saved finding' }))
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove saved finding' }))
  await screen.findByText(/No saved findings yet/)
  expect(deleteFinding).toHaveBeenCalledWith(8)
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Saved findings' })))
})
