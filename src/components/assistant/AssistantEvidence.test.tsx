import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

it('keeps each finding busy until its own concurrent removal settles', async () => {
  vi.mocked(fetchFindings).mockResolvedValue([8, 9].map(id => ({
    id, title: `Finding ${id}`, content: 'Original figures', evidence: [], context: {}, model_used: null,
    evidence_as_of: '2026-09-25T00:00:00Z', created_at: '2026-09-25T00:00:00Z',
  })))
  let finishFirst!: () => void
  let finishSecond!: () => void
  vi.mocked(deleteFinding)
    .mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve }))
    .mockImplementationOnce(() => new Promise(resolve => { finishSecond = resolve }))
  render(<ConfirmProvider><SavedFindings revision={0} /></ConfirmProvider>)
  const removal = (id: number) => within(document.getElementById(`assistant-finding-${id}`)!).getByRole('button', { name: 'Remove saved finding' })
  for (const id of [8, 9]) {
    fireEvent.click((await screen.findByText(`Finding ${id}`)).closest('summary')!)
    fireEvent.click(removal(id))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove saved finding' }))
    await waitFor(() => expect(deleteFinding).toHaveBeenCalledWith(id))
  }
  expect(removal(8).getAttribute('aria-busy')).toBe('true')
  expect(removal(9).getAttribute('aria-busy')).toBe('true')
  await act(async () => finishFirst())
  expect(removal(9).getAttribute('aria-busy')).toBe('true')
  fireEvent.click(removal(9))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(deleteFinding).toHaveBeenCalledTimes(2)
  await act(async () => finishSecond())
  expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Saved findings' }))
})
