import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistantHandlers, ChatRequest } from '../../api/assistantStream'
import { reviewEvidenceFixture as bundle } from '../../testing/assistantEvidenceFixtures'
import DetailPanelProvider from '../details/DetailPanelProvider'
import { EXPLAIN_SELECTION_EVENT } from '../details/explainSelection'
import AssistantDrawer from './AssistantDrawer'
import { AssistantMessageBody, ComputedSummary, SavedFindings } from './AssistantEvidence'

const mocks = vi.hoisted(() => ({ settings: vi.fn(), stream: vi.fn(), save: vi.fn(), findings: vi.fn(), remove: vi.fn() }))
vi.mock('../../api/assistant', () => ({ fetchAssistantSettings: mocks.settings, fetchAssistantModels: async () => ({ models: [
  { key: 'kimi-k3', label: 'Kimi', available: true, default: true }, { key: 'alternate', label: 'Alternate', available: true },
] }), fetchContextPreview: async () => ({ sections: [] }) }))
vi.mock('../../api/household', () => ({ fetchHousehold: async () => ({ people: [] }) }))
vi.mock('../../api/assistantStream', () => ({ streamChat: mocks.stream }))
vi.mock('../../api/assistantFindings', () => ({ saveFinding: mocks.save, fetchFindings: mocks.findings, deleteFinding: mocks.remove }))

let handlers: AssistantHandlers
let abort: ReturnType<typeof vi.fn>
function Navigation() {
  const navigate = useNavigate()
  return <button onClick={() => navigate('/portfolio?owner=2')}>Change page</button>
}
function mount(shared = false) {
  const view = <><Navigation /><AssistantDrawer /></>
  return render(<MemoryRouter initialEntries={['/spending?month=2026-08-01']}>{shared ? <DetailPanelProvider>{view}</DetailPanelProvider> : view}</MemoryRouter>)
}
beforeEach(() => {
  mocks.settings.mockResolvedValue({ key: { configured: true }, default_model: 'kimi-k3' })
  abort = vi.fn()
  mocks.stream.mockImplementation((_request: ChatRequest, listener: AssistantHandlers) => { handlers = listener; return { abort, finished: new Promise(() => {}) } })
  mocks.findings.mockResolvedValue([])
  mocks.save.mockResolvedValue({ id: 1 })
})
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); vi.clearAllMocks(); Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true }) })

