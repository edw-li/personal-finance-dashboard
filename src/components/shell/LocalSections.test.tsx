import { useEffect } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalSectionNav, LocalSectionPanel, useLocalSections } from './LocalSections'

const SECTIONS = [{ id: 'summary', label: 'Summary' }, { id: 'inputs', label: 'Inputs' }] as const
const mounted = vi.fn()
function Editor() { useEffect(() => { mounted() }, []); return <label>Draft amount<input defaultValue="10" /></label> }
function Harness() {
  const state = useLocalSections(SECTIONS, 'summary', { resolveLegacy: ({ searchParams }) => searchParams.has('edit') ? 'inputs' : null })
  const location = useLocation()
  const navigate = useNavigate()
  return <>
    <LocalSectionNav state={state} label="Page views" />
    <LocalSectionPanel state={state} section="summary"><p>Summary content</p></LocalSectionPanel>
    <LocalSectionPanel state={state} section="inputs"><Editor /></LocalSectionPanel>
    <output>{location.search}</output><button type="button" onClick={() => navigate(-1)}>Browser back</button>
    <button type="button" onClick={() => { const params = new URLSearchParams(location.search); params.delete('edit'); navigate({ search: params.toString() }, { replace: true }) }}>Consume arrival</button>
    <button type="button" onClick={() => navigate('/taxes')}>Open bare page</button>
  </>
}
afterEach(() => { cleanup(); mounted.mockClear() })
describe('task-oriented local sections', () => {
  it('mounts editors only when visited and preserves drafts and scope between views', () => {
    render(<MemoryRouter initialEntries={['/taxes?owner=2&year=2026&view=list']}><Harness /></MemoryRouter>)
    expect(mounted).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: 'Inputs' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Draft amount' }), { target: { value: '425' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Summary' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Inputs' }))
    expect((screen.getByRole('textbox', { name: 'Draft amount' }) as HTMLInputElement).value).toBe('425')
    expect(mounted).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status').textContent).toBe('?owner=2&year=2026&view=list&section=inputs')
  })
  it('opens legacy editor links and allows an explicit section to override carried params', async () => {
    render(<MemoryRouter initialEntries={['/taxes?edit=income&year=2026']}><Harness /></MemoryRouter>)
    expect(screen.getByRole('tab', { name: 'Inputs' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: 'Summary' }))
    expect(screen.getByRole('tab', { name: 'Summary' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Inputs' }).getAttribute('aria-selected')).toBe('true'))
  })
  it('supports keyboard tab navigation with the same panels and scope', () => {
    render(<MemoryRouter><Harness /></MemoryRouter>)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Summary' }), { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Inputs' }).getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Inputs' }))
  })
  it('retains an inferred editor after its arrival parameter is consumed, without making the next bare address sticky', () => {
    render(<MemoryRouter initialEntries={['/taxes?edit=income&year=2026']}><Harness /></MemoryRouter>)
    fireEvent.change(screen.getByRole('textbox', { name: 'Draft amount' }), { target: { value: '720' } })
    fireEvent.click(screen.getByRole('button', { name: 'Consume arrival' }))
    expect(screen.getByRole('tab', { name: 'Inputs' }).getAttribute('aria-selected')).toBe('true')
    expect((screen.getByRole('textbox', { name: 'Draft amount' }) as HTMLInputElement).value).toBe('720')
    expect(screen.getByRole('status').textContent).toBe('?year=2026')
    fireEvent.click(screen.getByRole('button', { name: 'Open bare page' }))
    expect(screen.getByRole('tab', { name: 'Summary' }).getAttribute('aria-selected')).toBe('true')
  })
})