describe('assistant evidence and working context', () => {
  it('retains a computed review after provider failure and saves only this dated finding', async () => {
    mocks.settings.mockResolvedValue({ key: { configured: false }, default_model: 'kimi-k3' })
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Open assistant' }))
    await screen.findByText(/Computed month reviews are available/)
    fireEvent.click(screen.getByRole('button', { name: 'Review latest completed month' }))
    expect(mocks.stream.mock.calls[0][0].intent).toBe('month_review')
    act(() => { handlers.onComputedSummary?.(bundle); handlers.onError({ kind: 'bad_key', message: 'Written explanation unavailable.' }) })
    expect(screen.getByRole('region', { name: 'Computed summary' }).textContent).toContain('$1,234.56')
    expect(screen.getByText('Review the latest completed month.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save finding' }))
    await screen.findByRole('button', { name: 'Finding saved' })
    expect(mocks.save).toHaveBeenCalledWith('Review the latest completed month.', '', undefined, bundle)
    fireEvent.click(screen.getByRole('tab', { name: 'Saved findings' }))
    await screen.findByText(/No saved findings yet/)
    expect(mocks.findings).toHaveBeenCalledOnce()
  })

  it('keeps the captured chart selection and owner when retrying after navigation', async () => {
    mount()
    const captured = { chartTitle: 'Account values', sourceRoute: '/net-worth?owner=1&month=2026-08-01', capturedAt: '2026-09-12T09:00:00Z',
      selection: { kind: 'entity', id: 'account:7', entityId: 7, entityType: 'account', label: 'Brokerage', scope: 1, values: [{ label: 'Balance', value: '5000.00', unit: 'USD' }] } }
    act(() => window.dispatchEvent(new CustomEvent(EXPLAIN_SELECTION_EVENT, { detail: captured })))
    await waitFor(() => expect(mocks.stream).toHaveBeenCalledOnce())
    const original = structuredClone(mocks.stream.mock.calls[0][0].context)
    fireEvent.click(screen.getByRole('button', { name: 'Change page' }))
    act(() => { handlers.onToken('The balance'); handlers.onError({ kind: 'unavailable', message: 'Provider stopped.' }) })
    expect(screen.getByText('Partial answer.')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Retry with Alternate' }))
    expect(mocks.stream.mock.calls[1][0].context).toEqual(original)
    expect(mocks.stream.mock.calls[1][0].intent).toBe('selection')
    expect(mocks.stream.mock.calls[1][0].messages.filter((m: { role: string }) => m.role === 'user')).toHaveLength(1)
  })

  it('preserves the composer when inspecting evidence and returning to the shared panel', async () => {
    mount(true)
    fireEvent.click(screen.getByRole('button', { name: 'Open assistant' }))
    await screen.findByRole('textbox', { name: 'Ask the assistant' })
    fireEvent.click(screen.getByRole('button', { name: 'Review latest completed month' }))
    act(() => { handlers.onComputedSummary?.(bundle); handlers.onDone({ model_used: 'kimi-k3' }) })
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask the assistant' }), { target: { value: 'Keep this draft' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Inspect Living spending' })[0])
    expect(screen.getByRole('dialog', { name: 'Living spending' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Assistant' }))
    expect((screen.getByRole('textbox', { name: 'Ask the assistant' }) as HTMLTextAreaElement).value).toBe('Keep this draft')
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('raises a retained assistant from Explain and the launcher without losing its draft', async () => {
    mount(true)
    fireEvent.click(screen.getByRole('button', { name: 'Open assistant' }))
    await screen.findByRole('textbox', { name: 'Ask the assistant' })
    fireEvent.click(screen.getByRole('button', { name: 'Review latest completed month' }))
    act(() => { handlers.onComputedSummary?.(bundle); handlers.onDone({ model_used: 'kimi-k3' }) })
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask the assistant' }), { target: { value: 'Keep this draft' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Inspect Living spending' })[0])
    expect(screen.getByRole('button', { name: 'Open assistant' }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Open assistant' }))
    expect(screen.getByRole('dialog', { name: 'Assistant' })).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'Ask the assistant' }) as HTMLTextAreaElement).value).toBe('Keep this draft')
    fireEvent.click(screen.getAllByRole('button', { name: 'Inspect Living spending' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Explain this number' }))
    await waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('dialog', { name: 'Assistant' })).toBeTruthy()
    expect(mocks.stream.mock.calls[1][0].context.selection.selection.evidence[0]).toEqual(bundle.metrics[0])
  })

  it('inside the shared panel: non-modal, the model picker and New chat in the panel chrome, no drawer header, launcher stepped aside', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true }) // too narrow to dock → overlay
    mount(true)
    fireEvent.click(screen.getByRole('button', { name: 'Open assistant' }))
    const dialog = await screen.findByRole('dialog', { name: 'Assistant' })
    await screen.findByRole('textbox', { name: 'Ask the assistant' })
    // G1: a chat the reader can use while looking at the numbers — the page stays live.
    expect(dialog.className).toContain('detail-panel-overlay')
    expect(dialog.getAttribute('aria-modal')).toBeNull()
    expect(document.querySelector('.detail-panel-backdrop')).toBeNull()
    expect(document.querySelector('.detail-layout-content')!.hasAttribute('inert')).toBe(false)
    // B2: one chrome row — the drawer's own header is gone; its controls are the panel's actions.
    const controls = dialog.querySelector('.detail-panel-controls') as HTMLElement
    expect(within(controls).getByRole('combobox', { name: 'Model' })).toBeTruthy()
    expect(within(controls).getByRole('button', { name: 'New chat' })).toBeTruthy()
    expect(document.querySelector('.assistant-header')).toBeNull()
    expect(document.querySelector('.assistant-drawer-coordinated')).toBeTruthy()
    // The launcher steps aside while the conversation IS the active panel; the panel's Close is the exit.
    expect(screen.queryByRole('button', { name: 'Open assistant' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Open assistant' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('ignores late content after Stop and cancels the provider when unmounted', async () => {
    const view = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Open assistant' }))
    await screen.findByRole('textbox', { name: 'Ask the assistant' })
    fireEvent.click(screen.getByRole('button', { name: 'Review latest completed month' }))
    act(() => handlers.onComputedSummary?.(bundle))
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    act(() => handlers.onToken('Late answer must not appear'))
    expect(screen.queryByText('Late answer must not appear')).toBeNull()
    expect(abort).toHaveBeenCalledOnce()
    view.unmount()
    expect(abort).toHaveBeenCalledTimes(2)
  })

  it('asks about a metric as a figure, never "X in X"', async () => {
    mount()
    const captured = { chartTitle: 'Net worth', sourceRoute: '/', capturedAt: '2026-09-13T00:00:00Z',
      selection: { kind: 'point', id: 'metric:net_worth', label: 'Net worth', date: '2026-08-01', scope: 'household',
        values: [{ label: 'Net worth', value: '806708.50', unit: 'USD' }], evidence: [{ ...bundle.metrics[0], window: null, as_of: '2026-08-01' }] } }
    act(() => window.dispatchEvent(new CustomEvent(EXPLAIN_SELECTION_EVENT, { detail: captured })))
    await waitFor(() => expect(mocks.stream).toHaveBeenCalledOnce())
    expect(mocks.stream.mock.calls[0][0].messages.at(-1).content)
      .toBe('Explain the Net worth figure ($806,708.50, as of 2026-08-01, Household). Use the captured evidence and distinguish recorded facts from interpretation.')
    expect(mocks.stream.mock.calls[0][0].intent).toBe('selection')
  })

  // Both evidence blocks speak the shared Disclosure grammar (2026-09-13 polish §2.6)
  // while keeping the class hooks their own stylesheet is written against.
  it('the computed summary keeps its figures behind a closed Disclosure', () => {
    render(<ComputedSummary bundle={bundle} />)
    const inspect = document.querySelector('.assistant-computed-summary details.disclosure') as HTMLDetailsElement
    expect(inspect.open).toBe(false)
    expect(inspect.querySelector(':scope > summary')?.textContent).toBe('Inspect the figures and comparison window')
    expect(inspect.querySelector(':scope > .disclosure-body dl dt')?.textContent).toBe('Living spending')
  })

  it('each saved finding is a Disclosure that keeps the assistant-saved-finding hook', async () => {
    mocks.findings.mockResolvedValue([{ id: 7, title: 'August looked fine', content: 'All good.', model_used: 'kimi-k3',
      context: {}, evidence: bundle.metrics, evidence_as_of: '2026-09-12T09:00:00Z', created_at: '2026-09-12T10:00:00Z' }])
    render(<SavedFindings revision={0} />)
    await screen.findByText('August looked fine')
    const finding = document.querySelector('details.disclosure.assistant-saved-finding') as HTMLDetailsElement
    expect(finding.open).toBe(false)
    expect(finding.querySelector(':scope > summary small')?.textContent).toContain('Evidence from')
    const body = finding.querySelector(':scope > .disclosure-body') as HTMLElement
    expect(within(body).getByRole('button', { name: 'Remove saved finding' })).toBeTruthy()
    expect(within(body).getByRole('button', { name: 'Inspect Living spending' })).toBeTruthy()
  })

  it('renders only known metric references as inspectable values', () => {
    render(<AssistantMessageBody text={'Known [[metric:living_spending_2026_08_abc]], unknown [[metric:invented]], [bad](https://example.com).'} metrics={bundle.metrics} />)
    expect(screen.getByRole('button', { name: 'Inspect Living spending' }).textContent).toBe('$1,234.56')
    expect(screen.getByText(/Evidence unavailable/)).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('preserves the precise payroll election in an evidence reference', () => {
    const metric = { ...bundle.metrics[0], id: 'to_cap_rate', label: 'Election to reach cap', value: '0.123456789', unit: 'ratio', display_precision: 7 }
    render(<AssistantMessageBody text="Use [[metric:to_cap_rate]]." metrics={[metric]} />)
    expect(screen.getByRole('button', { name: 'Inspect Election to reach cap' }).textContent).toBe('12.3456789%')
  })
})
